import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from '@/app.js';
import { loadEnv } from '@/config/env.js';
import { DEFAULT_FEATURE_QUOTA } from '@/modules/ai/ai-routes.js';
import { DEFAULT_DEEPSEEK_MODEL } from '@/modules/ai/ai-service.js';
import { notifyPaymentWebSocket } from '@/modules/payment/payment-websocket.js';
import {
  buildMockJsapiParams,
  canApplyMockPaymentSuccess,
} from '@/modules/payment/payment-routes.js';
import {
  buildPhotoProviderBody,
  isSupportedImagePayload,
  matchesImageSignature,
} from '@/modules/photo/photo-routes.js';
import {
  DEFAULT_PHOTO_STALE_MINUTES,
  isStalePhotoGeneration,
} from '@/modules/maintenance/photo-compensation.js';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_HOST: '127.0.0.1',
  DATABASE_PORT: '3306',
  DATABASE_NAME: 'ai-resume-test',
  DATABASE_USER: 'test',
  DATABASE_PASSWORD: 'test',
  REDIS_URL: 'redis://127.0.0.1:6379/2',
};

describe('foundation', () => {
  it('keeps Snowy logical-delete markers explicit in module code', () => {
    const moduleRoot = join(process.cwd(), 'src', 'modules');
    const source = readdirSync(moduleRoot, { recursive: true, encoding: 'utf8' })
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => readFileSync(join(moduleRoot, entry), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/(?:delete_flag|DELETE_FLAG):\s*null/);
    expect(source).not.toMatch(/(?:delete_flag|DELETE_FLAG).*!=.*DELETED/);
  });

  it('keeps the Java-compatible default AI quota at three uses', () => {
    expect(DEFAULT_FEATURE_QUOTA).toBe(3);
  });

  it('uses the Java-configured DeepSeek flash model for general AI flows', () => {
    expect(DEFAULT_DEEPSEEK_MODEL).toBe('deepseek-v4-flash');
  });

  it('keeps mock JSAPI responses compatible with the member page', () => {
    expect(buildMockJsapiParams('0123456789abcdef-rest')).toMatchObject({
      appId: 'mock-app-id',
      nonceStr: '0123456789abcdef',
      package: 'prepay_id=mock_0123456789abcdef',
      signType: 'MD5',
      paySign: 'mock-signature',
    });
  });

  it('only applies mock payment success to pending orders', () => {
    expect(canApplyMockPaymentSuccess('待支付')).toBe(true);
    expect(canApplyMockPaymentSuccess('支付失败')).toBe(false);
    expect(canApplyMockPaymentSuccess('支付成功')).toBe(false);
  });

  it('identifies only old processing photo records for compensation', () => {
    const now = new Date('2026-09-21T12:00:00.000Z');
    expect(
      isStalePhotoGeneration('2026-09-21T11:45:01.000Z', now, DEFAULT_PHOTO_STALE_MINUTES),
    ).toBe(false);
    expect(
      isStalePhotoGeneration('2026-09-21T11:45:00.000Z', now, DEFAULT_PHOTO_STALE_MINUTES),
    ).toBe(true);
    expect(isStalePhotoGeneration(null, now)).toBe(false);
  });

  it('accepts only matching image signatures for photo uploads', () => {
    expect(matchesImageSignature(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg')).toBe(
      true,
    );
    expect(
      matchesImageSignature(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        'image/png',
      ),
    ).toBe(true);
    expect(matchesImageSignature(Uint8Array.from([0xff, 0xd8, 0xff]), 'image/png')).toBe(false);
  });

  it('keeps provider image size separate from the requested ID-photo size', () => {
    expect(
      buildPhotoProviderBody({
        model: 'doubao-seedream-4-5-251128',
        prompt: 'test',
        image: 'data:image/png;base64,test',
        size: '2048x2048',
      }),
    ).toMatchObject({
      model: 'doubao-seedream-4-5-251128',
      size: '2048x2048',
      watermark: false,
      n: 1,
    });
  });

  it('rejects unsupported photo upload files before contacting COS', async () => {
    const app = buildApp(
      loadEnv({
        ...baseEnv,
        TEST_AUTH_ENABLED: 'true',
        TEST_USER_ID: 'photo-upload-test-user',
        TEST_AUTH_TOKEN: 'photo-upload-test-token',
      }),
    );
    const boundary = 'photo-upload-test';
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="payload.exe"',
      'Content-Type: application/octet-stream',
      '',
      'not-an-image',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const response = await app.inject({
      method: 'POST',
      url: '/c/photo/file/upload',
      headers: {
        token: 'photo-upload-test-token',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 400, success: false });
    await app.close();
  });

  it('extracts text from synthetic DOCX and PDF resume samples', async () => {
    const app = buildApp(
      loadEnv({
        ...baseEnv,
        TEST_AUTH_ENABLED: 'true',
        TEST_USER_ID: 'file-parser-test-user',
        TEST_AUTH_TOKEN: 'file-parser-test-token',
      }),
    );

    const upload = async (filename: string, contentType: string) => {
      const boundary = `file-parser-${filename}`;
      const content = readFileSync(join(process.cwd(), 'test', 'fixtures', filename));
      const prefix = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      );
      const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
      return app.inject({
        method: 'POST',
        url: '/c/resume/analysisText',
        headers: {
          token: 'file-parser-test-token',
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: Buffer.concat([prefix, content, suffix]),
      });
    };

    const docx = await upload(
      'sample-resume.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(docx.statusCode).toBe(200);
    expect(docx.json()).toMatchObject({ code: 200, success: true });
    expect(docx.json().data).toContain('codex synthetic resume DOCX');

    const pdf = await upload('sample-resume.pdf', 'application/pdf');
    expect(pdf.statusCode).toBe(200);
    expect(pdf.json()).toMatchObject({ code: 200, success: true });
    expect(pdf.json().data).toContain('codex synthetic resume PDF');
    await app.close();
  });

  it('loads a validated test environment', () => {
    const env = loadEnv(baseEnv);
    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(8823);
    expect(env.DOUBAO_IMAGE_SIZE).toBe('2048x2048');
    expect(env.AI_MAX_OUTPUT_TOKENS).toBe(4000);
  });

  it('allows an explicit bounded AI output token limit', () => {
    const env = loadEnv({ ...baseEnv, AI_MAX_OUTPUT_TOKENS: '8000' });
    expect(env.AI_MAX_OUTPUT_TOKENS).toBe(8000);
    expect(() => loadEnv({ ...baseEnv, AI_MAX_OUTPUT_TOKENS: '0' })).toThrow(
      'AI_MAX_OUTPUT_TOKENS',
    );
  });

  it('validates provider result bytes before uploading them to COS', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(isSupportedImagePayload(png, 'image/png')).toBe(true);
    expect(isSupportedImagePayload(png, 'image/png; charset=binary')).toBe(true);
    expect(isSupportedImagePayload(Uint8Array.from([1, 2, 3]), 'image/png')).toBe(false);
    expect(isSupportedImagePayload(png, 'image/png', 4)).toBe(false);
  });

  it('rejects provider image sizes that Seedream cannot generate', () => {
    expect(() => loadEnv({ ...baseEnv, DOUBAO_IMAGE_SIZE: '295x413' })).toThrow(
      'DOUBAO_IMAGE_SIZE',
    );
  });

  it('treats blank optional URL settings as unset', () => {
    const env = loadEnv({
      ...baseEnv,
      WECHAT_REDIRECT_URI: '',
      FRONT_REDIRECT_URI: '',
      DOUBAO_BASE_URL: '',
      ADMIN_SM2_PRIVATE_KEY: '',
    });
    expect(env.WECHAT_REDIRECT_URI).toBeUndefined();
    expect(env.FRONT_REDIRECT_URI).toBeUndefined();
    expect(env.DOUBAO_BASE_URL).toBeUndefined();
    expect(env.ADMIN_SM2_PRIVATE_KEY).toBeUndefined();
  });

  it('rejects test auth in production', () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        TEST_AUTH_ENABLED: 'true',
        TEST_USER_ID: 'test-user',
        TEST_AUTH_TOKEN: 'test-token',
      }),
    ).toThrow('TEST_AUTH_ENABLED cannot be enabled in production');
  });

  it('requires the SM2 private key for Node admin login', () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        ADMIN_LOGIN_ENABLED: 'true',
      }),
    ).toThrow('ADMIN_SM2_PRIVATE_KEY is required');
  });

  it('returns the compatibility response envelope', async () => {
    const app = buildApp(loadEnv(baseEnv));
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 200,
      success: true,
      data: { status: 'ok', environment: 'test' },
    });
    await app.close();
  });

  it('accepts empty JSON action bodies used by the legacy Axios client', async () => {
    const app = buildApp(loadEnv(baseEnv));
    const response = await app.inject({
      method: 'POST',
      url: '/c/resume/webError',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 200, success: true });
    await app.close();
  });

  it('rejects protected resume routes without a compatible token', async () => {
    const app = buildApp(loadEnv(baseEnv));
    const response = await app.inject({
      method: 'GET',
      url: '/c/resume/codex_migration_test_missing',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 401, success: false });
    await app.close();
  });

  it('protects photo, chat and admin compatibility routes consistently', async () => {
    const app = buildApp(loadEnv(baseEnv));
    for (const url of [
      '/c/photo/quota',
      '/aiChat/c/gpt/checkIsIng',
      '/aiChat/c/dialogue/page',
      '/dev/dict/page',
      '/biz/dict/page',
      '/auth/b/getLoginUser',
      '/sys/userCenter/loginMenu',
      '/c/resume/distribution/stat',
      '/c/resume/notification/unreadCount',
      '/extension/ai/analyze',
    ]) {
      const response = await app.inject({
        method: url === '/extension/ai/analyze' ? 'POST' : 'GET',
        url,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 401, success: false });
    }
    await app.close();
  });

  it('keeps the public admin bootstrap configuration endpoint safe', async () => {
    const app = buildApp(loadEnv(baseEnv));
    const response = await app.inject({ method: 'GET', url: '/dev/config/sysBaseList' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 200, success: true, data: [] });
    await app.close();
  });

  it('registers the Java-compatible ad slot aliases', () => {
    const app = buildApp(loadEnv(baseEnv));
    const routes = app.printRoutes();
    expect(routes).toContain('common/adslot/');
    expect(routes).toContain('list (GET, HEAD)');
    expect(routes).toContain('click (POST)');
  });

  it('registers every path in the retained frontend contract', () => {
    const app = buildApp(loadEnv(baseEnv));
    const routes: Array<[string, string]> = [
      ['GET', '/c/resume/:resumeId'],
      ['GET', '/c/resume/:resumeId/baseInfo'],
      ['GET', '/c/resume/category'],
      ['GET', '/c/resume/templates'],
      ['GET', '/c/resume/templates/my'],
      ['GET', '/c/resume/templates/myCollects'],
      ['POST', '/c/resume/create'],
      ['POST', '/c/resume/collect/:resumeId'],
      ['POST', '/c/resume/disCollect/:resumeId'],
      ['POST', '/c/resume/use/:resumeId'],
      ['POST', '/c/resume/publish'],
      ['POST', '/c/resume/unpublish/:resumeId'],
      ['DELETE', '/c/resume/:resumeId'],
      ['PUT', '/c/resume/modules'],
      ['PUT', '/c/resume/name'],
      ['PUT', '/c/resume/previewImage'],
      ['PUT', '/c/resume/template'],
      ['PUT', '/c/resume/styleConfig'],
      ['POST', '/c/resume/webError'],
      ['POST', '/c/resume/feedback'],
      ['GET', '/c/resume/memberPackage'],
      ['GET', '/c/resume/memberPackage/offer'],
      ['GET', '/c/resume/memberPackage/photo'],
      ['GET', '/c/resume/redeem/:code'],
      ['GET', '/c/resume/functionLimits/count'],
      ['POST', '/c/resume/aiTest'],
      ['POST', '/c/resume/analyze'],
      ['GET', '/c/resume/analyze/:id'],
      ['POST', '/c/resume/aiGenerate'],
      ['POST', '/c/resume/optimize/suggestion'],
      ['POST', '/c/resume/optimize'],
      ['POST', '/c/resume/ai/optimize'],
      ['POST', '/c/resume/translate'],
      ['POST', '/c/resume/aiInterview'],
      ['GET', '/c/resume/aiInterview/:id'],
      ['POST', '/c/resume/analysisText'],
      ['POST', '/c/resume/import'],
      ['POST', '/c/resume/import/create'],
      ['GET', '/c/resume/distribution/stat'],
      ['GET', '/c/resume/invitationRecords'],
      ['GET', '/c/resume/invitedUserDetails'],
      ['GET', '/c/resume/redeemCode/:invitationCode'],
      ['GET', '/c/resume/campusRecruitment'],
      ['GET', '/c/resume/campusRecruitment/referral'],
      ['GET', '/c/resume/campusRecruitment/progress'],
      ['GET', '/c/resume/campusRecruitment/stats'],
      ['PUT', '/c/resume/campusRecruitment/status'],
      ['PUT', '/c/resume/campusRecruitment/remarks'],
      ['GET', '/c/resume/campusRecruitment/record'],
      ['POST', '/c/resume/campusRecruitment/record'],
      ['PUT', '/c/resume/campusRecruitment/record/:id'],
      ['DELETE', '/c/resume/campusRecruitment/record/:id'],
      ['POST', '/c/resume/campusRecruitment/custom'],
      ['PUT', '/c/resume/campusRecruitment/custom/:id'],
      ['GET', '/c/resume/notification/page/system'],
      ['GET', '/c/resume/notification/page/activity'],
      ['GET', '/c/resume/notification/page/like'],
      ['GET', '/c/resume/notification/unreadCount'],
      ['GET', '/c/resume/notification/unreadSystem'],
      ['POST', '/c/resume/notification/read/:id'],
      ['POST', '/c/resume/notification/readAll'],
      ['POST', '/dev/file/uploadTencentReturnUrl'],
      ['GET', '/c/photo/template'],
      ['POST', '/c/photo/file/upload'],
      ['GET', '/c/photo/quota'],
      ['GET', '/c/photo/generation'],
      ['POST', '/c/photo/generation'],
      ['GET', '/c/photo/generation/:id'],
      ['DELETE', '/c/photo/generation/:id'],
      ['POST', '/c/photo/generate'],
      ['GET', '/auth/c/getLoginUser'],
      ['GET', '/auth/c/getLoginUser/offer'],
      ['GET', '/auth/c/doLogout'],
      ['POST', '/auth/b/doLogin'],
      ['GET', '/auth/b/getLoginUser'],
      ['GET', '/auth/b/doLogout'],
      ['GET', '/sys/userCenter/loginMenu'],
      ['GET', '/dev/config/sysBaseList'],
      ['GET', '/dev/dict/page'],
      ['GET', '/dev/dict/list'],
      ['GET', '/dev/dict/tree'],
      ['GET', '/dev/dict/treeAll'],
      ['GET', '/dev/dict/detail'],
      ['POST', '/dev/dict/add'],
      ['POST', '/dev/dict/edit'],
      ['POST', '/dev/dict/delete'],
      ['GET', '/biz/dict/page'],
      ['GET', '/biz/dict/list'],
      ['GET', '/biz/dict/tree'],
      ['GET', '/biz/dict/treeAll'],
      ['GET', '/biz/dict/detail'],
      ['POST', '/biz/dict/add'],
      ['POST', '/biz/dict/edit'],
      ['POST', '/biz/dict/delete'],
      ['GET', '/oauth/resume/wx/getCode'],
      ['GET', '/oauth/resume/wx/getCode/offer'],
      ['GET', '/oauth/resume/wx/getOpenId'],
      ['GET', '/oauth/resume/wx/getOpenId/offer'],
      ['POST', '/oauth/resume/render/wechat'],
      ['POST', '/aiChat/c/gpt/chatSseContext'],
      ['POST', '/aiChat/c/gpt/chatStreamContext'],
      ['GET', '/aiChat/c/gpt/checkIsIng'],
      ['POST', '/aiChat/c/gpt/chatGuide/:dialogueId'],
      ['POST', '/aiChat/c/gpt/chatGuide/xfxh/:dialogueId'],
      ['POST', '/aiChat/c/gpt/chatAnewAnswer'],
      ['GET', '/aiChat/c/dialogue/page'],
      ['POST', '/aiChat/c/dialogue'],
      ['PUT', '/aiChat/c/dialogue'],
      ['GET', '/aiChat/c/dialogue/:id'],
      ['DELETE', '/aiChat/c/dialogue/:id'],
      ['GET', '/aiChat/c/message/page'],
      ['POST', '/extension/ai/analyze'],
      ['GET', '/c/resume/adslot/list'],
      ['POST', '/c/resume/adslot/click'],
      ['GET', '/c/adSlot/list'],
      ['POST', '/c/adSlot/click'],
      ['GET', '/c/common/adslot/list'],
      ['POST', '/c/common/adslot/click'],
    ];

    for (const [method, url] of routes) {
      expect(app.hasRoute({ method, url }), `${method} ${url}`).toBe(true);
    }
  });

  it('protects the mock JSAPI order creator', async () => {
    const app = buildApp(loadEnv(baseEnv));
    const response = await app.inject({ method: 'POST', url: '/test/jsapi/createTestOrder' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 401, success: false });
    await app.close();
  });

  it('does not expose JSAPI diagnostic routes in production', async () => {
    const app = buildApp(loadEnv({ ...baseEnv, NODE_ENV: 'production' }));
    const response = await app.inject({ method: 'GET', url: '/test/jsapi/ping' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 404, success: false });
    await app.close();
  });

  it('validates the extension AI contract before model access', async () => {
    const app = buildApp(
      loadEnv({
        ...baseEnv,
        TEST_AUTH_ENABLED: 'true',
        TEST_USER_ID: 'extension-test-user',
        TEST_AUTH_TOKEN: 'extension-test-token',
      }),
    );
    const invalid = await app.inject({
      method: 'POST',
      url: '/extension/ai/analyze',
      headers: { 'x-offer-star-token': 'extension-test-token' },
      payload: { pageUrl: 'not-a-url' },
    });
    expect(invalid.statusCode).toBe(200);
    expect(invalid.json()).toMatchObject({ code: 400, success: false });

    const valid = await app.inject({
      method: 'POST',
      url: '/extension/ai/analyze',
      headers: { 'x-offer-star-token': 'extension-test-token' },
      payload: {
        pageUrl: 'https://example.com/jobs/1',
        fields: [
          { id: 'name', key: null, label: '姓名', type: 'text', confidence: 0.4 },
          {
            id: 'start-date',
            key: 'startDate',
            label: '开始时间',
            type: 'month',
            confidence: 0.86,
          },
          { id: 'end-date', key: 'endDate', label: '结束时间', type: 'month', confidence: 0.86 },
        ],
      },
    });
    expect(valid.statusCode).toBe(500);
    expect(valid.json()).toMatchObject({ code: 503, success: false });
    await app.close();
  });

  it('fails closed for live payment callbacks until signature verification is enabled', async () => {
    const app = buildApp(loadEnv({ ...baseEnv, PAYMENT_MODE: 'live' }));
    const response = await app.inject({
      method: 'POST',
      url: '/c/resume/memberPackage/wxPayCallback',
      payload: { orderNo: 'not-processed' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 501, success: false });
    await app.close();
  });

  it('exposes the reduced full-access admin menu for a development test admin', async () => {
    const app = buildApp(
      loadEnv({
        ...baseEnv,
        TEST_AUTH_ENABLED: 'true',
        TEST_USER_ID: 'admin-test-user',
        TEST_AUTH_TOKEN: 'admin-test-token',
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: '/sys/userCenter/loginMenu',
      headers: { token: 'admin-test-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 200,
      data: [{ children: [{ path: '/index' }, { path: '/biz/dict' }] }],
    });
    await app.close();
  });

  it('delivers the legacy payment notification over WebSocket', async () => {
    const app = buildApp(loadEnv(baseEnv));
    await app.ready();
    const socket = await app.injectWS('/ws/ws-test-user/WxPay');
    const message = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('payment websocket timeout')), 1000);
      socket.once('message', (data) => {
        clearTimeout(timer);
        resolve(JSON.parse(data.toString()));
      });
      socket.once('error', reject);
    });
    expect(notifyPaymentWebSocket('ws-test-user', 'WxPay', { code: 200, data: '支付成功' })).toBe(
      1,
    );
    await expect(message).resolves.toEqual({ code: 200, data: '支付成功' });
    socket.close();
    await app.close();
  });
});
