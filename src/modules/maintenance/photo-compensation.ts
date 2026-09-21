import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { AppEnv } from '@/config/env.js';
import type { Database } from '@/infrastructure/database.js';

export const PHOTO_FUNCTION_NAME = 'AI证件照生成';
export const DEFAULT_PHOTO_STALE_MINUTES = 15;

export function isStalePhotoGeneration(
  createTime: Date | string | null,
  now: Date,
  staleMinutes = DEFAULT_PHOTO_STALE_MINUTES,
) {
  if (!createTime) return false;
  const createdAt = createTime instanceof Date ? createTime.getTime() : Date.parse(createTime);
  return Number.isFinite(createdAt) && createdAt <= now.getTime() - staleMinutes * 60_000;
}

/**
 * Compensate records left in PROCESSING after a process crash. The conditional
 * status update makes this safe when multiple Node instances run the job.
 */
export async function compensateStuckPhotoGenerations(
  db: Kysely<Database>,
  now = new Date(),
  staleMinutes = DEFAULT_PHOTO_STALE_MINUTES,
) {
  const cutoff = new Date(now.getTime() - staleMinutes * 60_000);
  const candidates = await db
    .selectFrom('sc_ai_photo_generation_record')
    .select(['id', 'user_id'])
    .where('status', '=', 'PROCESSING')
    .where('delete_flag', '=', 'NOT_DELETE')
    .where('create_time', '<=', cutoff)
    .execute();

  let compensated = 0;
  for (const candidate of candidates) {
    const changed = await db.transaction().execute(async (trx) => {
      const result = await trx
        .updateTable('sc_ai_photo_generation_record')
        .set({
          status: 'FAILED',
          error_message: '系统异常中断，补偿任务自动退回额度',
          cost_count: 0,
          update_time: new Date(),
        })
        .where('id', '=', candidate.id)
        .where('user_id', '=', candidate.user_id)
        .where('status', '=', 'PROCESSING')
        .where('delete_flag', '=', 'NOT_DELETE')
        .executeTakeFirst();
      if (!Number(result.numUpdatedRows)) return false;

      const limit = await trx
        .selectFrom('sc_user_function_limits')
        .select('id')
        .where('user_id', '=', candidate.user_id)
        .where('function_name', '=', PHOTO_FUNCTION_NAME)
        .forUpdate()
        .executeTakeFirst();
      if (limit) {
        await trx
          .updateTable('sc_user_function_limits')
          .set(({ eb }) => ({
            remaining_uses: eb('remaining_uses', '+', 1),
            update_time: new Date(),
          }))
          .where('id', '=', limit.id)
          .execute();
      } else {
        await trx
          .insertInto('sc_user_function_limits')
          .values({
            id: randomUUID().replaceAll('-', ''),
            function_name: PHOTO_FUNCTION_NAME,
            remaining_uses: 4,
            user_id: candidate.user_id,
            create_time: new Date(),
            update_time: new Date(),
          })
          .execute();
      }
      return true;
    });
    if (changed) compensated += 1;
  }
  return compensated;
}

export function registerMaintenanceJobs(app: FastifyInstance, env: AppEnv, db: Kysely<Database>) {
  if (!env.PHOTO_COMPENSATION_ENABLED) return;
  const timer = setInterval(() => {
    void compensateStuckPhotoGenerations(
      db,
      new Date(),
      env.PHOTO_COMPENSATION_STALE_MINUTES,
    ).catch((error: unknown) => app.log.error({ error }, 'AI证件照补偿任务执行失败'));
  }, env.PHOTO_COMPENSATION_INTERVAL_MS);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}
