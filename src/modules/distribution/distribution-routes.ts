import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { requireUser } from '@/auth/request-user.js';
import { ok } from '@/common/http-response.js';
import type { AppEnv } from '@/config/env.js';
import type { Database } from '@/infrastructure/database.js';

type DistributionQuery = { page?: string; limit?: string; userNameKeyword?: string };

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

function numberValue(value: unknown) {
  return Number(value ?? 0);
}

export function registerDistributionRoutes(
  app: FastifyInstance,
  env: AppEnv,
  db: Kysely<Database>,
) {
  const authenticate = requireUser(env);

  app.get('/c/resume/distribution/stat', { preHandler: authenticate }, async (request) => {
    const userId = request.userId as string;
    const [user, aggregate, relationCount, redeem] = await Promise.all([
      db
        .selectFrom('client_user')
        .select([
          'invitation_code as invitationCode',
          'has_distribution_promo_code as hasDistributionPromoCode',
          'withdrawn_rebate_amount as withdrawnRebateAmount',
        ] as const)
        .where('ID', '=', userId)
        .where('DELETE_FLAG', '=', 'NOT_DELETE')
        .executeTakeFirst(),
      db
        .selectFrom('t_invitation_records')
        .select([
          sql<number>`count(*)`.as('orderTotalCount'),
          sql<number>`coalesce(sum(case when category = '二级返佣' then rebate_amount else 0 end), 0)`.as(
            'subReferralRebateRate',
          ),
          sql<number>`coalesce(sum(case when category = '邀请码' then recharged_amount else 0 end), 0)`.as(
            'inviteRechargeTotalAmount',
          ),
          sql<number>`coalesce(sum(case when category = '邀请码' then rebate_amount else 0 end), 0)`.as(
            'inviteRebateTotalAmount',
          ),
          sql<number>`coalesce(sum(case when category = '优惠码' then recharged_amount else 0 end), 0)`.as(
            'discountsRechargeTotalAmount',
          ),
          sql<number>`coalesce(sum(case when category = '优惠码' then rebate_amount else 0 end), 0)`.as(
            'discountsRebateTotalAmount',
          ),
        ])
        .where('user_id', '=', userId)
        .where('delete_flag', '=', 'NOT_DELETE')
        .executeTakeFirst(),
      db
        .selectFrom('t_front_relation')
        .select(sql<number>`count(distinct target_id)`.as('count'))
        .where('user_id', '=', userId)
        .where('category', 'in', ['用户优惠码关联', '用户邀请码关联'])
        .executeTakeFirst(),
      db
        .selectFrom('t_redeem_code')
        .select(['code', 'rebate_rate as rebateRate', 'ext_json as extJson'])
        .where('user_id', '=', userId)
        .where('delete_flag', '=', 'NOT_DELETE')
        .orderBy('create_time', 'desc')
        .executeTakeFirst(),
    ]);
    const inviteRebate = numberValue(aggregate?.inviteRebateTotalAmount);
    const subRebate = numberValue(aggregate?.subReferralRebateRate);
    const total = inviteRebate + subRebate;
    const withdrawn = numberValue(user?.withdrawnRebateAmount);
    let discountRebate = 0;
    if (redeem?.extJson) {
      try {
        discountRebate = numberValue(JSON.parse(redeem.extJson));
      } catch {
        discountRebate = numberValue(redeem.extJson);
      }
    }
    return ok({
      orderTotalCount: numberValue(aggregate?.orderTotalCount),
      ipCount: 0,
      userCount: numberValue(relationCount?.count),
      inviteRechargeTotalAmount: numberValue(aggregate?.inviteRechargeTotalAmount),
      inviteRebateTotalAmount: inviteRebate,
      discountsRechargeTotalAmount: numberValue(aggregate?.discountsRechargeTotalAmount),
      discountsRebateTotalAmount: numberValue(aggregate?.discountsRebateTotalAmount),
      subReferralRebateRate: subRebate,
      inviteTotalEarnings: total,
      withdrawnRebateAmount: withdrawn,
      availableRebateAmount: total - withdrawn,
      hasDistributionPromoCode: Boolean(user?.hasDistributionPromoCode),
      discountsCode: redeem?.code ?? null,
      discountsCodeRebateRate: redeem?.rebateRate ?? null,
      discountRebate,
      invitationCode: user?.invitationCode ?? null,
    });
  });

  app.get('/c/resume/invitationRecords', { preHandler: authenticate }, async (request) => {
    const query = request.query as DistributionQuery;
    const current = pageValue(query.page, 1, 10_000);
    const size = pageValue(query.limit, 10, 100);
    const userId = request.userId as string;
    const base = db
      .selectFrom('t_invitation_records')
      .select([
        'id',
        'delete_flag as deleteFlag',
        'create_time as createTime',
        'user_id as userId',
        'target_user_id as targetUserId',
        'invitation_code as invitationCode',
        'ip',
        'recharged_amount as rechargedAmount',
        'category',
        'rebate_amount as rebateAmount',
        'rebate_rate as rebateRate',
      ] as const)
      .where('user_id', '=', userId)
      .where('delete_flag', '=', 'NOT_DELETE');
    const [records, count] = await Promise.all([
      base
        .orderBy('create_time', 'desc')
        .limit(size)
        .offset((current - 1) * size)
        .execute(),
      db
        .selectFrom('t_invitation_records')
        .select(sql<number>`count(*)`.as('count'))
        .where('user_id', '=', userId)
        .where('delete_flag', '=', 'NOT_DELETE')
        .executeTakeFirst(),
    ]);
    return ok(pageData(records, numberValue(count?.count), current, size));
  });

  app.get('/c/resume/invitedUserDetails', { preHandler: authenticate }, async (request) => {
    const query = request.query as DistributionQuery;
    const current = pageValue(query.page, 1, 10_000);
    const size = pageValue(query.limit, 10, 100);
    const userId = request.userId as string;
    let base = db
      .selectFrom('t_front_relation as fr')
      .innerJoin('client_user as cu', 'cu.ID', 'fr.target_id')
      .leftJoin('t_recharge_record as rr', (join) =>
        join.onRef('rr.user_id', '=', 'cu.ID').on('rr.delete_flag', '=', 'NOT_DELETE'),
      )
      .leftJoin('t_invitation_records as ir', (join) =>
        join
          .onRef('ir.target_user_id', '=', 'cu.ID')
          .on('ir.user_id', '=', userId)
          .on('ir.delete_flag', '=', 'NOT_DELETE'),
      )
      .select([
        'cu.ID as userId',
        'cu.NICKNAME as userName',
        'cu.user_status as userStatus',
        sql<string>`date_format(min(fr.create_time), '%Y-%m-%d %H:%i:%s')`.as('inviteTime'),
        sql<number>`coalesce(sum(rr.amount / 100), 0)`.as('totalConsumption'),
        sql<number>`coalesce(sum(ir.rebate_amount), 0)`.as('rebateAmount'),
      ])
      .where('fr.user_id', '=', userId)
      .where('fr.category', 'in', ['用户优惠码关联', '用户邀请码关联'])
      .where('cu.DELETE_FLAG', '=', 'NOT_DELETE')
      .groupBy(['cu.ID', 'cu.NICKNAME', 'cu.user_status'])
      .orderBy('rebateAmount', 'desc');
    if (query.userNameKeyword?.trim())
      base = base.where('cu.NAME', 'like', `%${query.userNameKeyword.trim()}%`) as typeof base;
    const records = await base
      .limit(size)
      .offset((current - 1) * size)
      .execute();
    const count = await db
      .selectFrom('t_front_relation as fr')
      .innerJoin('client_user as cu', 'cu.ID', 'fr.target_id')
      .select(sql<number>`count(distinct cu.ID)`.as('count'))
      .where('fr.user_id', '=', userId)
      .where('fr.category', 'in', ['用户优惠码关联', '用户邀请码关联'])
      .where('cu.DELETE_FLAG', '=', 'NOT_DELETE')
      .executeTakeFirst();
    return ok(
      pageData(
        records.map((record) => ({
          ...record,
          userName: record.userName ? `${String(record.userName).slice(0, 1)}***` : record.userName,
        })),
        numberValue(count?.count),
        current,
        size,
      ),
    );
  });

  app.get<{ Params: { invitationCode: string } }>(
    '/c/resume/redeemCode/:invitationCode',
    async (request) => {
      const row = await db
        .selectFrom('client_user as cu')
        .innerJoin('t_redeem_code as rc', 'cu.ID', 'rc.user_id')
        .select(['cu.AVATAR as avatar', 'cu.NICKNAME as nickname', 'rc.code'])
        .where('cu.invitation_code', '=', request.params.invitationCode)
        .where('cu.DELETE_FLAG', '=', 'NOT_DELETE')
        .where('rc.delete_flag', '=', 'NOT_DELETE')
        .orderBy('rc.create_time', 'desc')
        .executeTakeFirst();
      return ok(row ?? null);
    },
  );
}
