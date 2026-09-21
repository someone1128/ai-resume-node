import { describe, expect, it } from 'vitest';
import { parseJsonOrText, sanitizeAiHtml } from '@/modules/ai/ai-service.js';

describe('ai service safety helpers', () => {
  it('parses fenced JSON returned by a model', () => {
    expect(parseJsonOrText('```json\n[{"moduleType":"基本信息"}]\n```')).toEqual([
      { moduleType: '基本信息' },
    ]);
  });

  it('removes executable HTML from optimization output while retaining safe markup', () => {
    expect(
      sanitizeAiHtml('<h3>建议</h3><p onclick="alert(1)">内容</p><script>alert(2)</script>'),
    ).toBe('<h3>建议</h3><p>内容</p>');
  });
});
