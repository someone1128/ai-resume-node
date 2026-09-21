import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchJson, fetchWithTimeout, HttpClientError } from '@/common/http-client.js';

const servers: Server[] = [];

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe('http client', () => {
  it('parses successful JSON responses', async () => {
    const baseUrl = await startServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true }));
    });
    await expect(fetchJson<{ ok: boolean }>(baseUrl, {}, 500)).resolves.toEqual({ ok: true });
  });

  it('classifies non-JSON and non-2xx responses', async () => {
    const invalidUrl = await startServer((_request, response) => response.end('not-json'));
    await expect(fetchJson(invalidUrl, {}, 500)).rejects.toMatchObject({
      name: 'HttpClientError',
      status: 200,
    });

    const errorUrl = await startServer((_request, response) => {
      response.statusCode = 503;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ reason: 'maintenance' }));
    });
    await expect(fetchJson(errorUrl, {}, 500)).rejects.toMatchObject({
      name: 'HttpClientError',
      status: 503,
      responseBody: { reason: 'maintenance' },
    });
  });

  it('turns an aborted upstream request into a timeout error', async () => {
    const slowUrl = await startServer((_request, response) => {
      setTimeout(() => response.end('late'), 100);
    });
    await expect(fetchWithTimeout(slowUrl, {}, 10)).rejects.toBeInstanceOf(HttpClientError);
    await expect(fetchWithTimeout(slowUrl, {}, 10)).rejects.toMatchObject({
      message: '外部请求超时',
    });
  });
});
