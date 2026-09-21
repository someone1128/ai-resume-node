/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { AppError } from '@/common/errors.js';
import { ok } from '@/common/http-response.js';
import {
  deleteClientToken,
  requireUser,
  requestToken,
  saveClientToken,
} from '@/auth/request-user.js';
import type { AppEnv } from '@/config/env.js';
import type { Database } from '@/infrastructure/database.js';
import type { Kysely } from 'kysely';
import { fetchJson } from '@/common/http-client.js';

type WechatTokenResponse = {
  access_token?: string;
  openid?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
};

type WechatUserResponse = WechatTokenResponse & {
  nickname?: string;
  headimgurl?: string;
  sex?: number;
  privilege?: string[];
};

type WechatProfile = Omit<WechatUserResponse, 'unionid'> & { unionid: string | null };

function authorizeUrl(env: AppEnv, webName?: string, scope = 'snsapi_login') {
  const redirectUri = redirectUriFor(env, webName);
  if (!env.WECHAT_APP_ID || !redirectUri) throw new AppError(503, '微信登录未配置');
  const redirect = redirectUri.includes('webName=')
    ? redirectUri
    : `${redirectUri}${redirectUri.includes('?') ? '&' : '?'}webName=${encodeURIComponent(webName ?? 'resume')}`;
  const params = new URLSearchParams({
    appid: env.WECHAT_APP_ID,
    redirect_uri: redirect,
    response_type: 'code',
    scope,
    state: randomUUID(),
  });
  return `https://open.weixin.qq.com/connect/qrconnect?${params.toString()}#wechat_redirect`;
}

function redirectUriFor(env: AppEnv, webName?: string) {
  if (webName === 'offer') return env.WECHAT_REDIRECT_URI_OFFER ?? env.WECHAT_REDIRECT_URI;
  if (webName === 'photo') return env.WECHAT_REDIRECT_URI_PHOTO ?? env.WECHAT_REDIRECT_URI;
  if (webName === 'campus') return env.WECHAT_REDIRECT_URI_CAMPUS ?? env.WECHAT_REDIRECT_URI;
  return env.WECHAT_REDIRECT_URI;
}

function frontRedirectFor(env: AppEnv, webName?: string) {
  if (webName === 'offer') return env.FRONT_REDIRECT_URI_OFFER;
  if (webName === 'photo') return env.FRONT_REDIRECT_URI_PHOTO;
  if (webName === 'campus') return env.FRONT_REDIRECT_URI_CAMPUS;
  return env.FRONT_REDIRECT_URI;
}

function throwWechatError(payload: WechatTokenResponse): never {
  throw new AppError(502, `微信授权失败${payload.errmsg ? `：${payload.errmsg}` : ''}`);
}

async function loadWechatUser(env: AppEnv, code: string): Promise<WechatProfile> {
  if (!env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET) throw new AppError(503, '微信登录未配置');
  const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
  tokenUrl.search = new URLSearchParams({
    appid: env.WECHAT_APP_ID,
    secret: env.WECHAT_APP_SECRET,
    code,
    grant_type: 'authorization_code',
  }).toString();
  let token: WechatTokenResponse;
  try {
    token = await fetchJson<WechatTokenResponse>(tokenUrl, {}, env.AI_REQUEST_TIMEOUT_MS);
  } catch (error) {
    throw new AppError(
      error instanceof Error && error.message.includes('超时') ? 504 : 502,
      '微信授权服务不可用',
    );
  }
  if (!token.access_token || !token.openid) throwWechatError(token);
  const userUrl = new URL('https://api.weixin.qq.com/sns/userinfo');
  userUrl.search = new URLSearchParams({
    access_token: token.access_token,
    openid: token.openid,
    lang: 'zh_CN',
  }).toString();
  let profile: WechatUserResponse;
  try {
    profile = await fetchJson<WechatUserResponse>(userUrl, {}, env.AI_REQUEST_TIMEOUT_MS);
  } catch (error) {
    throw new AppError(
      error instanceof Error && error.message.includes('超时') ? 504 : 502,
      '微信用户信息服务不可用',
    );
  }
  if (!profile.openid || profile.errcode) throwWechatError(profile);
  return { ...profile, unionid: profile.unionid ?? token.unionid ?? null } as WechatProfile;
}

async function findOrCreateWechatUser(db: Kysely<Database>, profile: WechatProfile) {
  const account = profile.unionid ?? profile.openid!;
  const existing = await db
    .selectFrom('client_user')
    .selectAll()
    .where((eb) =>
      eb.or([
        ...(profile.unionid ? [eb('union_id', '=', profile.unionid)] : []),
        eb('wechat_openid', '=', profile.openid!),
        eb('ACCOUNT', '=', account),
      ]),
    )
    .where('DELETE_FLAG', '=', 'NOT_DELETE')
    .executeTakeFirst();
  if (existing) {
    await db
      .updateTable('client_user')
      .set({
        union_id: profile.unionid ?? existing.union_id,
        wechat_openid: profile.openid,
        NICKNAME: profile.nickname ?? existing.NICKNAME,
        AVATAR: profile.headimgurl ?? existing.AVATAR,
      } as any)
      .where('ID', '=', existing.ID)
      .execute();
    return existing.ID;
  }
  const id = randomUUID().replaceAll('-', '').slice(0, 20);
  await db
    .insertInto('client_user')
    .values({
      ID: id,
      ACCOUNT: account,
      NICKNAME: profile.nickname ?? null,
      AVATAR: profile.headimgurl ?? null,
      union_id: profile.unionid ?? null,
      wechat_openid: profile.openid,
      DELETE_FLAG: 'NOT_DELETE',
      user_status: 'ENABLE',
      create_time: new Date(),
    } as any)
    .execute();
  return id;
}

function mapUser(user: any) {
  return {
    id: user.ID,
    account: user.ACCOUNT,
    nickname: user.NICKNAME,
    name: user.NAME,
    avatar: user.AVATAR,
    signature: user.SIGNATURE,
    phone: user.PHONE,
    email: user.EMAIL,
    memberLevel: user.member_level,
    memberExpirationTime: user.member_expiration_time,
    offerMemberExpirationTime: user.offer_member_expiration_time,
    photoMemberExpirationTime: user.photo_member_expiration_time,
    unionId: user.union_id,
    wechatOpenid: user.wechat_openid,
    createTime: user.create_time,
    extJson: user.EXT_JSON,
  };
}

export function registerAuthRoutes(app: FastifyInstance, env: AppEnv, db: Kysely<Database>) {
  const authenticate = requireUser(env);
  app.post('/oauth/resume/render/wechat', async (request) =>
    ok(authorizeUrl(env, String((request.query as any).webName ?? 'resume'))),
  );
  app.get('/oauth/resume/render/wechat', async (request) =>
    ok(authorizeUrl(env, String((request.query as any).webName ?? 'resume'))),
  );
  app.get('/oauth/resume/wx/getCode', async (request) =>
    ok(authorizeUrl(env, String((request.query as any).webName ?? 'resume'), 'snsapi_userinfo')),
  );
  app.get('/oauth/resume/wx/getCode/offer', async () =>
    ok(authorizeUrl(env, 'offer', 'snsapi_userinfo')),
  );
  app.get('/oauth/resume/wx/getCode/campus', async () =>
    ok(authorizeUrl(env, 'campus', 'snsapi_userinfo')),
  );
  async function completeWechatCallback(request: any, reply: any, webName?: string) {
    const { code } = request.query as { code?: string };
    if (!code) throw new AppError(400, '微信授权 code 不能为空');
    const profile = await loadWechatUser(env, code);
    const userId = await findOrCreateWechatUser(db, profile);
    const token = randomBytes(32).toString('hex');
    await saveClientToken(env, token, userId);
    const redirect = frontRedirectFor(env, webName);
    if (!redirect) return ok({ token, userId });
    const separator = redirect.includes('?') ? (redirect.endsWith('=') ? '' : '&') : '?';
    return reply.redirect(
      `${redirect}${separator}${redirect.endsWith('=') ? '' : 'token='}${encodeURIComponent(token)}`,
    );
  }
  app.get('/oauth/resume/wx/getOpenId', (request, reply) => completeWechatCallback(request, reply));
  app.get('/oauth/resume/wx/getOpenId/offer', (request, reply) =>
    completeWechatCallback(request, reply, 'offer'),
  );
  app.get('/oauth/resume/wx/getOpenId/campus', (request, reply) =>
    completeWechatCallback(request, reply, 'campus'),
  );
  app.get('/oauth/resume/callback/wechat', (request, reply) =>
    completeWechatCallback(
      request,
      reply,
      String((request.query as { webName?: string }).webName ?? 'resume'),
    ),
  );

  async function currentUser(request: any) {
    await authenticate(request);
    const user = await db
      .selectFrom('client_user')
      .selectAll()
      .where('ID', '=', request.userId!)
      .where('DELETE_FLAG', '=', 'NOT_DELETE')
      .executeTakeFirst();
    if (!user) throw new AppError(404, '用户不存在');
    return ok(mapUser(user));
  }
  app.get('/auth/c/getLoginUser', { preHandler: authenticate }, currentUser);
  app.get('/auth/c/getLoginUser/offer', { preHandler: authenticate }, currentUser);
  app.get('/auth/c/getLoginUser/photo', { preHandler: authenticate }, currentUser);
  app.get('/auth/c/doLogout', { preHandler: authenticate }, async (request) => {
    const token = requestToken(request);
    if (token) await deleteClientToken(env, token);
    return ok(null);
  });
}
