import 'dotenv/config';
import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);
const optionalHex = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .optional(),
);

export const MIN_DOUBAO_OUTPUT_PIXELS = 3_686_400;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(8823),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3200'),
    DATABASE_HOST: z.string().min(1),
    DATABASE_PORT: z.coerce.number().int().positive().default(3306),
    DATABASE_NAME: z.string().min(1),
    DATABASE_USER: z.string().min(1),
    DATABASE_PASSWORD: z.string(),
    DATABASE_CONNECTION_LIMIT: z.coerce.number().int().positive().max(100).default(10),
    REDIS_URL: z.string().url(),
    REDIS_MAX_CONNECTIONS: z.coerce.number().int().positive().max(100).default(16),
    TEST_AUTH_ENABLED: booleanFromEnv,
    TEST_USER_ID: z.string().optional(),
    TEST_AUTH_TOKEN: z.string().optional(),
    ADMIN_LOGIN_ENABLED: booleanFromEnv,
    ADMIN_SM2_PRIVATE_KEY: optionalHex,
    ADMIN_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .max(7 * 24 * 60 * 60)
      .default(86_400),
    CLIENT_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .max(90 * 24 * 60 * 60)
      .default(30 * 24 * 60 * 60),
    TENCENT_COS_SECRET_ID: z.string().optional(),
    TENCENT_COS_SECRET_KEY: z.string().optional(),
    TENCENT_COS_REGION: z.string().optional(),
    TENCENT_COS_BUCKET: z.string().optional(),
    TENCENT_COS_PUBLIC_BASE_URL: optionalUrl,
    WECHAT_APP_ID: z.string().optional(),
    WECHAT_APP_SECRET: z.string().optional(),
    WECHAT_REDIRECT_URI: optionalUrl,
    WECHAT_REDIRECT_URI_OFFER: optionalUrl,
    WECHAT_REDIRECT_URI_PHOTO: optionalUrl,
    WECHAT_REDIRECT_URI_CAMPUS: optionalUrl,
    WECHAT_MP_REDIRECT_URI_CAMPUS: optionalUrl,
    FRONT_REDIRECT_URI: optionalUrl,
    FRONT_REDIRECT_URI_OFFER: optionalUrl,
    FRONT_REDIRECT_URI_PHOTO: optionalUrl,
    FRONT_REDIRECT_URI_CAMPUS: optionalUrl,
    WECHAT_PAY_APP_ID: z.string().optional(),
    WECHAT_PAY_MCH_ID: z.string().optional(),
    WECHAT_PAY_MCH_KEY: z.string().optional(),
    WECHAT_PAY_API_V3_KEY: z.string().optional(),
    WECHAT_PAY_CERT_SERIAL_NO: z.string().optional(),
    WECHAT_PAY_PRIVATE_KEY_PATH: z.string().optional(),
    WECHAT_PAY_CERT_PATH: z.string().optional(),
    WECHAT_PAY_NOTIFY_URL: optionalUrl,
    PAYMENT_MODE: z.enum(['mock', 'live']).default('mock'),
    DEEPSEEK_API_KEY: z.string().optional(),
    DEEPSEEK_BASE_URL: optionalUrl.default('https://api.deepseek.com'),
    DEEPSEEK_MODEL: z.string().optional(),
    DOUBAO_API_KEY: z.string().optional(),
    DOUBAO_BASE_URL: optionalUrl,
    DOUBAO_TEXT_MODEL: z.string().optional(),
    DOUBAO_IMAGE_MODEL: z.string().optional(),
    // Seedream 4.5 currently requires at least 3,686,400 output pixels. The
    // user's ID-photo size is stored separately in the business record.
    DOUBAO_IMAGE_SIZE: z
      .string()
      .regex(/^\d+x\d+$/)
      .default('2048x2048'),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
    AI_MAX_INPUT_LENGTH: z.coerce.number().int().positive().max(100_000).default(3_000),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(12_000).default(4_000),
    PHOTO_COMPENSATION_ENABLED: booleanFromEnv,
    PHOTO_COMPENSATION_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(7 * 24 * 60 * 60 * 1000)
      .default(5 * 60 * 1000),
    PHOTO_COMPENSATION_STALE_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .max(7 * 24 * 60)
      .default(15),
  })
  .superRefine((data, context) => {
    const [width, height] = data.DOUBAO_IMAGE_SIZE.split('x').map(Number);
    if (!width || !height || width * height < MIN_DOUBAO_OUTPUT_PIXELS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DOUBAO_IMAGE_SIZE'],
        message: `必须至少为 ${MIN_DOUBAO_OUTPUT_PIXELS} 像素`,
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }

  if (parsed.data.NODE_ENV === 'production' && parsed.data.TEST_AUTH_ENABLED) {
    throw new Error('TEST_AUTH_ENABLED cannot be enabled in production');
  }

  if (
    parsed.data.TEST_AUTH_ENABLED &&
    (!parsed.data.TEST_USER_ID || !parsed.data.TEST_AUTH_TOKEN)
  ) {
    throw new Error('TEST_USER_ID and TEST_AUTH_TOKEN are required when test auth is enabled');
  }

  if (parsed.data.ADMIN_LOGIN_ENABLED && !parsed.data.ADMIN_SM2_PRIVATE_KEY) {
    throw new Error('ADMIN_SM2_PRIVATE_KEY is required when ADMIN_LOGIN_ENABLED is enabled');
  }

  return parsed.data;
}
