import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import { loadEnv, type AppEnv } from '@/config/env.js';
import { AppError } from '@/common/errors.js';
import { fail, ok } from '@/common/http-response.js';
import { createDatabase } from '@/infrastructure/database.js';
import { registerResumeRoutes } from '@/modules/resume/resume-routes.js';
import { registerAiRoutes } from '@/modules/ai/ai-routes.js';
import { registerStorageRoutes } from '@/modules/storage/storage-routes.js';
import { registerCampusRoutes } from '@/modules/campus/campus-routes.js';
import { registerDictRoutes } from '@/modules/admin/dict-routes.js';
import { registerAdminAuthRoutes } from '@/modules/admin/admin-auth-routes.js';
import { registerDistributionRoutes } from '@/modules/distribution/distribution-routes.js';
import { registerAdSlotRoutes } from '@/modules/ad-slot/ad-slot-routes.js';
import { registerNotificationRoutes } from '@/modules/notification/notification-routes.js';
import { registerPaymentRoutes } from '@/modules/payment/payment-routes.js';
import { registerJsapiTestRoutes } from '@/modules/payment/jsapi-test-routes.js';
import { registerChatRoutes } from '@/modules/chat/chat-routes.js';
import { registerPhotoRoutes } from '@/modules/photo/photo-routes.js';
import { registerAuthRoutes } from '@/modules/auth/auth-routes.js';
import { registerExtensionAiRoutes } from '@/modules/extension/extension-ai-routes.js';
import { registerPaymentWebSocket } from '@/modules/payment/payment-websocket.js';
import { closeAuthRedis, pingAuthRedis } from '@/auth/request-user.js';
import { registerMaintenanceJobs } from '@/modules/maintenance/photo-compensation.js';

export function buildApp(env: AppEnv = loadEnv()): FastifyInstance {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  const corsOrigins = env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.register(cors, { origin: corsOrigins, credentials: true });
  app.register(helmet);
  app.register(sensible);
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

  // Axios may send action requests with JSON content type but an empty body.
  // Treat that legacy shape as an empty object instead of rejecting it before
  // the route handler gets a chance to process the action.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, payload, done) => {
    const text = String(payload).trim();
    if (!text) return done(null, {});
    try {
      return done(null, JSON.parse(text));
    } catch (error) {
      return done(error as Error);
    }
  });

  // The existing Axios client sends empty POST/PUT requests as form encoded
  // payloads for actions such as create, collect and publish. Accept that
  // legacy media type while keeping Fastify's JSON parser for normal bodies.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, payload, done) => done(null, payload),
  );

  const database = createDatabase(env);
  registerResumeRoutes(app, env, database);
  registerAiRoutes(app, env, database);
  registerStorageRoutes(app, env);
  registerCampusRoutes(app, env, database);
  registerDictRoutes(app, env, database);
  registerAdminAuthRoutes(app, env, database);
  registerDistributionRoutes(app, env, database);
  registerAdSlotRoutes(app, env, database);
  registerNotificationRoutes(app, env, database);
  registerPaymentRoutes(app, env, database);
  registerPaymentWebSocket(app);
  registerJsapiTestRoutes(app, env, database);
  registerChatRoutes(app, env, database);
  registerPhotoRoutes(app, env, database);
  registerAuthRoutes(app, env, database);
  registerExtensionAiRoutes(app, env);
  registerMaintenanceJobs(app, env, database);
  app.addHook('onClose', async () => {
    await database.destroy();
    await closeAuthRedis();
  });

  // Keep a minimal mutation audit trail without logging request bodies, tokens,
  // resume content or payment signatures. The route template prevents query
  // strings (which may contain codes or order numbers) from entering logs.
  app.addHook('onResponse', async (request, reply) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    request.log.info(
      {
        audit: true,
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? request.url.split('?')[0],
        statusCode: reply.statusCode,
        userId: request.userId,
        adminId: request.adminId,
      },
      'mutation completed',
    );
  });

  app.get('/ready', async (request, reply) => {
    void request;
    try {
      await database.selectNoFrom((expression) => expression.val(1).as('ok')).execute();
      await pingAuthRedis(env);
      return ok({ status: 'ready', database: 'ok', redis: 'ok', environment: env.NODE_ENV });
    } catch {
      return reply.code(503).send(fail(503, '数据库未就绪'));
    }
  });

  app.get('/health', async () => ok({ status: 'ok', environment: env.NODE_ENV }));

  app.setErrorHandler((error, request, reply) => {
    request.log.error(
      {
        requestId: request.id,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorCodeDetail:
          error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined,
        errorCode: error instanceof AppError ? error.code : 500,
      },
      'request failed',
    );

    if (error instanceof AppError) {
      return reply.code(error.code >= 500 ? 500 : 200).send(fail(error.code, error.message));
    }

    return reply.code(500).send(fail(500, '服务器内部错误'));
  });

  return app;
}
