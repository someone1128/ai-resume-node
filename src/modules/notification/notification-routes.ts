/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { AppError } from '@/common/errors.js';
import { ok } from '@/common/http-response.js';
import { requireUser } from '@/auth/request-user.js';
import type { AppEnv } from '@/config/env.js';
import type { Database } from '@/infrastructure/database.js';

type NotificationQuery = { page?: string; limit?: string };

function pageValue(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function pageData<T>(records: T[], total: number, current: number, size: number) {
  return {
    page: current,
    limit: size,
    totalPage: Math.ceil(total / size),
    total,
    list: records,
    reservedObject: null,
  };
}

export function registerNotificationRoutes(
  app: FastifyInstance,
  env: AppEnv,
  db: Kysely<Database>,
) {
  const authenticate = requireUser(env);

  async function page(request: any, type: string) {
    await authenticate(request);
    const query = request.query as NotificationQuery;
    const current = pageValue(query.page, 1, 10_000);
    const size = pageValue(query.limit, 10, 100);
    const userId = request.userId as string;
    const base = db
      .selectFrom('sc_notification as n')
      .leftJoin('sc_user_notification as un', (join) =>
        join
          .onRef('un.notification_id', '=', 'n.id')
          .on('un.user_id', '=', userId)
          .on('un.delete_flag', '=', 'NOT_DELETE'),
      )
      .select([
        'n.id',
        'n.type',
        'n.title',
        'n.content',
        'n.images',
        'n.create_time as createTime',
        'n.expired_time as expiredTime',
        'un.read_flag as readFlag',
      ])
      .where('n.type', '=', type)
      .where('n.delete_flag', '=', 'NOT_DELETE')
      .where('n.expired_time', '>', new Date());
    const [records, count] = await Promise.all([
      base
        .orderBy('n.id', 'desc')
        .limit(size)
        .offset((current - 1) * size)
        .execute(),
      db
        .selectFrom('sc_notification')
        .select(sql<number>`count(*)`.as('count'))
        .where('type', '=', type)
        .where('delete_flag', '=', 'NOT_DELETE')
        .where('expired_time', '>', new Date())
        .executeTakeFirst(),
    ]);
    return ok(pageData(records, Number(count?.count ?? 0), current, size));
  }

  app.get('/c/resume/notification/page/system', (request) => page(request, '系统公告'));
  app.get('/c/resume/notification/page/activity', (request) => page(request, '活动公告'));

  app.get('/c/resume/notification/page/like', { preHandler: authenticate }, async (request) => {
    const query = request.query as NotificationQuery;
    const current = pageValue(query.page, 1, 10_000);
    const size = pageValue(query.limit, 10, 100);
    const userId = request.userId as string;
    const base = db
      .selectFrom('sc_notification as n')
      .innerJoin('sc_user_notification as un', (join) =>
        join
          .onRef('un.notification_id', '=', 'n.id')
          .on('un.user_id', '=', userId)
          .on('un.delete_flag', '=', 'NOT_DELETE'),
      )
      .leftJoin('client_user as cu', 'cu.ID', 'n.send_user_id')
      .select([
        'n.id',
        'n.type',
        'n.content',
        'n.cases_id as casesId',
        'n.create_time as createTime',
        'un.read_flag as readFlag',
        'cu.NICKNAME as nickname',
        'cu.AVATAR as avatar',
      ])
      .where('n.type', 'in', ['点赞', '收藏'])
      .where('n.delete_flag', '=', 'NOT_DELETE')
      .where('n.expired_time', '>', new Date());
    const records = await base
      .orderBy('n.id', 'desc')
      .limit(size)
      .offset((current - 1) * size)
      .execute();
    const count = await db
      .selectFrom('sc_notification as n')
      .innerJoin('sc_user_notification as un', (join) =>
        join
          .onRef('un.notification_id', '=', 'n.id')
          .on('un.user_id', '=', userId)
          .on('un.delete_flag', '=', 'NOT_DELETE'),
      )
      .select(sql<number>`count(*)`.as('count'))
      .where('n.type', 'in', ['点赞', '收藏'])
      .where('n.delete_flag', '=', 'NOT_DELETE')
      .where('n.expired_time', '>', new Date())
      .executeTakeFirst();
    return ok(pageData(records, Number(count?.count ?? 0), current, size));
  });

  app.get('/c/resume/notification/unreadCount', { preHandler: authenticate }, async (request) => {
    const userId = request.userId as string;
    const [system, activity, like, collect] = await Promise.all([
      unreadCount(db, userId, '系统公告'),
      unreadCount(db, userId, '活动公告'),
      unreadUserCount(db, userId, '点赞'),
      unreadUserCount(db, userId, '收藏'),
    ]);
    return ok({
      systemCount: system,
      activityCount: activity,
      likeCount: like,
      collectCount: collect,
      totalCount: system + activity + like + collect,
      likeAndCollectCount: like + collect,
    });
  });

  app.get('/c/resume/notification/unreadSystem', { preHandler: authenticate }, async (request) => {
    const row = await db
      .selectFrom('sc_notification as n')
      .selectAll('n')
      .where('n.type', 'in', ['系统公告', '活动公告'])
      .where('n.delete_flag', '=', 'NOT_DELETE')
      .where('n.expired_time', '>', new Date())
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('sc_user_notification as un')
              .select('un.id')
              .whereRef('un.notification_id', '=', 'n.id')
              .where('un.user_id', '=', request.userId as string)
              .where('un.delete_flag', '=', 'NOT_DELETE'),
          ),
        ),
      )
      .orderBy('n.weight', 'desc')
      .orderBy('n.id', 'desc')
      .executeTakeFirst();
    return ok(row ?? null);
  });

  app.post<{ Params: { id: string } }>(
    '/c/resume/notification/read/:id',
    { preHandler: authenticate },
    async (request) => {
      const userId = request.userId as string;
      const notification = await db
        .selectFrom('sc_notification')
        .select(['id', 'type'])
        .where('id', '=', request.params.id)
        .where('delete_flag', '=', 'NOT_DELETE')
        .executeTakeFirst();
      if (!notification) throw new AppError(404, '通知不存在');
      const existing = await db
        .selectFrom('sc_user_notification')
        .select('id')
        .where('notification_id', '=', notification.id)
        .where('user_id', '=', userId)
        .where('delete_flag', '=', 'NOT_DELETE')
        .executeTakeFirst();
      if (existing)
        await db
          .updateTable('sc_user_notification')
          .set({ read_flag: 1, read_time: new Date() })
          .where('id', '=', existing.id)
          .execute();
      else
        await db
          .insertInto('sc_user_notification')
          .values({
            id: randomUUID().replaceAll('-', ''),
            user_id: userId,
            notification_id: notification.id,
            read_flag: 1,
            delete_flag: 'NOT_DELETE',
            create_time: new Date(),
            read_time: new Date(),
            type: notification.type,
          })
          .execute();
      return ok(null);
    },
  );

  app.post('/c/resume/notification/readAll', { preHandler: authenticate }, async (request) => {
    const type = String((request.query as { type?: string }).type ?? '');
    const userId = request.userId as string;
    if (['点赞', '收藏'].includes(type)) {
      await db
        .updateTable('sc_user_notification')
        .set({ read_flag: 1, read_time: new Date() })
        .where('user_id', '=', userId)
        .where('type', '=', type)
        .where('delete_flag', '=', 'NOT_DELETE')
        .execute();
    } else {
      const rows = await db
        .selectFrom('sc_notification as n')
        .select(['n.id', 'n.type'])
        .where('n.type', '=', type)
        .where('n.delete_flag', '=', 'NOT_DELETE')
        .where('n.expired_time', '>', new Date())
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom('sc_user_notification as un')
                .select('un.id')
                .whereRef('un.notification_id', '=', 'n.id')
                .where('un.user_id', '=', userId)
                .where('un.delete_flag', '=', 'NOT_DELETE'),
            ),
          ),
        )
        .execute();
      if (rows.length)
        await db
          .insertInto('sc_user_notification')
          .values(
            rows.map((row) => ({
              id: randomUUID().replaceAll('-', ''),
              user_id: userId,
              notification_id: row.id,
              read_flag: 1,
              delete_flag: 'NOT_DELETE',
              create_time: new Date(),
              read_time: new Date(),
              type: row.type,
            })),
          )
          .execute();
    }
    return ok(null);
  });
}

async function unreadCount(db: Kysely<Database>, userId: string, type: string) {
  const row = await db
    .selectFrom('sc_notification as n')
    .select(sql<number>`count(*)`.as('count'))
    .where('n.type', '=', type)
    .where('n.delete_flag', '=', 'NOT_DELETE')
    .where('n.expired_time', '>', new Date())
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('sc_user_notification as un')
            .select('un.id')
            .whereRef('un.notification_id', '=', 'n.id')
            .where('un.user_id', '=', userId)
            .where('un.read_flag', '=', 1)
            .where('un.delete_flag', '=', 'NOT_DELETE'),
        ),
      ),
    )
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

async function unreadUserCount(db: Kysely<Database>, userId: string, type: string) {
  const row = await db
    .selectFrom('sc_user_notification')
    .select(sql<number>`count(*)`.as('count'))
    .where('user_id', '=', userId)
    .where('type', '=', type)
    .where('read_flag', '=', 0)
    .where('delete_flag', '=', 'NOT_DELETE')
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}
