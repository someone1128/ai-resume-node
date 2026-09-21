/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { AppError } from '@/common/errors.js';
import { ok } from '@/common/http-response.js';
import { requireUser } from '@/auth/request-user.js';
import type { AppEnv } from '@/config/env.js';
import type { Database } from '@/infrastructure/database.js';
import { fetchWithTimeout } from '@/common/http-client.js';
import { uploadToCos } from '@/modules/storage/cos-service.js';

type GenerateBody = { image?: string; sizeId?: string; templateCode?: string; gender?: string };
const sizes: Record<string, { name: string; width: number; height: number }> = {
  '1inch': { name: '一寸', width: 295, height: 413 },
  '2inch': { name: '二寸', width: 413, height: 579 },
  small_1inch: { name: '小一寸', width: 260, height: 378 },
  small_2inch: { name: '小二寸', width: 390, height: 567 },
};
const photoFunction = 'AI证件照生成';
const maxUploadBytes = 15 * 1024 * 1024;
const imageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const imageSuffixes = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

function normalizeImageMimeType(contentType: string | null | undefined) {
  return (contentType ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

export function buildPhotoProviderBody(input: {
  model: string;
  prompt: string;
  image: string;
  size: string;
}) {
  return {
    model: input.model,
    prompt: input.prompt,
    image: input.image,
    size: input.size,
    watermark: false,
    n: 1,
  };
}

function id() {
  return randomUUID().replaceAll('-', '').slice(0, 20);
}
function mapTemplate(row: any) {
  return {
    id: row.id,
    templateCode: row.template_code,
    templateName: row.template_name,
    gender: row.gender,
    sampleImageUrl: row.sample_image_url,
    prompt: row.prompt,
    status: row.status,
    sortCode: row.sort_code,
    remark: row.remark,
    extJson: row.ext_json,
  };
}
function mapRecord(row: any) {
  return {
    ...row,
    sourceImageUrl: row.source_image_url,
    resultImageUrl: row.result_image_url,
    sizeId: row.size_id,
    sizeName: row.size_name,
    backgroundColor: row.background_color,
    backgroundHex: row.background_hex,
    templateId: row.template_id,
    templateName: row.template_name,
    providerRequestId: row.provider_request_id,
    durationMs: row.duration_ms,
    estimatedCost: row.estimated_cost,
    billingMode: row.billing_mode,
    costCount: row.cost_count,
    memberSnapshot: row.member_snapshot,
    errorMessage: row.error_message,
    createTime: row.create_time,
    updateTime: row.update_time,
  };
}

export function registerPhotoRoutes(app: FastifyInstance, env: AppEnv, db: Kysely<Database>) {
  const authenticate = requireUser(env);

  app.get('/c/photo/template', async (request) => {
    const gender = String((request.query as { gender?: string }).gender ?? '');
    let query = db
      .selectFrom('sc_ai_photo_template_config')
      .selectAll()
      .where('delete_flag', '=', 'NOT_DELETE')
      .where('status', '!=', 'DISABLE');
    if (gender)
      query = query.where((eb: any) =>
        eb.or([eb('gender', '=', gender), eb('gender', 'is', null)]),
      ) as typeof query;
    const rows = await query.orderBy('sort_code', 'asc').execute();
    return ok(rows.map(mapTemplate));
  });

  // The legacy front-end uploads the source portrait before invoking generation.
  // Keep the Java endpoint and its validation semantics so callers do not need
  // to change their upload flow during the migration.
  app.post('/c/photo/file/upload', { preHandler: authenticate }, async (request) => {
    const part = await request.file();
    if (!part) throw new AppError(400, '请选择图片文件');
    const filename = part.filename.toLowerCase();
    const suffix = filename.includes('.') ? (filename.split('.').pop() ?? '') : '';
    if (!imageMimeTypes.has(part.mimetype) || !imageSuffixes.has(suffix))
      throw new AppError(400, '仅支持 JPG、PNG、GIF 或 WEBP 图片');
    const body = await part.toBuffer();
    if (body.byteLength > maxUploadBytes) throw new AppError(400, '图片大小不能超过15MB');
    const contentType = normalizeImageMimeType(part.mimetype);
    if (!matchesImageSignature(body, contentType)) throw new AppError(400, '图片文件内容无效');
    return ok(await uploadToCos(env, body, contentType, part.filename));
  });

  app.get('/c/photo/quota', { preHandler: authenticate }, async (request) =>
    ok({ remainingCount: await getQuota(db, request.userId!) }),
  );

  app.post('/c/photo/generation', { preHandler: authenticate }, async (request) => {
    const body = request.body as {
      sizeId?: string;
      templateCode?: string;
      gender?: string;
      status?: string;
      sourceImageUrl?: string;
      resultImageUrl?: string;
    };
    const recordId = id();
    await db
      .insertInto('sc_ai_photo_generation_record')
      .values({
        id: recordId,
        delete_flag: 'NOT_DELETE',
        create_time: new Date(),
        update_time: new Date(),
        user_id: request.userId!,
        source_image_url: body.sourceImageUrl ?? null,
        result_image_url: body.resultImageUrl ?? null,
        size_id: body.sizeId ?? null,
        size_name: sizes[body.sizeId ?? '']?.name ?? null,
        width: sizes[body.sizeId ?? '']?.width ?? null,
        height: sizes[body.sizeId ?? '']?.height ?? null,
        background_color: null,
        background_hex: null,
        template_id: body.templateCode ?? null,
        template_name: null,
        gender: body.gender ?? null,
        status: body.status ?? 'PROCESSING',
        error_message: null,
        provider: 'volcengine',
        model_id: env.DOUBAO_IMAGE_MODEL ?? null,
        provider_request_id: null,
        duration_ms: 0,
        estimated_cost: 0,
        billing_mode: 'COUNT_PACKAGE',
        cost_count: 1,
        member_snapshot: 'PHOTO_CREDIT',
        ext_json: null,
      } as any)
      .execute();
    return ok({ id: recordId });
  });

  app.get('/c/photo/generation', { preHandler: authenticate }, async (request) => {
    const query = request.query as { page?: string; limit?: string; status?: string };
    const current = Math.max(1, Number(query.page ?? 1));
    const size = Math.min(100, Math.max(1, Number(query.limit ?? 10)));
    let builder = db
      .selectFrom('sc_ai_photo_generation_record')
      .selectAll()
      .where('user_id', '=', request.userId!)
      .where('delete_flag', '=', 'NOT_DELETE');
    if (query.status) builder = builder.where('status', '=', query.status) as typeof builder;
    const [records, count] = await Promise.all([
      builder
        .orderBy('create_time', 'desc')
        .limit(size)
        .offset((current - 1) * size)
        .execute(),
      db
        .selectFrom('sc_ai_photo_generation_record')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('user_id', '=', request.userId!)
        .where('delete_flag', '=', 'NOT_DELETE')
        .executeTakeFirst(),
    ]);
    return ok({
      records: records.map(mapRecord),
      total: Number(count?.count ?? 0),
      current,
      size,
      pages: Math.ceil(Number(count?.count ?? 0) / size),
    });
  });

  app.get('/c/photo/generation/:id', { preHandler: authenticate }, async (request) => {
    const row = await db
      .selectFrom('sc_ai_photo_generation_record')
      .selectAll()
      .where('id', '=', String((request.params as { id: string }).id))
      .where('user_id', '=', request.userId!)
      .where('delete_flag', '=', 'NOT_DELETE')
      .executeTakeFirst();
    if (!row) throw new AppError(404, 'AI证件照生成记录不存在');
    return ok(mapRecord(row));
  });

  app.delete('/c/photo/generation/:id', { preHandler: authenticate }, async (request) => {
    const result = await db
      .updateTable('sc_ai_photo_generation_record')
      .set({ delete_flag: 'DELETED', update_time: new Date() })
      .where('id', '=', String((request.params as { id: string }).id))
      .where('user_id', '=', request.userId!)
      .executeTakeFirst();
    if (!Number(result.numUpdatedRows)) throw new AppError(404, '记录不存在或无权操作');
    return ok(null);
  });

  app.post('/c/photo/generate', { preHandler: authenticate }, async (request) => {
    const body = request.body as GenerateBody;
    if (!body.image || !body.sizeId || !body.templateCode || !body.gender)
      throw new AppError(400, '图片、尺寸、模板和性别不能为空');
    const size = sizes[body.sizeId];
    if (!size) throw new AppError(400, '不支持的证件照尺寸');
    if (!env.DOUBAO_API_KEY || !env.DOUBAO_IMAGE_MODEL)
      throw new AppError(503, '火山方舟图片模型未配置');
    const template = await db
      .selectFrom('sc_ai_photo_template_config')
      .selectAll()
      .where('template_code', '=', body.templateCode)
      .where('delete_flag', '=', 'NOT_DELETE')
      .where('status', '!=', 'DISABLE')
      .executeTakeFirst();
    if (!template) throw new AppError(404, 'AI证件照模板不存在或已停用');
    if (!(await consumeQuota(db, request.userId!)))
      throw new AppError(403, 'AI证件照剩余次数不足，请先购买次数包');
    let sourceImageUrl: string;
    try {
      sourceImageUrl = await persistInputImage(env, body.image);
    } catch (error) {
      await refundQuota(db, request.userId!);
      throw error;
    }
    const started = Date.now();
    const recordId = id();
    try {
      await db
        .insertInto('sc_ai_photo_generation_record')
        .values({
          id: recordId,
          delete_flag: 'NOT_DELETE',
          create_time: new Date(),
          update_time: new Date(),
          user_id: request.userId!,
          source_image_url: sourceImageUrl,
          result_image_url: null,
          size_id: body.sizeId,
          size_name: size.name,
          width: size.width,
          height: size.height,
          background_color: null,
          background_hex: null,
          template_id: template.template_code,
          template_name: template.template_name,
          gender: body.gender,
          status: 'PROCESSING',
          error_message: null,
          provider: 'volcengine',
          model_id: env.DOUBAO_IMAGE_MODEL,
          provider_request_id: null,
          duration_ms: 0,
          estimated_cost: 0,
          billing_mode: 'COUNT_PACKAGE',
          cost_count: 1,
          member_snapshot: 'PHOTO_CREDIT',
          ext_json: null,
        } as any)
        .execute();
      const response = await fetchWithTimeout(
        env.DOUBAO_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.DOUBAO_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            buildPhotoProviderBody({
              model: env.DOUBAO_IMAGE_MODEL,
              prompt: `${template.prompt ?? ''}\n生成${size.name}证件照，性别：${body.gender}`,
              image: body.image,
              // The provider output size is independent of the final ID-photo
              // specification. Seedream 4.5 rejects the 295x413/413x579
              // business dimensions; keep those dimensions in the record and
              // send the provider-compatible configured size instead.
              size: env.DOUBAO_IMAGE_SIZE,
            }),
          ),
        },
        env.AI_REQUEST_TIMEOUT_MS,
      );
      const payload = (await response.json()) as any;
      if (!response.ok) throw new Error('provider request failed');
      const providerResultUrl =
        payload.data?.[0]?.url ??
        (payload.data?.[0]?.b64_json ? `data:image/png;base64,${payload.data[0].b64_json}` : null);
      if (!providerResultUrl) throw new Error('provider response missing image');
      const resultUrl = await persistResultImage(env, providerResultUrl);
      const duration = Date.now() - started;
      await db
        .updateTable('sc_ai_photo_generation_record')
        .set({
          status: 'SUCCESS',
          result_image_url: resultUrl,
          provider_request_id: payload.id ?? null,
          duration_ms: duration,
          update_time: new Date(),
        })
        .where('id', '=', recordId)
        .execute();
      return ok({
        recordId,
        sourceImageUrl,
        resultImageUrl: resultUrl,
        provider: 'volcengine',
        modelId: env.DOUBAO_IMAGE_MODEL,
        providerRequestId: payload.id ?? null,
        durationMs: duration,
        remainingCount: await getQuota(db, request.userId!),
      });
    } catch {
      await db
        .updateTable('sc_ai_photo_generation_record')
        .set({
          status: 'FAILED',
          error_message: '火山方舟图片生成失败',
          duration_ms: Date.now() - started,
          update_time: new Date(),
        })
        .where('id', '=', recordId)
        .execute();
      await refundQuota(db, request.userId!);
      throw new AppError(502, 'AI证件照生成失败');
    }
  });
}

export function matchesImageSignature(body: Uint8Array, contentType: string): boolean {
  if (contentType === 'image/jpeg') return body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (contentType === 'image/png')
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => body[index] === byte,
    );
  if (contentType === 'image/gif') {
    const header = Buffer.from(body.subarray(0, 6)).toString('ascii');
    return header === 'GIF87a' || header === 'GIF89a';
  }
  if (contentType === 'image/webp') {
    return (
      Buffer.from(body.subarray(0, 4)).toString('ascii') === 'RIFF' &&
      Buffer.from(body.subarray(8, 12)).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

async function persistInputImage(env: AppEnv, value: string): Promise<string> {
  if (/^https?:\/\//i.test(value)) return value;
  const match = value.match(/^data:([^;,]+)?;base64,([\s\S]+)$/i);
  const base64 = match?.[2] ?? value;
  const contentType = normalizeImageMimeType(match?.[1] ?? 'image/png');
  const body = Buffer.from(base64, 'base64');
  if (!isSupportedImagePayload(body, contentType)) throw new AppError(400, '图片文件内容无效');
  return uploadToCos(env, body, contentType, 'photo-input.png');
}

async function persistResultImage(env: AppEnv, value: string): Promise<string> {
  const data = value.match(/^data:([^;,]+)?;base64,([\s\S]+)$/i);
  if (data) {
    const contentType = normalizeImageMimeType(data[1] ?? 'image/png');
    const encoded = data[2];
    if (!encoded) throw new Error('provider image is empty');
    const body = Buffer.from(encoded, 'base64');
    if (!isSupportedImagePayload(body, contentType)) throw new Error('provider image is invalid');
    return uploadToCos(env, body, contentType, 'photo-result.png');
  }
  if (/^https?:\/\//i.test(value)) {
    const response = await fetchWithTimeout(value, {}, env.AI_REQUEST_TIMEOUT_MS);
    if (!response.ok) throw new Error('provider image download failed');
    const contentType = normalizeImageMimeType(response.headers.get('content-type') ?? 'image/png');
    const body = Buffer.from(await response.arrayBuffer());
    if (!isSupportedImagePayload(body, contentType)) throw new Error('provider image is invalid');
    return uploadToCos(env, body, contentType, 'photo-result.png');
  }
  throw new Error('provider response missing image');
}

export function isSupportedImagePayload(
  body: Uint8Array,
  contentType: string,
  maxBytes = maxUploadBytes,
): boolean {
  const normalized = normalizeImageMimeType(contentType);
  return (
    body.byteLength > 0 &&
    body.byteLength <= maxBytes &&
    imageMimeTypes.has(normalized) &&
    matchesImageSignature(body, normalized)
  );
}

async function getQuota(db: Kysely<Database>, userId: string) {
  const row = await db
    .selectFrom('sc_user_function_limits')
    .select('remaining_uses')
    .where('user_id', '=', userId)
    .where('function_name', '=', photoFunction)
    .executeTakeFirst();
  return Number(row?.remaining_uses ?? 0);
}
async function consumeQuota(db: Kysely<Database>, userId: string) {
  const result = await db
    .updateTable('sc_user_function_limits')
    .set(({ eb }: any) => ({
      remaining_uses: eb('remaining_uses', '-', 1),
      update_time: new Date(),
    }))
    .where('user_id', '=', userId)
    .where('function_name', '=', photoFunction)
    .where('remaining_uses', '>', 0)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

async function refundQuota(db: Kysely<Database>, userId: string) {
  await db
    .updateTable('sc_user_function_limits')
    .set(({ eb }: any) => ({
      remaining_uses: eb('remaining_uses', '+', 1),
      update_time: new Date(),
    }))
    .where('user_id', '=', userId)
    .where('function_name', '=', photoFunction)
    .execute();
}
