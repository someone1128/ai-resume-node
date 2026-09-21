import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import websocket from '@fastify/websocket';

type SocketGroup = Set<WebSocket>;

const sockets = new Map<string, SocketGroup>();

function socketKey(userId: string, type: string) {
  return `${userId}:${type}`;
}

function removeSocket(key: string, socket: WebSocket) {
  const group = sockets.get(key);
  if (!group) return;
  group.delete(socket);
  if (!group.size) sockets.delete(key);
}

/**
 * Keeps the legacy `/ws/:userId/:type` payment notification contract used by
 * the two web clients. The Node callback remains the source of truth; this
 * channel only informs an already open browser that the order was processed.
 */
export function registerPaymentWebSocket(app: FastifyInstance) {
  app.register(websocket);
  // Register the route in a child scope so the root plugin's onRoute hook sees
  // it. Registering the route directly on the root scope would make Fastify
  // treat it as a normal HTTP handler.
  app.register(async (scope) => {
    scope.get<{ Params: { userId: string; type: string } }>(
      '/ws/:userId/:type',
      { websocket: true },
      (socket, request) => {
        const key = socketKey(request.params.userId, request.params.type);
        const group = sockets.get(key) ?? new Set<WebSocket>();
        group.add(socket);
        sockets.set(key, group);

        const cleanup = () => removeSocket(key, socket);
        socket.once('close', cleanup);
        socket.once('error', cleanup);
        socket.on('message', () => {
          // Java's endpoint echoes client messages. Preserve that small legacy
          // behavior without allowing arbitrary broadcasts between users.
          if (socket.readyState === socket.OPEN) socket.send('');
        });
      },
    );
  });
}

export function notifyPaymentWebSocket(userId: string, type: string, payload: unknown) {
  const group = sockets.get(socketKey(userId, type));
  if (!group) return 0;
  const message = JSON.stringify(payload);
  let sent = 0;
  for (const socket of group) {
    if (socket.readyState !== socket.OPEN) continue;
    socket.send(message);
    sent += 1;
  }
  return sent;
}
