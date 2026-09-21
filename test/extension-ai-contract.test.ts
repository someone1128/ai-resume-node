import { describe, expect, it } from 'vitest';
import {
  EXTENSION_AI_DEFAULT_MODEL,
  parseExtensionAiResponse,
  resolveExtensionAiModel,
} from '@/modules/extension/extension-ai-routes.js';

describe('浏览器扩展 AI 模型配置', () => {
  it('默认使用 DeepSeek Flash', () => {
    expect(EXTENSION_AI_DEFAULT_MODEL).toBe('deepseek-flash');
    expect(resolveExtensionAiModel({ DEEPSEEK_MODEL: undefined })).toBe('deepseek-flash');
  });

  it('允许部署环境显式覆盖扩展模型', () => {
    expect(resolveExtensionAiModel({ DEEPSEEK_MODEL: 'deepseek-custom' })).toBe('deepseek-custom');
  });

  it('通过结构化校验后保留字段映射和用户审核草稿', () => {
    expect(
      parseExtensionAiResponse(
        JSON.stringify({
          mappings: [
            { fieldId: 'motivation', key: 'description', confidence: 0.91, reason: '职位描述字段' },
          ],
          drafts: [
            { fieldKey: 'description', content: '建议候选文案', reason: '用户确认后才填写' },
          ],
        }),
      ),
    ).toEqual({
      mappings: [
        { fieldId: 'motivation', key: 'description', confidence: 0.91, reason: '职位描述字段' },
      ],
      drafts: [{ fieldKey: 'description', content: '建议候选文案', reason: '用户确认后才填写' }],
    });
  });

  it('支持模型常见的 fenced JSON 输出', () => {
    expect(parseExtensionAiResponse('```json\n{"mappings":[],"drafts":[]}\n```')).toEqual({
      mappings: [],
      drafts: [],
    });
  });

  it('拒绝不在字段契约中的模型结果', () => {
    expect(() =>
      parseExtensionAiResponse(
        JSON.stringify({
          mappings: [{ fieldId: 'x', key: 'unknown', confidence: 1, reason: '错误' }],
          drafts: [],
        }),
      ),
    ).toThrow('AI 返回结构不合法');
  });
});
