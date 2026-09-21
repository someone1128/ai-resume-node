import { timingSafeEqual, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import smCrypto from 'sm-crypto';
import {
  resolveAdminToken,
  requestToken,
  saveAdminToken,
  deleteAdminToken,
} from '@/auth/request-user.js';
import { AppError } from '@/common/errors.js';
import { ok } from '@/common/http-response.js';
import type { AppEnv } from '@/config/env.js';
import type { Database } from '@/infrastructure/database.js';

type LoginBody = {
  account?: string;
  password?: string;
  passwordHash?: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    adminId: string | undefined;
  }
}

const migratedMenu = [
  {
    id: 'node-admin',
    name: 'nodeAdmin',
    path: '/nodeAdmin',
    component: '',
    meta: { title: '业务管理', type: 'module', icon: 'setting-outlined' },
    children: [
      {
        id: 'node-admin-home',
        name: 'index',
        path: '/index',
        component: 'index/index',
        meta: { title: '首页', type: 'menu', icon: 'bank-outlined', affix: true },
        children: [],
      },
      {
        id: 'node-admin-dict',
        name: 'dict',
        path: '/biz/dict',
        component: 'biz/dict/index',
        meta: { title: '字典管理', type: 'menu', icon: 'tags-outlined' },
        children: [],
      },
    ],
  },
];

function sameSecret(actual: string | null, expected: string) {
  if (!actual) return false;
  const left = Buffer.from(actual, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function passwordHash(body: LoginBody, env: AppEnv) {
  if (body.passwordHash && /^[0-9a-fA-F]{64}$/.test(body.passwordHash)) return body.passwordHash;
  if (!body.password) throw new AppError(400, '密码不能为空');
  if (!env.ADMIN_SM2_PRIVATE_KEY) throw new AppError(501, '管理员登录密钥未配置');
  try {
    const plain = smCrypto.sm2.doDecrypt(body.password, env.ADMIN_SM2_PRIVATE_KEY, 1);
    return smCrypto.sm3(plain);
  } catch {
    throw new AppError(401, '管理员密码解密失败');
  }
}

export function requireAdmin(env: AppEnv, db: Kysely<Database>) {
  return async function adminGuard(request: FastifyRequest): Promise<void> {
    const token = requestToken(request);
    if (env.TEST_AUTH_ENABLED && token === env.TEST_AUTH_TOKEN) {
      request.adminId = env.TEST_USER_ID;
      return;
    }
    if (!token) throw new AppError(401, '管理员登录状态已失效');
    const adminId = await resolveAdminToken(env, token);
    if (!adminId) throw new AppError(401, '管理员登录状态已失效');
    const admin = await db
      .selectFrom('sys_user')
      .select('ID')
      .where('ID', '=', adminId)
      .where('DELETE_FLAG', '=', 'NOT_DELETE')
      .executeTakeFirst();
    if (!admin) throw new AppError(403, '需要管理员登录');
    request.adminId = admin.ID;
  };
}

function mapAdmin(user: Record<string, unknown>) {
  return {
    id: user.ID,
    account: user.ACCOUNT,
    name: user.NAME,
    nickname: user.NICKNAME,
    avatar: user.AVATAR,
    signature: user.SIGNATURE,
    phone: user.PHONE,
    email: user.EMAIL,
    gender: user.GENDER,
    roleCodeList: ['superAdmin'],
    permissionCodeList: ['*'],
    orgName: null,
    positionName: null,
  };
}

export function registerAdminAuthRoutes(app: FastifyInstance, env: AppEnv, db: Kysely<Database>) {
  const adminGuard = requireAdmin(env, db);

  // Snowy loads this public bootstrap endpoint before an administrator has a
  // session. The migrated admin does not expose the old configuration center,
  // so return an empty safe set instead of making the login page fail.
  app.get('/dev/config/sysBaseList', async () => ok([]));

  app.post<{ Body: LoginBody }>('/auth/b/doLogin', async (request) => {
    if (!env.ADMIN_LOGIN_ENABLED) {
      throw new AppError(501, 'Node 管理员账号登录尚未启用，请先配置 ADMIN_LOGIN_ENABLED');
    }
    const body = request.body ?? {};
    const account = body.account?.trim();
    if (!account) throw new AppError(400, '账号不能为空');
    const user = await db
      .selectFrom('sys_user')
      .select(['ID', 'PASSWORD'])
      .where('ACCOUNT', '=', account)
      .where('DELETE_FLAG', '=', 'NOT_DELETE')
      .executeTakeFirst();
    if (!user || !sameSecret(user.PASSWORD, passwordHash(body, env))) {
      throw new AppError(401, '账号或密码错误');
    }
    const token = randomBytes(32).toString('hex');
    await saveAdminToken(env, token, user.ID);
    return ok(token);
  });

  app.get('/auth/b/getLoginUser', { preHandler: adminGuard }, async (request) => {
    if (!request.adminId) throw new AppError(401, '管理员登录状态已失效');
    const user = await db
      .selectFrom('sys_user')
      .select([
        'ID',
        'ACCOUNT',
        'NAME',
        'NICKNAME',
        'AVATAR',
        'SIGNATURE',
        'PHONE',
        'EMAIL',
        'GENDER',
      ])
      .where('ID', '=', request.adminId)
      .where('DELETE_FLAG', '=', 'NOT_DELETE')
      .executeTakeFirst();
    if (!user) throw new AppError(404, '管理员不存在');
    return ok(mapAdmin(user));
  });

  app.get('/sys/userCenter/loginMenu', { preHandler: adminGuard }, async () => ok(migratedMenu));

  app.get('/auth/b/doLogout', { preHandler: adminGuard }, async (request) => {
    const token = requestToken(request);
    if (token) await deleteAdminToken(env, token);
    return ok(null);
  });
}
