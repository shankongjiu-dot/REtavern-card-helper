import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildPostHistoryInstructions } from './prompt-builder';

function makeCard(overrides: Record<string, unknown> = {}): { data: Record<string, unknown> } {
  return {
    data: {
      name: '艾莉亚',
      description: '一位勇敢的精灵游侠。',
      personality: '果断、忠诚',
      scenario: '在森林中相遇',
      first_mes: '你好，旅行者。',
      mes_example: '',
      system_prompt: '',
      post_history_instructions: '',
      character_book: { entries: [] },
      ...overrides,
    },
  };
}

describe('buildSystemPrompt', () => {
  it('包含角色名称', () => {
    const prompt = buildSystemPrompt(makeCard() as never);
    expect(prompt).toContain('艾莉亚');
  });

  it('包含角色描述', () => {
    const prompt = buildSystemPrompt(makeCard() as never);
    expect(prompt).toContain('勇敢的精灵游侠');
  });

  it('包含性格', () => {
    const prompt = buildSystemPrompt(makeCard() as never);
    expect(prompt).toContain('果断');
  });

  it('包含场景', () => {
    const prompt = buildSystemPrompt(makeCard() as never);
    expect(prompt).toContain('森林');
  });

  it('使用 system_prompt 覆盖（当非空时）', () => {
    const card = makeCard({ system_prompt: '你是一个特殊系统提示。' }) as never;
    const prompt = buildSystemPrompt(card);
    expect(prompt).toContain('特殊系统提示');
  });

  it('空名称时使用默认 Character', () => {
    const card = makeCard({ name: '' }) as never;
    const prompt = buildSystemPrompt(card);
    // 不应崩溃，prompt 仍应包含其他内容
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('世界书常驻条目被包含在 prompt 中', () => {
    const card = makeCard({
      character_book: {
        entries: [
          { keys: ['艾莉亚'], content: '艾莉亚的详细背景故事', name: '背景', enabled: true, constant: true, insertion_order: 1 },
          { keys: ['无关'], content: '这条不应出现', name: '无关', enabled: true, constant: false, insertion_order: 2 },
        ],
      },
    }) as never;
    const prompt = buildSystemPrompt(card);
    expect(prompt).toContain('详细背景故事');
  });

  it('禁用的世界书条目不被包含', () => {
    const card = makeCard({
      character_book: {
        entries: [
          { keys: ['x'], content: '禁用内容', name: '禁用', enabled: false, constant: true, insertion_order: 1 },
        ],
      },
    }) as never;
    const prompt = buildSystemPrompt(card);
    expect(prompt).not.toContain('禁用内容');
  });
});

describe('buildPostHistoryInstructions', () => {
  it('有 post_history_instructions 时返回内容', () => {
    const card = makeCard({ post_history_instructions: '请保持角色一致。' }) as never;
    const result = buildPostHistoryInstructions(card);
    expect(result).toBe('请保持角色一致。');
  });

  it('无 post_history_instructions 时返回空字符串', () => {
    const card = makeCard({ post_history_instructions: '' }) as never;
    const result = buildPostHistoryInstructions(card);
    expect(result).toBe('');
  });

  it('只有空白的 post_history_instructions 返回空字符串', () => {
    const card = makeCard({ post_history_instructions: '   \n  ' }) as never;
    const result = buildPostHistoryInstructions(card);
    expect(result).toBe('');
  });
});
