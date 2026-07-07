import { describe, it, expect } from 'vitest';
import { autoFixEntries } from './card-fixers';
import { createEmptyLorebookEntry } from '../constants/defaults';
import type { LorebookEntry } from '../constants/defaults';

function makeEntry(overrides: Partial<LorebookEntry> = {}): LorebookEntry {
  return {
    ...createEmptyLorebookEntry(),
    keys: ['关键词'],
    content: '这是一段测试内容。',
    name: '测试条目',
    comment: '测试条目',
    enabled: true,
    constant: false,
    selective: false,
    insertion_order: 1,
    priority: 0,
    ...overrides,
  };
}

describe('autoFixEntries', () => {
  it('对无问题的条目不做修改', () => {
    const entries = [makeEntry()];
    const result = autoFixEntries(entries);
    expect(result.fixes).toHaveLength(0);
    expect(result.entries).toHaveLength(1);
  });

  it('禁用空内容条目', () => {
    const entries = [makeEntry({ content: '' })];
    const result = autoFixEntries(entries);
    expect(result.entries[0].enabled).toBe(false);
    expect(result.fixes.some((f) => f.includes('禁用'))).toBe(true);
  });

  it('为无触发词的非蓝灯条目添加 name 作为 key', () => {
    const entries = [makeEntry({ keys: [], name: '角色设定', comment: '角色设定' })];
    const result = autoFixEntries(entries);
    expect(result.entries[0].keys).toContain('角色设定');
    expect(result.fixes.some((f) => f.includes('触发关键词'))).toBe(true);
  });

  it('蓝灯条目的 selective 被移除', () => {
    const entries = [makeEntry({ constant: true, selective: true, secondary_keys: [] })];
    const result = autoFixEntries(entries);
    expect(result.entries[0].selective).toBe(false);
    expect(result.fixes.some((f) => f.includes('selective'))).toBe(true);
  });

  it('有有效触发词的 selective 条目移除 selective', () => {
    const entries = [makeEntry({ selective: true, secondary_keys: [], keys: ['好的关键词'], constant: false })];
    const result = autoFixEntries(entries);
    expect(result.entries[0].selective).toBe(false);
  });

  it('无有效触发词且 selective 的条目被禁用', () => {
    const entries = [makeEntry({ selective: true, secondary_keys: [], keys: ['a'], constant: false, name: '测试' })];
    const result = autoFixEntries(entries);
    expect(result.entries[0].enabled).toBe(false);
  });

  it('拆分超长内容条目（>2500 字符）', () => {
    const longContent = '段落内容。'.repeat(600); // ~3000 chars
    const entries = [makeEntry({ content: longContent, name: '长条目', comment: '长条目' })];
    const result = autoFixEntries(entries);
    expect(result.entries.length).toBeGreaterThan(1);
    expect(result.fixes.some((f) => f.includes('拆分'))).toBe(true);
  });

  it('拆分后子条目继承父条目的 keys', () => {
    const longContent = '段落一内容。\n\n段落二内容。\n\n段落三内容。'.repeat(400);
    const entries = [makeEntry({ content: longContent, keys: ['触发词'], name: '长条目', comment: '长条目' })];
    const result = autoFixEntries(entries);
    for (const e of result.entries) {
      expect(e.keys).toContain('触发词');
    }
  });

  it('无名称无触发词的条目被禁用', () => {
    const entries = [makeEntry({ keys: [], name: '', comment: '' })];
    const result = autoFixEntries(entries);
    expect(result.entries[0].enabled).toBe(false);
  });

  it('多个修复同时应用', () => {
    const entries = [
      makeEntry({ content: '', name: '空条目', comment: '空条目' }),
      makeEntry({ keys: [], constant: false, name: '无关键词', comment: '无关键词' }),
      makeEntry({ selective: true, secondary_keys: [], constant: true, name: '蓝灯selective', comment: '蓝灯selective' }),
    ];
    const result = autoFixEntries(entries);
    expect(result.fixes.length).toBeGreaterThanOrEqual(3);
  });
});
