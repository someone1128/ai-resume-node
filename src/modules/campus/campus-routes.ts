/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { AppError } from '@/common/errors.js';
import { ok } from '@/common/http-response.js';
import { requireUser } from '@/auth/request-user.js';
import type { AppEnv } from '@/config/env.js';
import type { CampusRecruitmentRow, Database } from '@/infrastructure/database.js';

type CampusQuery = {
  page?: string;
  limit?: string;
  keyword?: string;
  workLocation?: string;
  industry?: string;
  positions?: string;
  recruitmentStatus?: string;
  infoType?: string;
  dataSource?: 'custom' | 'system';
  startDate?: string;
  endDate?: string;
};

type CampusBody = Partial<CampusRecruitmentRow> & {
  recruitmentId?: string;
  recruitmentStatus?: string;
  recruitmentRemarks?: string;
};

const publicColumns = [
  'id',
  'company',
  'work_location as workLocation',
  'industry',
  'positions',
  'title',
  'remarks',
  'record_time as recordTime',
  'info_type as infoType',
  'referral_code as referralCode',
  'referral_method as referralMethod',
  'create_time as createTime',
  'update_time as updateTime',
] as const;

function pageValue(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

/**
 * Keep the Java Snowy CommonPage wire shape while the Node service replaces it.
 * The web clients rely on these names, including the reservedObject placeholder.
 */
function pageData<T>(records: T[], total: number, current: number, size: number) {
  return {
    page: current,
    limit: size,
    totalPage: total > 0 ? Math.ceil(total / size) : 0,
    total,
    list: records,
    reservedObject: null,
  };
}

function addFilters(builder: any, query: CampusQuery, userId?: string): any {
  let result = builder;
  const keyword = query.keyword?.trim();
  if (keyword) {
    result = result.where((eb: any) =>
      eb.or([
        eb('company', 'like', `%${keyword}%`),
        eb('positions', 'like', `%${keyword}%`),
        eb('title', 'like', `%${keyword}%`),
        eb('work_location', 'like', `%${keyword}%`),
        eb('industry', 'like', `%${keyword}%`),
        eb('remarks', 'like', `%${keyword}%`),
        ...(userId
          ? [
              sql<boolean>`EXISTS (SELECT 1 FROM sc_campus_recruitment_user cru WHERE cru.recruitment_id = sc_campus_recruitment.id AND cru.user_id = ${userId} AND cru.recruitment_remarks LIKE ${`%${keyword}%`})`,
            ]
          : []),
      ]),
    );
  }
  for (const [key, column] of [
    ['workLocation', 'work_location'],
    ['industry', 'industry'],
    ['positions', 'positions'],
  ] as const) {
    const value = query[key]?.trim();
    if (value) result = result.where(column, 'like', `%${value}%`);
  }
  if (query.startDate) result = result.where('record_time', '>=', query.startDate);
  if (query.endDate) result = result.where('record_time', '<=', `${query.endDate} 23:59:59`);
  return result;
}

function toRecruitmentInsert(body: CampusBody, id: string) {
  return {
    id,
    company: body.company ?? null,
    referral_code: body.referral_code ?? (body as any).referralCode ?? null,
    referral_method: body.referral_method ?? (body as any).referralMethod ?? null,
    title: body.title ?? null,
    progress_check: body.progress_check ?? (body as any).progressCheck ?? null,
    work_location: body.work_location ?? (body as any).workLocation ?? null,
    industry: body.industry ?? null,
    positions: body.positions ?? null,
    remarks: body.remarks ?? null,
    main_business: body.main_business ?? (body as any).mainBusiness ?? null,
    info_type: body.info_type ?? (body as any).infoType ?? '校招',
    record_time: body.record_time ?? (body as any).recordTime ?? new Date(),
    expiration_time: body.expiration_time ?? (body as any).expirationTime ?? null,
    create_time: new Date(),
    update_time: new Date(),
  };
}

export function registerCampusRoutes(app: FastifyInstance, env: AppEnv, db: Kysely<Database>) {
  const authenticate = requireUser(env);
  const optionalUser = async (request: any) => {
    try {
      await authenticate(request);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 401) throw error;
    }
  };

  async function listRecruitments(query: CampusQuery, infoType: '校招' | '内推', userId?: string) {
    const current = pageValue(query.page, 1, 10_000);
    const size = pageValue(query.limit, 10, 100);
    let base = db
      .selectFrom('sc_campus_recruitment')
      .select(publicColumns as any)
      .where('info_type', '=', infoType);
    base = addFilters(base, query, userId) as typeof base;
    if (userId && query.recruitmentStatus) {
      base = base.where(({ exists, selectFrom }: any) =>
        exists(
          selectFrom('sc_campus_recruitment_user as cru')
            .select('cru.id')
            .whereRef('cru.recruitment_id', '=', 'sc_campus_recruitment.id')
            .where('cru.user_id', '=', userId)
            .where('cru.recruitment_status', '=', query.recruitmentStatus!),
        ),
      ) as typeof base;
    }
    const countQuery = db
      .selectFrom('sc_campus_recruitment')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('info_type', '=', infoType);
    const filteredCount = addFilters(countQuery, query, userId);
    const finalCount =
      userId && query.recruitmentStatus
        ? filteredCount.where(({ exists, selectFrom }: any) =>
            exists(
              selectFrom('sc_campus_recruitment_user as cru')
                .select('cru.id')
                .whereRef('cru.recruitment_id', '=', 'sc_campus_recruitment.id')
                .where('cru.user_id', '=', userId)
                .where('cru.recruitment_status', '=', query.recruitmentStatus!),
            ),
          )
        : filteredCount;
    const [records, count] = await Promise.all([
      base
        .orderBy('record_time', 'desc')
        .limit(size)
        .offset((current - 1) * size)
        .execute(),
      finalCount.executeTakeFirst(),
    ]);
    if (!userId) return pageData(records, Number(count?.count ?? 0), current, size);
    const ids = records.map((record: any) => record.id);
    if (!ids.length) return pageData(records, Number(count?.count ?? 0), current, size);
    const statuses = await db
      .selectFrom('sc_campus_recruitment_user')
      .select(['recruitment_id', 'recruitment_status', 'recruitment_remarks'])
      .where('user_id', '=', userId)
      .where('recruitment_id', 'in', ids)
      .execute();
    const statusMap = new Map(statuses.map((item) => [item.recruitment_id, item]));
    return pageData(
      records.map((record: any) => ({
        ...record,
        ...(statusMap.get(record.id)
          ? {
              recruitmentStatus: statusMap.get(record.id)?.recruitment_status,
              recruitmentRemarks: statusMap.get(record.id)?.recruitment_remarks,
            }
          : {}),
      })),
      Number(count?.count ?? 0),
      current,
      size,
    );
  }

  app.get('/c/resume/campusRecruitment', { preHandler: optionalUser }, async (request) => {
    const query = request.query as CampusQuery;
    return ok(await listRecruitments(query, '校招', request.userId));
  });
  app.get('/c/resume/campusRecruitment/referral', { preHandler: optionalUser }, async (request) => {
    const query = request.query as CampusQuery;
    return ok(await listRecruitments(query, '内推', request.userId));
  });

  app.get('/c/resume/campusRecruitment/stats', async () => {
    const stats = await db
      .selectFrom('sc_campus_recruitment')
      .select(({ fn, val, case: caseExpr }) => [
        fn
          .sum(
            caseExpr()
              .when('record_time', '>=', val(new Date(Date.now() - 2 * 86400000)))
              .then(1)
              .else(0)
              .end(),
          )
          .as('threeDayCount'),
        fn
          .sum(
            caseExpr()
              .when('record_time', '>=', val(new Date(Date.now() - 6 * 86400000)))
              .then(1)
              .else(0)
              .end(),
          )
          .as('weekCount'),
        fn.countAll<number>().as('totalCount'),
      ])
      .executeTakeFirst();
    return ok(stats ?? { threeDayCount: 0, weekCount: 0, totalCount: 0 });
  });

  app.get('/c/resume/campusRecruitment/progress', { preHandler: authenticate }, async (request) => {
    const query = request.query as CampusQuery;
    const current = pageValue(query.page, 1, 10_000);
    const size = pageValue(query.limit, 10, 100);
    let base = db
      .selectFrom('sc_campus_recruitment as cr')
      .innerJoin('sc_campus_recruitment_user as cru', (join) =>
        join.onRef('cr.id', '=', 'cru.recruitment_id').on('cru.user_id', '=', request.userId!),
      )
      .select([
        ...(publicColumns.map((column) =>
          column.startsWith('id')
            ? 'cr.id'
            : `cr.${column.replace(/ as .+$/, '')} as ${column.includes(' as ') ? column.split(' as ')[1] : column}`,
        ) as any),
        'cru.recruitment_status as recruitmentStatus',
        'cru.recruitment_remarks as recruitmentRemarks',
      ])
      .where((eb: any) =>
        eb.or([
          eb.and([
            eb('cru.recruitment_status', 'is not', null),
            sql`TRIM(cru.recruitment_status) <> ''`,
          ]),
          eb.and([
            eb('cru.recruitment_remarks', 'is not', null),
            sql`TRIM(cru.recruitment_remarks) <> ''`,
          ]),
        ]),
      );
    if (query.recruitmentStatus)
      base = base.where('cru.recruitment_status', '=', query.recruitmentStatus) as typeof base;
    if (query.keyword)
      base = base.where((eb: any) =>
        eb.or([
          eb('cr.company', 'like', `%${query.keyword}%`),
          eb('cr.positions', 'like', `%${query.keyword}%`),
          eb('cr.title', 'like', `%${query.keyword}%`),
          eb('cru.recruitment_remarks', 'like', `%${query.keyword}%`),
        ]),
      ) as typeof base;
    const countQuery = (base as any)
      .clearSelect()
      .select(({ fn }: any) => fn.countAll().as('count'));
    const [records, count] = await Promise.all([
      base
        .orderBy('cr.record_time', 'desc')
        .limit(size)
        .offset((current - 1) * size)
        .execute(),
      countQuery.executeTakeFirst(),
    ]);
    return ok(pageData(records, Number(count?.count ?? 0), current, size));
  });

  app.put('/c/resume/campusRecruitment/status', { preHandler: authenticate }, async (request) =>
    updateRecruitmentUser(db, request.userId!, request.body as CampusBody, false),
  );
  app.put('/c/resume/campusRecruitment/remarks', { preHandler: authenticate }, async (request) =>
    updateRecruitmentUser(db, request.userId!, request.body as CampusBody, false),
  );

  app.get('/c/resume/campusRecruitment/record', { preHandler: authenticate }, async (request) => {
    const query = request.query as CampusQuery;
    const current = pageValue(query.page, 1, 10_000);
    const size = pageValue(query.limit, 10, 100);
    let base = db
      .selectFrom('sc_campus_recruitment_user as cru')
      .leftJoin('sc_campus_recruitment as cr', 'cr.id', 'cru.recruitment_id')
      .select(({ val, fn }) => [
        'cru.id as id',
        'cru.recruitment_id as recruitmentId',
        'cru.recruitment_status as recruitmentStatus',
        'cru.recruitment_remarks as recruitmentRemarks',
        fn.coalesce('cru.company', 'cr.company').as('company'),
        fn.coalesce('cru.positions', 'cr.positions').as('positions'),
        fn.coalesce('cru.title', 'cr.title').as('title'),
        fn.coalesce('cru.work_location', 'cr.work_location').as('workLocation'),
        fn.coalesce('cru.industry', 'cr.industry').as('industry'),
        fn.coalesce('cru.info_type', 'cr.info_type').as('infoType'),
        'cru.create_time as createTime',
        'cru.update_time as updateTime',
        val('system').as('dataSource'),
      ])
      .where('cru.user_id', '=', request.userId!);
    if (query.dataSource === 'custom')
      base = base.where((eb: any) =>
        eb.or([eb('cru.recruitment_id', 'is', null), eb('cru.recruitment_id', '=', '')]),
      ) as typeof base;
    if (query.dataSource === 'system')
      base = base
        .where('cru.recruitment_id', 'is not', null)
        .where('cru.recruitment_status', 'is not', null)
        .where('cru.recruitment_status', '<>', '')
        .where('cru.recruitment_status', '<>', '取消') as typeof base;
    if (query.recruitmentStatus)
      base = base.where('cru.recruitment_status', '=', query.recruitmentStatus) as typeof base;
    const countQuery = (base as any)
      .clearSelect()
      .select(({ fn }: any) => fn.countAll().as('count'));
    const [records, count] = await Promise.all([
      base
        .orderBy('cru.update_time', 'desc')
        .limit(size)
        .offset((current - 1) * size)
        .execute(),
      countQuery.executeTakeFirst(),
    ]);
    return ok(pageData(records, Number(count?.count ?? 0), current, size));
  });

  app.post('/c/resume/campusRecruitment/record', { preHandler: authenticate }, async (request) =>
    createUserRecord(db, request.userId!, request.body as CampusBody),
  );
  app.put('/c/resume/campusRecruitment/record/:id', { preHandler: authenticate }, async (request) =>
    updateUserRecord(
      db,
      request.userId!,
      String((request.params as { id: string }).id),
      request.body as CampusBody,
    ),
  );
  app.delete(
    '/c/resume/campusRecruitment/record/:id',
    { preHandler: authenticate },
    async (request) => {
      const id = String((request.params as { id: string }).id);
      const result = await db
        .deleteFrom('sc_campus_recruitment_user')
        .where('id', '=', id)
        .where('user_id', '=', request.userId!)
        .executeTakeFirst();
      if (!Number(result.numDeletedRows)) throw new AppError(404, '记录不存在或无权操作');
      return ok(null);
    },
  );

  app.post('/c/resume/campusRecruitment/custom', { preHandler: authenticate }, async (request) => {
    const body = { ...(request.body as CampusBody), info_type: '校招' };
    delete body.recruitmentId;
    return createUserRecord(db, request.userId!, body);
  });
  app.put('/c/resume/campusRecruitment/custom/:id', { preHandler: authenticate }, async (request) =>
    updateUserRecord(
      db,
      request.userId!,
      String((request.params as { id: string }).id),
      request.body as CampusBody,
      true,
    ),
  );
}

async function updateRecruitmentUser(
  db: Kysely<Database>,
  userId: string,
  body: CampusBody,
  _unused: boolean,
) {
  void _unused;
  if (!body.recruitmentId) throw new AppError(400, 'recruitmentId 不能为空');
  const recruitment = await db
    .selectFrom('sc_campus_recruitment')
    .select('id')
    .where('id', '=', body.recruitmentId)
    .executeTakeFirst();
  if (!recruitment) throw new AppError(404, '招聘信息不存在');
  const existing = await db
    .selectFrom('sc_campus_recruitment_user')
    .selectAll()
    .where('user_id', '=', userId)
    .where('recruitment_id', '=', body.recruitmentId)
    .executeTakeFirst();
  if (body.recruitmentStatus === '取消') {
    if (existing)
      await db.deleteFrom('sc_campus_recruitment_user').where('id', '=', existing.id).execute();
    return ok(null);
  }
  if (!existing) {
    await db
      .insertInto('sc_campus_recruitment_user')
      .values({
        id: randomUUID().replaceAll('-', ''),
        user_id: userId,
        recruitment_id: body.recruitmentId,
        recruitment_status: body.recruitmentStatus ?? null,
        recruitment_remarks: body.recruitmentRemarks ?? null,
        create_time: new Date(),
        update_time: new Date(),
      } as any)
      .execute();
  } else {
    await db
      .updateTable('sc_campus_recruitment_user')
      .set({
        recruitment_status: body.recruitmentStatus ?? existing.recruitment_status,
        recruitment_remarks: body.recruitmentRemarks ?? existing.recruitment_remarks,
        update_time: new Date(),
      })
      .where('id', '=', existing.id)
      .execute();
  }
  return ok(null);
}

async function createUserRecord(db: Kysely<Database>, userId: string, body: CampusBody) {
  if (body.recruitmentId) {
    const exists = await db
      .selectFrom('sc_campus_recruitment_user')
      .select('id')
      .where('user_id', '=', userId)
      .where('recruitment_id', '=', body.recruitmentId)
      .executeTakeFirst();
    if (exists) throw new AppError(409, '您已投递过该职位');
  }
  const id = randomUUID().replaceAll('-', '');
  await db
    .insertInto('sc_campus_recruitment_user')
    .values({
      ...toRecruitmentInsert(body, id),
      user_id: userId,
      recruitment_id: body.recruitmentId ?? null,
      recruitment_status: body.recruitmentStatus ?? null,
      recruitment_remarks: body.recruitmentRemarks ?? null,
    } as any)
    .execute();
  return ok(id);
}

async function updateUserRecord(
  db: Kysely<Database>,
  userId: string,
  id: string,
  body: CampusBody,
  customOnly = false,
) {
  const existing = await db
    .selectFrom('sc_campus_recruitment_user')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!existing || (customOnly && existing.recruitment_id))
    throw new AppError(404, '记录不存在或无权操作');
  const patch: Record<string, unknown> = { update_time: new Date() };
  for (const [key, column] of [
    ['company', 'company'],
    ['positions', 'positions'],
    ['title', 'title'],
    ['workLocation', 'work_location'],
    ['industry', 'industry'],
    ['referralCode', 'referral_code'],
    ['referralMethod', 'referral_method'],
    ['progressCheck', 'progress_check'],
    ['remarks', 'remarks'],
    ['mainBusiness', 'main_business'],
    ['infoType', 'info_type'],
    ['expirationTime', 'expiration_time'],
  ] as const)
    if ((body as any)[key] !== undefined) patch[column] = (body as any)[key];
  if (body.recruitmentStatus !== undefined) patch.recruitment_status = body.recruitmentStatus;
  if (body.recruitmentRemarks !== undefined) patch.recruitment_remarks = body.recruitmentRemarks;
  await db
    .updateTable('sc_campus_recruitment_user')
    .set(patch as any)
    .where('id', '=', id)
    .execute();
  return ok(null);
}
