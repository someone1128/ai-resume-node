import COS from 'cos-nodejs-sdk-v5';
import { randomUUID } from 'node:crypto';
import { AppError } from '@/common/errors.js';
import type { AppEnv } from '@/config/env.js';

export type CosObject = {
  key: string;
  url: string;
};

function requireCosConfig(env: AppEnv) {
  if (
    !env.TENCENT_COS_SECRET_ID ||
    !env.TENCENT_COS_SECRET_KEY ||
    !env.TENCENT_COS_REGION ||
    !env.TENCENT_COS_BUCKET
  ) {
    throw new AppError(503, '腾讯云存储未配置');
  }
  return {
    secretId: env.TENCENT_COS_SECRET_ID,
    secretKey: env.TENCENT_COS_SECRET_KEY,
    region: env.TENCENT_COS_REGION,
    bucket: env.TENCENT_COS_BUCKET,
  };
}

function createClient(env: AppEnv) {
  const config = requireCosConfig(env);
  return new COS({
    SecretId: config.secretId,
    SecretKey: config.secretKey,
    Timeout: env.AI_REQUEST_TIMEOUT_MS,
  });
}

function publicUrl(env: AppEnv, key: string) {
  if (env.TENCENT_COS_PUBLIC_BASE_URL) {
    return `${env.TENCENT_COS_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
  }
  const config = requireCosConfig(env);
  return `https://${config.bucket}.cos.${config.region}.myqcloud.com/${key}`;
}

function objectKeyFromUrl(env: AppEnv, urlOrKey: string) {
  if (!/^https?:\/\//i.test(urlOrKey)) return urlOrKey.replace(/^\/+/, '');
  try {
    const url = new URL(urlOrKey);
    const configuredBase = env.TENCENT_COS_PUBLIC_BASE_URL
      ? new URL(env.TENCENT_COS_PUBLIC_BASE_URL)
      : undefined;
    if (configuredBase && url.origin === configuredBase.origin) {
      const basePath = configuredBase.pathname.replace(/\/$/, '');
      return decodeURIComponent(url.pathname.slice(basePath.length).replace(/^\/+/, ''));
    }
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    throw new AppError(400, 'COS 文件地址格式不正确');
  }
}

export async function uploadToCos(
  env: AppEnv,
  body: Buffer,
  contentType: string | undefined,
  originalName: string | undefined,
): Promise<string> {
  const config = requireCosConfig(env);
  const cos = createClient(env);
  const extension = (originalName?.split('.').pop() || 'bin')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8);
  const key = `resume-migration/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension || 'bin'}`;
  const object = {
    Bucket: config.bucket,
    Region: config.region,
    Key: key,
    Body: body,
    ...(contentType ? { ContentType: contentType } : {}),
  };
  await cos.putObject(object);
  return publicUrl(env, key);
}

export async function deleteFromCos(env: AppEnv, urlOrKey: string): Promise<void> {
  const config = requireCosConfig(env);
  const cos = createClient(env);
  await cos.deleteObject({
    Bucket: config.bucket,
    Region: config.region,
    Key: objectKeyFromUrl(env, urlOrKey),
  });
}

export async function cosObjectExists(env: AppEnv, urlOrKey: string): Promise<boolean> {
  const config = requireCosConfig(env);
  const cos = createClient(env);
  try {
    await cos.headObject({
      Bucket: config.bucket,
      Region: config.region,
      Key: objectKeyFromUrl(env, urlOrKey),
    });
    return true;
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode);
    if (status === 404 || String((error as { code?: string }).code) === 'NoSuchKey') return false;
    throw error;
  }
}

export async function createCosDownloadUrl(
  env: AppEnv,
  urlOrKey: string,
  expires = 900,
): Promise<string> {
  const config = requireCosConfig(env);
  const key = objectKeyFromUrl(env, urlOrKey);
  if (env.TENCENT_COS_PUBLIC_BASE_URL) return publicUrl(env, key);
  const cos = createClient(env);
  const result = cos.getObjectUrl({
    Bucket: config.bucket,
    Region: config.region,
    Key: key,
    Sign: true,
    Expires: Math.max(1, Math.min(expires, 86_400)),
  });
  return result;
}
