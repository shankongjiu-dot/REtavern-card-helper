import { describe, it, expect } from 'vitest';
import { parseOptimizeResult, computeFieldDiffs, buildApplyPatch, ALL_OPTIMIZE_FIELDS } from './card-optimizer';
import { createEmptyDraft, createEmptyLorebookEntry } from '../constants/defaults';
import type { WizardDraft } from '../constants/defaults';

function makeDraft(overrides: Partial<WizardDraft> = {}): WizardDraft {
  return { ...createEmptyDraft(), ...overrides };
}

describe('parseOptimizeResult', () => {
  it('解析有效 JSON 对象', () => {
    const text = JSON.stringify({ cardName: '新名称', tags: ['标签'] });
    const result = parseOptimizeResult(text);
    expect(result).not.toBeNull();
    expect(result?.cardName).toBe('新名称');
    expect(result?.tags).toEqual(['标签']);
  });

  it('解析带 markdown 代码块的 JSON', () => {
    const text = '```json\n{"cardName": "新名称"}\n```';
    const result = parseOptimizeResult(text);
    expect(result?.cardName).toBe('新名称');
  });

  it('解析 lorebookEntries 数组', () => {
    const text = JSON.stringify({
      lorebookEntries: [{ comment: '条目1', content: '新内容', keys: ['新词'] }],
    });
    const result = parseOptimizeResult(text);
    expect(result?.lorebookEntries).toHaveLength(1);
    expect(result?.lorebookEntries?.[0].comment).toBe('条目1');
  });

  it('过滤掉无 comment 的条目', () => {
    const text = JSON.stringify({
      lorebookEntries: [{ comment: '', content: '内容' }, { comment: '有效', content: '内容' }],
    });
    const result = parseOptimizeResult(text);
    expect(result?.lorebookEntries).toHaveLength(1);
  });

  it('解析 mvuStatusBarHtml', () => {
    const text = JSON.stringify({ mvuStatusBarHtml: '<div>状态栏</div>' });
    const result = parseOptimizeResult(text);
    expect(result?.mvuStatusBarHtml).toBe('<div>状态栏</div>');
  });

  it('解析 mvuSchemaSections', () => {
    const text = JSON.stringify({
      mvuSchemaSections: [{ sectionName: '基础', variables: [{ path: 'level', description: '等级' }] }],
    });
    const result = parseOptimizeResult(text);
    expect(result?.mvuSchemaSections).toHaveLength(1);
    expect(result?.mvuSchemaSections?.[0].variables?.[0]?.path).toBe('level');
  });

  it('无效 JSON 返回 null', () => {
    expect(parseOptimizeResult('not json')).toBeNull();
  });

  it('空对象返回 null', () => {
    expect(parseOptimizeResult('{}')).toBeNull();
  });

  it('过滤非字符串类型的 tags', () => {
    const text = JSON.stringify({ tags: ['有效', 123, null, '有效2'] });
    const result = parseOptimizeResult(text);
    expect(result?.tags).toEqual(['有效', '有效2']);
  });
});

describe('computeFieldDiffs', () => {
  it('cardName 变化检测', () => {
    const draft = makeDraft({ cardName: '旧名' });
    const result = { cardName: '新名' };
    const diffs = computeFieldDiffs(draft, result, ['cardName']);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].hasChange).toBe(true);
    expect(diffs[0].before).toBe('旧名');
    expect(diffs[0].after).toBe('新名');
  });

  it('cardName 未变化时不产生 diff', () => {
    const draft = makeDraft({ cardName: '同名' });
    const result = { cardName: '同名' };
    const diffs = computeFieldDiffs(draft, result, ['cardName']);
    expect(diffs).toHaveLength(0);
  });

  it('firstMessage 变化检测', () => {
    const draft = makeDraft({ firstMessage: '旧开场白' });
    const result = { firstMessage: '新开场白' };
    const diffs = computeFieldDiffs(draft, result, ['firstMessage']);
    expect(diffs[0].hasChange).toBe(true);
  });

  it('tags 变化检测（顺序无关）', () => {
    const draft = makeDraft({ tags: ['a', 'b'] });
    const result = { tags: ['b', 'a'] };
    const diffs = computeFieldDiffs(draft, result, ['tags']);
    expect(diffs).toHaveLength(0); // 顺序无关，无变化
  });

  it('lorebookEntries 内容变化检测', () => {
    const entry = { ...createEmptyLorebookEntry(), comment: '条目1', content: '旧内容' };
    const draft = makeDraft({ lorebookEntries: [entry] });
    const result = { lorebookEntries: [{ comment: '条目1', content: '新内容' }] };
    const diffs = computeFieldDiffs(draft, result, ['lorebookEntries']);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].entryDiffs).toHaveLength(1);
    expect(diffs[0].entryDiffs?.[0]?.after?.content).toBe('新内容');
  });

  it('未匹配 comment 的条目不产生 diff', () => {
    const entry = { ...createEmptyLorebookEntry(), comment: '条目1', content: '内容' };
    const draft = makeDraft({ lorebookEntries: [entry] });
    const result = { lorebookEntries: [{ comment: '不存在', content: '新内容' }] };
    const diffs = computeFieldDiffs(draft, result, ['lorebookEntries']);
    expect(diffs).toHaveLength(0);
  });
});

describe('buildApplyPatch', () => {
  it('cardName patch', () => {
    const draft = makeDraft({ cardName: '旧名' });
    const result = { cardName: '新名' };
    const patch = buildApplyPatch(draft, 'cardName', result);
    expect(patch.cardName).toBe('新名');
  });

  it('tags patch', () => {
    const draft = makeDraft({ tags: ['旧'] });
    const result = { tags: ['新'] };
    const patch = buildApplyPatch(draft, 'tags', result);
    expect(patch.tags).toEqual(['新']);
  });

  it('firstMessage patch', () => {
    const draft = makeDraft({ firstMessage: '旧' });
    const result = { firstMessage: '新' };
    const patch = buildApplyPatch(draft, 'firstMessage', result);
    expect(patch.firstMessage).toBe('新');
  });

  it('lorebookEntries patch 只修改匹配的条目', () => {
    const e1 = { ...createEmptyLorebookEntry(), comment: '条目1', content: '旧内容1' };
    const e2 = { ...createEmptyLorebookEntry(), comment: '条目2', content: '旧内容2' };
    const draft = makeDraft({ lorebookEntries: [e1, e2] });
    const result = { lorebookEntries: [{ comment: '条目1', content: '新内容1' }] };
    const patch = buildApplyPatch(draft, 'lorebookEntries', result);
    const entries = patch.lorebookEntries!;
    expect(entries).toHaveLength(2);
    expect(entries[0].content).toBe('新内容1');
    expect(entries[1].content).toBe('旧内容2');
  });

  it('未知字段返回空 patch', () => {
    const draft = makeDraft();
    const patch = buildApplyPatch(draft, 'cardName', {});
    expect(Object.keys(patch)).toHaveLength(0);
  });
});

describe('ALL_OPTIMIZE_FIELDS', () => {
  it('包含所有 6 个字段', () => {
    expect(ALL_OPTIMIZE_FIELDS).toHaveLength(6);
    expect(ALL_OPTIMIZE_FIELDS).toContain('cardName');
    expect(ALL_OPTIMIZE_FIELDS).toContain('tags');
    expect(ALL_OPTIMIZE_FIELDS).toContain('firstMessage');
    expect(ALL_OPTIMIZE_FIELDS).toContain('lorebookEntries');
    expect(ALL_OPTIMIZE_FIELDS).toContain('mvu.statusBarHtml');
    expect(ALL_OPTIMIZE_FIELDS).toContain('mvu.schemaSections');
  });
});
