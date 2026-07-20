import { callAIWithPrompt, callAIWithPromptStreaming, type StreamCallback } from './ai-service';
import { parseAIJson } from '../constants/prompts';
import { createEmptyLorebookEntry } from '../constants/defaults';
import type { LorebookEntry } from '../constants/defaults';
import type { VariableBlueprint } from '../components/novel-workshop/types';
import { escapeEjsDoubleQuoted, escapeEjsSingleQuoted } from './staged-lorebook-builder';
import { sanitizeSegment } from '../components/novel-workshop/utils';

export const NOVEL_LOREBOOK_IMPORT_KEY = 'novel-analysis-lorebook-import';
export const NOVEL_ANALYSIS_PARTIAL_KEY = 'novelAnalysisPartial';

export interface NovelChunk {
  id: number;
  title: string;
  content: string;
  start: number;
  end: number;
}

export interface NovelLorebookMaterial {
  name: string;
  keys: string[];
  content: string;
  category: string;
  parent?: string;
  purpose?: string;
}

/** Structured item setting — explicit category instead of lumping into uniqueSettings. */
export interface NovelItemSetting {
  name: string;
  /** 道具分类：道具/装备/消耗品/神器/材料 等 */
  category: string;
  /** 属性（数值、稀有度、副作用等） */
  attributes: string;
  /** 功能用途 */
  function: string;
  /** 获取途径 */
  acquisition: string;
  /** 叙事意义 */
  significance: string;
}

/** Single stage of the main plot — drives staged worldbook progressive disclosure. */
export interface NovelPlotStage {
  /** 阶段名（用于分阶段世界书子条目 comment），如 "前期"/"中期"/"后期"/"终局" */
  name: string;
  /** 阶段简述（知识性，不写小说式场景） */
  summary: string;
  /** 关键事件（3-5 条，按因果链） */
  keyEvents: string[];
  /** 阶段高潮 */
  climax: string;
}

/** Structured main plot — converted into a staged lorebook dispatcher (轴: 剧情.进度). */
export interface NovelMainPlot {
  /** 前提/开局 */
  premise: string;
  /** 阶段列表（顺序即 if/else if 顺序） */
  stages: NovelPlotStage[];
  /** 结局/收束 */
  resolution: string;
}

/** Conditional easter egg — converted into a disabled lorebook entry guarded by an
 *  EJS `if (getvar('stat_data.彩蛋.{id}'))` block. The flag is initialized as `false`
 *  and is intended to be set to `true` by the card's updateRules when the trigger fires. */
export interface NovelEasterEgg {
  /** Stable identifier used as the MVU variable name suffix (e.g., "hidden_reunion") */
  id: string;
  /** 彩蛋名称（中文，便于展示） */
  name: string;
  /** 触发条件描述（自然语言） */
  trigger: string;
  /** 彩蛋内容（被触发时注入） */
  content: string;
  /** 触发关键词（用于 selective 策略，让条目在对话提及时也能被拉取） */
  keys: string[];
}

export interface NovelAnalysisResult {
  summary: string;
  genre: string;
  tone: string;
  styleProfile: {
    narration: string;
    dialogue: string;
    pacing: string;
    imagery: string;
    taboos: string[];
  };
  characters: Array<{
    name: string;
    role: string;
    logicHub: string;
    traits: string[];
    appearance: string;
    outfits: Array<{ scene: string; description: string }>;
    relationships: Array<{ target: string; type: string; dynamic: string; evidence: string }>;
    evidence: string;
  }>;
  relationshipMap: Array<{
    source: string;
    target: string;
    relation: string;
    conflictOrBond: string;
    storyFunction: string;
  }>;
  uniqueSettings: Array<{
    name: string;
    category: string;
    description: string;
    difference: string;
    usage: string;
  }>;
  /** NEW: Explicit item settings — separated from uniqueSettings so the wizard can
   *  give them their own category, ordering, and badge. */
  items: NovelItemSetting[];
  locations: Array<{
    name: string;
    description: string;
    significance: string;
  }>;
  factions: Array<{
    name: string;
    purpose: string;
    members: string[];
  }>;
  timeline: Array<{
    order: number;
    event: string;
    impact: string;
  }>;
  /** NEW: Structured main plot — converted into a staged lorebook dispatcher so the
   *  story unfolds progressively via the `剧情.进度` MVU variable. */
  mainPlot: NovelMainPlot;
  /** NEW: Conditional easter eggs — converted into disabled lorebook entries guarded
   *  by per-egg MVU boolean flags (initialized false in first_mes). */
  easterEggs: NovelEasterEgg[];
  lorebookEntries: NovelLorebookMaterial[];
  cleaningNotes: string[];
}

const CHAPTER_PATTERN = /(^|\n)(\s*(?:第[一二三四五六七八九十百千万零〇两\d]+[章节卷回幕部集]|番外|楔子|序章|终章|后记)[^\n]{0,60})/g;
const NOVEL_SAMPLE_MAX_CHARS = 42000;
export const DEFAULT_NOVEL_OUTPUT_MAX_TOKENS = 16000;

export function splitNovelText(text: string, maxChunkChars = 12000): NovelChunk[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];

  const matches = Array.from(normalized.matchAll(CHAPTER_PATTERN));
  const chunks: NovelChunk[] = [];

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const next = matches[i + 1];
      const start = current.index ?? 0;
      const end = next?.index ?? normalized.length;
      const raw = normalized.slice(start, end).trim();
      const title = (current[2] || `章节 ${i + 1}`).trim();
      pushSplitChunk(chunks, title, raw, start, maxChunkChars);
    }
  } else {
    pushSplitChunk(chunks, '区块 1', normalized, 0, maxChunkChars);
  }

  return chunks.map((chunk, index) => ({ ...chunk, id: index + 1 }));
}

function pushSplitChunk(chunks: NovelChunk[], title: string, content: string, start: number, maxChunkChars: number) {
  if (content.length <= maxChunkChars) {
    chunks.push({ id: chunks.length + 1, title, content, start, end: start + content.length });
    return;
  }

  let offset = 0;
  while (offset < content.length) {
    const sliceEnd = Math.min(offset + maxChunkChars, content.length);
    let end = sliceEnd;
    if (sliceEnd < content.length) {
      const punctuation = content.lastIndexOf('\n', sliceEnd);
      if (punctuation > offset + maxChunkChars * 0.6) end = punctuation;
    }
    const part = content.slice(offset, end).trim();
    if (part) {
      const partNo = Math.floor(offset / maxChunkChars) + 1;
      chunks.push({
        id: chunks.length + 1,
        title: `${title} (${partNo})`,
        content: part,
        start: start + offset,
        end: start + end,
      });
    }
    offset = end;
  }
}

export function buildNovelSample(chunks: NovelChunk[], maxChars = NOVEL_SAMPLE_MAX_CHARS): string {
  if (chunks.length === 0) return '';

  const selectedIndexes = new Set<number>();
  const anchors = [0, 1, Math.floor(chunks.length * 0.25), Math.floor(chunks.length * 0.5), Math.floor(chunks.length * 0.75), chunks.length - 2, chunks.length - 1];
  anchors.forEach((index) => {
    if (index >= 0 && index < chunks.length) selectedIndexes.add(index);
  });

  const selected = Array.from(selectedIndexes).sort((a, b) => a - b).map((index) => chunks[index]);
  const budgetPerChunk = Math.max(1800, Math.floor(maxChars / selected.length));

  return selected.map((chunk) => {
    const excerpt = chunk.content.length > budgetPerChunk
      ? `${chunk.content.slice(0, budgetPerChunk)}\n...(节选)`
      : chunk.content;
    return `# ${chunk.title}\n${excerpt}`;
  }).join('\n\n---\n\n');
}

interface NovelAnalysisPrompt {
  system: string;
  user: string;
}

/**
 * Build the (identical) system+user prompt for both streaming and non-streaming
 * novel analysis. Previously duplicated ~110 lines across the two code paths;
 * centralizing it removes drift risk and keeps the fallback path in sync.
 */
function buildNovelAnalysisPrompt(title: string, chunks: NovelChunk[]): NovelAnalysisPrompt {
  const sample = buildNovelSample(chunks);
  if (!sample) throw new Error('请先输入或上传小说文本');

  const system = `你是"小说文本 → SillyTavern 世界书"的结构化拆书专家。你的目标不是写普通读后感，而是直接生成可导入世界书、帮助 AI 进行角色扮演的素材库。

核心方向：
- 按世界书结构拆分，不要混成一大段：人物归人物，人物外貌归人物外貌，人物不同场景着装归着装，人物关系归关系，人物逻辑枢纽归逻辑枢纽，事件归事件，地点归地点，势力归势力，特殊设定归特殊设定，物品归物品，剧情主线归剧情主线，彩蛋归彩蛋，文风归文风。
- 允许做合理的创作型归纳：可以把文本中的隐含规律、关系张力、角色行为逻辑、叙事风格总结成可复用世界书，但必须基于节选证据，不要凭空加入未出现设定。
- 对重要人物要拆成多条世界书：例如"A - 核心设定""A - 外貌""A - 场景着装""A - 行为逻辑""A与B - 关系张力"。
- 着重梳理人物关系网络：关系类型、情感动力、冲突/依赖、叙事功能。
- 着重梳理人物逻辑枢纽：角色为什么这样行动、欲望、恐惧、底线、认知偏差、关键矛盾。
- 着重提取"特定设定"：只提不同于通用网文模板的独有规则、世界机制、组织制度、仪式、禁忌、职业体系。物品单独抽到 items 字段，不要混进 uniqueSettings。
- 着重提取"物品设定"：把小说中出现的可命名道具/装备/神器/消耗品/材料单独抽到 items 字段，每件物品必须给出属性、功能用途、获取途径、叙事意义。
- 着重提取"剧情主线"：把小说的整体故事主线抽到 mainPlot 字段，按"前期/中期/后期/终局"四阶段结构化（如小说节奏特殊可调整阶段名，但必须分阶段），每阶段写明简述、3-5 条关键事件、阶段高潮。剧情主线是知识性、概括性的"已发生事实库"，不是未来固定剧本。
- 着重提取"彩蛋"：把小说中"特定条件下才触发的隐藏内容"抽到 easterEggs 字段，例如：特定地点相遇、特定物品组合触发回忆、特定对话触发支线、达成隐藏条件解锁的人物过去。每个彩蛋必须给出 id（英文稳定标识）、name、trigger（自然语言触发条件描述）、content（触发后注入的内容）、keys（触发关键词）。
- 着重提取文风：叙述视角、句式节奏、对白习惯、意象系统、情绪底色、需要避免的违和写法。
- lorebookEntries 是最终产物，数量可以多，宁可拆细，也不要塞成一个大条目。
- 每个 lorebookEntries.content 使用清晰字段、列表、短段落，适合世界书注入，不写散文鉴赏。
- keys 至少 2 个字符，包含人名/别名/关系名/地点名/设定名，不要单字触发词。

角色扮演导向（RP-first）：
- 记住：这些素材最终注入 SillyTavern，用于 AI 实时扮演角色。拆书时要思考"这个信息如何帮助 AI 在对话中演好角色"。
- 人物条目必须提炼可执行的行为指令：说话方式、情绪触发点、对陌生玩家/熟悉玩家的不同反应、习惯性动作或语气。
- 关系条目必须说明：当玩家介入这段关系时，角色会产生什么反应、情绪变化或行为变化。
- 文风条目必须转化为可直接指导 AI 写作的指令，而不仅是风格描述。
- 避免"该角色表现为…""该设定说明…"等第三人称机械判断句，改用"当…时，角色会…""角色习惯…""玩家若…则…"等可注入 AI 行为的表述。

写作方法论（借鉴成熟制卡流程）：
1. 行为展现性格：不写"她很高冷"，写"她回应时常常只给一两个字，眼睛却不自觉观察对方的反应"。用具体动作、选择、习惯代替抽象标签。
2. 一句一意：写完一个事实就停，不补述同一件事。
3. 四问过滤：每句话都过四问——(1) 删了这句 AI 会错吗？不会则删；(2) 是信息还是装饰？装饰则删；(3) 列表能替代吗？能则改列表；(4) 不看原文能理解吗？不能则补关键信息。
4. 剧情作为前置知识库，而非既定叙事：
   - 主线剧情、角色背景、世界历史可以写入世界书，但目的是让 AI 理解"已经发生了什么、现在处于什么状态、有哪些约束"。
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
9. 禁词与禁用表达：
   - 模糊词：似乎、几乎、仿佛、如同、宛如、某种
   - 机械判断：该阶段角色表现为… / 在此阶段… / 该设定说明…
   - 空泛形容词：极度、非常、特别、巨大的、深刻的
   - 廉价比喻：像小兽、心湖泛起涟漪、投石入湖
   - 模板微表情：嘴角上扬、眼里闪过光芒、指尖泛白、咬紧下唇
   - 八股句式：不是…而是… / 虽然…但是… / 在…的同时
   - 价值升华：最终明白了、终于懂得了、这一刻她意识到

只输出 JSON，不要 markdown 代码块。`;

  const user = `小说标题：${title || '未命名小说'}
总切块数：${chunks.length}
总字数：${chunks.reduce((sum, chunk) => sum + chunk.content.length, 0)}
抽样策略：开头、前段、中段、后段、结尾多点抽样，供你进行结构化世界书拆分。

${sample}

请输出 JSON，必须符合以下结构：
{
  "summary": "整体剧情/世界观摘要，200-500字",
  "genre": "类型",
  "tone": "叙事氛围",
  "styleProfile": {
    "narration": "叙述视角、句式、信息密度",
    "dialogue": "对白风格、角色说话习惯",
    "pacing": "节奏、铺垫、爆点方式",
    "imagery": "常用意象、氛围词、感官描写",
    "taboos": ["续写时应避免的违和写法"]
  },
  "characters": [
    {
      "name": "人物名",
      "role": "叙事定位",
      "logicHub": "人物行动逻辑枢纽：欲望/恐惧/底线/矛盾/行为模式",
      "traits": ["性格或能力特征"],
      "appearance": "外貌与身体辨识点",
      "outfits": [{ "scene": "场景", "description": "该场景着装/装备/视觉状态" }],
      "relationships": [{ "target": "对象", "type": "关系类型", "dynamic": "关系张力与互动模式", "evidence": "依据" }],
      "evidence": "原文依据简述"
    }
  ],
  "relationshipMap": [
    { "source": "人物A", "target": "人物B", "relation": "关系", "conflictOrBond": "冲突/羁绊", "storyFunction": "叙事功能" }
  ],
  "uniqueSettings": [
    { "name": "设定名", "category": "规则/制度/能力/禁忌/组织/世界机制", "description": "设定内容", "difference": "它不同于通用网文模板的地方", "usage": "写作或世界书使用方式" }
  ],
  "items": [
    {
      "name": "物品名",
      "category": "道具/装备/消耗品/神器/材料",
      "attributes": "属性：数值、稀有度、副作用、外观等",
      "function": "功能用途：能做什么、怎么用、限制条件",
      "acquisition": "获取途径：从哪里得到、如何制作、需要什么代价",
      "significance": "叙事意义：对剧情/角色的作用、为何重要"
    }
  ],
  "locations": [
    { "name": "地点名", "description": "地点特征（地理/建筑/氛围）", "significance": "叙事重要性" }
  ],
  "factions": [
    { "name": "势力名", "purpose": "目的/立场", "members": ["成员"] }
  ],
  "timeline": [
    { "order": 1, "event": "事件", "impact": "影响" }
  ],
  "mainPlot": {
    "premise": "故事前提/开局：人物处境、初始矛盾、推动力",
    "stages": [
      {
        "name": "前期",
        "summary": "本阶段剧情简述（知识性，概括已发生事实，不写未来剧本）",
        "keyEvents": ["关键事件 1", "关键事件 2", "关键事件 3"],
        "climax": "本阶段高潮（已发生的关键转折或冲突爆发）"
      },
      { "name": "中期", "summary": "...", "keyEvents": ["..."], "climax": "..." },
      { "name": "后期", "summary": "...", "keyEvents": ["..."], "climax": "..." },
      { "name": "终局", "summary": "...", "keyEvents": ["..."], "climax": "..." }
    ],
    "resolution": "结局/收束：最终状态、主要矛盾如何（或未如何）解决"
  },
  "easterEggs": [
    {
      "id": "hidden_reunion",
      "name": "彩蛋名（中文，便于展示）",
      "trigger": "触发条件描述（自然语言）：例如『当玩家持有物品 X 并在地点 Y 提及关键词 Z 时』",
      "content": "触发后注入的世界书内容：包含揭露的设定/回忆/支线/对话引导。RP-first，写明 AI 应如何表现。",
      "keys": ["触发关键词1", "触发关键词2"]
    }
  ],
  "lorebookEntries": [
    {
      "name": "条目名（精简准确，2-6字），例如：A核心设定 / A外貌 / A场景着装 / A与B关系 / 某事件因果 / 文风对白 / 某物品设定 / 某地点设定",
      "keys": ["触发词"],
      "content": "世界书正文，字段化、可直接注入。RP-first：不要只写设定，要写 AI 如何表现。人物条目尽量覆盖：核心身份与动机、心理动态、行为模式、对话风格（含典型台词）、对他人态度、触发/消退条件、身体/环境细节、记忆/闪回。关系条目覆盖：关系类型与动力、日常互动、玩家介入时的反应、张力点与底线。地点/势力/规则条目覆盖：触发场景、AI 应营造的氛围、对角色行为的约束或推动。物品条目覆盖：属性、功能、获取途径、对持有者的影响。包含：触发条件/关键事实/角色反应/可表现的对白或动作/写作注意。",
      "category": "人物/人物外貌/人物着装/人物关系/人物逻辑/事件/地点/势力/特殊设定/物品/文风/清洗",
      "parent": "所属人物/地点/事件/设定，可为空",
      "purpose": "该条目在世界书中的用途"
    }
  ],
  "cleaningNotes": ["广告、乱码、防盗替换、异常格式等清洗提示，或空数组"]
}

拆分要求：
- 主要人物至少尝试生成：核心设定、外貌、着装/视觉状态、行为逻辑、关键关系。
- 重要关系单独生成"人物关系"世界书，不要只塞进人物条目。
- 重要事件单独生成"事件"世界书，写清起因、经过、结果、影响。
- 每件可命名物品单独生成"物品"条目，并同步进入 items 字段。
- 重要地点单独生成"地点"条目，覆盖场景描述与叙事意义。
- mainPlot.stages 必须至少 2 个阶段；每个阶段的 keyEvents 至少 3 条；climax 必须是已发生的事实而非未来剧本。
- easterEggs 的 id 必须是英文稳定标识（snake_case），name 是中文，trigger 必须具体可判（地点/物品/对话/隐藏条件），content 必须是触发后可注入的世界书正文。若小说没有可触发的彩蛋，输出空数组 []。
- 特殊设定必须说明"为什么不是通用模板"。物品不要混进 uniqueSettings。
- 文风必须单独生成至少 1 条世界书，用于后续创作保持风格。
- 人物与关系条目尽量包含"玩家介入时"的反应变化：陌生玩家如何被对待、玩家挑衅/亲近时角色的情绪和行为差异。
- 人物条目按"行为展现性格"原则写作：用具体动作、选择、习惯代替抽象标签；每句过四问；用"通常""可能""往往"等开放词替代绝对断言。
- 所有条目避免写成小说式场景、未来固定剧本或第三人称评论。`;

  return { system, user };
}

export async function analyzeNovelText(title: string, chunks: NovelChunk[], outputMaxTokens = DEFAULT_NOVEL_OUTPUT_MAX_TOKENS): Promise<NovelAnalysisResult> {
  const { system, user } = buildNovelAnalysisPrompt(title, chunks);
  const safeOutputMaxTokens = Math.min(Math.max(Math.floor(outputMaxTokens || DEFAULT_NOVEL_OUTPUT_MAX_TOKENS), 4000), 300000);
  const text = await callAIWithPrompt(system, user, { temperature: 0.7, max_tokens: safeOutputMaxTokens, presetMode: 'none' });
  const parsed = parseAIJson(text) as NovelAnalysisResult | null;
  if (!parsed) {
    try { sessionStorage.setItem(NOVEL_ANALYSIS_PARTIAL_KEY, text); } catch {}
    throw new Error('AI 返回内容无法解析为 JSON，请重试或减少文本长度');
  }

  return normalizeAnalysis(parsed);
}

/**
 * Streaming version of analyzeNovelText.
 * Returns the parsed analysis result and calls onChunk for real-time progress display.
 * The onChunk callback receives the accumulated text so far — suitable for showing
 * a "创作者无法介入" progress display.
 */
export async function analyzeNovelTextStreaming(
  title: string,
  chunks: NovelChunk[],
  outputMaxTokens: number,
  onChunk: StreamCallback,
): Promise<NovelAnalysisResult> {
  const { system, user } = buildNovelAnalysisPrompt(title, chunks);
  const safeOutputMaxTokens = Math.min(Math.max(Math.floor(outputMaxTokens || DEFAULT_NOVEL_OUTPUT_MAX_TOKENS), 4000), 300000);
  const text = await callAIWithPromptStreaming(system, user, onChunk, { temperature: 0.7, max_tokens: safeOutputMaxTokens, presetMode: 'none' });
  const parsed = parseAIJson(text) as NovelAnalysisResult | null;
  if (!parsed) {
    try { sessionStorage.setItem(NOVEL_ANALYSIS_PARTIAL_KEY, text); } catch {}
    throw new Error('AI 返回内容无法解析为 JSON，请重试或减少文本长度');
  }

  return normalizeAnalysis(parsed);
}

function normalizeAnalysis(parsed: Partial<NovelAnalysisResult>): NovelAnalysisResult {
  return {
    summary: parsed.summary || '',
    genre: parsed.genre || '',
    tone: parsed.tone || '',
    styleProfile: {
      narration: parsed.styleProfile?.narration || '',
      dialogue: parsed.styleProfile?.dialogue || '',
      pacing: parsed.styleProfile?.pacing || '',
      imagery: parsed.styleProfile?.imagery || '',
      taboos: Array.isArray(parsed.styleProfile?.taboos) ? parsed.styleProfile.taboos : [],
    },
    characters: Array.isArray(parsed.characters) ? parsed.characters : [],
    relationshipMap: Array.isArray(parsed.relationshipMap) ? parsed.relationshipMap : [],
    uniqueSettings: Array.isArray(parsed.uniqueSettings) ? parsed.uniqueSettings : [],
    items: Array.isArray(parsed.items) ? parsed.items : [],
    locations: Array.isArray(parsed.locations) ? parsed.locations : [],
    factions: Array.isArray(parsed.factions) ? parsed.factions : [],
    timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
    mainPlot: parsed.mainPlot && Array.isArray(parsed.mainPlot.stages) && parsed.mainPlot.stages.length > 0
      ? {
          premise: parsed.mainPlot.premise || '',
          stages: parsed.mainPlot.stages,
          resolution: parsed.mainPlot.resolution || '',
        }
      : { premise: '', stages: [], resolution: '' },
    easterEggs: Array.isArray(parsed.easterEggs) ? parsed.easterEggs : [],
    lorebookEntries: Array.isArray(parsed.lorebookEntries) ? parsed.lorebookEntries : [],
    cleaningNotes: Array.isArray(parsed.cleaningNotes) ? parsed.cleaningNotes : [],
  };
}

export function exportAnalysisAsJson(title: string, chunks: NovelChunk[], analysis: NovelAnalysisResult): string {
  return JSON.stringify({
    title,
    generatedAt: new Date().toISOString(),
    chunkCount: chunks.length,
    totalChars: chunks.reduce((sum, chunk) => sum + chunk.content.length, 0),
    analysis,
  }, null, 2);
}

export function analysisToLorebookEntries(analysis: NovelAnalysisResult): LorebookEntry[] {
  const entries: LorebookEntry[] = [];

  // 1. Convert the AI-extracted lorebookEntries array — tag each with fromSkeleton
  //    so the wizard shows a 🦴 badge and tracks AI-expand progress.
  analysis.lorebookEntries.forEach((entry, index) => {
    const category = entry.category || '素材';
    const lore = createEmptyLorebookEntry();
    lore.name = entry.name || `小说素材 ${index + 1}`;
    lore.comment = `[小说分析/${category}]${entry.parent ? ` ${entry.parent}` : ''}${entry.purpose ? ` - ${entry.purpose}` : ''}`;
    lore.keys = Array.isArray(entry.keys)
      ? entry.keys.map((key) => key.trim()).filter((key) => key.length >= 2)
      : [];
    lore.content = entry.content || '';
    lore.constant = category === '文风' || category === '特殊设定';
    lore.enabled = true;
    lore.position = category === '文风' || category === '特殊设定' ? 'before_char' : 'after_char';
    lore.insertion_order = categoryOrder(category, index);
    lore.priority = categoryPriority(category);
    lore.prevent_recursion = true;
    lore.match_whole_words = true;
    lore.fromSkeleton = true;
    lore.skeletonExpanded = false;
    if (lore.content.trim()) entries.push(lore);
  });

  // 2. Convert structured items array — give each item its own 物品 entry so the
  //    wizard can give them a distinct category, ordering, and badge.
  analysis.items.forEach((item, index) => {
    if (!item.name?.trim() || !item.function?.trim()) return;
    const lore = createEmptyLorebookEntry();
    lore.name = `${item.name}`;
    lore.comment = `[小说分析/物品] ${item.name}${item.category ? ` · ${item.category}` : ''}`;
    lore.keys = [item.name.trim()];
    lore.content = [
      `# ${item.name}${item.category ? `（${item.category}）` : ''}`,
      '',
      `- 属性：${item.attributes || '（未提取）'}`,
      `- 功能用途：${item.function}`,
      `- 获取途径：${item.acquisition || '（未提取）'}`,
      `- 叙事意义：${item.significance || '（未提取）'}`,
    ].join('\n');
    lore.constant = false;
    lore.enabled = true;
    lore.position = 'after_char';
    lore.insertion_order = categoryOrder('物品', index);
    lore.priority = categoryPriority('物品');
    lore.prevent_recursion = true;
    lore.match_whole_words = true;
    lore.fromSkeleton = true;
    lore.skeletonExpanded = false;
    entries.push(lore);
  });

  // 3. Convert mainPlot.stages into a staged lorebook dispatcher + child entries.
  //    The dispatcher reads `getvar('stat_data.剧情.进度')` and pulls the matching
  //    child entry via getWorldInfo — gives progressive story disclosure driven by
  //    the `剧情.进度` MVU variable (which is added by saveAnalysisLorebookImport).
  const plotStages = analysis.mainPlot?.stages?.filter((s) => s.name?.trim()) ?? [];
  if (plotStages.length >= 2) {
    const dispatcherName = '剧情主线分阶段';
    const bookName = '__NOVEL_ANALYSIS__'; // Will be rewritten by WizardPage on import to match card name
    const premiseLines: string[] = [];
    if (analysis.mainPlot.premise?.trim()) {
      premiseLines.push('--- 剧情前提 ---');
      premiseLines.push(analysis.mainPlot.premise.trim());
      premiseLines.push('');
    }
    if (analysis.mainPlot.resolution?.trim()) {
      premiseLines.push('--- 结局收束 ---');
      premiseLines.push(analysis.mainPlot.resolution.trim());
      premiseLines.push('');
    }
    const premiseBlock = premiseLines.join('\n');

    // Build dispatcher via staged-lorebook-builder for EJS correctness
    const stages = plotStages.map((s) => ({
      name: s.name.trim(),
      // H12: Use escapeEjsSingleQuoted so a backslash in s.name can't combine
      // with quote-escaping to break out of the single-quoted JS string literal.
      condition: `=== '${escapeEjsSingleQuoted(s.name.trim())}'`,
      content: buildPlotStageContent(s),
    }));
    const dispatcherContent = buildPlotDispatcherContent('剧情.进度', stages, bookName, dispatcherName, premiseBlock);
    const dispatcher = {
      ...createEmptyLorebookEntry(),
      name: dispatcherName,
      comment: dispatcherName,
      content: dispatcherContent,
      enabled: true,
      constant: true,
      selective: true,
      insertion_order: 600,
      position: 'after_char' as const,
      depth: 3,
      priority: 95,
      probability: 100,
      fromSkeleton: true,
      skeletonExpanded: false,
    } as LorebookEntry;
    entries.push(dispatcher);

    // Child entries — disabled by default, only pulled by dispatcher
    stages.forEach((stage) => {
      const child = {
        ...createEmptyLorebookEntry(),
        name: `${dispatcherName}：${stage.name}`,
        comment: `${dispatcherName}：${stage.name}`,
        content: stage.content || `# ${stage.name} 阶段\n（请在此填写该阶段的具体内容）`,
        enabled: false,
        constant: false,
        selective: true,
        insertion_order: 100,
        position: 'after_char' as const,
        depth: 4,
        priority: 50,
        probability: 100,
        fromSkeleton: true,
        skeletonExpanded: false,
      } as LorebookEntry;
      entries.push(child);
    });
  }

  // 4. Convert easterEggs into disabled entries guarded by EJS — the entry's
  //    content is wrapped in `<%_ if (getvar('stat_data.彩蛋.{id}') === true) { _%>`
  //    so it only injects when the corresponding boolean flag has been flipped to
  //    true (e.g. by the card's updateRules after the trigger fires).
  //    The flag itself is added to MVU blueprints by saveAnalysisLorebookImport.
  //    H8: sanitize egg.id with sanitizeSegment so `'` or `\` in AI-generated
  //    ids can't break out of the single-quoted JS string literal in getvar(...).
  analysis.easterEggs.forEach((egg, index) => {
    if (!egg.id?.trim() || !egg.content?.trim()) return;
    const flagId = sanitizeSegment(egg.id.trim());
    if (!flagId) return;
    const varPath = `彩蛋.${flagId}`;
    const guardedContent = [
      `<%_ if (getvar('stat_data.${varPath}') === true) { _%>`,
      `--- 彩蛋：${egg.name || flagId} ---`,
      `触发条件：${egg.trigger || '（未指定）'}`,
      '',
      egg.content.trim(),
      `<%_ } _%>`,
    ].join('\n');
    const lore = {
      ...createEmptyLorebookEntry(),
      name: `彩蛋：${egg.name || flagId}`,
      comment: `[小说分析/彩蛋] ${egg.name || flagId} · 触发：${egg.trigger || '（未指定）'}`,
      keys: Array.isArray(egg.keys)
        ? egg.keys.map((k) => k.trim()).filter((k) => k.length >= 2)
        : [],
      content: guardedContent,
      enabled: true,
      constant: false,
      selective: true,
      insertion_order: 700 + index,
      position: 'after_char' as const,
      depth: 4,
      priority: 40,
      probability: 100,
      prevent_recursion: true,
      match_whole_words: true,
      fromSkeleton: true,
      skeletonExpanded: false,
    } as LorebookEntry;
    entries.push(lore);
  });

  return entries;
}

/** Build the content of a single main-plot stage child entry (knowledge-base style, not future-script). */
function buildPlotStageContent(stage: NovelPlotStage): string {
  const lines: string[] = [];
  lines.push(`# 剧情主线 · ${stage.name} 阶段`);
  if (stage.summary?.trim()) {
    lines.push('');
    lines.push('## 阶段简述');
    lines.push(stage.summary.trim());
  }
  if (stage.keyEvents?.length) {
    lines.push('');
    lines.push('## 关键事件（已发生）');
    stage.keyEvents.filter((e) => e?.trim()).forEach((e, i) => {
      lines.push(`${i + 1}. ${e.trim()}`);
    });
  }
  if (stage.climax?.trim()) {
    lines.push('');
    lines.push('## 阶段高潮');
    lines.push(stage.climax.trim());
  }
  return lines.join('\n');
}

/** Build the dispatcher content for the main-plot staged lorebook.
 *  Mirrors buildDispatcherContent from staged-lorebook-builder.ts but inlines
 *  the premise/resolution block before the dispatch logic. */
function buildPlotDispatcherContent(
  axisPath: string,
  stages: Array<{ name: string; condition?: string; content?: string }>,
  bookName: string,
  dispatcherName: string,
  premiseBlock: string,
): string {
  // Escape axisPath so a `'` or `\` in user/AI-provided paths can't break out of
  // the single-quoted JS string literal in getvar('stat_data.{axisPath}').
  const escapedAxisPath = escapeEjsSingleQuoted(axisPath);
  const rawExpr = `getvar('stat_data.${escapedAxisPath}')`;
  const suffix = dispatcherName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_');
  const rawVar = `__stagedRaw_${suffix}`;
  const valVar = `__stagedVal_${suffix}`;

  // Escape bookName and childComment so a `"` or `\` in user/AI-provided names
  // can't break out of the double-quoted JS string literal in getWorldInfo(...).
  const escapedBook = escapeEjsDoubleQuoted(bookName);

  const lines: string[] = [];
  if (premiseBlock) {
    lines.push(premiseBlock);
  }
  lines.push(`<%_ const ${rawVar} = ${rawExpr}; _%>`);
  lines.push(`<%_ const ${valVar} = Array.isArray(${rawVar}) ? ${rawVar}[0] : ${rawVar}; _%>`);
  lines.push(`<%_ if (${valVar} === undefined) { _%>`);
  lines.push(`<!-- 错误：阶段轴变量"${escapedAxisPath}"未定义，无法加载剧情主线分阶段内容。请在第 5 步启用 MVU 并初始化此变量。 -->`);
  stages.forEach((stage) => {
    // H12: Use escapeEjsSingleQuoted for fallback condition so a backslash in
    // stage.name can't break out of the single-quoted JS string literal.
    const cond = stage.condition || `=== '${escapeEjsSingleQuoted(stage.name)}'`;
    const childComment = `${dispatcherName}：${stage.name}`;
    const escapedComment = escapeEjsDoubleQuoted(childComment);
    lines.push(`<%_ } else if (${valVar} ${cond}) { _%>`);
    lines.push(`<%= await getWorldInfo("${escapedBook}", "${escapedComment}") _%>`);
  });
  lines.push('<%_ } else { _%>');
  lines.push(`<!-- 警告：阶段轴变量"${escapedAxisPath}"的值未匹配任何已定义阶段。 -->`);
  lines.push('<%_ } _%>');
  return lines.join('\n');
}

function categoryOrder(category: string, index: number): number {
  const base: Record<string, number> = {
    文风: 80,
    特殊设定: 120,
    人物: 300,
    人物逻辑: 320,
    人物外貌: 340,
    人物着装: 360,
    人物关系: 380,
    地点: 450,
    势力: 500,
    物品: 550,
    事件: 650,
    清洗: 900,
  };
  return (base[category] ?? 550) + index;
}

function categoryPriority(category: string): number {
  const priority: Record<string, number> = {
    文风: 95,
    特殊设定: 90,
    人物: 85,
    人物逻辑: 85,
    人物关系: 82,
    人物外貌: 75,
    人物着装: 70,
    事件: 70,
    地点: 60,
    势力: 60,
    物品: 60,
  };
  return priority[category] ?? 50;
}

/**
 * Build MVU variable blueprints from the structured analysis fields so the
 * wizard can auto-populate the MVU schema. Two kinds of variables:
 *  - `剧情.进度` (enum): one option per mainPlot stage name, default = first stage.
 *    Only emitted when mainPlot.stages has ≥2 entries (otherwise the dispatcher
 *    wasn't generated either, so the variable would be useless).
 *  - `彩蛋.{id}` (boolean): one per easter egg, default=false. The card's
 *    updateRules is expected to flip these to true when the trigger fires,
 *    which in turn lifts the EJS guard on the corresponding lorebook entry.
 */
export function buildAnalysisVariableBlueprints(analysis: NovelAnalysisResult): VariableBlueprint[] {
  const blueprints: VariableBlueprint[] = [];

  const stages = analysis.mainPlot?.stages?.filter((s) => s.name?.trim()) ?? [];
  if (stages.length >= 2) {
    const stageNames = stages.map((s) => s.name.trim());
    blueprints.push({
      path: '剧情.进度',
      type: 'enum',
      options: stageNames,
      default: stageNames[0],
      description: '剧情主线阶段轴。决定剧情主线分阶段世界书注入哪一段（由调度器读取）。',
    });
  }

  for (const egg of analysis.easterEggs ?? []) {
    const id = egg.id?.trim();
    if (!id) continue;
    // H8: sanitize egg.id so `'` or `\` in AI-generated ids can't break out of
    // the single-quoted JS string literal in setvar('stat_data.彩蛋.{id}', ...).
    // Consistent with the sanitization applied in analysisToLorebookEntries.
    const safeId = sanitizeSegment(id);
    if (!safeId) continue;
    blueprints.push({
      path: `彩蛋.${safeId}`,
      type: 'boolean',
      default: false,
      description: `彩蛋「${egg.name || safeId}」触发标志。默认 false；当卡片 updateRules 检测到触发条件时置为 true，对应彩蛋条目才会注入。触发条件：${egg.trigger || '（未指定）'}`,
    });
  }

  return blueprints;
}

export function saveAnalysisLorebookImport(
  title: string,
  analysis: NovelAnalysisResult,
): { entries: LorebookEntry[]; variableBlueprints: VariableBlueprint[] } {
  const entries = analysisToLorebookEntries(analysis);
  const variableBlueprints = buildAnalysisVariableBlueprints(analysis);
  try {
    sessionStorage.setItem(NOVEL_LOREBOOK_IMPORT_KEY, JSON.stringify({
      title,
      entries,
      variableBlueprints,
      createdAt: new Date().toISOString(),
    }));
  } catch {
    throw new Error('浏览器存储空间不足，无法导出分析结果。请关闭其他标签页或清理缓存后重试。');
  }
  return { entries, variableBlueprints };
}

export function consumeAnalysisLorebookImport(): {
  title: string;
  entries: LorebookEntry[];
  variableBlueprints: VariableBlueprint[];
} | null {
  try {
    const raw = sessionStorage.getItem(NOVEL_LOREBOOK_IMPORT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(NOVEL_LOREBOOK_IMPORT_KEY);

    const parsed = JSON.parse(raw) as {
      title?: string;
      entries?: LorebookEntry[];
      variableBlueprints?: VariableBlueprint[];
    };
    if (!Array.isArray(parsed.entries)) return null;
    return {
      title: parsed.title || '',
      entries: parsed.entries,
      variableBlueprints: Array.isArray(parsed.variableBlueprints) ? parsed.variableBlueprints : [],
    };
  } catch {
    return null;
  }
}
