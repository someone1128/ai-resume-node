import type { FastifyRequest } from 'fastify';
import { AppError } from '@/common/errors.js';
import type { AppEnv } from '@/config/env.js';
import { Redis } from 'ioredis';

let redisClient: Redis | undefined;

function getRedis(env: AppEnv): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    redisClient.on('error', () => undefined);
  }
  return redisClient;
}

export function requestToken(request: FastifyRequest): string | undefined {
  const tokenHeader =
    request.headers.token ??
    request.headers['x-offer-star-token'] ??
    request.headers.authorization?.replace(/^Bearer\s+/i, '');
  return Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
}

async function resolveLegacyToken(env: AppEnv, token: string): Promise<string | undefined> {
  try {
    const redis = getRedis(env);
    // Snowy uses Sa-Token client login with the `C` login type. The value of
    // token:C:token:<token> is the client_user ID. Keep the default namespace
    // as a fallback for old/admin tokens without changing Redis data.
    const clientId = await redis.get(`token:C:token:${token}`);
    if (clientId) return clientId;
    return (await redis.get(`token:token:${token}`)) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function resolveAdminToken(env: AppEnv, token: string): Promise<string | undefined> {
  try {
    const redis = getRedis(env);
    const adminId = await redis.get(`token:B:token:${token}`);
    if (adminId) return adminId;
    return (await redis.get(`token:token:${token}`)) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function saveAdminToken(env: AppEnv, token: string, userId: string): Promise<void> {
  await getRedis(env).set(`token:B:token:${token}`, userId, 'EX', env.ADMIN_TOKEN_TTL_SECONDS);
}

export async function deleteAdminToken(env: AppEnv, token: string): Promise<void> {
  await getRedis(env).del(`token:B:token:${token}`);
}

export async function saveClientToken(env: AppEnv, token: string, userId: string): Promise<void> {
  await getRedis(env).set(`token:C:token:${token}`, userId, 'EX', env.CLIENT_TOKEN_TTL_SECONDS);
}

export async function deleteClientToken(env: AppEnv, token: string): Promise<void> {
  await getRedis(env).del(`token:C:token:${token}`);
}

export async function pingAuthRedis(env: AppEnv): Promise<void> {
  await getRedis(env).ping();
}

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | undefined;
  }
}

export function requireUser(env: AppEnv) {
  return async function authenticate(request: FastifyRequest): Promise<void> {
    const token = requestToken(request);

    if (env.TEST_AUTH_ENABLED && token === env.TEST_AUTH_TOKEN) {
      request.userId = env.TEST_USER_ID;
      return;
    }

    if (token) {
      const userId = await resolveLegacyToken(env, token);
      if (userId) {
        request.userId = userId;
        return;
      }
    }

    throw new AppError(401, '登录状态已失效');
  };
}

export async function closeAuthRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = undefined;
  }
}
