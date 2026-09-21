import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { AppError } from '@/common/errors.js';
import { ok } from '@/common/http-response.js';
import { requireUser, requestToken } from '@/auth/request-user.js';
import type { AppEnv } from '@/config/env.js';
import type { Database } from '@/infrastructure/database.js';

type CallbackBody = {
  outTradeNo?: string;
  out_trade_no?: string;
  status?: string;
  result_code?: string;
};

/**
 * Development-only compatibility endpoints for the existing JSAPI diagnostic page.
 * They are deliberately mock-only and never call WeChat or create a real charge.
 */
export function registerJsapiTestRoutes(app: FastifyInstance, env: AppEnv, db: Kysely<Database>) {
  const authenticate = requireUser(env);

  const assertMockTestUser = async (request: { userId: string | undefined }) => {
    if (
      env.PAYMENT_MODE !== 'mock' ||
      !env.TEST_AUTH_ENABLED ||
      request.userId !== env.TEST_USER_ID
    )
      throw new AppError(403, 'JSAPI 测试接口仅允许 mock 测试账号');
  };

  const assertDiagnosticEnvironment = () => {
    if (env.NODE_ENV === 'production') {
      throw new AppError(404, 'JSAPI 测试接口未在生产环境开放');
    }
  };

  app.get('/test/jsapi/ping', async () => {
    assertDiagnosticEnvironment();
    return ok('pong - Node mock JSAPI 测试接口');
  });

  app.get('/test/jsapi/checkLogin', async (request) => {
    assertDiagnosticEnvironment();
    const token = requestToken(request);
    const loggedIn = Boolean(token && env.TEST_AUTH_ENABLED && token === env.TEST_AUTH_TOKEN);
    return ok({
      isLogin: loggedIn,
      loginStatus: loggedIn ? 'FULL_READY' : 'NOT_LOGGED_IN',
      hasOpenId: false,
      canUseJSAPI: false,
      message: loggedIn ? 'Node mock 环境不调用真实微信 JSAPI' : '用户未登录，请先登录',
      suggestions: '测试环境只回放 mock 订单和回调，不产生真实扣款',
    });
  });

  app.get('/test/jsapi/getWechatLoginUrl', async () => {
    assertDiagnosticEnvironment();
    return ok({
      wechatLoginUrl: '/oauth/resume/wx/getCode',
      normalUrl: '/oauth/resume/wx/getCode',
      offerUrl: '/oauth/resume/wx/getCode/offer',
      currentUrl: '/oauth/resume/wx/getCode',
      message: '真实微信授权请在预发布环境验证',
    });
  });

  app.get('/test/jsapi/getMyOpenId', { preHandler: authenticate }, async (request) => {
    assertDiagnosticEnvironment();
    await assertMockTestUser(request);
    const user = await db
      .selectFrom('client_user')
      .select(['ID as id', 'NICKNAME as nickname', 'wechat_openid as openid'])
      .where('ID', '=', request.userId!)
      .where('DELETE_FLAG', '=', 'NOT_DELETE')
      .executeTakeFirst();
    if (!user) throw new AppError(404, '测试用户不存在');
    return ok({
      isLogin: true,
      userId: user.id,
      nickname: user.nickname,
      hasOpenId: Boolean(user.openid),
      openId: user.openid,
      message: user.openid
        ? '测试账号已绑定微信 OpenID'
        : '测试账号没有微信 OpenID，使用 mock 支付',
    });
  });

  app.post('/test/jsapi/createTestOrder', { preHandler: authenticate }, async (request) => {
    assertDiagnosticEnvironment();
    await assertMockTestUser(request);
    const user = await db
      .selectFrom('client_user')
      .select(['NICKNAME as nickname', 'wechat_openid as openid'])
      .where('ID', '=', request.userId!)
      .where('DELETE_FLAG', '=', 'NOT_DELETE')
      .executeTakeFirst();
    if (!user) throw new AppError(404, '测试用户不存在');
    const id = randomUUID().replaceAll('-', '');
    const outTradeNo = `codex_jsapi_test_${Date.now()}_${id.slice(0, 8)}`;
    await db
      .insertInto('t_payment_order')
      .values({
        id,
        delete_flag: 'NOT_DELETE',
        create_time: new Date(),
        update_time: new Date(),
        pay_channel: 'MOCK_JSAPI',
        amount: '0.01',
        recharge_record_id: null,
        order_no: outTradeNo,
        status: '待支付',
        openid: user.openid,
        product_id: 'TEST_PRODUCT',
        remark: 'Node mock JSAPI 测试订单',
        ip: null,
        code_url: `mock://wechat-jsapi/${outTradeNo}`,
        user_id: request.userId!,
        ext_json: JSON.stringify({ mode: 'mock', source: 'jsapi-test' }),
        redeem_code_id: null,
      })
      .execute();
    return ok({
      orderId: id,
      outTradeNo,
      jsapiParams: {
        appId: 'mock-app-id',
        timeStamp: String(Math.floor(Date.now() / 1000)),
        nonceStr: id.slice(0, 16),
        package: `prepay_id=mock_${id.slice(0, 16)}`,
        signType: 'MD5',
        paySign: 'mock-signature',
      },
      debugInfo: {
        userOpenId: user.openid,
        userId: request.userId,
        nickname: user.nickname,
        amount: '0.01',
        currency: 'CNY',
        notifyUrl: '/test/jsapi/callback',
        version: 'mock',
      },
    });
  });

  app.get('/test/jsapi/queryOrder', { preHandler: authenticate }, async (request) => {
    assertDiagnosticEnvironment();
    await assertMockTestUser(request);
    const outTradeNo = String((request.query as { outTradeNo?: string }).outTradeNo ?? '');
    if (!outTradeNo) throw new AppError(400, '缺少订单号');
    const order = await db
      .selectFrom('t_payment_order')
      .selectAll()
      .where('order_no', '=', outTradeNo)
      .where('user_id', '=', request.userId!)
      .executeTakeFirst();
    return ok(
      order
        ? {
            orderId: order.id,
            orderNo: order.order_no,
            status: order.status,
            amount: order.amount,
            createTime: order.create_time,
            updateTime: order.update_time,
            openid: order.openid,
          }
        : { message: '订单不存在' },
    );
  });

  app.post('/test/jsapi/callback', async (request) => {
    assertDiagnosticEnvironment();
    if (env.PAYMENT_MODE !== 'mock') return 'SUCCESS';
    const body = (request.body ?? {}) as CallbackBody;
    const outTradeNo = body.outTradeNo ?? body.out_trade_no;
    if (!outTradeNo) throw new AppError(400, '缺少订单号');
    const callbackStatus = body.status ?? body.result_code;
    const normalizedStatus = ['SUCCESS', '支付成功', '成功'].includes(callbackStatus ?? '')
      ? '支付成功'
      : '支付失败';
    await db
      .updateTable('t_payment_order')
      .set({
        status: normalizedStatus,
        update_time: new Date(),
      })
      .where('order_no', '=', outTradeNo)
      .where('order_no', 'like', 'codex_jsapi_test_%')
      .where('status', '=', '待支付')
      .execute();
    return 'SUCCESS';
  });
}
