/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { AppError } from '@/common/errors.js';
import { ok } from '@/common/http-response.js';
import type { AppEnv } from '@/config/env.js';
import type { Database } from '@/infrastructure/database.js';
import { requireAdmin } from '@/modules/admin/admin-auth-routes.js';

type DictQuery = {
  page?: string;
  limit?: string;
  category?: string;
  parentId?: string;
  dictLabel?: string;
  dictValue?: string;
};
type DictBody = {
  id?: string;
  parentId?: string | null;
  dictLabel?: string;
  dictValue?: string;
  category?: string;
  sortCode?: number;
  extJson?: string | null;
};

function pageValue(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function mapDict(row: any) {
  return {
    id: row.ID,
    parentId: row.PARENT_ID,
    dictLabel: row.DICT_LABEL,
    dictValue: row.DICT_VALUE,
    category: row.CATEGORY,
    sortCode: row.SORT_CODE,
    extJson: row.EXT_JSON,
    createTime: row.CREATE_TIME,
    updateTime: row.UPDATE_TIME,
  };
}

export function registerDictRoutes(app: FastifyInstance, env: AppEnv, db: Kysely<Database>) {
  const adminOnly = requireAdmin(env, db);

  const page = async (request: any) => {
    const query = request.query as DictQuery;
    const current = pageValue(query.page, 1, 10_000);
    const size = pageValue(query.limit, 20, 100);
    let base = db.selectFrom('dev_dict').selectAll().where('DELETE_FLAG', '=', 'NOT_DELETE');
    if (query.category) base = base.where('CATEGORY', '=', query.category) as typeof base;
    if (query.parentId) base = base.where('PARENT_ID', '=', query.parentId) as typeof base;
    if (query.dictLabel)
      base = base.where('DICT_LABEL', 'like', `%${query.dictLabel}%`) as typeof base;
    if (query.dictValue)
      base = base.where('DICT_VALUE', 'like', `%${query.dictValue}%`) as typeof base;
    const [rows, count] = await Promise.all([
      base
        .orderBy('SORT_CODE', 'asc')
        .orderBy('ID', 'asc')
        .limit(size)
        .offset((current - 1) * size)
        .execute(),
      (() => {
        let countQuery = db
          .selectFrom('dev_dict')
          .select(({ fn }) => fn.countAll<number>().as('count'))
          .where('DELETE_FLAG', '=', 'NOT_DELETE');
        if (query.category)
          countQuery = countQuery.where('CATEGORY', '=', query.category) as typeof countQuery;
        if (query.parentId)
          countQuery = countQuery.where('PARENT_ID', '=', query.parentId) as typeof countQuery;
        if (query.dictLabel)
          countQuery = countQuery.where(
            'DICT_LABEL',
            'like',
            `%${query.dictLabel}%`,
          ) as typeof countQuery;
        if (query.dictValue)
          countQuery = countQuery.where(
            'DICT_VALUE',
            'like',
            `%${query.dictValue}%`,
          ) as typeof countQuery;
        return countQuery.executeTakeFirst();
      })(),
    ]);
    return ok({
      records: rows.map(mapDict),
      total: Number(count?.count ?? 0),
      current,
      size,
      pages: Math.ceil(Number(count?.count ?? 0) / size),
    });
  };

  const list = async (request: any) => {
    const query = request.query as DictQuery;
    let base = db.selectFrom('dev_dict').selectAll().where('DELETE_FLAG', '=', 'NOT_DELETE');
    if (query.category) base = base.where('CATEGORY', '=', query.category) as typeof base;
    if (query.parentId) base = base.where('PARENT_ID', '=', query.parentId) as typeof base;
    return ok((await base.orderBy('SORT_CODE', 'asc').orderBy('ID', 'asc').execute()).map(mapDict));
  };

  const tree = async (request: any) => {
    const query = request.query as DictQuery;
    let base = db.selectFrom('dev_dict').selectAll().where('DELETE_FLAG', '=', 'NOT_DELETE');
    if (query.category) base = base.where('CATEGORY', '=', query.category) as typeof base;
    const rows = (await base.orderBy('SORT_CODE', 'asc').orderBy('ID', 'asc').execute()).map(
      mapDict,
    );
    const byParent = new Map<string, any[]>();
    for (const row of rows)
      byParent.set(row.parentId ?? '0', [
        ...(byParent.get(row.parentId ?? '0') ?? []),
        { ...row, children: [] },
      ]);
    const roots = byParent.get('0') ?? byParent.get('') ?? [];
    const attach = (items: any[]): any[] =>
      items.map((item) => ({ ...item, children: attach(byParent.get(item.id) ?? []) }));
    return ok(attach(roots));
  };

  const detail = async (request: any) => {
    const id = String((request.query as { id?: string }).id ?? '');
    if (!id) throw new AppError(400, 'id 不能为空');
    const row = await db
      .selectFrom('dev_dict')
      .selectAll()
      .where('ID', '=', id)
      .where('DELETE_FLAG', '=', 'NOT_DELETE')
      .executeTakeFirst();
    if (!row) throw new AppError(404, '字典不存在');
    return ok(mapDict(row));
  };

  const add = async (request: any) => {
    const body = request.body as DictBody;
    if (!body.dictLabel || !body.dictValue || !body.category)
      throw new AppError(400, 'dictLabel、dictValue、category 不能为空');
    const id = randomUUID().replaceAll('-', '').slice(0, 20);
    await db
      .insertInto('dev_dict')
      .values({
        ID: id,
        PARENT_ID: body.parentId ?? '0',
        DICT_LABEL: body.dictLabel,
        DICT_VALUE: body.dictValue,
        CATEGORY: body.category,
        SORT_CODE: body.sortCode ?? 0,
        EXT_JSON: body.extJson ?? null,
        DELETE_FLAG: 'NOT_DELETE',
        CREATE_TIME: new Date(),
        UPDATE_TIME: new Date(),
      })
      .execute();
    return ok(id);
  };

  const edit = async (request: any) => {
    const body = request.body as DictBody;
    if (!body.id) throw new AppError(400, 'id 不能为空');
    const patch: Record<string, unknown> = { UPDATE_TIME: new Date() };
    if (body.parentId !== undefined) patch.PARENT_ID = body.parentId;
    if (body.dictLabel !== undefined) patch.DICT_LABEL = body.dictLabel;
    if (body.dictValue !== undefined) patch.DICT_VALUE = body.dictValue;
    if (body.category !== undefined) patch.CATEGORY = body.category;
    if (body.sortCode !== undefined) patch.SORT_CODE = body.sortCode;
    if (body.extJson !== undefined) patch.EXT_JSON = body.extJson;
    const result = await db
      .updateTable('dev_dict')
      .set(patch as any)
      .where('ID', '=', body.id)
      .where('DELETE_FLAG', '=', 'NOT_DELETE')
      .executeTakeFirst();
    if (!Number(result.numUpdatedRows)) throw new AppError(404, '字典不存在');
    return ok(null);
  };

  const remove = async (request: any) => {
    const body = request.body as { id?: string; ids?: string[] };
    const ids = body.ids ?? (body.id ? [body.id] : []);
    if (!ids.length) throw new AppError(400, 'id 不能为空');
    const child = await db
      .selectFrom('dev_dict')
      .select('ID')
      .where('PARENT_ID', 'in', ids)
      .where('DELETE_FLAG', '=', 'NOT_DELETE')
      .executeTakeFirst();
    if (child) throw new AppError(409, '该字典仍有下级字典，不能删除');
    await db
      .updateTable('dev_dict')
      .set({ DELETE_FLAG: 'DELETED', UPDATE_TIME: new Date() })
      .where('ID', 'in', ids)
      .execute();
    return ok(null);
  };

  // Keep both the legacy developer dictionary URLs and the business dictionary
  // URLs used by the only retained Snowy admin page. They share one handler so
  // the reduced admin does not need Snowy's permission/resource endpoints.
  for (const prefix of ['/dev/dict', '/biz/dict']) {
    app.get(`${prefix}/page`, { preHandler: adminOnly }, page);
    app.get(`${prefix}/list`, { preHandler: adminOnly }, list);
    app.get(`${prefix}/tree`, { preHandler: adminOnly }, tree);
    app.get(`${prefix}/treeAll`, { preHandler: adminOnly }, tree);
    app.get(`${prefix}/detail`, { preHandler: adminOnly }, detail);
    app.post(`${prefix}/add`, { preHandler: adminOnly }, add);
    app.post(`${prefix}/edit`, { preHandler: adminOnly }, edit);
    app.post(`${prefix}/delete`, { preHandler: adminOnly }, remove);
  }
}
