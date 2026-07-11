/**
 * Novel Workshop Service - AI extraction & merge for novel-to-worldbook pipeline.
 *
 * Pipeline: splitTextIntoChunks → extractNovelChunk (per chunk) → mergeNovelPackages → inject to host
 *
 * Reuses:
 *   - callAIWithPromptStreaming from ai-service.ts (streaming + retry)
 *   - parseAIJson from prompts.ts (robust 3-level JSON parsing)
 *   - Types from novel-workshop/types.ts
 */

import { callAIWithPromptStreaming } from './ai-service';
import { parseAIJson } from '../constants/prompts';
import type { StreamCallback } from './ai-service';
import type {
  NovelPackage,
  GateMode,
  NarrativeMode,
  CategoryId,
} from '../components/novel-workshop/types';
import {
  DEFAULT_STAGE_ORDER,
  MERGE_BATCH_SIZE,
} from '../components/novel-workshop/types';

export interface ExtractConfig {
  gateMode: GateMode;
  narrativeMode: NarrativeMode;
  focus: CategoryId[];
  stageOrder: string[];
  entryBudget: number;
  contextText?: string;
}

const FOCUS_LABELS: Record<CategoryId, string> = {
  character: '人物',
  location: '地点',
  faction: '势力',
  rule: '规则',
  item: '物品',
};

function buildStageList(gateMode: GateMode, stageOrder: string[]): string {
  if (gateMode === 'public_only') return '["公开"]';
  return JSON.stringify(stageOrder.length ? stageOrder : [...DEFAULT_STAGE_ORDER]);
}

function buildFocusList(focus: CategoryId[]): string {
  const labels = focus.map((f) => FOCUS_LABELS[f] || f).join('、');
  return labels || '人物、地点、势力、规则';
}

const EXTRACT_SYSTEM = `你是"小说文本 → SillyTavern 世界书"的结构化拆书引擎。你的目标是从小说文本中抽取可注入世界书的实体、条目、揭露标记和 MVU 变量蓝图。

核心原则：
- 按世界书结构拆分：人物归人物，地点归地点，势力归势力，规则归规则，物品归物品。
- 每条 entry 的 content 使用清晰字段、列表、短段落，适合世界书注入，不写散文鉴赏。
- keys 至少 2 个字符，包含人名/别名/关系名/地点名/设定名，不要单字触发词。
- 对重要人物拆成多条世界书：核心设定、外貌、行为逻辑、关键关系等。
- 着重提取"特定设定"：只提不同于通用模板的独有规则、世界机制、组织制度、物品、仪式、禁忌。
- variables 是 MVU 变量蓝图：为关键角色或系统状态提取变量（如好感度、信任值、剧情进度等），每个变量必须有 path/type/description。
- 允许做合理的创作型归纳，但必须基于文本证据，不要凭空加入未出现设定。

只输出 JSON，不要 markdown 代码块，不要任何解释。`;

function buildExtractUser(
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
  config: ExtractConfig,
): string {
  const stageList = buildStageList(config.gateMode, config.stageOrder);
  const focusList = buildFocusList(config.focus);
  const needsFlags = config.gateMode === 'stage_flags';

  return `## 文本块 ${chunkIndex + 1}/${totalChunks}

${chunk}
${config.contextText ? `\n## 用户补充说明\n${config.contextText}\n` : ''}
## 抽取配置
- 门控模式：${config.gateMode}
- 叙事模式：${config.narrativeMode === 'lore_only' ? '只做世界观' : '按剧情推进'}
- 抽取重点：${focusList}
- 阶段轴：${stageList}
- 条目预算：约 ${config.entryBudget} 条（多片段时每片产出约 ${Math.max(5, Math.floor(config.entryBudget / totalChunks))} 条）

输出 JSON，必须符合以下结构：
{
  "summary": "本片段的内容摘要，100-300字",
  "stage_order": ${stageList},
  ${needsFlags ? `"reveal_flags": [
    { "id": "flag_id", "label": "标记名", "description": "该标记控制的剧情揭露", "default": false }
  ],` : '"reveal_flags": [],'}
  "entity_index": [
    { "id": "entity_id", "name": "实体名", "category": "character|location|faction|rule|item|event", "aliases": ["别名"], "summary": "公开摘要" }
  ],
  "variables": [
    { "path": "角色名.属性", "type": "number", "description": "变量说明", "default": 0, "min": 0, "max": 100 }
  ],
  "entries": [
    {
      "name": "条目名（2-6字）",
      "content": "世界书正文，字段化格式",
      "keys": ["触发词1", "触发词2"],
      "category": "character",
      "stage": ${JSON.stringify(config.stageOrder[0] || '公开')},
      "strategy": "selective",
      "priority": 700
    }
  ]
}

字段说明：
- strategy: "constant"（蓝灯常驻，适合核心世界观/全局规则）或 "selective"（绿灯关键词触发，适合具体人物/地点/物品）
- stage: 条目所属的阶段，必须来自上面的阶段轴
- priority: 100-1000，数值越大越优先保留
- variables 的 type: "number" | "string" | "boolean" | "enum"（enum 需提供 options）

请只输出 JSON。`;
}

const MERGE_SYSTEM = `你是世界书合并引擎。你的任务是合并多个从不同文本片段抽取的世界书包，去重同名实体、整合触发词、归并阶段。

合并规则：
- 同名实体（名称或别名相同）合并为一条，aliases 取并集，summary 取最完整的版本。
- 相同主题的 entry 合并为一条，content 取并集，keys 取并集。
- reveal_flags 按去重保留，id 相同的合并。
- variables 按 path 去重，保留最完整的定义。
- summary 合并为一个连贯的整体摘要。
- stage_order 取所有片段的并集，保持原有顺序。

只输出 JSON，不要 markdown 代码块，不要任何解释。`;

function buildMergeUser(packages: NovelPackage[], mergeIndex: number, totalMerges: number): string {
  return `## 合并任务 ${mergeIndex + 1}/${totalMerges}

以下是 ${packages.length} 个从不同文本片段抽取的世界书包，请合并为一个：

${packages.map((pkg, i) => `### 片段 ${i + 1}
${JSON.stringify(pkg)}`).join('\n\n')}

输出合并后的 JSON，结构同输入：
{
  "summary": "合并后的整体摘要",
  "stage_order": [...],
  "reveal_flags": [...],
  "entity_index": [...],
  "variables": [...],
  "entries": [...]
}

请只输出合并后的 JSON。`;
}

export async function extractNovelChunk(
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
  config: ExtractConfig,
  onChunk?: StreamCallback,
): Promise<NovelPackage> {
  const user = buildExtractUser(chunk, chunkIndex, totalChunks, config);
  const fullText = await callAIWithPromptStreaming(EXTRACT_SYSTEM, user, onChunk || (() => {}), {
    presetMode: 'none',
    temperature: 0.3,
  });

  const parsed = parseAIJson(fullText) as NovelPackage | null;
  if (!parsed) {
    throw new Error(`片段 ${chunkIndex + 1} 的 AI 响应无法解析为 JSON`);
  }

  return normalizePackage(parsed);
}

export async function mergeNovelPackages(
  packages: NovelPackage[],
  mergeIndex: number,
  totalMerges: number,
  onChunk?: StreamCallback,
): Promise<NovelPackage> {
  if (packages.length <= 1) return packages[0] || emptyPackage();

  const user = buildMergeUser(packages, mergeIndex, totalMerges);
  const fullText = await callAIWithPromptStreaming(MERGE_SYSTEM, user, onChunk || (() => {}), {
    presetMode: 'none',
    temperature: 0.2,
  });

  const parsed = parseAIJson(fullText) as NovelPackage | null;
  if (!parsed) {
    throw new Error(`合并任务 ${mergeIndex + 1} 的 AI 响应无法解析为 JSON`);
  }

  return normalizePackage(parsed);
}

export function emptyPackage(): NovelPackage {
  return {
    summary: '',
    stage_order: [...DEFAULT_STAGE_ORDER],
    reveal_flags: [],
    entity_index: [],
    variables: [],
    entries: [],
  };
}

function normalizePackage(raw: unknown): NovelPackage {
  const r = (raw || {}) as Record<string, unknown>;
  return {
    summary: String(r.summary || '').trim(),
    stage_order: Array.isArray(r.stage_order)
      ? (r.stage_order as string[])
      : Array.isArray(r.stageOrder)
        ? (r.stageOrder as string[])
        : [...DEFAULT_STAGE_ORDER],
    reveal_flags: (Array.isArray(r.reveal_flags) ? r.reveal_flags : Array.isArray(r.revealFlags) ? r.revealFlags : []) as NovelPackage['reveal_flags'],
    entity_index: (Array.isArray(r.entity_index) ? r.entity_index : Array.isArray(r.entityIndex) ? r.entityIndex : []) as NovelPackage['entity_index'],
    variables: (Array.isArray(r.variables) ? r.variables : []) as NovelPackage['variables'],
    entries: (Array.isArray(r.entries) ? r.entries : []) as NovelPackage['entries'],
  };
}

export function mergePackagesLocally(packages: NovelPackage[]): NovelPackage {
  if (packages.length === 0) return emptyPackage();
  if (packages.length === 1) return packages[0];

  const seenEntities = new Map<string, NovelPackage['entity_index'][number]>();
  const seenEntries = new Map<string, NovelPackage['entries'][number]>();
  const seenFlags = new Map<string, NovelPackage['reveal_flags'][number]>();
  const seenVars = new Map<string, NovelPackage['variables'][number]>();
  const stageSet = new Set<string>();
  const summaries: string[] = [];

  for (const pkg of packages) {
    if (pkg.summary) summaries.push(pkg.summary);
    (pkg.stage_order || []).forEach((s) => stageSet.add(s));

    for (const e of pkg.entity_index || []) {
      const key = e.name || e.id;
      if (key && !seenEntities.has(key)) seenEntities.set(key, e);
    }

    for (const entry of pkg.entries || []) {
      const key = entry.name || entry.title || '';
      if (key && !seenEntries.has(key)) seenEntries.set(key, entry);
    }

    for (const f of pkg.reveal_flags || []) {
      const key = f.id || f.label;
      if (key && !seenFlags.has(key)) seenFlags.set(key, f);
    }

    for (const v of pkg.variables || []) {
      if (v.path && !seenVars.has(v.path)) seenVars.set(v.path, v);
    }
  }

  return {
    summary: summaries.join('\n\n'),
    stage_order: stageSet.size > 0 ? [...stageSet] : [...DEFAULT_STAGE_ORDER],
    reveal_flags: [...seenFlags.values()],
    entity_index: [...seenEntities.values()],
    variables: [...seenVars.values()],
    entries: [...seenEntries.values()],
  };
}

export { MERGE_BATCH_SIZE };
