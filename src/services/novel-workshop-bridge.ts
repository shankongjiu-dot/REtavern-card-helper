/**
 * Novel Analysis ↔ Novel Workshop bridge.
 *
 * Maps a structured NovelAnalysisResult into a natural-language contextText
 * that the Workshop's extraction prompt can consume. The original source text
 * is passed verbatim so the Workshop can split/chunk it independently.
 */
import type { NovelAnalysisResult } from './novel-analysis-service';
import type { LorebookEntry, MvuConfig, MvuSchemaSection, MvuVariable } from '../constants/defaults';
import { createEmptyLorebookEntry } from '../constants/defaults';
import type { GeneratedEntry, VariableBlueprint, RevealFlag } from '../components/novel-workshop/types';
import { sanitizeSegment } from '../components/novel-workshop/utils';

export const NOVEL_WORKSHOP_BRIDGE_KEY = 'novel-workshop-analysis-bridge';

export interface NovelWorkshopBridgePayload {
  title: string;
  sourceText: string;
  contextText: string;
  pushedAt: string;
}

/**
 * Build a concise but information-dense context document from the analysis.
 * This becomes the "用户补充说明" section of the Workshop extraction prompt.
 */
export function buildWorkshopContextText(title: string, analysis: NovelAnalysisResult): string {
  const parts: string[] = [];

  parts.push(`## 小说分析摘要`);
  parts.push(`作品名：${title || '未命名小说'}`);
  if (analysis.genre) parts.push(`类型：${analysis.genre}`);
  if (analysis.tone) parts.push(`基调：${analysis.tone}`);
  if (analysis.summary) parts.push(`\n${analysis.summary}`);

  if (analysis.styleProfile) {
    const sp = analysis.styleProfile;
    parts.push(`\n## 文风参考（请让生成的世界书条目保持这种文风）`);
    if (sp.narration) parts.push(`- 叙述：${sp.narration}`);
    if (sp.dialogue) parts.push(`- 对话：${sp.dialogue}`);
    if (sp.pacing) parts.push(`- 节奏：${sp.pacing}`);
    if (sp.imagery) parts.push(`- 意象：${sp.imagery}`);
    if (sp.taboos?.length) parts.push(`- 避免：${sp.taboos.join('、')}`);
  }

  if (analysis.characters?.length) {
    parts.push(`\n## 重点人物（必须提取，建议为每个人物拆多条）`);
    analysis.characters.forEach((c) => {
      const lines: string[] = [];
      lines.push(`### ${c.name}${c.role ? `（${c.role}）` : ''}`);
      if (c.logicHub) lines.push(`- 逻辑枢纽：${c.logicHub}`);
      if (c.traits?.length) lines.push(`- 特质：${c.traits.join('、')}`);
      if (c.appearance) lines.push(`- 外貌：${c.appearance}`);
      if (c.outfits?.length) {
        lines.push(`- 场景着装：${c.outfits.map((o) => `${o.scene}：${o.description}`).join('；')}`);
      }
      if (c.relationships?.length) {
        lines.push(`- 关系：${c.relationships.map((r) => `${r.target}（${r.type}，${r.dynamic}）`).join('；')}`);
      }
      if (c.evidence) lines.push(`- 文本证据：${c.evidence}`);
      parts.push(lines.join('\n'));
    });
  }

  if (analysis.relationshipMap?.length) {
    parts.push(`\n## 人物关系网络`);
    analysis.relationshipMap.forEach((r) => {
      parts.push(`- ${r.source} → ${r.target}：${r.relation}。${r.conflictOrBond}（叙事功能：${r.storyFunction}）`);
    });
  }

  if (analysis.timeline?.length) {
    parts.push(`\n## 剧情时间线`);
    analysis.timeline.forEach((item) => {
      parts.push(`- ${item.order}. ${item.event}${item.impact ? `（影响：${item.impact}）` : ''}`);
    });
  }

  if (analysis.locations?.length) {
    parts.push(`\n## 关键地点`);
    analysis.locations.forEach((loc) => {
      const line = [`- ${loc.name}`];
      if (loc.description) line.push(`：${loc.description}`);
      if (loc.significance) line.push(`（意义：${loc.significance}）`);
      parts.push(line.join(''));
    });
  }

  if (analysis.factions?.length) {
    parts.push(`\n## 势力/组织`);
    analysis.factions.forEach((f) => {
      const members = f.members?.length ? `（成员：${f.members.join('、')}）` : '';
      parts.push(`- ${f.name}：${f.purpose || ''}${members}`);
    });
  }

  if (analysis.uniqueSettings?.length) {
    parts.push(`\n## 特殊设定/世界观`);
    analysis.uniqueSettings.forEach((s) => {
      const line = [`- ${s.name}`];
      if (s.category) line.push(`[${s.category}]`);
      if (s.description) line.push(` ${s.description}`);
      if (s.difference) line.push(`（独特性：${s.difference}）`);
      if (s.usage) line.push(`（使用方式：${s.usage}）`);
      parts.push(line.join(''));
    });
  }

  if (analysis.lorebookEntries?.length) {
    parts.push(`\n## 建议的世界书条目方向`);
    analysis.lorebookEntries.forEach((e) => {
      const keys = e.keys?.length ? `（关键词：${e.keys.join('、')}）` : '';
      parts.push(`- [${e.category}] ${e.name}${keys}：${e.content.slice(0, 120)}${e.content.length > 120 ? '…' : ''}`);
    });
  }

  if (analysis.cleaningNotes?.length) {
    parts.push(`\n## 整理备注`);
    analysis.cleaningNotes.forEach((note) => parts.push(`- ${note}`));
  }

  return parts.join('\n\n');
}

/**
 * Serialize analysis + original text to sessionStorage for the Workshop to consume.
 */
export function pushAnalysisToWorkshop(
  title: string,
  sourceText: string,
  analysis: NovelAnalysisResult,
): void {
  const payload: NovelWorkshopBridgePayload = {
    title,
    sourceText,
    contextText: buildWorkshopContextText(title, analysis),
    pushedAt: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(NOVEL_WORKSHOP_BRIDGE_KEY, JSON.stringify(payload));
  } catch {
    try {
      sessionStorage.setItem(
        NOVEL_WORKSHOP_BRIDGE_KEY,
        JSON.stringify({
          ...payload,
          sourceText: '',
        }),
      );
    } catch {
      throw new Error('浏览器存储空间不足，无法推送小说分析。请关闭其他标签页或清理缓存后重试。');
    }
  }
}

/**
 * Read and remove the bridge payload. Should be called once on Workshop mount.
 */
export function consumeWorkshopBridge(): NovelWorkshopBridgePayload | null {
  try {
    const raw = sessionStorage.getItem(NOVEL_WORKSHOP_BRIDGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(NOVEL_WORKSHOP_BRIDGE_KEY);
    const parsed = JSON.parse(raw) as Partial<NovelWorkshopBridgePayload>;
    if (!parsed.contextText) return null;
    return {
      title: parsed.title || '',
      sourceText: parsed.sourceText || '',
      contextText: parsed.contextText,
      pushedAt: parsed.pushedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ── Workshop → Wizard lorebook bridge ─────────────────────────────────────

export const WORKSHOP_LOREBOOK_IMPORT_KEY = 'novel-workshop-lorebook-import';

export interface WorkshopLorebookImportPayload {
  title: string;
  entries: LorebookEntry[];
  variableBlueprints: VariableBlueprint[];
  summary: string;
  createdAt: string;
}

const WORKSHOP_CATEGORY_ORDER_BASE: Record<string, number> = {
  rule: 100,
  character: 300,
  location: 450,
  faction: 500,
  item: 550,
  event: 650,
};

const WORKSHOP_CATEGORY_PRIORITY: Record<string, number> = {
  rule: 90,
  character: 85,
  faction: 75,
  location: 60,
  item: 60,
  event: 70,
};

const WORKSHOP_CATEGORY_LABEL: Record<string, string> = {
  character: '人物',
  location: '地点',
  faction: '势力',
  rule: '规则',
  item: '物品',
  event: '事件',
};

function workshopCategoryOrder(category: string, index: number): number {
  const base = WORKSHOP_CATEGORY_ORDER_BASE[category] ?? 550;
  return base + index;
}

function workshopCategoryPriority(category: string): number {
  return WORKSHOP_CATEGORY_PRIORITY[category] ?? 50;
}

/** Convert GeneratedEntry[] from Novel Workshop into LorebookEntry[] for the card wizard.
 *  - Tags every entry with fromSkeleton=true so the wizard shows the 🦴 badge.
 *  - For entries with requiredFlags, wraps content in an EJS guard that only injects
 *    when ALL listed flags are true (checked via `getvar('stat_data.开关.{flagId}')`).
 *    The matching MVU boolean variables are produced by revealFlagsToVariableBlueprints. */
export function workshopEntriesToLorebookEntries(
  entries: GeneratedEntry[],
  _stageOrder: string[],
): LorebookEntry[] {
  return entries.map((entry, index) => {
    const lore = createEmptyLorebookEntry();
    const categoryLabel = WORKSHOP_CATEGORY_LABEL[entry.category] || entry.category;
    lore.name = entry.name || `工坊条目 ${index + 1}`;
    lore.comment = `[工坊/${categoryLabel}]${entry.aspect ? ` ${entry.aspect}` : ''}${entry.stage ? ` · ${entry.stage}` : ''}`;
    lore.keys = (entry.keys || []).map((k) => k.trim()).filter((k) => k.length >= 2);
    lore.content = entry.content || '';
    lore.enabled = true;
    lore.constant = entry.strategy === 'constant';
    lore.selective = entry.strategy === 'selective';
    lore.position = entry.strategy === 'constant' ? 'before_char' : 'after_char';
    lore.insertion_order = workshopCategoryOrder(entry.category, index);
    lore.priority = entry.priority || workshopCategoryPriority(entry.category);
    lore.prevent_recursion = true;
    lore.match_whole_words = true;
    lore.fromSkeleton = true;
    lore.skeletonExpanded = false;

    // Gate content behind requiredFlags (AND logic). The flag booleans live at
    // `stat_data.开关.{flagId}` and are seeded by revealFlagsToVariableBlueprints.
    // Sanitize each flag id with sanitizeSegment so characters like single quotes
    // can't break out of the JS string literal in the EJS guard. Sanitization
    // MUST match what revealFlagsToVariableBlueprints does — otherwise the guard
    // would reference a different variable path than the one seeded.
    const flags = (entry.requiredFlags || [])
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => sanitizeSegment(f))
      .filter(Boolean);
    if (flags.length > 0) {
      const conditions = flags.map((f) => `getvar('stat_data.开关.${f}') === true`).join(' && ');
      lore.content = [
        `<%_ if (${conditions}) { _%>`,
        lore.content,
        `<%_ } _%>`,
      ].join('\n');
    }
    return lore;
  }).filter((entry) => entry.content.trim());
}

/** Convert RevealFlag[] from the Workshop UI into VariableBlueprint[] so the
 *  wizard can seed the matching `开关.{flagId}` MVU booleans. Defaults to false
 *  — the card's updateRules is expected to flip these to true when the user
 *  satisfies the corresponding trigger condition. */
export function revealFlagsToVariableBlueprints(flags: RevealFlag[]): VariableBlueprint[] {
  if (!flags?.length) return [];
  const seen = new Set<string>();
  const blueprints: VariableBlueprint[] = [];
  for (const flag of flags) {
    const rawId = flag.id?.trim();
    if (!rawId) continue; // skip empty ids — preserves pre-fix behavior
    // Sanitize the id so the resulting MVU variable path is a valid EJS string
    // literal argument (e.g. "flag'bad" → "flag_bad"). AI is instructed to use
    // snake_case but defensive sanitization keeps the card from breaking when
    // it doesn't. Sanitization MUST match what workshopEntriesToLorebookEntries
    // does to requiredFlags — otherwise the EJS guard would reference a
    // different variable path than the one seeded here.
    const id = sanitizeSegment(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    blueprints.push({
      path: `开关.${id}`,
      type: 'boolean',
      default: false,
      description: `剧情开关「${flag.label || id}」${flag.description ? `：${flag.description}` : ''}。默认 false；当卡片 updateRules 检测到对应条件时置为 true，触发 requiredFlags 引用了此开关的世界书条目注入。`,
    });
  }
  return blueprints;
}

/** Save workshop-generated entries to sessionStorage for WizardPage to consume. */
export function saveWorkshopLorebookImport(
  title: string,
  entries: GeneratedEntry[],
  variables: VariableBlueprint[],
  summary: string,
  stageOrder: string[],
): LorebookEntry[] {
  const lorebookEntries = workshopEntriesToLorebookEntries(entries, stageOrder);
  const payload: WorkshopLorebookImportPayload = {
    title,
    entries: lorebookEntries,
    variableBlueprints: variables,
    summary,
    createdAt: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(WORKSHOP_LOREBOOK_IMPORT_KEY, JSON.stringify(payload));
  } catch {
    try {
      sessionStorage.setItem(WORKSHOP_LOREBOOK_IMPORT_KEY, JSON.stringify({
        ...payload,
        variableBlueprints: [],
      }));
    } catch {
      throw new Error('浏览器存储空间不足，无法导出条目。请关闭其他标签页或清理缓存后重试。');
    }
  }
  return lorebookEntries;
}

/** Read and remove the workshop lorebook import payload. Should be called once on WizardPage mount. */
export function consumeWorkshopLorebookImport(): WorkshopLorebookImportPayload | null {
  try {
    const raw = sessionStorage.getItem(WORKSHOP_LOREBOOK_IMPORT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(WORKSHOP_LOREBOOK_IMPORT_KEY);
    const parsed = JSON.parse(raw) as Partial<WorkshopLorebookImportPayload>;
    if (!Array.isArray(parsed.entries)) return null;
    return {
      title: parsed.title || '',
      entries: parsed.entries,
      variableBlueprints: Array.isArray(parsed.variableBlueprints) ? parsed.variableBlueprints : [],
      summary: parsed.summary || '',
      createdAt: parsed.createdAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Convert VariableBlueprint[] from Novel Workshop into MvuSchemaSection[] for the card wizard. */
export function variableBlueprintsToMvuSections(
  blueprints: VariableBlueprint[],
): MvuSchemaSection[] {
  if (!blueprints.length) return [];

  const seenPaths = new Set<string>();
  const groups = new Map<string, MvuVariable[]>();
  for (const bp of blueprints) {
    if (!bp.path || seenPaths.has(bp.path)) continue;
    seenPaths.add(bp.path);

    const sectionName = bp.path.split('.')[0] || '变量';
    if (!groups.has(sectionName)) groups.set(sectionName, []);
    const group = groups.get(sectionName)!;

    let zodType: string;
    switch (bp.type) {
      case 'number': zodType = 'z.coerce.number()'; break;
      case 'boolean': zodType = 'z.boolean()'; break;
      case 'enum': zodType = `z.enum(${JSON.stringify(bp.options || [])})`; break;
      default: zodType = 'z.string()'; break;
    }

    group.push({
      path: bp.path,
      zodType,
      description: bp.description || bp.path,
      prefix: '',
      initialValue: bp.default ?? (bp.type === 'number' ? 0 : bp.type === 'boolean' ? false : ''),
      ...(bp.type === 'enum' && bp.options ? { enumValues: bp.options } : {}),
      ...(bp.type === 'number' && bp.min != null && bp.max != null ? { range: { min: bp.min, max: bp.max } } : {}),
    });
  }

  return Array.from(groups.entries()).map(([name, variables]) => ({
    name,
    variables,
  }));
}

/**
 * Merge incoming variable blueprints into an existing MVU config.
 *
 * This is extracted from WizardPage's two import effects (novel-analysis and
 * workshop) so the merge logic can be unit-tested. The merge is performed at
 * the VARIABLE PATH level (not the section level) so that importing a new
 * variable `剧情.进度` does NOT get silently dropped when the existing config
 * already has a section named `剧情` containing other variables like
 * `剧情.支线触发`. Existing variables always win over incoming blueprints
 * with the same path (user edits preserved).
 *
 * Returned MvuConfig is enabled=true whenever at least one new variable was
 * added; otherwise the input config is returned unchanged.
 */
export function mergeVariableBlueprintsIntoMvu(
  current: MvuConfig,
  blueprints: VariableBlueprint[],
): MvuConfig {
  const incomingSections = variableBlueprintsToMvuSections(blueprints);
  if (incomingSections.length === 0) return current;

  // Index existing variables by path for fast lookup.
  const existingVariablePaths = new Set<string>();
  for (const section of current.schemaSections) {
    for (const v of section.variables) {
      existingVariablePaths.add(v.path);
    }
  }

  const mergedSections = current.schemaSections.map((s) => ({ ...s, variables: [...s.variables] }));
  let addedCount = 0;

  for (const incoming of incomingSections) {
    const target = mergedSections.find((s) => s.name === incoming.name);
    if (target) {
      // Merge variables into existing section: skip duplicate paths.
      for (const v of incoming.variables) {
        if (!existingVariablePaths.has(v.path)) {
          target.variables.push(v);
          existingVariablePaths.add(v.path);
          addedCount += 1;
        }
      }
    } else {
      // New section: only include variables whose path doesn't already exist
      // elsewhere (defensive — shouldn't normally happen, but covers the case
      // where the same path is split across differently-named sections).
      const newVars = incoming.variables.filter((v) => {
        if (existingVariablePaths.has(v.path)) return false;
        existingVariablePaths.add(v.path);
        return true;
      });
      if (newVars.length > 0) {
        mergedSections.push({ name: incoming.name, variables: newVars });
        addedCount += newVars.length;
      }
    }
  }

  if (addedCount === 0) return current;
  return { ...current, enabled: true, schemaSections: mergedSections };
}
