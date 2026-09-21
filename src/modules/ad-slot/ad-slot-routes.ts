import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { AppError } from '@/common/errors.js';
import { ok } from '@/common/http-response.js';
import type { AppEnv } from '@/config/env.js';
import type { Database } from '@/infrastructure/database.js';

type AdSlotQuery = { projectCode?: string; slotCode?: string };

export function registerAdSlotRoutes(app: FastifyInstance, _env: AppEnv, db: Kysely<Database>) {
  const list = async (request: { query: unknown }) => {
    const query = request.query as AdSlotQuery;
    let builder = db
      .selectFrom('sc_ad_slot_config')
      .select([
        'id',
        'project_code as projectCode',
        'slot_code as slotCode',
        'ad_mode as adMode',
        'title',
        'image_url as imageUrl',
        'target_url as targetUrl',
        'sort_code as sortCode',
        'click_count as clickCount',
      ] as const)
      .where('delete_flag', '=', 'NOT_DELETE')
      .where('status', '=', 'ENABLE')
      .where((eb) => eb.or([eb('start_time', 'is', null), eb('start_time', '<=', new Date())]))
      .where((eb) => eb.or([eb('end_time', 'is', null), eb('end_time', '>=', new Date())]));
    if (query.projectCode)
      builder = builder.where('project_code', '=', query.projectCode) as typeof builder;
    if (query.slotCode)
      builder = builder.where('slot_code', '=', query.slotCode.toUpperCase()) as typeof builder;
    const rows = await builder.orderBy('sort_code', 'asc').orderBy('update_time', 'desc').execute();
    return ok(rows);
  };

  // Keep both paths used by the current clients and the Java controller.
  for (const path of ['/c/resume/adslot/list', '/c/adSlot/list', '/c/common/adslot/list'])
    app.get(path, list);

  const click = async (request: { body: unknown }) => {
    const body = request.body as { id?: string };
    if (!body?.id) throw new AppError(400, '广告位 id 不能为空');
    await db
      .updateTable('sc_ad_slot_config')
      .set({ click_count: sql`coalesce(click_count, 0) + 1`, last_click_time: new Date() })
      .where('id', '=', body.id)
      .where('delete_flag', '=', 'NOT_DELETE')
      .execute();
    return ok(null);
  };

  for (const path of ['/c/resume/adslot/click', '/c/adSlot/click', '/c/common/adslot/click'])
    app.post(path, click);
}
