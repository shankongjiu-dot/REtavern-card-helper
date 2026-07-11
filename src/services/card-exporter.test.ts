import { describe, it, expect } from 'vitest';
import { assembleCard, cardToDraft, findStagedLorebookEntryIndices } from './card-exporter';
import { createEmptyDraft, createEmptyLorebookEntry, createEmptyCharacter } from '../constants/defaults';
import type { WizardDraft, LorebookEntry } from '../constants/defaults';

function makeDraft(overrides: Partial<WizardDraft> = {}): WizardDraft {
  return { ...createEmptyDraft(), ...overrides };
}

describe('assembleCard', () => {
  it('生成符合 V3 spec 的卡片结构', () => {
    const draft = makeDraft({ cardName: '测试角色' });
    const card = assembleCard(draft);
    expect(card.spec).toBe('chara_card_v3');
    expect(card.spec_version).toBe('3.0');
    expect(card.data.name).toBe('测试角色');
  });

  it('extensions.world 与 character_book.name 一致', () => {
    const draft = makeDraft({ cardName: '测试角色' });
    const card = assembleCard(draft);
    expect(card.data.extensions.world).toBe(card.data.character_book.name);
  });

  it('卡片名称作为顶层 name 和 data.name', () => {
    const draft = makeDraft({ cardName: '银帷骑士' });
    const card = assembleCard(draft);
    expect(card.name).toBe('银帷骑士');
    expect(card.data.name).toBe('银帷骑士');
  });

  it('包含 character_book 且 entries 为数组', () => {
    const draft = makeDraft({ cardName: '测试' });
    const card = assembleCard(draft);
    expect(card.data.character_book).toBeDefined();
    expect(Array.isArray(card.data.character_book.entries)).toBe(true);
  });

  it('世界书条目按 insertion_order 排序', () => {
    const e1 = { ...createEmptyLorebookEntry(), insertion_order: 3, comment: 'C', name: 'C' };
    const e2 = { ...createEmptyLorebookEntry(), insertion_order: 1, comment: 'A', name: 'A' };
    const e3 = { ...createEmptyLorebookEntry(), insertion_order: 2, comment: 'B', name: 'B' };
    const draft = makeDraft({ cardName: '测试', lorebookEntries: [e1, e2, e3] });
    const card = assembleCard(draft);
    const entries = card.data.character_book.entries;
    expect(entries[0].comment).toBe('A');
    expect(entries[1].comment).toBe('B');
    expect(entries[2].comment).toBe('C');
  });

  it('MVU 未启用时不导出 MVU 相关条目', () => {
    const draft = makeDraft({ cardName: '测试' });
    const card = assembleCard(draft);
    const entries = card.data.character_book.entries;
    const mvuNames = entries.filter((e) =>
      ['[InitVar]请勿打开', '[mvu_update]变量更新规则', 'MVU 变量列表', 'MVU 变量输出格式', 'EJS预处理'].includes(e.name),
    );
    expect(mvuNames).toHaveLength(0);
  });

  it('first_mes 在 MVU 启用时包含状态栏占位符', () => {
    const draft = makeDraft({
      cardName: '测试',
      firstMessage: '你好。',
      mvu: {
        enabled: true,
        mode: 'expert',
        schemaSections: [],
        updateRules: [],
        ejsConfigs: [],
        ejsPreprocessContent: '',
        schemaTsContent: '',
        initvarYamlContent: '',
        updateRulesYamlContent: '',
        statusBarHtml: '<div>状态栏</div>',
        statusBarStyle: 'compact-panel',
      },
    });
    const card = assembleCard(draft);
    expect(card.data.first_mes).toContain('<StatusPlaceHolderImpl/>');
  });

  it('first_mes 在 MVU 未启用时不包含状态栏占位符', () => {
    const draft = makeDraft({ cardName: '测试', firstMessage: '你好。' });
    const card = assembleCard(draft);
    expect(card.data.first_mes).not.toContain('<StatusPlaceHolderImpl/>');
  });

  it('existingId 被保留在卡片中', () => {
    const draft = makeDraft({ cardName: '测试' });
    const card = assembleCard(draft, 42);
    expect(card.id).toBe(42);
  });

  it('无 existingId 时卡片不含 id', () => {
    const draft = makeDraft({ cardName: '测试' });
    const card = assembleCard(draft);
    expect(card.id).toBeUndefined();
  });

  it('creator_notes 为空时使用默认值', () => {
    const draft = makeDraft({ cardName: '测试', creator_notes: '' });
    const card = assembleCard(draft);
    expect(card.data.creator_notes).toContain('吟游手册');
  });

  it('_meta 包含角色信息', () => {
    const char = { ...createEmptyCharacter(), name: '角色1', description: '描述' };
    const draft = makeDraft({ cardName: '测试', characters: [char] });
    const card = assembleCard(draft);
    expect(card._meta.characters).toHaveLength(1);
    expect(card._meta.characters[0].name).toBe('角色1');
  });

  it('_meta 中的 entryIds 会剔除已不存在的条目', () => {
    const entry = createEmptyLorebookEntry();
    const char = { ...createEmptyCharacter(), name: '角色1', description: '描述', entryIds: [entry.id, 'deleted-id'] };
    const draft = makeDraft({ cardName: '测试', characters: [char], lorebookEntries: [entry] });
    const card = assembleCard(draft);
    expect(card._meta.characters[0].entryIds).toEqual([entry.id]);
  });

  it('从 _meta 恢复时，数字型 id/entryIds 会被规范化为字符串', () => {
    const card = assembleCard(makeDraft({ cardName: '测试' }));
    card._meta = {
      characters: [{
        id: 123,
        name: 'Alice',
        description: '描述',
        entryIds: [1, 2],
      }],
    } as unknown as typeof card._meta;
    const restored = cardToDraft(card as unknown as Record<string, unknown>);
    expect(restored.characters[0].id).toBe('123');
    expect(restored.characters[0].entryIds).toEqual(['1', '2']);
  });

  it('tags 被正确导出', () => {
    const draft = makeDraft({ cardName: '测试', tags: ['奇幻', '冒险'] });
    const card = assembleCard(draft);
    expect(card.data.tags).toEqual(['奇幻', '冒险']);
  });

  it('alternate_greetings 被正确导出', () => {
    const draft = makeDraft({ cardName: '测试', alternate_greetings: ['问候1', '问候2'] });
    const card = assembleCard(draft);
    expect(card.data.alternate_greetings).toEqual(['问候1', '问候2']);
  });
});

describe('cardToDraft', () => {
  it('往返一致：assembleCard → cardToDraft 保留 cardName', () => {
    const draft = makeDraft({ cardName: '往返测试', firstMessage: '开场白' });
    const card = assembleCard(draft);
    const restored = cardToDraft(card as unknown as Record<string, unknown>);
    expect(restored.cardName).toBe('往返测试');
    expect(restored.firstMessage).toBe('开场白');
  });

  it('往返一致：保留 tags', () => {
    const draft = makeDraft({ cardName: '测试', tags: ['标签1', '标签2'] });
    const card = assembleCard(draft);
    const restored = cardToDraft(card as unknown as Record<string, unknown>);
    expect(restored.tags).toEqual(['标签1', '标签2']);
  });

  it('往返一致：保留 scenario', () => {
    const draft = makeDraft({ cardName: '测试', scenario: '场景描述' });
    const card = assembleCard(draft);
    const restored = cardToDraft(card as unknown as Record<string, unknown>);
    expect(restored.scenario).toBe('场景描述');
  });

  it('往返一致：保留 lorebook 条目数量', () => {
    const entries = [
      { ...createEmptyLorebookEntry(), comment: '条目1', name: '条目1', content: '内容1', keys: ['词1'] },
      { ...createEmptyLorebookEntry(), comment: '条目2', name: '条目2', content: '内容2', keys: ['词2'] },
    ];
    const draft = makeDraft({ cardName: '测试', lorebookEntries: entries });
    const card = assembleCard(draft);
    const restored = cardToDraft(card as unknown as Record<string, unknown>);
    expect(restored.lorebookEntries).toHaveLength(2);
  });

  it('从 _meta 恢复角色信息', () => {
    const char = { ...createEmptyCharacter(), name: '艾莉亚', description: '精灵游侠' };
    const draft = makeDraft({ cardName: '测试', characters: [char] });
    const card = assembleCard(draft);
    const restored = cardToDraft(card as unknown as Record<string, unknown>);
    expect(restored.characters).toHaveLength(1);
    expect(restored.characters[0].name).toBe('艾莉亚');
  });

  it('MVU 未启用的卡片不恢复 mvu config', () => {
    const draft = makeDraft({ cardName: '测试' });
    const card = assembleCard(draft);
    const restored = cardToDraft(card as unknown as Record<string, unknown>);
    expect(restored.mvu).toBeUndefined();
  });

  it('bookScanDepth 和 bookTokenBudget 被保留', () => {
    const draft = makeDraft({ cardName: '测试', bookScanDepth: 300, bookTokenBudget: 2000 });
    const card = assembleCard(draft);
    const restored = cardToDraft(card as unknown as Record<string, unknown>);
    expect(restored.bookScanDepth).toBe(300);
    expect(restored.bookTokenBudget).toBe(2000);
  });

  it('缺少 _meta.characters 时，从角色设定条目重建角色后不会保留重复条目', () => {
    const roleEntry = { ...createEmptyLorebookEntry(), name: 'Alice - 角色设定', content: '描述', constant: true };
    const otherEntry = { ...createEmptyLorebookEntry(), name: '其他', content: '内容' };
    const draft = makeDraft({ cardName: '测试', lorebookEntries: [roleEntry, otherEntry] });
    const card = assembleCard(draft);
    const cardWithoutMeta = { ...card, _meta: {} };
    const restored = cardToDraft(cardWithoutMeta as unknown as Record<string, unknown>);
    expect(restored.characters).toHaveLength(1);
    expect(restored.characters[0].name).toBe('Alice');
    expect(restored.lorebookEntries).toHaveLength(1);
    expect(restored.lorebookEntries[0].name).toBe('其他');
  });

  it('往返后世界书条目和角色 entryIds 保持字符串类型', () => {
    const entries = [
      { ...createEmptyLorebookEntry(), comment: '条目1', name: '条目1', content: '内容1', keys: ['词1'] },
      { ...createEmptyLorebookEntry(), comment: '条目2', name: '条目2', content: '内容2', keys: ['词2'] },
    ];
    const draft = makeDraft({ cardName: '测试', lorebookEntries: entries });
    const card = assembleCard(draft);
    const restored = cardToDraft(card as unknown as Record<string, unknown>);
    expect(restored.lorebookEntries.every((e) => typeof e.id === 'string')).toBe(true);
  });
});

describe('findStagedLorebookEntryIndices', () => {
  it('无分阶段条目时返回空集合', () => {
    const entries: LorebookEntry[] = [
      { ...createEmptyLorebookEntry(), comment: '普通', name: '普通', content: '内容' },
    ];
    const indices = findStagedLorebookEntryIndices(entries);
    expect(indices.size).toBe(0);
  });

  it('包含 getWorldInfo 调度内容的条目被识别', () => {
    // parseDispatcherContent 需要同时匹配 getvar('stat_data.XXX') 和 getWorldInfo("书名", "子条目")
    const dispatcherContent = `<%_ const stage = getvar('stat_data.阶段'); const w = getWorldInfo("阶段书", "阶段1"); _%>`;
    const entries: LorebookEntry[] = [
      { ...createEmptyLorebookEntry(), comment: '调度', name: '调度', content: dispatcherContent },
      { ...createEmptyLorebookEntry(), comment: '普通', name: '普通', content: '普通内容' },
    ];
    const indices = findStagedLorebookEntryIndices(entries);
    expect(indices.has(0)).toBe(true);
    expect(indices.has(1)).toBe(false);
  });
});
