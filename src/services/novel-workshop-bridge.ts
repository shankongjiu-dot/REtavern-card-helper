/**
 * Novel Analysis ↔ Novel Workshop bridge.
 *
 * Maps a structured NovelAnalysisResult into a natural-language contextText
 * that the Workshop's extraction prompt can consume. The original source text
 * is passed verbatim so the Workshop can split/chunk it independently.
 */
import type { NovelAnalysisResult } from './novel-analysis-service';

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
    // If the text is too large for sessionStorage, fall back to context-only.
    sessionStorage.setItem(
      NOVEL_WORKSHOP_BRIDGE_KEY,
      JSON.stringify({
        ...payload,
        sourceText: '',
      }),
    );
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
