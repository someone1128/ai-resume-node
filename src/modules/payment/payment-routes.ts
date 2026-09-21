/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { AppError } from '@/common/errors.js';
import { ok } from '@/common/http-response.js';
import { requireUser } from '@/auth/request-user.js';
import type { AppEnv } from '@/config/env.js';
import type { Database, MemberPackageRow } from '@/infrastructure/database.js';
import { notifyPaymentWebSocket } from '@/modules/payment/payment-websocket.js';

type PaymentBody = {
  packageId?: string;
  redeemCode?: string;
  orderNo?: string;
  out_trade_no?: string;
  status?: string;
  webName?: string;
};

export function buildMockJsapiParams(orderId: string) {
  return {
    appId: 'mock-app-id',
    timeStamp: String(Math.floor(Date.now() / 1000)),
    nonceStr: orderId.slice(0, 16),
    package: `prepay_id=mock_${orderId.slice(0, 16)}`,
    signType: 'MD5',
    paySign: 'mock-signature',
  };
}

export function canApplyMockPaymentSuccess(status: string | null | undefined) {
  return status === '待支付';
}

function packageCategory(webName?: string) {
  return webName === 'offer' ? 'offer星球' : webName === 'photo' ? 'AI证件照' : '高分简历';
}

function parseCallback(body: unknown): PaymentBody {
  if (typeof body === 'object' && body) {
    const value = body as PaymentBody;
    return {
      ...value,
      ...(value.orderNo || !value.out_trade_no ? {} : { orderNo: value.out_trade_no }),
    };
  }
  const text = String(body ?? '');
  const value = (name: string) => text.match(new RegExp('<' + name + '>([^<]+)'))?.[1];
  const orderNo = value('out_trade_no') ?? value('orderNo');
  const status = value('result_code') ?? value('status');
  return { ...(orderNo ? { orderNo } : {}), ...(status ? { status } : {}) };
}

async function findPackage(
  db: Kysely<Database>,
  packageId: string,
  webName?: string,
): Promise<MemberPackageRow> {
  const row = await db
    .selectFrom('sc_member_package')
    .selectAll()
    .where('id', '=', packageId)
    .where('delete_flag', '=', 'NOT_DELETE')
    .executeTakeFirst();
  if (!row) throw new AppError(404, '不存在该会员套餐或已下架');
  const category = packageCategory(webName);
  let ext: Record<string, unknown> = {};
  try {
    ext = row.ext_json ? JSON.parse(row.ext_json) : {};
  } catch {
    /* preserve legacy rows */
  }
  if (ext.category && ext.category !== category) throw new AppError(400, '套餐类型不匹配');
  return row;
}

export function registerPaymentRoutes(app: FastifyInstance, env: AppEnv, db: Kysely<Database>) {
  const authenticate = requireUser(env);

  async function createOrder(
    request: any,
    webName: string | undefined,
    reply: FastifyReply | undefined,
    qrResponse: boolean,
  ) {
    await authenticate(request);
    if (env.PAYMENT_MODE !== 'mock') throw new AppError(501, '微信支付 live 模式尚未启用');
    if (!env.TEST_AUTH_ENABLED || request.userId !== env.TEST_USER_ID)
      throw new AppError(403, '模拟支付只允许测试账号');
    const params = (request.params ?? {}) as { code?: string; packageId?: string };
    const body = (request.body ?? {}) as { redeemCode?: string; packageId?: string };
    const packageId = params.packageId ?? body.packageId;
    if (!packageId) throw new AppError(400, 'packageId不能为空');
    const memberPackage = await findPackage(db, packageId, webName);
    const id = randomUUID().replaceAll('-', '');
    const orderNo = `codex_migration_test_order_${Date.now()}_${id.slice(0, 8)}`;
    await db
      .insertInto('t_payment_order')
      .values({
        id,
        delete_flag: 'NOT_DELETE',
        create_time: new Date(),
        update_time: new Date(),
        pay_channel: 'MOCK',
        amount: memberPackage.current_amount,
        recharge_record_id: null,
        order_no: orderNo,
        status: '待支付',
        openid: null,
        product_id: memberPackage.id,
        remark: `migration mock ${webName ?? 'resume'}`,
        ip: null,
        code_url: `mock://wechat-pay/${orderNo}`,
        user_id: request.userId,
        ext_json: JSON.stringify({
          mode: 'mock',
          webName: webName ?? null,
          redeemCode: params.code ?? body.redeemCode ?? '0',
        }),
        redeem_code_id: null,
      } as any)
      .execute();
    const result = {
      orderNo,
      outTradeNo: orderNo,
      codeUrl: `mock://wechat-pay/${orderNo}`,
      amount: memberPackage.current_amount,
      mode: 'mock',
      packageId: memberPackage.id,
      // Keep the JSAPI response shape consumable by the existing member page
      // while making it explicit that these values are mock-only and must
      // never be sent to WeChat.
      ...(qrResponse
        ? {}
        : {
            jsapiParams: {
              ...buildMockJsapiParams(id),
            },
          }),
    };
    if (qrResponse && reply) {
      const escapedOrderNo = orderNo.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
      return reply
        .header('x-mock-order-no', orderNo)
        .type('image/svg+xml')
        .send(
          `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" fill="white"/><rect x="16" y="16" width="288" height="288" fill="none" stroke="black" stroke-width="4"/><text x="160" y="145" text-anchor="middle" font-size="20">MOCK WECHAT PAY</text><text x="160" y="180" text-anchor="middle" font-size="12">${escapedOrderNo}</text><text x="160" y="215" text-anchor="middle" font-size="12">仅用于迁移测试，不可真实支付</text></svg>`,
        );
    }
    return ok(result);
  }

  for (const [path, webName] of [
    ['/c/resume/memberPackage/createOrder/:code/:packageId', undefined],
    ['/c/resume/memberPackage/createOrder/offer/:code/:packageId', 'offer'],
    ['/c/resume/memberPackage/createOrder/photo/:code/:packageId', 'photo'],
  ] as const)
    app.post(path, async (request, reply) => createOrder(request, webName, reply, true));

  for (const [path, webName] of [
    ['/c/resume/memberPackage/createJSAPIOrder', undefined],
    ['/c/resume/memberPackage/createJSAPIOrder/offer', 'offer'],
    ['/c/resume/memberPackage/createJSAPIOrder/photo', 'photo'],
  ] as const)
    app.post(path, async (request, reply) => createOrder(request, webName, reply, false));

  async function createFreeOrder(request: any, webName: string | undefined) {
    await authenticate(request);
    const params = request.params as { code: string; packageId: string };
    const memberPackage = await findPackage(db, params.packageId, webName);
    const userId = request.userId!;
    await db.transaction().execute(async (trx) => {
      const redeem = await trx
        .selectFrom('t_redeem_code')
        .selectAll()
        .where('code', '=', params.code)
        .where('delete_flag', '=', 'NOT_DELETE')
        .where('expiration_time', '>', new Date())
        .forUpdate()
        .executeTakeFirst();
      if (!redeem || redeem.ext_json !== '0') throw new AppError(400, '该优惠码不支持免费领取');
      if (
        redeem.max_redemption !== null &&
        redeem.max_redemption !== undefined &&
        (redeem.current_redemption ?? 0) >= redeem.max_redemption
      ) {
        throw new AppError(400, '该优惠码已达到使用次数上限');
      }
      if (redeem.user_id && redeem.user_id === userId) {
        throw new AppError(400, '无法使用自己的优惠券');
      }
      const user = await trx
        .selectFrom('client_user')
        .select([
          'member_expiration_time',
          'offer_member_expiration_time',
          'photo_member_expiration_time',
        ] as any)
        .where('ID', '=', userId)
        .where('DELETE_FLAG', '=', 'NOT_DELETE')
        .forUpdate()
        .executeTakeFirst();
      if (!user) throw new AppError(404, '用户不存在');
      await grantPackage(trx, userId, memberPackage, webName, user);
      await trx
        .updateTable('t_redeem_code')
        .set({ current_redemption: (redeem.current_redemption ?? 0) + 1, update_time: new Date() })
        .where('code_id', '=', redeem.code_id)
        .execute();
    });
    return ok(null);
  }

  for (const [path, webName] of [
    ['/c/resume/memberPackage/createFreeOrder/:code/:packageId', undefined],
    ['/c/resume/memberPackage/createFreeOrder/offer/:code/:packageId', 'offer'],
    ['/c/resume/memberPackage/createFreeOrder/photo/:code/:packageId', 'photo'],
  ] as const)
    app.post(path, async (request) => createFreeOrder(request, webName));

  app.post('/c/resume/memberPackage/createLinkFreeOrder', { preHandler: authenticate }, async () =>
    ok(null),
  );
  app.post(
    '/c/resume/memberPackage/createLinkFreeOrder/offer',
    { preHandler: authenticate },
    async () => ok(null),
  );

  async function callback(request: any, webName: string | undefined) {
    if (env.PAYMENT_MODE !== 'mock')
      throw new AppError(501, '微信支付 live 回调验签尚未启用，已拒绝处理');
    const payload = parseCallback(request.body);
    if (!payload.orderNo) throw new AppError(400, '缺少订单号');
    const orderNo = payload.orderNo;
    const result = await db.transaction().execute(async (trx) => {
      const order = await trx
        .selectFrom('t_payment_order')
        .selectAll()
        .where('order_no', '=', orderNo)
        .where('user_id', '=', env.TEST_USER_ID ?? '')
        .forUpdate()
        .executeTakeFirst();
      if (!order) throw new AppError(404, '测试订单不存在');
      if (order.status === '支付成功')
        return { response: 'SUCCESS', changed: false, userId: order.user_id };
      if (!canApplyMockPaymentSuccess(order.status))
        return { response: 'SUCCESS', changed: false, userId: order.user_id };
      if (payload.status && !['SUCCESS', '支付成功', '成功'].includes(payload.status)) {
        await trx
          .updateTable('t_payment_order')
          .set({ status: '支付失败', update_time: new Date() })
          .where('id', '=', order.id)
          .execute();
        return { response: 'SUCCESS', changed: false, userId: order.user_id };
      }
      const memberPackage = await findPackage(trx, order.product_id!, webName);
      const user = await trx
        .selectFrom('client_user')
        .select([
          'member_expiration_time',
          'offer_member_expiration_time',
          'photo_member_expiration_time',
        ] as any)
        .where('ID', '=', order.user_id!)
        .where('DELETE_FLAG', '=', 'NOT_DELETE')
        .forUpdate()
        .executeTakeFirst();
      if (!user) throw new AppError(404, '用户不存在');
      await grantPackage(trx, order.user_id!, memberPackage, webName, user);
      await trx
        .updateTable('t_payment_order')
        .set({
          status: '支付成功',
          update_time: new Date(),
          recharge_record_id: `mock_${order.id.slice(0, 14)}`,
        })
        .where('id', '=', order.id)
        .execute();
      return { response: 'SUCCESS', changed: true, userId: order.user_id };
    });
    if (result.changed && result.userId) {
      notifyPaymentWebSocket(result.userId, 'WxPay', {
        code: 200,
        success: true,
        data: '支付成功',
        msg: '操作成功',
      });
    }
    return result.response;
  }
  app.post('/c/resume/memberPackage/wxPayCallback', async (request) =>
    callback(request, undefined),
  );
  app.post('/c/resume/memberPackage/wxPayCallback/offer', async (request) =>
    callback(request, 'offer'),
  );
  app.post('/c/resume/memberPackage/wxPayCallback/photo', async (request) =>
    callback(request, 'photo'),
  );
}

async function grantPackage(
  db: Kysely<Database>,
  userId: string,
  memberPackage: MemberPackageRow,
  webName: string | undefined,
  user: any,
) {
  if (memberPackage.billing_mode === 'COUNT_PACKAGE') {
    const functionName = webName === 'photo' ? 'AI证件照生成' : '简历分析';
    const amount = Number(memberPackage.usage_count ?? 0);
    const existing = await db
      .selectFrom('sc_user_function_limits')
      .selectAll()
      .where('user_id', '=', userId)
      .where('function_name', '=', functionName)
      .executeTakeFirst();
    if (existing)
      await db
        .updateTable('sc_user_function_limits')
        .set({
          remaining_uses: Number(existing.remaining_uses ?? 0) + amount,
          update_time: new Date(),
        })
        .where('id', '=', existing.id)
        .execute();
    else
      await db
        .insertInto('sc_user_function_limits')
        .values({
          id: randomUUID().replaceAll('-', ''),
          user_id: userId,
          function_name: functionName,
          remaining_uses: amount,
          create_time: new Date(),
          update_time: new Date(),
        })
        .execute();
    return;
  }
  const days = Number(memberPackage.gift_day ?? 0);
  const field =
    webName === 'offer'
      ? 'offer_member_expiration_time'
      : webName === 'photo'
        ? 'photo_member_expiration_time'
        : 'member_expiration_time';
  const current =
    user[field] && new Date(user[field]).getTime() > Date.now()
      ? new Date(user[field])
      : new Date();
  current.setDate(current.getDate() + days);
  await db
    .updateTable('client_user')
    .set({ [field]: current, member_level: '会员', update_time: new Date() } as any)
    .where('ID', '=', userId)
    .execute();
}
