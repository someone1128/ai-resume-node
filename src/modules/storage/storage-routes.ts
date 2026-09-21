import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireUser } from '@/auth/request-user.js';
import type { AppEnv } from '@/config/env.js';
import { AppError } from '@/common/errors.js';
import { ok } from '@/common/http-response.js';
import { uploadToCos } from '@/modules/storage/cos-service.js';

export function registerStorageRoutes(app: FastifyInstance, env: AppEnv) {
  app.post(
    '/dev/file/uploadTencentReturnUrl',
    { preHandler: requireUser(env) },
    async (request: FastifyRequest) => {
      const part = await request.file();
      if (!part) throw new AppError(400, '请上传文件');
      const body = await part.toBuffer();
      if (body.byteLength > 20 * 1024 * 1024) throw new AppError(400, '文件不能超过 20MB');
      return ok(await uploadToCos(env, body, part.mimetype, part.filename));
    },
  );
}
