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

角色扮演导向（RP-first）：
- 记住：这些内容最终会被注入 SillyTavern，由 AI 在实时对话中扮演角色。条目不应只是"设定说明"，而应包含"AI 在何时如何表现"。
- 人物条目必须体现：说话方式、情绪反应、对玩家常见行为的默认反应、标志性口头禅或语气。
- 关系条目必须体现：角色在该关系中的互动模式，以及玩家介入时可能引发的反应或张力变化。
- 地点/势力/规则条目必须体现：当场景或设定被触发时，AI 应如何影响氛围、角色行为或剧情走向。
- 避免机械判断句（如"该角色表现为…""该阶段角色…""该设定说明…"），改用具体的行为、对白、场景描写。

写作方法论（借鉴成熟制卡流程）：
1. 行为展现性格：不写"她很高冷"，写"她回应时常常只给一两个字，眼睛却不自觉观察对方的反应"。用具体动作、选择、习惯代替抽象标签。
2. 一句一意：写完一个事实就停，不补述同一件事。
3. 四问过滤：每句话都过四问——(1) 删了这句 AI 会错吗？不会则删；(2) 是信息还是装饰？装饰则删；(3) 列表能替代吗？能则改列表；(4) 不看原文能理解吗？不能则补关键信息。
4. 剧情作为前置知识库，而非既定叙事：
   - 小说原文的剧情、背景、历史可以写入条目，但目的是让 AI 理解"已经发生了什么、现在处于什么状态、有哪些约束"。
   - 写法上应是概括性、知识性的说明（时间、原因、结果、影响），不要写成小说式场景、对话或未来必定发生的情节。
   - 不写"一定会""只能""必然"等绝对断言；给后续扮演留空间。
5. 多元化与可变性：世界和角色不是铁板一块。多用"通常""往往""可能""在某些情境下""常见""罕见""并非绝对"。对同一设定可给出 2-3 种变体或例外，让 AI 在扮演时有发挥空间。
6. 信息密度：人物与关系条目的 content 要覆盖充分细节；每条信息都要说明它对 AI 扮演的实际影响。
7. 人物条目建议结构（作为 content 字段）：
   - 核心身份与动机
   - 心理动态：用具体念头、身体感受表现，不写结论句
   - 行为模式：3-5 条可直接复现的动作/习惯/反应
   - 对话风格：整体语气 + 3-5 句典型台词（用引号）
   - 对他人态度：对主角/对手/陌生人的差异，用行为体现
   - 触发/消退条件：什么情境下更容易出现某种状态
   - 身体/环境细节：习惯性动作、表情、姿态、穿着、环境线索
   - 记忆/闪回：容易被什么触发、会想起什么
8. 关系条目建议结构：
   - 关系类型与情感动力
   - 双方日常互动模式
   - 玩家介入时可能引发的情绪变化或行为变化
   - 关系中的张力点与底线
9. 地点/势力/规则条目建议结构：
   - 触发该条目的典型场景
   - AI 应营造的氛围
   - 对角色行为的约束或推动
   - 地区差异或变体（如有）
10. 禁词与禁用表达：
   - 模糊词：似乎、几乎、仿佛、如同、宛如、某种
   - 机械判断：该阶段角色表现为… / 在此阶段… / 该设定说明…
   - 空泛形容词：极度、非常、特别、巨大的、深刻的
   - 廉价比喻：像小兽、心湖泛起涟漪、投石入湖
   - 模板微表情：嘴角上扬、眼里闪过光芒、指尖泛白、咬紧下唇
   - 八股句式：不是…而是… / 虽然…但是… / 在…的同时
   - 价值升华：最终明白了、终于懂得了、这一刻她意识到

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

content 写作要求（RP-first）：
- 不要只写"是什么"，要写"AI 遇到时怎么演"。
- 人物条目尽量覆盖：核心身份与动机、心理动态（用具体念头/身体感受，不写结论句）、行为模式 3-5 条、对话风格（整体语气 + 3-5 句典型台词）、对他人态度、触发/消退条件、身体/环境细节、记忆/闪回。
- 关系条目覆盖：关系类型与情感动力、双方日常互动模式、玩家介入时可能引发的情绪变化或行为变化、关系中的张力点与底线。
- 地点/势力/规则条目覆盖：触发该条目的典型场景、AI 应营造的氛围、对角色行为的约束或推动、地区差异或变体（如有）。
- 用"当…时，角色会…""角色习惯…""玩家若…则…"等可直接指导 AI 行为的句式。
- 避免写成小说式场景、未来固定剧本或第三人称评论；剧情只作为前置知识库。

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

角色扮演导向：
- 合并后的内容最终用于 AI 实时扮演角色。合并 content 时，优先保留能指导 AI 行为的具体描述（说话方式、反应模式、情绪触发、场景氛围），而不是笼统的设定说明。
- 如果多个片段对同一个人物的描述有差异，合并为"不同情境下的表现"，而不是简单堆砌。
- 避免生成"该角色表现为…"等机械判断句。

写作方法论（合并时仍需遵守）：
1. 行为展现性格：保留具体动作、选择、习惯，删除抽象标签。
2. 一句一意：合并后删除重复表达。
3. 四问过滤：合并新增的内容也要过四问——删了 AI 会错吗？是信息还是装饰？列表能替代吗？不看原文能理解吗？
4. 剧情作为前置知识库：合并后的 content 不应写成小说式场景或未来固定剧本。
5. 多元化与可变性：保留"通常""可能""往往""在某些情境下"等开放词和变体。
6. 禁词与禁用表达：合并后避免出现似乎、仿佛、极度、该阶段角色表现为…、嘴角上扬、最终明白了等表达。

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
      const name = entry.name || entry.title || '';
      if (!name) continue;
      const key = [name, entry.aspect || entry.slot || '', entry.stage || '', entry.category || ''].join('|');
      if (!seenEntries.has(key)) seenEntries.set(key, entry);
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
