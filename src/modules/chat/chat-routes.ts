/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { requireUser } from '@/auth/request-user.js';
import { AppError } from '@/common/errors.js';
import { ok } from '@/common/http-response.js';
import type { AppEnv } from '@/config/env.js';
import type { Database } from '@/infrastructure/database.js';
import { generateAiText, streamAiText } from '@/modules/ai/ai-service.js';

type ChatBody = {
  prompt?: string;
  chatDialogueId?: string;
  dialogueModel?: boolean;
  chatModel?: string;
  imageList?: string[];
};

type DialogueBody = {
  id?: string;
  dialogueName?: string;
  targetId?: string;
  hasChatGroup?: boolean;
};

function chatId() {
  // Keep IDs below signed BIGINT range because t_chat_message.relevance_id
  // stores the related message ID as BIGINT(20).
  const suffix = randomUUID().replace(/\D/g, '').slice(0, 5).padEnd(5, '0');
  return `${Date.now()}${suffix}`;
}

function pageValue(value: unknown, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function pageResponse<T>(records: T[], total: number, current: number, size: number) {
  return { records, total, current, size, pages: Math.ceil(total / size) };
}

const guideCache = new Map<string, { guide: { guideList: string[] }; expiresAt: number }>();

async function ownedDialogue(db: Kysely<Database>, id: string, userId: string) {
  const row = await db
    .selectFrom('t_chat_dialogue')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .where('DELETE_FLAG', '=', 'NOT_DELETE')
    .executeTakeFirst();
  if (!row) throw new AppError(400, '会话不存在或无权使用');
  return row;
}

async function createDialogue(
  db: Kysely<Database>,
  userId: string,
  body: DialogueBody,
  prompt?: string,
) {
  const now = new Date();
  const id = chatId();
  const dialogueName = (body.dialogueName ?? prompt?.trim().slice(0, 15) ?? '新的聊天').slice(
    0,
    15,
  );
  await db
    .insertInto('t_chat_dialogue')
    .values({
      id,
      user_id: userId,
      dialogue_name: dialogueName,
      robot_model_id: body.hasChatGroup ? null : (body.targetId ?? '1'),
      remark: null,
      DELETE_FLAG: 'NOT_DELETE',
      CREATE_TIME: now,
      CREATE_USER: userId,
      UPDATE_TIME: now,
      UPDATE_USER: userId,
      ip: null,
      request_uuid: null,
      login_status: 1,
      visibility_type: 0,
      chat_group_id: body.hasChatGroup ? (body.targetId ?? null) : null,
      END_TIME: null,
    })
    .execute();
  return ownedDialogue(db, id, userId);
}

async function ensureDialogue(db: Kysely<Database>, userId: string, body: ChatBody) {
  if (body.chatDialogueId) return ownedDialogue(db, body.chatDialogueId, userId);
  return createDialogue(db, userId, {}, body.prompt);
}

async function saveMessage(
  db: Kysely<Database>,
  userId: string,
  dialogueId: string,
  content: string,
  hasAi: boolean,
  body: ChatBody,
  relevanceId: string | null = null,
) {
  const id = chatId();
  await db
    .insertInto('t_chat_message')
    .values({
      chat_message_id: id,
      content,
      user_id: userId,
      remark: null,
      DELETE_FLAG: 'NOT_DELETE',
      CREATE_TIME: new Date(),
      chat_dialogue_id: dialogueId,
      send_time: new Date(),
      robot_model_id: null,
      include_sensitive_word: null,
      ip: null,
      has_ai: hasAi ? 1 : 0,
      relevance_id: relevanceId,
      has_ignore_context: 0,
      chat_model: body.chatModel ?? 'deepseek-v4-flash',
      image_list: body.imageList?.length ? JSON.stringify(body.imageList) : null,
      chat_group_id: null,
      has_read: 1,
      tokens: content.length,
      consume_magic: null,
      context_tokens: null,
    })
    .execute();
  return id;
}

async function prepareChat(env: AppEnv, db: Kysely<Database>, userId: string, body: ChatBody) {
  const prompt = body.prompt?.trim();
  if (!prompt) throw new AppError(400, '提示词不得为空');
  const dialogue = await ensureDialogue(db, userId, body);
  // Snowy sends the recent dialogue as context to the model. Keep the same
  // behavior while bounding the prompt so a long conversation cannot exceed
  // the configured AI input limit.
  const history = await db
    .selectFrom('t_chat_message')
    .select(['content', 'has_ai'])
    .where('chat_dialogue_id', '=', dialogue.id)
    .where('user_id', '=', userId)
    .where('DELETE_FLAG', '=', 'NOT_DELETE')
    .orderBy('send_time', 'desc')
    .limit(8)
    .execute();
  const historyText = history
    .reverse()
    .map((item) => `${item.has_ai ? 'AI' : '用户'}: ${item.content ?? ''}`)
    .join('\n');
  const userMessageId = await saveMessage(db, userId, dialogue.id, prompt, false, body);
  const historyBudget = Math.max(0, env.AI_MAX_INPUT_LENGTH - prompt.length - 32);
  const boundedHistory = historyText.slice(-historyBudget);
  const modelPrompt = boundedHistory
    ? `请结合以下历史对话回答用户最新问题。\n${boundedHistory}\n用户最新问题：${prompt}`
    : prompt;
  return { dialogue, body, modelPrompt, userMessageId, prompt };
}

async function persistChatAnswer(
  db: Kysely<Database>,
  userId: string,
  prepared: Awaited<ReturnType<typeof prepareChat>>,
  answer: string,
) {
  await saveMessage(
    db,
    userId,
    prepared.dialogue.id,
    answer,
    true,
    prepared.body,
    prepared.userMessageId,
  );
  await db
    .updateTable('t_chat_dialogue')
    .set({
      dialogue_name: prepared.dialogue.dialogue_name || prepared.prompt.slice(0, 15),
      UPDATE_TIME: new Date(),
    })
    .where('id', '=', prepared.dialogue.id)
    .where('user_id', '=', userId)
    .execute();
}

async function generateAndPersist(
  env: AppEnv,
  db: Kysely<Database>,
  userId: string,
  body: ChatBody,
) {
  const prepared = await prepareChat(env, db, userId, body);
  const answer = await generateAiText(env, prepared.modelPrompt);
  await persistChatAnswer(db, userId, prepared, answer);
  return { answer, content: answer, chatDialogueId: prepared.dialogue.id };
}

function parseGuide(value: string) {
  try {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value;
    const parsed = JSON.parse(fenced.trim()) as { guideList?: unknown };
    if (Array.isArray(parsed.guideList)) {
      return {
        guideList: parsed.guideList
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 3),
      };
    }
  } catch {
    // Keep a stable response shape if the model does not return JSON.
  }
  return {
    guideList: value
      .split(/[\n。！？]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3),
  };
}

export function registerChatRoutes(app: FastifyInstance, env: AppEnv, db: Kysely<Database>) {
  const authenticate = requireUser(env);

  app.post('/aiChat/c/gpt/chatSseContext', { preHandler: authenticate }, async (request) => {
    const result = await generateAndPersist(
      env,
      db,
      request.userId!,
      (request.body ?? {}) as ChatBody,
    );
    return ok(result);
  });

  app.post(
    '/aiChat/c/gpt/chatStreamContext',
    { preHandler: authenticate },
    async (request, reply) => {
      const prepared = await prepareChat(
        env,
        db,
        request.userId!,
        (request.body ?? {}) as ChatBody,
      );
      const format = String((request.query as { format?: string } | undefined)?.format ?? 'raw');
      reply.header('x-chat-dialogue-id', prepared.dialogue.id);
      const chunks = (async function* () {
        let answer = '';
        for await (const chunk of streamAiText(env, prepared.modelPrompt)) {
          answer += chunk;
          if (format === 'sse') {
            yield `data: ${JSON.stringify({ text: chunk })}\n\n`;
          } else {
            yield chunk;
          }
        }
        if (answer) await persistChatAnswer(db, request.userId!, prepared, answer);
      })();
      return reply
        .type(format === 'sse' ? 'text/event-stream' : 'application/octet-stream')
        .header('cache-control', 'no-cache')
        .send(Readable.from(chunks));
    },
  );

  app.get('/aiChat/c/gpt/checkIsIng', { preHandler: authenticate }, async () => ok(false));

  async function generateGuide(request: any) {
    const dialogue = await ownedDialogue(db, String(request.params.dialogueId), request.userId!);
    const messages = await db
      .selectFrom('t_chat_message')
      .select(['content', 'has_ai'])
      .where('chat_dialogue_id', '=', dialogue.id)
      .where('user_id', '=', request.userId!)
      .where('DELETE_FLAG', '=', 'NOT_DELETE')
      .orderBy('send_time', 'desc')
      .limit(6)
      .execute();
    if (!messages.length) return ok({ guideList: [] });
    const context = messages
      .reverse()
      .map((item) => `${item.has_ai ? 'AI' : '用户'}: ${item.content ?? ''}`)
      .join('\n');
    const answer = await generateAiText(
      env,
      `根据下面的聊天记录生成 3 个下一步可能提问的问题，只返回 JSON：{"guideList":["问题1","问题2","问题3"]}\n${context}`,
    );
    const guide = parseGuide(answer);
    guideCache.set(`${request.userId}:${dialogue.id}`, {
      guide,
      expiresAt: Date.now() + 10 * 24 * 60 * 60 * 1000,
    });
    return ok(guide);
  }

  app.post('/aiChat/c/gpt/chatGuide/:dialogueId', { preHandler: authenticate }, generateGuide);
  // The Java service exposes a second provider-specific guide path. Keep it
  // as an alias so older clients can migrate without changing their route.
  app.post('/aiChat/c/gpt/chatGuide/xfxh/:dialogueId', { preHandler: authenticate }, generateGuide);
  app.get('/aiChat/c/gpt/chatGuide/:dialogueId', { preHandler: authenticate }, async (request) => {
    const dialogue = await ownedDialogue(
      db,
      String((request.params as any).dialogueId),
      request.userId!,
    );
    const cached = guideCache.get(`${request.userId}:${dialogue.id}`);
    if (!cached || cached.expiresAt <= Date.now()) {
      guideCache.delete(`${request.userId}:${dialogue.id}`);
      return ok({ guideList: [] });
    }
    return ok(cached.guide);
  });

  app.post('/aiChat/c/gpt/chatAnewAnswer', { preHandler: authenticate }, async (request) => {
    const body = (request.body ?? {}) as ChatBody;
    if (!body.chatDialogueId) throw new AppError(400, '会话ID不得为空');
    await ownedDialogue(db, body.chatDialogueId, request.userId!);
    const latest = body.prompt
      ? body.prompt
      : (
          await db
            .selectFrom('t_chat_message')
            .select('content')
            .where('chat_dialogue_id', '=', body.chatDialogueId)
            .where('user_id', '=', request.userId!)
            .where('has_ai', '=', 0)
            .where('DELETE_FLAG', '=', 'NOT_DELETE')
            .orderBy('send_time', 'desc')
            .executeTakeFirst()
        )?.content;
    if (!latest) throw new AppError(400, '没有可重新生成的提问');
    return ok(await generateAndPersist(env, db, request.userId!, { ...body, prompt: latest }));
  });

  app.get('/aiChat/c/dialogue/page', { preHandler: authenticate }, async (request) => {
    const query = (request.query ?? {}) as any;
    const current = pageValue(query.page, 1, 10_000);
    const size = pageValue(query.limit, 10, 100);
    let builder = db
      .selectFrom('t_chat_dialogue')
      .select([
        'id',
        'user_id as userId',
        'dialogue_name as dialogueName',
        'robot_model_id as robotModelId',
        'CREATE_TIME as createTime',
        'ip',
        'visibility_type as visibilityType',
        'chat_group_id as chatGroupId',
      ])
      .where('user_id', '=', request.userId!)
      .where('DELETE_FLAG', '=', 'NOT_DELETE')
      .orderBy('CREATE_TIME', 'desc')
      .limit(size)
      .offset((current - 1) * size);
    if (query.chatGroupId)
      builder = builder.where('chat_group_id', '=', String(query.chatGroupId)) as typeof builder;
    if (query.chatRoleId)
      builder = builder.where('robot_model_id', '=', String(query.chatRoleId)) as typeof builder;
    const records = await builder.execute();
    let countQuery = db
      .selectFrom('t_chat_dialogue')
      .select(sql<number>`count(*)`.as('count'))
      .where('user_id', '=', request.userId!)
      .where('DELETE_FLAG', '=', 'NOT_DELETE');
    if (query.chatGroupId)
      countQuery = countQuery.where('chat_group_id', '=', String(query.chatGroupId));
    if (query.chatRoleId)
      countQuery = countQuery.where('robot_model_id', '=', String(query.chatRoleId));
    const count = await countQuery.executeTakeFirst();
    return ok(pageResponse(records, Number(count?.count ?? 0), current, size));
  });

  app.post('/aiChat/c/dialogue', { preHandler: authenticate }, async (request) => {
    const body = (request.body ?? {}) as DialogueBody;
    return ok(await createDialogue(db, request.userId!, body));
  });

  app.put('/aiChat/c/dialogue', { preHandler: authenticate }, async (request) => {
    const body = (request.body ?? {}) as DialogueBody;
    if (!body.id) throw new AppError(400, '会话ID不得为空');
    await ownedDialogue(db, body.id, request.userId!);
    await db
      .updateTable('t_chat_dialogue')
      .set({ dialogue_name: (body.dialogueName ?? '').slice(0, 15), UPDATE_TIME: new Date() })
      .where('id', '=', body.id)
      .where('user_id', '=', request.userId!)
      .execute();
    return ok(null);
  });

  app.delete('/aiChat/c/dialogue/:id', { preHandler: authenticate }, async (request) => {
    const id = String((request.params as any).id);
    await ownedDialogue(db, id, request.userId!);
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('t_chat_message')
        .set({ DELETE_FLAG: 'DELETED' })
        .where('chat_dialogue_id', '=', id)
        .where('user_id', '=', request.userId!)
        .execute();
      await trx
        .updateTable('t_chat_dialogue')
        .set({ DELETE_FLAG: 'DELETED', UPDATE_TIME: new Date() })
        .where('id', '=', id)
        .where('user_id', '=', request.userId!)
        .execute();
    });
    return ok(null, '删除会话成功');
  });

  app.get('/aiChat/c/dialogue/:id', { preHandler: authenticate }, async (request) => {
    const row = await ownedDialogue(db, String((request.params as any).id), request.userId!);
    return ok(row);
  });

  app.get('/aiChat/c/message/page', { preHandler: authenticate }, async (request) => {
    const query = (request.query ?? {}) as any;
    const current = pageValue(query.page, 1, 10_000);
    const size = pageValue(query.limit, 20, 200);
    let builder = db
      .selectFrom('t_chat_message as m')
      .innerJoin('t_chat_dialogue as d', 'd.id', 'm.chat_dialogue_id')
      .select([
        'm.user_id as userId',
        'm.chat_message_id as chatMessageId',
        'm.chat_dialogue_id as chatDialogueId',
        'm.content',
        'd.dialogue_name as dialogueName',
        'm.robot_model_id as robotModelId',
        'm.send_time as sendTime',
        'm.has_ai as hasAi',
        'm.relevance_id as relevanceId',
        'm.has_ignore_context as hasIgnoreContext',
        'm.image_list as imageList',
        'm.tokens',
        'm.consume_magic as consumeMagic',
        'm.chat_model as chatModel',
      ])
      .where('m.user_id', '=', request.userId!)
      .where('d.user_id', '=', request.userId!)
      .where('m.DELETE_FLAG', '=', 'NOT_DELETE')
      .where('d.DELETE_FLAG', '=', 'NOT_DELETE')
      .orderBy('m.send_time', 'asc')
      .limit(size)
      .offset((current - 1) * size);
    if (query.chatDialogueId)
      builder = builder.where(
        'm.chat_dialogue_id',
        '=',
        String(query.chatDialogueId),
      ) as typeof builder;
    if (query.content)
      builder = builder.where('m.content', 'like', `%${String(query.content)}%`) as typeof builder;
    const records = await builder.execute();
    let countQuery = db
      .selectFrom('t_chat_message as m')
      .innerJoin('t_chat_dialogue as d', 'd.id', 'm.chat_dialogue_id')
      .select(sql<number>`count(*)`.as('count'))
      .where('m.user_id', '=', request.userId!)
      .where('d.user_id', '=', request.userId!)
      .where('m.DELETE_FLAG', '=', 'NOT_DELETE')
      .where('d.DELETE_FLAG', '=', 'NOT_DELETE');
    if (query.chatDialogueId)
      countQuery = countQuery.where('m.chat_dialogue_id', '=', String(query.chatDialogueId));
    if (query.content)
      countQuery = countQuery.where('m.content', 'like', `%${String(query.content)}%`);
    const count = await countQuery.executeTakeFirst();
    return ok(pageResponse(records, Number(count?.count ?? 0), current, size));
  });
}
