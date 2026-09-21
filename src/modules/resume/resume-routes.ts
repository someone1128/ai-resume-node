import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { AppError } from '@/common/errors.js';
import { ok } from '@/common/http-response.js';
import { requireUser } from '@/auth/request-user.js';
import type { AppEnv } from '@/config/env.js';
import type { Database } from '@/infrastructure/database.js';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export const DEFAULT_MODULE_TYPES = [
  '基本信息',
  '专业技能',
  '教育经历',
  '工作经历',
  '项目经历',
  '荣誉奖项',
  '研究经历',
  '作品集',
  '其他经历',
  '个人总结',
] as const;

const resumeColumns = [
  'id',
  'title',
  'user_id as userId',
  'is_published as isPublished',
  'publish_date as publishDate',
  'preview_image as previewImage',
  'view_count as viewCount',
  'usage_count as usageCount',
  'collect_count as collectCount',
  'create_time as createTime',
  'update_time as updateTime',
  'delete_flag as deleteFlag',
  'style_config as styleConfig',
  'publish_id as publishId',
  'template',
] as const;

type ResumeQuery = {
  page?: string;
  limit?: string;
  isPublished?: string;
  keyword?: string;
};

type BodyRecord = Record<string, unknown>;

function bodyRecord(body: unknown): BodyRecord {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, '请求参数格式错误');
  }
  return body as BodyRecord;
}

function requiredString(body: BodyRecord, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(400, `${key}不能为空`);
  }
  return value.trim();
}

function pageValue(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function pageResponse<T>(records: T[], total: number, page: number, limit: number) {
  // Snowy's CommonPage shape is consumed directly by both web clients.
  // Keep the legacy field names here instead of translating them in each UI.
  return {
    page,
    limit,
    totalPage: Math.ceil(total / limit),
    total,
    list: records,
    reservedObject: null,
  };
}

async function getOwnedResume(db: Kysely<Database>, resumeId: string, userId: string) {
  return db
    .selectFrom('sc_resume')
    .select('id')
    .where('id', '=', resumeId)
    .where('user_id', '=', userId)
    .where('delete_flag', '=', 'NOT_DELETE')
    .executeTakeFirst();
}

async function getOwnedOrPublishedResume(db: Kysely<Database>, resumeId: string, userId: string) {
  return db
    .selectFrom('sc_resume')
    .select('id')
    .where('id', '=', resumeId)
    .where('delete_flag', '=', 'NOT_DELETE')
    .where(({ or, eb }) => or([eb('user_id', '=', userId), eb('is_published', '=', 1)]))
    .executeTakeFirst();
}

async function updateOwnedResume(
  db: Kysely<Database>,
  resumeId: string,
  userId: string,
  values: Record<string, unknown>,
) {
  const owned = await getOwnedResume(db, resumeId, userId);
  if (!owned) throw new AppError(400, '简历不存在或无权操作');
  await db
    .updateTable('sc_resume')
    .set(values as never)
    .where('id', '=', resumeId)
    .execute();
}

async function listResumes(
  db: Kysely<Database>,
  query: ResumeQuery,
  published: boolean,
  userId?: string,
) {
  const page = pageValue(query.page, 1, 10_000);
  const limit = pageValue(query.limit, 10, 100);
  let builder = db
    .selectFrom('sc_resume')
    .select(resumeColumns)
    .where('delete_flag', '=', 'NOT_DELETE')
    .where('is_published', '=', published ? 1 : 0)
    .orderBy('update_time', 'desc')
    .limit(limit)
    .offset((page - 1) * limit);
  if (userId) builder = builder.where('user_id', '=', userId);
  if (query.keyword) builder = builder.where('title', 'like', `%${query.keyword}%`);
  const records = await builder.execute();
  let countBuilder = db
    .selectFrom('sc_resume')
    .select(sql<number>`count(*)`.as('count'))
    .where('delete_flag', '=', 'NOT_DELETE')
    .where('is_published', '=', published ? 1 : 0);
  if (userId) countBuilder = countBuilder.where('user_id', '=', userId);
  if (query.keyword) countBuilder = countBuilder.where('title', 'like', `%${query.keyword}%`);
  const count = await countBuilder.executeTakeFirst();
  return ok(pageResponse(records, Number(count?.count ?? 0), page, limit));
}

async function listMemberPackages(db: Kysely<Database>, category: string) {
  const packages = await db
    .selectFrom('sc_member_package')
    .select([
      'id',
      'delete_flag as deleteFlag',
      'create_time as createTime',
      'update_time as updateTime',
      'package_name as packageName',
      'current_amount as currentAmount',
      'original_amount as originalAmount',
      'sort',
      'ext_json as extJson',
      'gift_day as giftDay',
      'tags',
      'billing_mode as billingMode',
      'usage_count as usageCount',
      'stripe_product_id as stripeProductId',
    ] as const)
    .where('delete_flag', '=', 'NOT_DELETE')
    .where('ext_json', '=', category)
    .orderBy('sort', 'asc')
    .orderBy('id', 'asc')
    .execute();
  return ok(packages);
}

function bool(value: number | boolean | null): boolean {
  return value === true || value === 1;
}

function mapResume(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    userId: row.userId,
    isPublished: bool(row.isPublished as number | boolean | null),
    publishDate: row.publishDate,
    previewImage: row.previewImage,
    viewCount: row.viewCount,
    usageCount: row.usageCount,
    collectCount: row.collectCount,
    createTime: row.createTime,
    updateTime: row.updateTime,
    deleteFlag: row.deleteFlag,
    styleConfig: row.styleConfig,
    publishId: row.publishId,
    template: row.template,
  };
}

export async function hasActiveResumeMembership(db: Kysely<Database>, userId: string) {
  const user = await db
    .selectFrom('client_user')
    .select(['member_expiration_time', 'offer_member_expiration_time'])
    .where('ID', '=', userId)
    .where('DELETE_FLAG', '=', 'NOT_DELETE')
    .executeTakeFirst();
  const now = Date.now();
  return [user?.member_expiration_time, user?.offer_member_expiration_time].some(
    (value) => value instanceof Date && value.getTime() > now,
  );
}

export async function assertResumeCreationAllowed(db: Kysely<Database>, userId: string) {
  if (await hasActiveResumeMembership(db, userId)) return;
  const existing = await db
    .selectFrom('sc_resume')
    .select('id')
    .where('user_id', '=', userId)
    .where('is_published', '=', 0)
    .where('delete_flag', '=', 'NOT_DELETE')
    .forUpdate()
    .execute();
  if (existing.length >= 3) throw new AppError(400, '非会员简历数量已达上限');
}

export function registerResumeRoutes(app: FastifyInstance, env: AppEnv, db: Kysely<Database>) {
  const authenticate = requireUser(env);

  app.post('/c/resume/webError', async (request) => {
    const body = request.body;
    if (!body || typeof body !== 'object') throw new AppError(400, '错误数据格式不正确');
    // Keep the compatibility endpoint side-effect free. The old service forwarded
    // this payload to an external Feishu webhook; Node must not leak user content
    // into logs or make that external call during migration.
    return ok(null);
  });

  app.post('/c/resume/feedback', { preHandler: authenticate }, async (request) => {
    const body = bodyRecord(request.body);
    const content = body.content ?? body.feedbackContent;
    if (typeof content !== 'string' || content.trim() === '')
      throw new AppError(400, '反馈内容不能为空');
    return ok(null);
  });

  app.get('/c/resume/category', { preHandler: authenticate }, async () => {
    const categories = await db
      .selectFrom('sc_tags')
      .select([
        'id',
        'name',
        'is_category as isCategory',
        'create_time as createTime',
        'update_time as updateTime',
      ] as const)
      .where('is_category', '=', 1)
      .where('delete_flag', '=', 'NOT_DELETE')
      .orderBy('create_time', 'asc')
      .execute();
    return ok(categories);
  });

  app.get<{ Querystring: { code?: string; webName?: string } }>(
    '/c/resume/memberPackage',
    { preHandler: authenticate },
    async (request) => {
      const category =
        request.query.webName === 'photo'
          ? 'AI证件照'
          : request.query.webName === 'offer'
            ? 'offer星球'
            : '高分简历';
      return listMemberPackages(db, category);
    },
  );

  app.get<{ Querystring: { code?: string } }>(
    '/c/resume/memberPackage/offer',
    { preHandler: authenticate },
    async () => listMemberPackages(db, 'offer星球'),
  );

  app.get<{ Querystring: { code?: string } }>(
    '/c/resume/memberPackage/photo',
    { preHandler: authenticate },
    async () => listMemberPackages(db, 'AI证件照'),
  );

  app.get<{ Params: { code: string } }>(
    '/c/resume/redeem/:code',
    { preHandler: authenticate },
    async (request) => {
      const redeem = await db
        .selectFrom('t_redeem_code')
        .select([
          'code_id as codeId',
          'code',
          'code_type as codeType',
          'expiration_time as expirationTime',
          'max_redemption as maxRedemption',
          'current_redemption as currentRedemption',
          'member_package_id as memberPackageId',
          'ext_json as extJson',
          'user_id as userId',
        ] as const)
        .where('code', '=', request.params.code)
        .where('delete_flag', '=', 'NOT_DELETE')
        .where('expiration_time', '>', new Date())
        .executeTakeFirst();
      if (!redeem || (redeem.maxRedemption ?? 0) <= (redeem.currentRedemption ?? 0)) {
        throw new AppError(400, '该兑换码已失效或不存在');
      }
      if (redeem.userId && redeem.userId === request.userId) {
        throw new AppError(400, '无法使用自己的优惠券');
      }
      return ok(redeem);
    },
  );

  app.get<{ Querystring: { functionName?: string } }>(
    '/c/resume/functionLimits/count',
    { preHandler: authenticate },
    async (request) => {
      const functionName = request.query.functionName?.trim();
      if (!functionName) throw new AppError(400, 'functionName不能为空');
      const userId = request.userId as string;
      let limit = await db
        .selectFrom('sc_user_function_limits')
        .select('remaining_uses')
        .where('function_name', '=', functionName)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (!limit) {
        const now = new Date();
        await db
          .insertInto('sc_user_function_limits')
          .values({
            id: randomUUID().replaceAll('-', ''),
            function_name: functionName,
            remaining_uses: 3,
            user_id: userId,
            create_time: now,
            update_time: now,
          })
          .execute();
        limit = { remaining_uses: 3 };
      }
      return ok(limit.remaining_uses ?? 0);
    },
  );

  app.post<{ Querystring: { resumeId?: string } }>(
    '/c/resume/create',
    { preHandler: authenticate },
    async (request) => {
      const userId = request.userId as string;
      const user = await db
        .selectFrom('client_user')
        .select(['NICKNAME', 'NAME'])
        .where('ID', '=', userId)
        .where('DELETE_FLAG', '=', 'NOT_DELETE')
        .executeTakeFirst();
      const title = `${user?.NICKNAME ?? user?.NAME ?? '我的'}的简历`;
      const sourceResumeId = request.query.resumeId;
      const result = await db.transaction().execute(async (trx) => {
        await assertResumeCreationAllowed(trx, userId);
        const now = new Date();
        const resumeId = randomUUID().replaceAll('-', '');
        let sourceModules: Array<{
          module_type: string;
          display_order: number;
          module_content: string | null;
          has_enable: number | boolean | null;
        }> = [];
        if (sourceResumeId) {
          const source = await trx
            .selectFrom('sc_resume')
            .select(['id', 'user_id', 'is_published'])
            .where('id', '=', sourceResumeId)
            .where('delete_flag', '=', 'NOT_DELETE')
            .where(({ or, eb }) => or([eb('user_id', '=', userId), eb('is_published', '=', 1)]))
            .executeTakeFirst();
          if (!source) throw new AppError(400, '源简历不存在或无权使用');
          sourceModules = await trx
            .selectFrom('sc_resume_modules')
            .select(['module_type', 'display_order', 'module_content', 'has_enable'])
            .where('resume_id', '=', sourceResumeId)
            .where('delete_flag', '=', 'NOT_DELETE')
            .orderBy('display_order', 'asc')
            .execute();
        }
        await trx
          .insertInto('sc_resume')
          .values({
            id: resumeId,
            title,
            user_id: userId,
            is_published: 0,
            publish_date: null,
            preview_image: null,
            view_count: 0,
            usage_count: 0,
            collect_count: 0,
            create_time: now,
            update_time: now,
            delete_flag: 'NOT_DELETE',
            style_config: null,
            publish_id: null,
            template: 'template2',
          })
          .execute();
        const modules = sourceModules.length
          ? sourceModules.map((module) => ({
              id: randomUUID().replaceAll('-', ''),
              resume_id: resumeId,
              module_type: module.module_type,
              display_order: module.display_order,
              module_content: module.module_content ?? '{}',
              create_time: now,
              update_time: now,
              delete_flag: 'NOT_DELETE',
              user_id: userId,
              has_enable: module.has_enable ?? 1,
            }))
          : DEFAULT_MODULE_TYPES.map((moduleType, index) => ({
              id: randomUUID().replaceAll('-', ''),
              resume_id: resumeId,
              module_type: moduleType,
              display_order: index + 1,
              module_content: '{}',
              create_time: now,
              update_time: now,
              delete_flag: 'NOT_DELETE',
              user_id: userId,
              has_enable: moduleType === '基本信息' ? 1 : 0,
            }));
        await trx.insertInto('sc_resume_modules').values(modules).execute();
        return {
          id: resumeId,
          title,
          userId,
          resumeModules: modules,
          isPublished: false,
          template: 'template2',
        };
      });
      return ok(result);
    },
  );

  app.get<{ Querystring: ResumeQuery }>(
    '/c/resume/templates',
    { preHandler: authenticate },
    async (request) => listResumes(db, request.query, true),
  );

  app.get<{ Querystring: ResumeQuery }>(
    '/c/resume/templates/my',
    { preHandler: authenticate },
    async (request) => listResumes(db, request.query, false, request.userId),
  );

  app.get<{ Querystring: ResumeQuery }>(
    '/c/resume/templates/myCollects',
    { preHandler: authenticate },
    async (request) => {
      const page = pageValue(request.query.page, 1, 10_000);
      const limit = pageValue(request.query.limit, 10, 100);
      const userId = request.userId as string;
      const query = db
        .selectFrom('sc_resume as r')
        .innerJoin('sc_user_actions as a', 'a.resume_id', 'r.id')
        .select([
          'r.id',
          'r.title',
          'r.user_id as userId',
          'r.is_published as isPublished',
          'r.publish_date as publishDate',
          'r.preview_image as previewImage',
          'r.view_count as viewCount',
          'r.usage_count as usageCount',
          'r.collect_count as collectCount',
          'r.create_time as createTime',
          'r.update_time as updateTime',
          'r.delete_flag as deleteFlag',
          'r.style_config as styleConfig',
          'r.publish_id as publishId',
          'r.template',
        ])
        .where('a.user_id', '=', userId)
        .where('a.action_type', '=', '收藏')
        .where('a.delete_flag', '=', 'NOT_DELETE')
        .where('r.delete_flag', '=', 'NOT_DELETE')
        .orderBy('r.update_time', 'desc')
        .limit(limit)
        .offset((page - 1) * limit);
      const records = await query.execute();
      const count = await db
        .selectFrom('sc_resume as r')
        .innerJoin('sc_user_actions as a', 'a.resume_id', 'r.id')
        .select(sql<number>`count(*)`.as('count'))
        .where('a.user_id', '=', userId)
        .where('a.action_type', '=', '收藏')
        .where('a.delete_flag', '=', 'NOT_DELETE')
        .where('r.delete_flag', '=', 'NOT_DELETE')
        .executeTakeFirst();
      return ok(pageResponse(records, Number(count?.count ?? 0), page, limit));
    },
  );

  app.post<{ Params: { resumeId: string } }>(
    '/c/resume/collect/:resumeId',
    { preHandler: authenticate },
    async (request) => {
      const resume = await getOwnedOrPublishedResume(
        db,
        request.params.resumeId,
        request.userId as string,
      );
      if (!resume) throw new AppError(400, '简历不存在');
      const userId = request.userId as string;
      const exists = await db
        .selectFrom('sc_user_actions')
        .select('id')
        .where('resume_id', '=', request.params.resumeId)
        .where('user_id', '=', userId)
        .where('action_type', '=', '收藏')
        .where('delete_flag', '=', 'NOT_DELETE')
        .executeTakeFirst();
      if (!exists) {
        await db
          .insertInto('sc_user_actions')
          .values({
            id: randomUUID().replaceAll('-', ''),
            resume_id: request.params.resumeId,
            user_id: userId,
            action_type: '收藏',
            delete_flag: 'NOT_DELETE',
          })
          .execute();
      }
      return ok(null);
    },
  );

  app.post<{ Params: { resumeId: string } }>(
    '/c/resume/disCollect/:resumeId',
    { preHandler: authenticate },
    async (request) => {
      await db
        .updateTable('sc_user_actions')
        .set({ delete_flag: 'DELETED' })
        .where('resume_id', '=', request.params.resumeId)
        .where('user_id', '=', request.userId as string)
        .where('action_type', '=', '收藏')
        .where('delete_flag', '=', 'NOT_DELETE')
        .execute();
      return ok(null);
    },
  );

  app.post<{ Params: { resumeId: string } }>(
    '/c/resume/use/:resumeId',
    { preHandler: authenticate },
    async (request) => {
      const resume = await getOwnedOrPublishedResume(
        db,
        request.params.resumeId,
        request.userId as string,
      );
      if (!resume) throw new AppError(400, '简历不存在');
      await db
        .updateTable('sc_resume')
        .set({ usage_count: sql`coalesce(usage_count, 0) + 1`, update_time: new Date() })
        .where('id', '=', request.params.resumeId)
        .execute();
      return ok(null);
    },
  );

  app.delete<{ Params: { resumeId: string } }>(
    '/c/resume/:resumeId',
    { preHandler: authenticate },
    async (request) => {
      const resume = await getOwnedResume(db, request.params.resumeId, request.userId as string);
      if (!resume) throw new AppError(400, '简历不存在');
      await db.transaction().execute(async (trx) => {
        const now = new Date();
        await trx
          .updateTable('sc_resume')
          .set({ delete_flag: 'DELETED', update_time: now })
          .where('id', '=', request.params.resumeId)
          .where('user_id', '=', request.userId as string)
          .execute();
        await trx
          .updateTable('sc_resume_modules')
          .set({ delete_flag: 'DELETED', update_time: now })
          .where('resume_id', '=', request.params.resumeId)
          .where('delete_flag', '=', 'NOT_DELETE')
          .execute();
      });
      return ok(null);
    },
  );

  app.put('/c/resume/name', { preHandler: authenticate }, async (request) => {
    const body = bodyRecord(request.body);
    const resumeId = requiredString(body, 'resumeId');
    const title = requiredString(body, 'title');
    await updateOwnedResume(db, resumeId, request.userId as string, {
      title,
      update_time: new Date(),
    });
    return ok(null);
  });

  app.put('/c/resume/template', { preHandler: authenticate }, async (request) => {
    const body = bodyRecord(request.body);
    const resumeId = requiredString(body, 'resumeId');
    const template = requiredString(body, 'template');
    await updateOwnedResume(db, resumeId, request.userId as string, {
      template,
      update_time: new Date(),
    });
    return ok(null);
  });

  app.put('/c/resume/previewImage', { preHandler: authenticate }, async (request) => {
    const body = bodyRecord(request.body);
    const resumeId = requiredString(body, 'resumeId');
    const previewImage = requiredString(body, 'previewImage');
    await updateOwnedResume(db, resumeId, request.userId as string, {
      preview_image: previewImage,
      update_time: new Date(),
    });
    return ok(null);
  });

  app.put('/c/resume/styleConfig', { preHandler: authenticate }, async (request) => {
    const body = bodyRecord(request.body);
    const resumeId = requiredString(body, 'resumeId');
    const styleConfig = requiredString(body, 'styleConfig');
    await updateOwnedResume(db, resumeId, request.userId as string, {
      style_config: styleConfig,
      update_time: new Date(),
    });
    return ok(null);
  });

  app.post('/c/resume/publish', { preHandler: authenticate }, async (request) => {
    const body = bodyRecord(request.body);
    const resumeId = requiredString(body, 'resumeId');
    const publishTitle = typeof body.publishTitle === 'string' ? body.publishTitle.trim() : '';
    const previewImage = typeof body.previewImage === 'string' ? body.previewImage.trim() : '';
    if (!(await hasActiveResumeMembership(db, request.userId as string))) {
      throw new AppError(403, '非会员用户不得公开发布简历');
    }
    const source = await getOwnedResume(db, resumeId, request.userId as string);
    if (!source) throw new AppError(400, '简历不存在或无权操作');
    const publishId = await db.transaction().execute(async (trx) => {
      const now = new Date();
      const published = await trx
        .selectFrom('sc_resume')
        .select('publish_id as publishId')
        .where('id', '=', resumeId)
        .executeTakeFirst();
      let nextPublishId = published?.publishId ?? '';
      if (!nextPublishId) {
        nextPublishId = randomUUID().replaceAll('-', '');
        const original = await trx
          .selectFrom('sc_resume')
          .selectAll()
          .where('id', '=', resumeId)
          .where('user_id', '=', request.userId as string)
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('sc_resume')
          .values({
            ...original,
            id: nextPublishId,
            title: publishTitle || original.title,
            is_published: 1,
            publish_date: now,
            publish_id: resumeId,
            preview_image: previewImage || original.preview_image,
            create_time: now,
            update_time: now,
            delete_flag: 'NOT_DELETE',
          })
          .execute();
        const sourceModules = await trx
          .selectFrom('sc_resume_modules')
          .selectAll()
          .where('resume_id', '=', resumeId)
          .where('delete_flag', '=', 'NOT_DELETE')
          .execute();
        if (sourceModules.length) {
          await trx
            .insertInto('sc_resume_modules')
            .values(
              sourceModules.map((module) => ({
                ...module,
                id: randomUUID().replaceAll('-', ''),
                resume_id: nextPublishId,
                create_time: now,
                update_time: now,
                delete_flag: 'NOT_DELETE',
              })),
            )
            .execute();
        }
        await trx
          .updateTable('sc_resume')
          .set({ publish_id: nextPublishId, publish_date: now, update_time: now })
          .where('id', '=', resumeId)
          .where('user_id', '=', request.userId as string)
          .execute();
      } else {
        await trx
          .updateTable('sc_resume')
          .set({
            title: publishTitle || undefined,
            preview_image: previewImage || undefined,
            is_published: 1,
            publish_date: now,
            update_time: now,
          })
          .where('id', '=', nextPublishId)
          .execute();
      }
      return nextPublishId;
    });
    return ok(publishId);
  });

  app.post<{ Params: { resumeId: string } }>(
    '/c/resume/unpublish/:resumeId',
    { preHandler: authenticate },
    async (request) => {
      const source = await getOwnedResume(db, request.params.resumeId, request.userId as string);
      if (!source) throw new AppError(400, '简历不存在或无权操作');
      const published = await db
        .selectFrom('sc_resume')
        .select('publish_id as publishId')
        .where('id', '=', request.params.resumeId)
        .executeTakeFirst();
      if (published?.publishId) {
        await db.transaction().execute(async (trx) => {
          const now = new Date();
          await trx
            .updateTable('sc_resume')
            .set({ delete_flag: 'DELETED', update_time: now })
            .where('id', '=', published.publishId)
            .execute();
          await trx
            .updateTable('sc_resume_modules')
            .set({ delete_flag: 'DELETED', update_time: now })
            .where('resume_id', '=', published.publishId)
            .execute();
          await trx
            .updateTable('sc_resume')
            .set({ publish_id: null, publish_date: null, update_time: now })
            .where('id', '=', request.params.resumeId)
            .where('user_id', '=', request.userId as string)
            .execute();
        });
      }
      return ok(null);
    },
  );

  app.put('/c/resume/modules', { preHandler: authenticate }, async (request) => {
    const body = bodyRecord(request.body);
    const resumeId = requiredString(body, 'resumeId');
    const moduleList = body.resumeModules;
    if (!Array.isArray(moduleList)) throw new AppError(400, 'resumeModules不能为空');
    const userId = request.userId as string;
    await db.transaction().execute(async (trx) => {
      const owned = await getOwnedResume(trx, resumeId, userId);
      if (!owned) throw new AppError(400, '简历不存在或无权操作');
      const now = new Date();
      await trx
        .updateTable('sc_resume_modules')
        .set({ delete_flag: 'DELETED', update_time: now })
        .where('resume_id', '=', resumeId)
        .where('delete_flag', '=', 'NOT_DELETE')
        .execute();
      const nextModules = moduleList.map((item, index) => {
        const module = bodyRecord(item);
        return {
          id: randomUUID().replaceAll('-', ''),
          resume_id: resumeId,
          module_type: typeof module.moduleType === 'string' ? module.moduleType : '其他经历',
          display_order: typeof module.displayOrder === 'number' ? module.displayOrder : index + 1,
          module_content: typeof module.moduleContent === 'string' ? module.moduleContent : '{}',
          create_time: now,
          update_time: now,
          delete_flag: 'NOT_DELETE',
          user_id: userId,
          has_enable: module.hasEnable === false ? 0 : 1,
        };
      });
      if (nextModules.length)
        await trx.insertInto('sc_resume_modules').values(nextModules).execute();
      await trx
        .updateTable('sc_resume')
        .set({ update_time: now })
        .where('id', '=', resumeId)
        .where('user_id', '=', userId)
        .execute();
      return undefined;
    });
    return ok(null);
  });

  app.get<{ Params: { resumeId: string } }>(
    '/c/resume/:resumeId',
    { preHandler: authenticate },
    async (request) => {
      const resume = await db
        .selectFrom('sc_resume')
        .select([
          'id',
          'title',
          'user_id as userId',
          'is_published as isPublished',
          'publish_date as publishDate',
          'preview_image as previewImage',
          'view_count as viewCount',
          'usage_count as usageCount',
          'collect_count as collectCount',
          'create_time as createTime',
          'update_time as updateTime',
          'delete_flag as deleteFlag',
          'style_config as styleConfig',
          'publish_id as publishId',
          'template',
        ])
        .where('id', '=', request.params.resumeId)
        .where('delete_flag', '=', 'NOT_DELETE')
        .where(({ or, eb }) =>
          or([eb('user_id', '=', request.userId as string), eb('is_published', '=', 1)]),
        )
        .executeTakeFirst();

      if (!resume) throw new AppError(400, '简历不存在');

      const modules = await db
        .selectFrom('sc_resume_modules')
        .select([
          'id',
          'resume_id as resumeId',
          'module_type as moduleType',
          'display_order as displayOrder',
          'module_content as moduleContent',
          'create_time as createTime',
          'update_time as updateTime',
          'delete_flag as deleteFlag',
          'user_id as userId',
          'has_enable as hasEnable',
        ])
        .where('resume_id', '=', request.params.resumeId)
        .where('delete_flag', '=', 'NOT_DELETE')
        .orderBy('display_order', 'asc')
        .execute();

      const action = await db
        .selectFrom('sc_user_actions')
        .select('id')
        .where('resume_id', '=', request.params.resumeId)
        .where('user_id', '=', request.userId ?? '')
        .where('action_type', '=', '收藏')
        .where('delete_flag', '=', 'NOT_DELETE')
        .executeTakeFirst();

      return ok({ ...mapResume(resume), resumeModules: modules, hasCollect: Boolean(action) });
    },
  );

  app.get<{ Params: { resumeId: string } }>(
    '/c/resume/:resumeId/baseInfo',
    { preHandler: authenticate },
    async (request) => {
      const resume = await db
        .selectFrom('sc_resume')
        .select([
          'id',
          'title',
          'user_id as userId',
          'is_published as isPublished',
          'publish_date as publishDate',
          'preview_image as previewImage',
          'view_count as viewCount',
          'usage_count as usageCount',
          'collect_count as collectCount',
          'create_time as createTime',
          'update_time as updateTime',
          'delete_flag as deleteFlag',
          'style_config as styleConfig',
          'publish_id as publishId',
          'template',
        ])
        .where('id', '=', request.params.resumeId)
        .where('delete_flag', '=', 'NOT_DELETE')
        .where(({ or, eb }) =>
          or([eb('user_id', '=', request.userId as string), eb('is_published', '=', 1)]),
        )
        .executeTakeFirst();

      if (!resume) throw new AppError(400, '简历不存在');

      const tags = await db
        .selectFrom('sc_resume_tags')
        .select('tag_name as tagName')
        .where('resume_id', '=', request.params.resumeId)
        .execute();

      const action = await db
        .selectFrom('sc_user_actions')
        .select('id')
        .where('resume_id', '=', request.params.resumeId)
        .where('user_id', '=', request.userId ?? '')
        .where('action_type', '=', '收藏')
        .where('delete_flag', '=', 'NOT_DELETE')
        .executeTakeFirst();

      return ok({ ...mapResume(resume), tags, isCollect: Boolean(action) });
    },
  );
}
