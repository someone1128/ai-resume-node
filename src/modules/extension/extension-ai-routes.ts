import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '@/common/errors.js';
import { ok } from '@/common/http-response.js';
import { requireUser } from '@/auth/request-user.js';
import type { AppEnv } from '@/config/env.js';
import { generateAiText, parseJsonOrText } from '@/modules/ai/ai-service.js';

export const EXTENSION_AI_DEFAULT_MODEL = 'deepseek-flash';

export function resolveExtensionAiModel(env: Pick<AppEnv, 'DEEPSEEK_MODEL'>) {
  return env.DEEPSEEK_MODEL || EXTENSION_AI_DEFAULT_MODEL;
}

const fieldKey = z.enum([
  'name',
  'phone',
  'email',
  'city',
  'targetCity',
  'age',
  'gender',
  'currentStatus',
  'targetSalary',
  'wechat',
  'website',
  'github',
  'targetPosition',
  'school',
  'major',
  'degree',
  'company',
  'position',
  'startDate',
  'endDate',
  'description',
  'skills',
  'projectName',
  'projectRole',
  'projectStartDate',
  'projectEndDate',
  'projectDescription',
  'photo',
  'attachment',
]);

const requestSchema = z.object({
  pageUrl: z.string().url().max(2048),
  siteId: z.string().max(64).default('generic'),
  jobDescription: z.string().max(12_000).default(''),
  draftInstruction: z.string().max(1_000).default(''),
  fields: z
    .array(
      z.object({
        id: z.string().max(128),
        key: fieldKey.nullable(),
        label: z.string().max(300),
        type: z.string().max(64),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(200),
  resume: z
    .object({
      skills: z.array(z.string().max(500)).max(50).default([]),
      selfIntroduction: z.string().max(5_000).optional(),
    })
    .optional(),
});

const responseSchema = z.object({
  mappings: z
    .array(
      z.object({
        fieldId: z.string().max(128),
        key: fieldKey.nullable(),
        confidence: z.number().min(0).max(1),
        reason: z.string().max(300),
      }),
    )
    .max(200),
  drafts: z
    .array(
      z.object({
        fieldKey,
        content: z.string().max(5_000),
        reason: z.string().max(300),
      }),
    )
    .max(30),
});

/** 校验并提取模型返回的扩展 AI 结果，避免不完整结果直接进入插件填写流程。 */
export function parseExtensionAiResponse(text: string) {
  const result = responseSchema.safeParse(parseJsonOrText(text));
  if (!result.success) throw new AppError(502, 'AI 返回结构不合法');
  return result.data;
}

function sanitizePageUrl(pageUrl: string) {
  const url = new URL(pageUrl);
  return `${url.origin}${url.pathname}`;
}

function buildPrompt(input: z.infer<typeof requestSchema>) {
  return [
    '你是招聘网站表单字段识别助手。只返回 JSON，不要 Markdown，不要解释 JSON 以外的内容。',
    '根据页面字段、站点和职位描述，为未确定字段选择统一字段 key，并为适合生成草稿的字段给出候选文本。',
    '不要猜测姓名、手机号、邮箱等个人信息；不要生成虚假经历；不要自动提交；置信度低于 0.7 时 key 返回 null。',
    '允许的 key：name, phone, email, city, targetCity, age, gender, currentStatus, targetSalary, wechat, website, github, targetPosition, school, major, degree, company, position, startDate, endDate, description, skills, projectName, projectRole, projectStartDate, projectEndDate, projectDescription, photo, attachment。',
    '返回格式：{"mappings":[{"fieldId":"...","key":"..."或null,"confidence":0到1,"reason":"..."}],"drafts":[{"fieldKey":"description","content":"...","reason":"..."}]}',
    `页面地址：${sanitizePageUrl(input.pageUrl)}`,
    `站点：${input.siteId}`,
    `职位描述：${input.jobDescription}`,
    `草稿操作要求：${input.draftInstruction || '无，正常分析全部字段'}`,
    `页面字段：${JSON.stringify(input.fields)}`,
    `简历补充信息：${JSON.stringify(input.resume ?? {})}`,
  ].join('\n');
}

export function registerExtensionAiRoutes(app: FastifyInstance, env: AppEnv) {
  const authenticate = requireUser(env);
  app.post('/extension/ai/analyze', { preHandler: authenticate }, async (request) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, '请求参数不合法');
    const prompt = buildPrompt(parsed.data).slice(0, env.AI_MAX_INPUT_LENGTH);
    try {
      const text = await generateAiText(env, prompt, { model: resolveExtensionAiModel(env) });
      return ok(parseExtensionAiResponse(text));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'AI 分析失败，请稍后重试');
    }
  });
}
