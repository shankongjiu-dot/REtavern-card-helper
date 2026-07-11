/**
 * Card Optimizer — builds AI prompts for field-level optimization, parses the
 * structured JSON response, and computes per-field diffs for the compare modal.
 *
 * Design (mirrors buildStatusBarModifyAIPrompt paradigm):
 *   - Preserve original info; optimize, don't truncate.
 *   - lorebookEntries matched by `comment`; only existing editable user entries can be changed.
 *   - MVU statusBarHtml must keep all {{getvar::stat_data.*}} macros intact.
 *   - MVU schemaSections must keep path/zodType; only description may change.
 *   - Returns pure JSON (no code fences).
 */
import type { WizardDraft, LorebookEntry, MvuSchemaSection } from '../constants/defaults';
import { parseAIJson } from '../constants/prompts';
import { findStagedLorebookEntryIndices, isProtectedLorebookEntry, editableLorebookEntries } from './card-exporter';

export type OptimizeFieldKey =
  | 'cardName'
  | 'tags'
  | 'firstMessage'
  | 'lorebookEntries'
  | 'mvu.statusBarHtml'
  | 'mvu.schemaSections';

export const ALL_OPTIMIZE_FIELDS: OptimizeFieldKey[] = [
  'cardName',
  'tags',
  'firstMessage',
  'lorebookEntries',
  'mvu.statusBarHtml',
  'mvu.schemaSections',
];

/** Raw AI response shape (only optimized fields present). */
export interface OptimizeResult {
  cardName?: string;
  tags?: string[];
  firstMessage?: string;
  lorebookEntries?: Array<{
    comment: string;
    name?: string;
    content?: string;
    keys?: string[];
    secondary_keys?: string[];
    selective?: boolean;
    constant?: boolean;
  }>;
  mvuStatusBarHtml?: string;
  mvuSchemaSections?: Array<{
    sectionName?: string;
    variables?: Array<{ path: string; description?: string }>;
  }>;
}

export interface EntryDiff {
  comment: string;
  before: Partial<Pick<LorebookEntry, 'content' | 'keys' | 'secondary_keys' | 'selective' | 'constant'>> | null;
  after: Partial<Pick<LorebookEntry, 'content' | 'keys' | 'secondary_keys' | 'selective' | 'constant'>> | null;
  isNew: boolean;
  hasChange: boolean;
}

export interface FieldDiff {
  field: OptimizeFieldKey;
  hasChange: boolean;
  before: unknown;
  after: unknown;
  /** Only for lorebookEntries — per-entry diffs matched by comment. */
  entryDiffs?: EntryDiff[];
}

/** Build a concise snapshot of selected fields for the AI prompt. */
function snapshotFields(draft: WizardDraft, fields: OptimizeFieldKey[]): string {
  const parts: string[] = [];
  for (const f of fields) {
    if (f === 'cardName') parts.push(`cardName: ${JSON.stringify(draft.cardName || '')}`);
    else if (f === 'tags') parts.push(`tags: ${JSON.stringify(draft.tags || [])}`);
    else if (f === 'firstMessage') parts.push(`firstMessage: ${JSON.stringify((draft.firstMessage || '').slice(0, 4000))}`);
    else if (f === 'lorebookEntries') {
      const entries = editableLorebookEntries(draft)
        .filter((e) => e.enabled)
        .map((e) => ({
          comment: e.comment,
          content: (e.content || '').slice(0, 1500),
          keys: e.keys,
          secondary_keys: e.secondary_keys,
          selective: e.selective,
          constant: e.constant,
        }));
      parts.push(`lorebookEntries: ${JSON.stringify(entries)}`);
    } else if (f === 'mvu.statusBarHtml') {
      parts.push(`mvuStatusBarHtml: ${JSON.stringify((draft.mvu?.statusBarHtml || '').slice(0, 4000))}`);
    } else if (f === 'mvu.schemaSections') {
      const sections = (draft.mvu?.schemaSections || []).map((s) => ({
        sectionName: s.name,
        variables: s.variables.map((v) => ({ path: v.path, description: v.description })),
      }));
      parts.push(`mvuSchemaSections: ${JSON.stringify(sections)}`);
    }
  }
  return parts.join('\n\n');
}

export const LOREBOOK_OPTIMIZE_BATCH_SIZE = 10;

export function buildLorebookBatches(
  draft: WizardDraft,
  direction: string,
): { system: string; user: string }[] {
  const entries = editableLorebookEntries(draft).filter((e) => e.enabled);
  const batches: { system: string; user: string }[] = [];
  for (let i = 0; i < entries.length; i += LOREBOOK_OPTIMIZE_BATCH_SIZE) {
    const batch = entries.slice(i, i + LOREBOOK_OPTIMIZE_BATCH_SIZE);
    batches.push({
      system: `你是 SillyTavern 角色卡世界书检修专家。用户会提供一批已有世界书条目，请只输出需要修改的字段补丁，不要重写整条内容。`,
      user: `请检修以下世界书条目，返回 JSON 补丁。\n\n${direction ? `用户额外要求：${direction}\n\n` : ''}## 检修规则\n1. 只处理明显错误字段，不要润色 content，不要重新输出完整世界书。\n2. 如果 selective=true 且 secondary_keys=[]：优先判断是否真的需要二级过滤。\n   - 普通关键词触发条目：输出 {"selective":false}\n   - 确实需要二级过滤：只输出 {"secondary_keys":["补充词"]}\n3. 如果非 constant 条目 keys 为空：只输出 keys。\n4. 如果没有问题，不要返回该条目。\n5. 必须按 comment 精准匹配。严禁新增条目。\n\n## 输出格式\n{"lorebookEntries":[{"comment":"原comment","secondary_keys":["词"],"selective":false,"keys":["词"]}]}\n\n## 当前条目\n${JSON.stringify(
        batch.map((e) => ({
          comment: e.comment,
          name: e.name,
          keys: e.keys,
          secondary_keys: e.secondary_keys,
          selective: e.selective,
          constant: e.constant,
          content: (e.content || '').slice(0, 1200),
        })),
      )}\n\n请只输出 JSON 补丁：`,
    });
  }
  return batches;
}

export function buildOptimizePrompt(
  draft: WizardDraft,
  selectedFields: OptimizeFieldKey[],
  direction: string,
): { system: string; user: string } {
  const fieldNames = selectedFields.map((f) => {
    const map: Record<OptimizeFieldKey, string> = {
      cardName: 'cardName（卡片名称）',
      tags: 'tags（标签数组）',
      firstMessage: 'firstMessage（开场白）',
      lorebookEntries: 'lorebookEntries（世界书条目数组）',
      'mvu.statusBarHtml': 'mvuStatusBarHtml（状态栏 HTML）',
      'mvu.schemaSections': 'mvuSchemaSections（MVU 变量定义）',
    };
    return map[f];
  });

  const system = `你是 SillyTavern 角色卡优化专家。用户会提供当前角色卡的部分字段内容，请仅对指定字段进行优化，返回 JSON。

## 严格约束（违反将导致卡片损坏）
1. 保留原有信息不丢失，仅做优化不删减。提升清晰度、一致性与 token 效率。
2. lorebookEntries 必须按 comment 字段匹配原条目，只返回内容有变化的条目。comment 必须与原条目完全一致。
3. mvuStatusBarHtml 必须保留所有 {{getvar::stat_data.路径}} 宏，不得修改路径。可用 max(0%, calc(...)) 包裹进度条宽度。
4. mvuSchemaSections 必须保留每个变量的 path 不变，只能修改 description。sectionName 必须与原一致。
5. 严禁输出未选中的字段。严禁输出解释文字、markdown 代码块标记。

## 输出格式（纯 JSON 对象）
${selectedFields
  .map((f) => {
    if (f === 'cardName') return '可输出："cardName": "优化后的名称"';
    if (f === 'tags') return '可输出："tags": ["标签1", "标签2"]';
    if (f === 'firstMessage') return '可输出："firstMessage": "优化后的开场白"';
    if (f === 'lorebookEntries') return '可输出："lorebookEntries": [{"comment":"原条目comment","content":"优化后内容","keys":["触发词"]}]';
    if (f === 'mvu.statusBarHtml') return '可输出："mvuStatusBarHtml": "优化后的HTML"';
    if (f === 'mvu.schemaSections') return '可输出："mvuSchemaSections": [{"sectionName":"原section名","variables":[{"path":"原path","description":"优化后描述"}]}]';
    return '';
  })
  .filter(Boolean)
  .join('\n')}
未列出的字段一律禁止输出。`;

  const user = `请优化以下字段：${fieldNames.join('、')}

${direction ? `## 优化方向\n${direction}\n` : ''}

## 当前字段内容
${snapshotFields(draft, selectedFields)}

请直接输出优化后的 JSON 对象：`;

  return { system, user };
}

export function parseOptimizeResult(text: string): OptimizeResult | null {
  const parsed = parseAIJson(text);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const result: OptimizeResult = {};
  if (typeof obj.cardName === 'string') result.cardName = obj.cardName;
  if (Array.isArray(obj.tags)) result.tags = (obj.tags as unknown[]).filter((x): x is string => typeof x === 'string');
  if (typeof obj.firstMessage === 'string') result.firstMessage = obj.firstMessage;
  if (Array.isArray(obj.lorebookEntries)) {
    result.lorebookEntries = (obj.lorebookEntries as unknown[])
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e) => ({
        comment: typeof e.comment === 'string' ? e.comment : '',
        name: typeof e.name === 'string' ? e.name : undefined,
        content: typeof e.content === 'string' ? e.content : undefined,
        keys: Array.isArray(e.keys) ? (e.keys as unknown[]).filter((k): k is string => typeof k === 'string') : undefined,
        secondary_keys: Array.isArray(e.secondary_keys) ? (e.secondary_keys as unknown[]).filter((k): k is string => typeof k === 'string') : undefined,
        selective: typeof e.selective === 'boolean' ? e.selective : undefined,
        constant: typeof e.constant === 'boolean' ? e.constant : undefined,
      }))
      .filter((e) => e.comment);
  }
  if (typeof obj.mvuStatusBarHtml === 'string') result.mvuStatusBarHtml = obj.mvuStatusBarHtml;
  if (Array.isArray(obj.mvuSchemaSections)) {
    result.mvuSchemaSections = (obj.mvuSchemaSections as unknown[])
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map((s) => ({
        sectionName: typeof s.sectionName === 'string' ? s.sectionName : undefined,
        variables: Array.isArray(s.variables)
          ? (s.variables as unknown[])
              .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
              .map((v) => ({
                path: typeof v.path === 'string' ? v.path : '',
                description: typeof v.description === 'string' ? v.description : undefined,
              }))
              .filter((v) => v.path)
          : [],
      }));
  }
  const hasAny = Object.keys(result).length > 0;
  return hasAny ? result : null;
}

function sameStringArray(a: string[] | undefined, b: string[] | undefined): boolean {
  return JSON.stringify((a || []).slice().sort()) === JSON.stringify((b || []).slice().sort());
}

function diffLorebook(
  current: LorebookEntry[],
  optimized: NonNullable<OptimizeResult['lorebookEntries']>,
): EntryDiff[] {
  const diffs: EntryDiff[] = [];
  for (const opt of optimized) {
    const matches = current.filter((e) => e.comment === opt.comment);
    if (matches.length === 0) continue;

    for (const match of matches) {
      const before: EntryDiff['before'] = {};
      const after: EntryDiff['after'] = {};

      if (opt.content !== undefined && opt.content !== match.content) {
        before.content = match.content || '';
        after.content = opt.content;
      }
      if (opt.keys !== undefined && !sameStringArray(opt.keys, match.keys)) {
        before.keys = match.keys || [];
        after.keys = opt.keys;
      }
      if (opt.secondary_keys !== undefined && !sameStringArray(opt.secondary_keys, match.secondary_keys)) {
        before.secondary_keys = match.secondary_keys || [];
        after.secondary_keys = opt.secondary_keys;
      }
      if (opt.selective !== undefined && opt.selective !== match.selective) {
        before.selective = match.selective;
        after.selective = opt.selective;
      }
      if (opt.constant !== undefined && opt.constant !== match.constant) {
        before.constant = match.constant;
        after.constant = opt.constant;
      }

      if (Object.keys(after).length > 0) {
        diffs.push({
          comment: opt.comment,
          before,
          after,
          isNew: false,
          hasChange: true,
        });
      }
    }
  }
  return diffs;
}

export function computeFieldDiffs(
  draft: WizardDraft,
  result: OptimizeResult,
  selectedFields: OptimizeFieldKey[],
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of selectedFields) {
    if (field === 'cardName' && result.cardName !== undefined) {
      const before = draft.cardName || '';
      const after = result.cardName;
      diffs.push({ field, hasChange: before !== after, before, after });
    } else if (field === 'tags' && result.tags !== undefined) {
      const before = draft.tags || [];
      const after = result.tags;
      diffs.push({
        field,
        hasChange: JSON.stringify(before.slice().sort()) !== JSON.stringify(after.slice().sort()),
        before,
        after,
      });
    } else if (field === 'firstMessage' && result.firstMessage !== undefined) {
      const before = draft.firstMessage || '';
      const after = result.firstMessage;
      diffs.push({ field, hasChange: before !== after, before, after });
    } else if (field === 'lorebookEntries' && result.lorebookEntries !== undefined) {
      const currentEntries = editableLorebookEntries(draft);
      const allowedComments = new Set(currentEntries.map((e) => e.comment).filter(Boolean));
      const safeResult = result.lorebookEntries.filter((entry) => allowedComments.has(entry.comment));
      const entryDiffs = diffLorebook(currentEntries, safeResult);
      diffs.push({
        field,
        hasChange: entryDiffs.length > 0,
        before: currentEntries,
        after: safeResult,
        entryDiffs,
      });
    } else if (field === 'mvu.statusBarHtml' && result.mvuStatusBarHtml !== undefined) {
      const before = draft.mvu?.statusBarHtml || '';
      const after = result.mvuStatusBarHtml;
      diffs.push({ field, hasChange: before !== after, before, after });
    } else if (field === 'mvu.schemaSections' && result.mvuSchemaSections !== undefined) {
      const beforeSections = (draft.mvu?.schemaSections || []).map((s) => ({
        sectionName: s.name,
        variables: s.variables.map((v) => ({ path: v.path, description: v.description })),
      }));
      const afterSections = result.mvuSchemaSections;
      const hasChange = JSON.stringify(beforeSections) !== JSON.stringify(afterSections);
      diffs.push({
        field,
        hasChange,
        before: draft.mvu?.schemaSections || ([] as MvuSchemaSection[]),
        after: afterSections,
      });
    }
  }
  return diffs.filter((d) => d.hasChange);
}

/** Build a Partial<WizardDraft> patch for a single field. */
export function buildApplyPatch(
  draft: WizardDraft,
  field: OptimizeFieldKey,
  result: OptimizeResult,
): Partial<WizardDraft> {
  if (field === 'cardName' && result.cardName !== undefined) {
    return { cardName: result.cardName };
  }
  if (field === 'tags' && result.tags !== undefined) {
    return { tags: result.tags };
  }
  if (field === 'firstMessage' && result.firstMessage !== undefined) {
    return { firstMessage: result.firstMessage };
  }
  if (field === 'lorebookEntries' && result.lorebookEntries !== undefined) {
    const current = draft.lorebookEntries ? [...draft.lorebookEntries] : [];
    let stagedIndices = new Set<number>();
    if (draft.stagedMode?.enabled) {
      try {
        stagedIndices = findStagedLorebookEntryIndices(current);
      } catch {
        stagedIndices = new Set();
      }
    }
    const editableComments = new Set(
      current
        .filter((entry, idx) => !isProtectedLorebookEntry(entry, idx, stagedIndices))
        .map((entry) => entry.comment)
        .filter(Boolean),
    );
    for (const opt of result.lorebookEntries) {
      if (!editableComments.has(opt.comment)) continue;
      current.forEach((existing, idx) => {
        if (existing.comment !== opt.comment) return;
        current[idx] = {
          ...existing,
          ...(opt.content !== undefined ? { content: opt.content } : {}),
          ...(opt.keys !== undefined ? { keys: opt.keys } : {}),
          ...(opt.secondary_keys !== undefined ? { secondary_keys: opt.secondary_keys } : {}),
          ...(opt.selective !== undefined ? { selective: opt.selective } : {}),
          ...(opt.constant !== undefined ? { constant: opt.constant } : {}),
          ...(opt.name ? { name: opt.name } : {}),
        };
      });
    }
    return { lorebookEntries: current };
  }
  if (field === 'mvu.statusBarHtml' && result.mvuStatusBarHtml !== undefined && draft.mvu) {
    return { mvu: { ...draft.mvu, statusBarHtml: result.mvuStatusBarHtml } };
  }
  if (field === 'mvu.schemaSections' && result.mvuSchemaSections !== undefined && draft.mvu) {
    // Merge: keep path/zodType, only update description from AI.
    const currentSections = draft.mvu.schemaSections.map((s) => ({ ...s, variables: s.variables.map((v) => ({ ...v })) }));
    for (const optSection of result.mvuSchemaSections) {
      const targetSection = currentSections.find((s) => s.name === optSection.sectionName);
      if (!targetSection) continue;
      for (const optVar of optSection.variables || []) {
        const targetVar = targetSection.variables.find((v) => v.path === optVar.path);
        if (targetVar && optVar.description !== undefined) {
          targetVar.description = optVar.description;
        }
      }
    }
    return { mvu: { ...draft.mvu, schemaSections: currentSections } };
  }
  return {};
}
