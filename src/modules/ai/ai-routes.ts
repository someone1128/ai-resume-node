import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { AppError } from '@/common/errors.js';
import { ok } from '@/common/http-response.js';
import { requireUser } from '@/auth/request-user.js';
import type { AppEnv } from '@/config/env.js';
import type { Database } from '@/infrastructure/database.js';
import { generateAiText, parseJsonOrText, sanitizeAiHtml } from '@/modules/ai/ai-service.js';
import {
  assertResumeCreationAllowed,
  DEFAULT_MODULE_TYPES,
} from '@/modules/resume/resume-routes.js';
import type { Kysely } from 'kysely';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

type Body = Record<string, unknown>;

function objectBody(body: unknown): Body {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, '请求参数格式错误');
  }
  return body as Body;
}

function stringValue(body: Body, key: string, required = true): string {
  const value = body[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (required) throw new AppError(400, `${key}不能为空`);
  return '';
}

async function resumeContext(
  db: Kysely<Database>,
  userId: string,
  resumeId: string | undefined,
  supplied: string,
) {
  if (supplied) return supplied;
  if (!resumeId) return '';
  const resume = await db
    .selectFrom('sc_resume')
    .select('id')
    .where('id', '=', resumeId)
    .where('user_id', '=', userId)
    .where('delete_flag', '=', 'NOT_DELETE')
    .executeTakeFirst();
  if (!resume) throw new AppError(400, '简历不存在或无权使用');
  const modules = await db
    .selectFrom('sc_resume_modules')
    .select([
      'module_type as moduleType',
      'module_content as moduleContent',
      'has_enable as hasEnable',
    ])
    .where('resume_id', '=', resumeId)
    .where('delete_flag', '=', 'NOT_DELETE')
    .orderBy('display_order', 'asc')
    .execute();
  return JSON.stringify(modules);
}

const featureMessages: Record<string, string> = {
  简历分析: '您的分析次数已用完，开通会员增加次数',
  智能生成简历: '您的生成简历次数已用完，开通会员增加次数',
  AI面试题: '您的 AI 预测面试题次数已用完，开通会员增加次数',
  一键优化简历: '您的 AI 一键优化简历功能次数已用完，开通会员增加次数',
  简历优化建议: '您的优化建议功能次数已用完，开通会员增加次数',
};

export const DEFAULT_FEATURE_QUOTA = 3;

async function isActiveMember(db: Kysely<Database>, userId: string) {
  const user = await db
    .selectFrom('client_user')
    .select(['member_expiration_time', 'offer_member_expiration_time'])
    .where('ID', '=', userId)
    .where('DELETE_FLAG', '=', 'NOT_DELETE')
    .executeTakeFirst();
  if (!user) return false;
  const now = Date.now();
  return [user.member_expiration_time, user.offer_member_expiration_time].some(
    (value) => value instanceof Date && value.getTime() > now,
  );
}

async function reserveFeatureQuota(db: Kysely<Database>, userId: string, functionName: string) {
  if (await isActiveMember(db, userId)) return false;
  const reserved = await db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('sc_user_function_limits')
      .select('remaining_uses')
      .where('function_name', '=', functionName)
      .where('user_id', '=', userId)
      .forUpdate()
      .executeTakeFirst();
    if (!existing) {
      await trx
        .insertInto('sc_user_function_limits')
        .values({
          id: randomUUID().replaceAll('-', ''),
          function_name: functionName,
          remaining_uses: DEFAULT_FEATURE_QUOTA,
          user_id: userId,
          create_time: new Date(),
          update_time: new Date(),
        })
        .execute();
      return true;
    }
    if (Number(existing.remaining_uses ?? 0) <= 0) return false;
    const result = await trx
      .updateTable('sc_user_function_limits')
      .set(({ eb }) => ({
        remaining_uses: eb('remaining_uses', '-', 1),
        update_time: new Date(),
      }))
      .where('function_name', '=', functionName)
      .where('user_id', '=', userId)
      .where('remaining_uses', '>', 0)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  });
  if (!reserved) throw new AppError(403, featureMessages[functionName] ?? '功能次数已用完');
  return true;
}

async function refundFeatureQuota(db: Kysely<Database>, userId: string, functionName: string) {
  await db
    .updateTable('sc_user_function_limits')
    .set(({ eb }) => ({
      remaining_uses: eb('remaining_uses', '+', 1),
      update_time: new Date(),
    }))
    .where('function_name', '=', functionName)
    .where('user_id', '=', userId)
    .execute();
}

function generatedModuleList(parsed: unknown) {
  const objectValue =
    parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  const items: unknown[] = Array.isArray(parsed)
    ? parsed
    : objectValue && Array.isArray(objectValue.modules)
      ? objectValue.modules
      : [];
  if (!items.length) throw new AppError(502, 'AI 未返回有效的简历模块 JSON');
  const mapped = items
    .filter((item: unknown): item is Record<string, unknown> =>
      Boolean(item && typeof item === 'object'),
    )
    .map((item: Record<string, unknown>) => ({
      moduleType:
        typeof item.moduleType === 'string' && importModuleTypes.includes(item.moduleType)
          ? item.moduleType
          : '其他经历',
      moduleContent:
        typeof item.moduleContent === 'string'
          ? item.moduleContent
          : JSON.stringify(item.moduleContent ?? item),
    }));
  return DEFAULT_MODULE_TYPES.map((moduleType, index) => {
    const found = mapped.find((item) => item.moduleType === moduleType);
    return {
      module_type: moduleType,
      display_order: index + 1,
      module_content: found?.moduleContent ?? '{}',
      has_enable: found ? 1 : 0,
    };
  });
}

async function createGeneratedResume(
  db: Kysely<Database>,
  userId: string,
  parsed: unknown,
  titleSuffix = '的简历',
) {
  const modules = generatedModuleList(parsed);
  return db.transaction().execute(async (trx) => {
    await assertResumeCreationAllowed(trx, userId);
    const user = await trx
      .selectFrom('client_user')
      .select(['NICKNAME', 'NAME'])
      .where('ID', '=', userId)
      .where('DELETE_FLAG', '=', 'NOT_DELETE')
      .executeTakeFirst();
    const now = new Date();
    const resumeId = randomUUID().replaceAll('-', '');
    await trx
      .insertInto('sc_resume')
      .values({
        id: resumeId,
        title: `${user?.NICKNAME ?? user?.NAME ?? '我的'}${titleSuffix}`,
        user_id: userId,
        is_published: 0,
        publish_date: null,
        preview_image: null,
        view_count: 0,
        usage_count: 0,
        collect_count: 0,
        create_time: now,
        update_time: now,
        delete_flag: 'NOT_DELETE',
        style_config: null,
        publish_id: null,
        template: 'template2',
      })
      .execute();
    await trx
      .insertInto('sc_resume_modules')
      .values(
        modules.map((module) => ({
          id: randomUUID().replaceAll('-', ''),
          resume_id: resumeId,
          module_type: module.module_type,
          display_order: module.display_order,
          module_content: module.module_content,
          create_time: now,
          update_time: now,
          delete_flag: 'NOT_DELETE',
          user_id: userId,
          has_enable: module.has_enable,
        })),
      )
      .execute();
    return resumeId;
  });
}

async function withFeatureQuota<T>(
  db: Kysely<Database>,
  userId: string,
  functionName: string,
  work: () => Promise<T>,
) {
  const charged = await reserveFeatureQuota(db, userId, functionName);
  try {
    return await work();
  } catch (error) {
    if (charged) await refundFeatureQuota(db, userId, functionName);
    throw error;
  }
}

async function readMultipartFile(request: FastifyRequest) {
  const part = await request.file();
  if (!part) throw new AppError(400, '请上传文件');
  const buffer = await part.toBuffer();
  if (buffer.byteLength > 10 * 1024 * 1024) throw new AppError(400, '文件不能超过 10MB');
  const filename = part.filename.toLowerCase();
  try {
    if (filename.endsWith('.docx') || part.mimetype.includes('wordprocessingml')) {
      return (await mammoth.extractRawText({ buffer })).value.trim();
    }
    if (filename.endsWith('.pdf') || part.mimetype === 'application/pdf') {
      const parser = new PDFParse({ data: buffer });
      try {
        return (await parser.getText()).text.trim();
      } finally {
        await parser.destroy();
      }
    }
    if (part.mimetype.startsWith('text/') || /\.(txt|md|json|html?)$/.test(filename))
      return buffer.toString('utf8').trim();
    throw new AppError(400, '仅支持 PDF、DOCX、TXT、MD、JSON 或 HTML 文件');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, '文件解析失败，请确认文件未损坏');
  }
}

const importModuleTypes = [
  '基本信息',
  '专业技能',
  '教育经历',
  '工作经历',
  '项目经历',
  '荣誉奖项',
  '研究经历',
  '作品集',
  '其他经历',
  '个人总结',
];

async function importModules(env: AppEnv, text: string) {
  if (!text) throw new AppError(400, '文件解析失败，找不到内容');
  const answer = await generateAiText(
    env,
    `请将以下简历文本整理成 JSON 数组。每项必须包含 moduleType 和 moduleContent，moduleType 只能使用：${importModuleTypes.join('、')}；moduleContent 输出对象。只输出 JSON。\n${text}`,
  );
  const parsed = parseJsonOrText(answer);
  if (!Array.isArray(parsed)) throw new AppError(502, 'AI 未返回有效的简历模块 JSON');
  return parsed
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      moduleType:
        typeof item.moduleType === 'string' && importModuleTypes.includes(item.moduleType)
          ? item.moduleType
          : '其他经历',
      moduleContent:
        typeof item.moduleContent === 'string'
          ? item.moduleContent
          : JSON.stringify(item.moduleContent ?? item),
    }));
}

export function registerAiRoutes(app: FastifyInstance, env: AppEnv, db: Kysely<Database>) {
  const authenticate = requireUser(env);

  app.post('/c/resume/aiTest', { preHandler: authenticate }, async () => {
    return ok(await generateAiText(env, '请只回答 hello'));
  });

  app.post('/c/resume/analyze', { preHandler: authenticate }, async (request) => {
    const body = objectBody(request.body);
    const userId = request.userId as string;
    return ok(
      await withFeatureQuota(db, userId, '简历分析', async () => {
        const resumeInfo = await resumeContext(
          db,
          userId,
          typeof body.resumeId === 'string' ? body.resumeId : undefined,
          stringValue(body, 'resumeInfo', false),
        );
        const jobInfo = stringValue(body, 'jobInfo', false);
        const prompt = `请分析以下简历与职位匹配度，输出 JSON，包含 score、strengths、risks、suggestions 四个字段。\n职位：${jobInfo}\n简历：${resumeInfo}`;
        const answer = await generateAiText(env, prompt);
        const id = randomUUID().replaceAll('-', '');
        const now = new Date();
        await db
          .insertInto('sc_resume_report')
          .values({
            id,
            create_time: now,
            update_time: now,
            user_id: userId,
            delete_flag: 'NOT_DELETE',
            resume_info: resumeInfo,
            job_info: jobInfo,
            prompt,
            report_info: answer,
          })
          .execute();
        return id;
      }),
    );
  });

  app.get<{ Params: { id: string } }>(
    '/c/resume/analyze/:id',
    { preHandler: authenticate },
    async (request) => {
      const report = await db
        .selectFrom('sc_resume_report')
        .select('report_info as reportInfo')
        .where('id', '=', request.params.id)
        .where('user_id', '=', request.userId as string)
        .where('delete_flag', '=', 'NOT_DELETE')
        .executeTakeFirst();
      if (!report) throw new AppError(400, '分析报告不存在');
      return ok(parseJsonOrText(report.reportInfo ?? ''));
    },
  );

  app.post('/c/resume/aiGenerate', { preHandler: authenticate }, async (request) => {
    const body = objectBody(request.body);
    const userId = request.userId as string;
    return ok(
      await withFeatureQuota(db, userId, '智能生成简历', async () => {
        const jobTitle = stringValue(body, 'jobTitle');
        const personalInfo = stringValue(body, 'personalInfo');
        const answer = await generateAiText(
          env,
          `请根据个人信息和目标职位生成结构化简历模块 JSON。只输出 JSON。目标职位：${jobTitle}\n个人信息：${personalInfo}`,
        );
        return createGeneratedResume(db, userId, parseJsonOrText(answer));
      }),
    );
  });

  app.post('/c/resume/optimize/suggestion', { preHandler: authenticate }, async (request) => {
    const body = objectBody(request.body);
    const userId = request.userId as string;
    return ok(
      await withFeatureQuota(db, userId, '简历优化建议', async () => {
        const resumeInfo = await resumeContext(
          db,
          userId,
          typeof body.resumeId === 'string' ? body.resumeId : undefined,
          stringValue(body, 'resumeInfo', false),
        );
        const answer = await generateAiText(
          env,
          `请给出简历优化建议，使用安全的 HTML 段落、标题和列表输出，不要输出 script 标签。简历：${resumeInfo}`,
        );
        return sanitizeAiHtml(answer);
      }),
    );
  });

  app.post('/c/resume/optimize', { preHandler: authenticate }, async (request) => {
    const body = objectBody(request.body);
    const userId = request.userId as string;
    return ok(
      await withFeatureQuota(db, userId, '一键优化简历', async () => {
        const resumeInfo = stringValue(body, 'resumeInfo');
        const optimizeSuggestion = stringValue(body, 'optimizeSuggestion');
        const answer = await generateAiText(
          env,
          `请按照优化建议修改简历，输出结构化 JSON。简历：${resumeInfo}\n优化建议：${optimizeSuggestion}`,
        );
        return createGeneratedResume(db, userId, parseJsonOrText(answer));
      }),
    );
  });

  app.post('/c/resume/ai/optimize', { preHandler: authenticate }, async (request) => {
    const body = objectBody(request.body);
    const userId = request.userId as string;
    return ok(
      await withFeatureQuota(db, userId, '一键优化简历', async () => {
        const sourceText = stringValue(body, 'sourceText');
        const scene = stringValue(body, 'scene');
        const userInstruction = stringValue(body, 'userInstruction', false);
        const answer = await generateAiText(
          env,
          `请优化以下${scene}文本，输出 JSON，包含 optimizedText 和 plainText。${userInstruction ? `补充要求：${userInstruction}` : ''}\n原文：${sourceText}`,
        );
        const parsed = parseJsonOrText(answer);
        return {
          recordId: randomUUID().replaceAll('-', ''),
          optimizedText:
            typeof parsed === 'object' && parsed && 'optimizedText' in parsed
              ? parsed.optimizedText
              : answer,
          plainText:
            typeof parsed === 'object' && parsed && 'plainText' in parsed
              ? parsed.plainText
              : answer,
        };
      }),
    );
  });

  app.post('/c/resume/translate', { preHandler: authenticate }, async (request) => {
    const body = objectBody(request.body);
    const text = stringValue(body, 'text');
    const targetLanguage = stringValue(body, 'targetLanguage');
    return ok(
      await generateAiText(env, `请将以下内容翻译为${targetLanguage}，保持 JSON 结构不变：${text}`),
    );
  });

  app.post('/c/resume/aiInterview', { preHandler: authenticate }, async (request) => {
    const body = objectBody(request.body);
    const userId = request.userId as string;
    return ok(
      await withFeatureQuota(db, userId, 'AI面试题', async () => {
        const resumeInfo = await resumeContext(
          db,
          userId,
          typeof body.resumeId === 'string' ? body.resumeId : undefined,
          stringValue(body, 'resumeInfo', false),
        );
        const jobInfo = stringValue(body, 'jobInfo', false);
        const interviewType = stringValue(body, 'interviewType', false);
        const jobLevel = stringValue(body, 'jobLevel', false);
        const prompt = `请生成面试题 JSON 数组，每项包含 difficulty、question、type。岗位：${jobInfo}\n级别：${jobLevel}\n面试类型：${interviewType}\n简历：${resumeInfo}`;
        const answer = await generateAiText(env, prompt);
        const id = randomUUID().replaceAll('-', '');
        const now = new Date();
        await db
          .insertInto('sc_interview_questions')
          .values({
            id,
            user_id: userId,
            create_time: now,
            update_time: now,
            delete_flag: 'NOT_DELETE',
            question: answer,
            job_info: jobInfo,
            resume_info: resumeInfo,
          })
          .execute();
        return id;
      }),
    );
  });

  app.get<{ Params: { id: string } }>(
    '/c/resume/aiInterview/:id',
    { preHandler: authenticate },
    async (request) => {
      const row = await db
        .selectFrom('sc_interview_questions')
        .select('question')
        .where('id', '=', request.params.id)
        .where('user_id', '=', request.userId as string)
        .where('delete_flag', '=', 'NOT_DELETE')
        .executeTakeFirst();
      if (!row) throw new AppError(400, '面试题不存在');
      return ok(parseJsonOrText(row.question ?? ''));
    },
  );

  app.post('/c/resume/analysisText', { preHandler: authenticate }, async (request) => {
    return ok(await readMultipartFile(request));
  });

  app.post('/c/resume/import', { preHandler: authenticate }, async (request) => {
    const text = await readMultipartFile(request);
    return ok(await importModules(env, text));
  });

  app.post('/c/resume/import/create', { preHandler: authenticate }, async (request) => {
    const userId = request.userId as string;
    await assertResumeCreationAllowed(db, userId);
    const text = await readMultipartFile(request);
    const imported = await importModules(env, text);
    const now = new Date();
    const resumeId = randomUUID().replaceAll('-', '');
    const modules = importModuleTypes.map((moduleType, index) => {
      const found = imported.find((item) => item.moduleType === moduleType);
      return {
        id: randomUUID().replaceAll('-', ''),
        resume_id: resumeId,
        module_type: moduleType,
        display_order: index + 1,
        module_content: found?.moduleContent ?? '{}',
        create_time: now,
        update_time: now,
        delete_flag: 'NOT_DELETE',
        user_id: userId,
        has_enable: found ? 1 : 0,
      };
    });
    await db.transaction().execute(async (trx) => {
      await assertResumeCreationAllowed(trx, userId);
      await trx
        .insertInto('sc_resume')
        .values({
          id: resumeId,
          title: '导入的简历',
          user_id: userId,
          is_published: 0,
          publish_date: null,
          preview_image: null,
          view_count: 0,
          usage_count: 0,
          collect_count: 0,
          create_time: now,
          update_time: now,
          delete_flag: 'NOT_DELETE',
          style_config: null,
          publish_id: null,
          template: 'template2',
        })
        .execute();
      await trx.insertInto('sc_resume_modules').values(modules).execute();
    });
    return ok(resumeId);
  });
}
