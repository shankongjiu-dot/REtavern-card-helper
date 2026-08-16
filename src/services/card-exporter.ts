/**
 * Card Exporter - assembles SillyTavern Character Card V2 spec-compliant JSON.
 *
 * V2 Spec: https://github.com/malfoyslastname/character-card-spec-v2
 *
 * Architecture (per SillyTavern conventions):
 *   - `description`: Core character info → ALWAYS in prompt ("Permanent Tokens")
 *   - `personality`: Brief personality summary → ALWAYS in prompt
 *   - `scenario`: Dialogue circumstances → ALWAYS in prompt
 *   - `character_book` (World Book): Detailed character/world info stored as
 *     keyword-triggered entries, dynamically injected when keywords appear in chat.
 *     This is where the bulk of character detail SHOULD live for token efficiency.
 *   - `first_mes`: Opening message (sent once at chat start)
 *
 * The character_book is a character-specific lorebook that stacks with the
 * user's global World Info. It gets embedded in the card on export.
 *
 * 状态栏渲染方案：
 *   通过 regex_scripts 注入 SillyTavern 正则脚本：
 *     1. 状态栏界面：把 <StatusPlaceHolderImpl/> 替换成 HTML 状态栏（markdownOnly）
 *     2. 对AI隐藏状态栏：把占位符从 prompt 中删除（promptOnly）
 *   first_mes 末尾自动追加占位符，保证开场消息也会渲染状态栏。
 */
import { generateId, MVU_LOREBOOK_ENTRY_NAMES, REGEX_SCRIPT_NAMES, resolveBookName } from '../constants/defaults';
import type {
  WizardDraft,
  LorebookEntry,
  LorebookPosition,
  MvuConfig,
  MvuVariable,
  EjsEntryConfig,
  LiveStreamChatConfig,
  DraftPassthrough,
  LorebookEntryPassthrough,
} from '../constants/defaults';
import { deepClone } from '../utils/deep-clone';
import { buildMvuScriptBundle } from './mvu-builder';
import { migrateStagedDispatcherContent, alignStagedDispatcherBookName, escapeEjsSingleQuoted } from './staged-lorebook-builder';
import { findStagedLorebookEntryIndices, isCharacterDescriptionSynced } from './lorebook-predicates';
import { fixLorebookBlueGreenLights } from './card-fixers';

/**
 * Position string → numeric index mapping.
 * SillyTavern uses this numeric value internally for insertion position.
 * Reference: tavern-cards-forge DataReference.md PositionType table.
 *
 * IMPORTANT: The numeric order determines actual insertion order in the prompt:
 *   0=before_char → 1=after_char → 2=before_author → 3=after_author → 4=at_depth → 5=before_example → 6=after_example
 */
const POSITION_INDEX: Record<string, number> = {
  before_char: 0,           // before_character_definition
  after_char: 1,            // after_character_definition
  before_author: 2,         // before_author_note
  after_author: 3,          // after_author_note
  at_depth: 4,              // at_depth (ST runtime)
  before_example: 5,        // before_example_messages
  after_example: 6,         // after_example_messages
};

/** 反向映射：SillyTavern 数值 position → 本工具的字符串 position。与 POSITION_INDEX 一一对应。 */
const POSITION_FROM_INDEX: Record<number, LorebookPosition> = {
  0: 'before_char',
  1: 'after_char',
  2: 'before_author',
  3: 'after_author',
  4: 'at_depth',
  5: 'before_example',
  6: 'after_example',
};

/**
 * 还原条目的插入位置。
 *
 * SillyTavern 里 `extensions.position`（数值）才是权威值：V2 规范的 entry.position
 * 只有 before_char / after_char 两种取值，表达不了 at_depth 等位置，所以第三方卡的
 * at_depth 条目往往在 entry.position 上写着 after_char、真正的位置藏在 extensions.position=4。
 * 只读字符串会把 at_depth 静默降级成 after_char，这里按 ST 的优先级还原：
 *   extensions.position(数值/字符串) > entry.position(数值/字符串) > after_char
 */
function resolveEntryPosition(rawPosition: unknown, rawExtPosition: unknown): LorebookPosition {
  for (const candidate of [rawExtPosition, rawPosition]) {
    if (typeof candidate === 'number' && POSITION_FROM_INDEX[candidate]) {
      return POSITION_FROM_INDEX[candidate];
    }
    if (typeof candidate === 'string' && candidate in POSITION_INDEX) {
      return candidate as LorebookPosition;
    }
  }
  return 'after_char';
}

/**
 * SelectiveLogic string → numeric mapping.
 * Reference: tavern-cards-forge DataReference.md SelectiveLogic table.
 */
const SELECTIVE_LOGIC_INDEX: Record<number, number> = {
  0: 0,  // AND ANY → and_any
  1: 3,  // AND ALL → and_all
  2: 1,  // NOT ALL → not_all
  3: 2,  // NOT ANY → not_any
};

/** Reverse mapping: SillyTavern numeric → our UI index */
const SELECTIVE_LOGIC_REVERSE: Record<number, number> = {
  0: 0,  // and_any → AND ANY
  3: 1,  // and_all → AND ALL
  1: 2,  // not_all → NOT ALL
  2: 3,  // not_any → NOT ANY
};

/** Placeholder appended to first_mes and every AI reply for status bar rendering */
const STATUS_BAR_PLACEHOLDER = '<StatusPlaceHolderImpl/>';

/** Placeholder appended to first_mes for live stream chat panel rendering (independent of MVU) */
const LIVE_CHAT_PLACEHOLDER = '<LiveStreamChatImpl/>';

/** Prompt rule instructing AI to emit the live chat placeholder and generate viewer comments.
 *  The live chat panel is a "danmaku" overlay for the user only--characters cannot see it
 *  (fourth-wall boundary). AI generates viewer reactions based on plot progression via MVU. */
const LIVE_CHAT_PROMPT_RULE = `---
<live_chat_rule>
## 直播间弹幕面板（观众评论）

本面板是给用户看的"弹幕"，显示观众对剧情的实时评论。
**剧情里的角色看不到这个面板**--它存在于"第四面墙"之外，不影响正文叙事。
角色不会回应弹幕，弹幕也不会推进剧情。

### 你的任务
1. 在每条回复末尾、<UpdateVariable> 之后（若有），输出字面量 \`<LiveStreamChatImpl/>\` 占位符（独占一行）
2. 若 MVU 启用，在 <UpdateVariable> 的 <JSONPatch> 里 **替换** \`stat_data.直播间.评论\` 数组：
   - 用 \`{ "op": "replace", "path": "/直播间/评论", "value": [...] }\`
   - 根据当前剧情进展，生成 3-8 条观众评论（**替换整个数组**，不是 insert 追加）
   - 评论应反映"观众"视角：吃瓜、吐槽、玩梗、站队、猜测走向、情绪宣泄
   - 评论风格口语化、碎片化，像真实直播间弹幕（短句、表情、梗）
   - 每条评论是字符串，如 \`"前排吃瓜"\`, \`"这也太刺激了"\`, \`"主播冲鸭"\`
   - **每条回复都必须更新该数组**，即使剧情平淡也要生成 3-5 条日常弹幕
   - **禁止发送空数组** \`[]\`--这会清空面板，观众永远不沉默
3. 若回复末尾已有 \`<StatusPlaceHolderImpl/>\`，将 \`<LiveStreamChatImpl/>\` 紧跟其后（新行）

### 示例 JSONPatch
\`\`\`json
[
  { "op": "replace", "path": "/直播间/评论", "value": ["卧槽这剧情", "主播快跑", "吃瓜吃瓜", "反转了？", "6666"] }
]
\`\`\`

### 禁止
- 不要把弹幕内容写进正文叙事
- 不要让角色感知、回应或提及弹幕
- 不要用弹幕推进剧情或代替角色对话
- 不要用 \`insert\` 追加（会导致数组无限增长），必须用 \`replace\` 替换整个数组
- 不要发送空数组 \`[]\`
- 占位符不得省略、翻译或修改
</live_chat_rule>
---`;

/** 直播间评论变量在 MVU schema 里的路径 */
const LIVE_CHAT_COMMENT_PATH = '直播间.评论';

/**
 * 当直播间面板启用且 MVU 也启用时，向 MVU schema 注入 `直播间.评论` 变量。
 * 该变量是 z.array(z.string())，初始值取自 LiveStreamChatConfig.initialComments。
 * 这样 AI 通过 MVU 的 <UpdateVariable> 更新该数组后，面板运行时脚本会自动渲染弹幕。
 *
 * 返回一个新的 MvuConfig 副本（深拷贝），不修改原始 draft.mvu。
 * 若 schema 里已存在该路径的变量，则跳过注入（尊重用户手动配置）。
 */
function injectLiveChatVariable(mvu: MvuConfig, liveChat: LiveStreamChatConfig): MvuConfig {
  const cloned = deepClone(mvu);
  // 检查是否已存在该变量
  for (const section of cloned.schemaSections) {
    for (const v of section.variables) {
      if (v.path === LIVE_CHAT_COMMENT_PATH) return cloned; // 已存在，跳过
    }
  }
  // 注入到名为"直播间"的 section（或新建）
  let liveSection = cloned.schemaSections.find(s => s.name === '直播间');
  if (!liveSection) {
    liveSection = { name: '直播间', variables: [] };
    cloned.schemaSections.push(liveSection);
  }
  const initialComments = Array.isArray(liveChat.initialComments)
    ? liveChat.initialComments.filter(c => typeof c === 'string' && c.trim()).slice(0, 20)
    : [];
  const liveVar: MvuVariable = {
    path: LIVE_CHAT_COMMENT_PATH,
    zodType: 'z.array(z.string())',
    description: '直播间观众弹幕评论数组，每条回复根据剧情生成 3-8 条新评论（替换旧评论）',
    prefix: '',
    initialValue: initialComments,
  };
  liveSection.variables.push(liveVar);
  // 清空缓存字段，强制 zodTxt / initvarYaml 从 schemaSections 重新生成
  cloned.schemaTsContent = '';
  cloned.initvarYamlContent = '';
  return cloned;
}

/**
 * 判断 MVU 是否「实际启用」—— 即便 schema 为空，只要存在从导入卡还原的 MVU 内容
 * （initvar / updateRules / ejsPreprocess / statusBarHtml），就视为启用。
 *
 * 背景：cardToDraft 还原导入卡时 schemaSections 恒为 []、schemaTsContent 恒为 ''，
 * 但 initvarYamlContent / updateRulesYamlContent / ejsPreprocessContent / statusBarHtml
 * 会从世界书条目与正则脚本中恢复。若仅用 schema 判断启用状态，导入卡重新导出时
 * MVU 组件（脚本/正则/变量条目）会被全部丢弃。
 */
function isMvuEffectivelyEnabled(mvu: MvuConfig | undefined): boolean {
  if (!mvu?.enabled) return false;
  // 向导原生配置：有 schema 节或缓存 schema.ts
  if (mvu.schemaTsContent || (mvu.schemaSections?.length ?? 0) > 0) return true;
  // 导入卡还原内容：任一缓存字段非空即视为 MVU 实际启用
  return Boolean(
    mvu.initvarYamlContent ||
    mvu.updateRulesYamlContent ||
    mvu.ejsPreprocessContent ||
    mvu.statusBarHtml
  );
}

/** Default creator notes used when draft.creator_notes is empty */
const DEFAULT_CREATOR_NOTES = '本卡由「吟游手册」制作。\n请尊重创作者的劳动成果，本卡仅供个人娱乐与学习交流使用，严禁任何形式的商业用途、倒卖、转载售卖或未经授权的二次分发。';

/** extensions.depth_prompt 的空占位（本工具不提供深度提示词编辑，仅保持结构与 V3 参考卡一致） */
const DEFAULT_DEPTH_PROMPT = { prompt: '', depth: 4, role: 'system' };

// ── 导入字段直通层（passthrough）────────────────────────────────────────────
//
// 目标：第三方 ST 卡「导入 → 不修改 → 导出」应逐字段等价，而不是被本工具的
// 规范化流程静默抹平。做法是在 cardToDraft 里把「本工具不认识的字段」原样收进
// draft._passthrough / entry._passthrough，在 assembleCard 里先铺底再让本工具
// 生成的字段覆盖上去。
//
// 铁律：**已知字段永远以本工具的值为准**。直通层只填补空缺，不参与竞争。
// 唯一例外见 ENTRY_EXT_IMPORT_WINS_DEFAULTS —— 那几个字段本工具只会写死常量、
// 且没有任何 UI/草稿入口，用导入值更忠实且不影响本工具行为。

/** 本工具生成的正则脚本名。导出时写入、导入时按名剔除，避免直通层重复注入。 */
const OWN_REGEX_SCRIPT_NAMES = {
  hideVarUpdate: '对AI隐藏变量更新',
  varUpdatePending: '变量更新中美化',
  varUpdateDone: '变量更新美化',
  statusBar: REGEX_SCRIPT_NAMES.statusBar,
  hideStatusBar: '对AI隐藏状态栏',
  liveChat: REGEX_SCRIPT_NAMES.liveChat,
  hideLiveChat: '对AI隐藏直播间',
} as const;

/** assembleCard 自行生成的 data 层字段 —— 不进直通层，导出时以本工具的值为准 */
const OWN_DATA_KEYS: ReadonlySet<string> = new Set([
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
  'creator_notes', 'system_prompt', 'post_history_instructions', 'alternate_greetings',
  'character_book', 'tags', 'creator', 'character_version', 'extensions',
]);

/** 卡片信封层 / 应用层字段 —— 纯 V1 卡时 data 就是卡本身，这些绝不能被写进 data */
const CARD_ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  'spec', 'spec_version', 'data', '_meta', '_passthrough',
  'id', 'createdAt', 'updatedAt', 'deletedAt', 'coverImageBlob',
  'chat', 'create_date', 'json_data',
]);

/** buildCardExtensions / assembleCard 自行生成的 data.extensions 键 */
const OWN_CARD_EXT_KEYS: ReadonlySet<string> = new Set([
  'mvu_enabled', 'mvu_dependencies', 'mvu_schema_sections', 'mvu_has_status_bar',
  'mvu_has_ejs_preprocess', 'mvu_status_bar_style', 'mvu_status_bar_show_icons',
  'mvu_status_bar_options', 'live_stream_chat', 'regex_scripts', 'world',
]);

/** assembleCard 自行生成的 character_book 字段（extensions 不在其中：本工具只写 {}，
 *  第三方卡里的真实内容更有价值，交给直通层保留） */
const OWN_CHARACTER_BOOK_KEYS: ReadonlySet<string> = new Set([
  'name', 'description', 'scan_depth', 'token_budget', 'recursive_scanning', 'entries',
]);

/** assembleCard 自行生成的世界书条目根层级字段 */
const OWN_ENTRY_KEYS: ReadonlySet<string> = new Set([
  'id', 'keys', 'secondary_keys', 'content', 'name', 'enabled', 'insertion_order',
  'case_sensitive', 'selective', 'constant', 'position', 'priority', 'comment',
  'use_regex', 'extensions',
]);

/** buildSTExtensions 会从 draft 字段重新生成的 entry.extensions 键 —— 导出时本工具值优先。
 *  注意 automation_id / vectorized / delay_until_recursion 与一批 match_* 等
 *  无 UI 入口的字段刻意不在此列，见下方常量。 */
const OWN_ENTRY_EXT_KEYS: ReadonlySet<string> = new Set([
  'position', 'probability', 'group', 'group_override', 'group_weight',
  'selectiveLogic', 'role', 'depth', 'exclude_recursion', 'prevent_recursion',
  'match_whole_words', 'case_sensitive', 'sticky', 'cooldown', 'delay',
  'ignore_budget', 'display_index',
]);

/**
 * 本工具在 buildSTExtensions 里写死常量、且没有任何 UI/草稿入口的 ST 运行时字段。
 * 第三方卡带了非默认值时以卡里的为准；值等于这里的默认值时不必进直通层（保持草稿干净）。
 */
const ENTRY_EXT_IMPORT_WINS_DEFAULTS: Record<string, unknown> = {
  automation_id: '',
  vectorized: false,
  delay_until_recursion: false,
  // ST 真正的概率开关叫 useProbability（不是 use_probability）。本工具恒写 true
  // 且无 UI 入口，因此第三方卡的「关闭概率判定」必须以卡里的值为准，
  // 否则往返后会被翻转成按概率触发。
  useProbability: true,
  // 见 buildSTExtensions 里的说明：本工具写 null（继承书级），导入值优先。
  scan_depth: null,
  // S3：以下与 useProbability/scan_depth 完全同型——buildSTExtensions 写死常量、
  // 无任何 UI/草稿入口，此前在 OWN_ENTRY_EXT_KEYS 里会覆盖导入卡的非默认值。
  match_persona_description: false,
  match_character_description: false,
  match_character_personality: false,
  match_character_depth_prompt: false,
  match_scenario: false,
  match_creator_notes: false,
  triggers: [] as unknown[],
  outlet_name: '',
  use_group_scoring: false,
};

/** 导入值是否等于 IMPORT_WINS 默认值（相等则不进直通层）。triggers 是数组，须按内容比较。 */
function equalsImportWinsDefault(key: string, value: unknown): boolean {
  const def = ENTRY_EXT_IMPORT_WINS_DEFAULTS[key];
  if (Array.isArray(def)) return Array.isArray(value) && value.length === 0 && def.length === 0;
  return value === def;
}

/** 只接受普通对象；数组 / 字符串 / null 等畸形值一律当作空对象，避免被 Object.entries 拆成下标键。 */
function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/**
 * 取出 src 中不属于 ownKeys 的键；全部命中已知键时返回 undefined（避免往草稿里塞空对象）。
 * isDefault 用于跳过「值就是本工具默认值」的键。
 */
function collectUnknownKeys(
  src: unknown,
  ownKeys: ReadonlySet<string>,
  isDefault?: (key: string, value: unknown) => boolean,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  let found = false;
  for (const [key, value] of Object.entries(asRecord(src))) {
    if (ownKeys.has(key) || value === undefined) continue;
    if (isDefault?.(key, value)) continue;
    out[key] = value;
    found = true;
  }
  return found ? out : undefined;
}

/**
 * 导出前把直通层里属于本工具的键剔除掉。
 *
 * cardToDraft 收集时已经过滤过一遍，这里是纵深防御：本工具并非每次都会写出全部
 * 已知键（例如 MVU 关闭时 buildCardExtensions 返回 {}），仅靠展开顺序无法保证
 * 「已知字段以本工具的值为准」——一个陈旧的 mvu_enabled 就足以让 ST 误判。
 */
function stripOwnKeys(
  rawSrc: unknown,
  ownKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const src = asRecord(rawSrc);
  let needsFilter = false;
  for (const key of Object.keys(src)) {
    if (ownKeys.has(key)) { needsFilter = true; break; }
  }
  if (!needsFilter) return src;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (!ownKeys.has(key)) out[key] = value;
  }
  return out;
}

/** depth_prompt 只有空占位内容时不值得进直通层（本工具导出时会自己写同样的占位） */
function isPlaceholderDepthPrompt(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const prompt = (value as Record<string, unknown>).prompt;
  return prompt === undefined || prompt === '';
}

/**
 * 合并条目级 extensions：直通层铺底 → 本工具生成的字段覆盖 →
 * ENTRY_EXT_IMPORT_WINS_DEFAULTS 里的字段回到导入值。
 */
function mergeEntryExtensions(
  own: Record<string, unknown>,
  passthrough: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!passthrough) return own;
  const merged: Record<string, unknown> = { ...stripOwnKeys(passthrough, OWN_ENTRY_EXT_KEYS), ...own };
  // ENTRY_EXT_IMPORT_WINS_DEFAULTS 里的键不在 OWN_ENTRY_EXT_KEYS 中，故 stripOwnKeys 不会剔除它们
  for (const key of Object.keys(ENTRY_EXT_IMPORT_WINS_DEFAULTS)) {
    if (passthrough[key] !== undefined) merged[key] = passthrough[key];
  }
  return merged;
}

/** 导出后的世界书条目形状。索引签名用于承载条目根层级的直通字段。 */
type ExportedLorebookEntry = {
  id: number;
  keys: string[];
  secondary_keys: string[];
  content: string;
  name: string;
  enabled: boolean;
  insertion_order: number;
  case_sensitive: boolean;
  selective: boolean;
  constant: boolean;
  position: string;
  priority: number;
  comment: string;
  use_regex: boolean;
  extensions: Record<string, unknown>;
  [key: string]: unknown;
};

function buildFirstMessage(draft: WizardDraft): string {
  const base = draft.firstMessage || '';
  let result = base;

  // 如果有 MVU 变量且需要设置初始值，在开头添加 EJS setvar 调用
  // 与参考卡「银帷骑士团」一致：通过 setvar 设置初始值，不依赖 InitVar
  if (draft.mvu?.enabled && (draft.mvu.schemaSections?.length ?? 0) > 0) {
    const setvarCalls: string[] = [];
    for (const section of draft.mvu.schemaSections) {
      for (const v of section.variables) {
        // $ 前缀变量虽然不在状态栏显示，但仍需在 stat_data 中初始化，
        // 否则后续更新规则和 EJS 调度中 getvar 会得到 undefined。
        const initVal = v.initialValue;
        if (initVal !== undefined && initVal !== null && initVal !== '') {
          // H11: Escape v.path so a `'`, `\`, or `%>` in user/AI-provided
          // variable paths can't break out of the single-quoted JS string
          // literal in setvar('stat_data....', ...). Same vector as H10.
          const escapedPath = escapeEjsSingleQuoted(v.path);
          // 数字类型不引号，字符串类型需要引号
          if (v.zodType === 'z.coerce.number()') {
            const numVal = Number(initVal);
            setvarCalls.push(`setvar('stat_data.${escapedPath}', ${Number.isFinite(numVal) ? numVal : 0});`);
          } else if (v.zodType.startsWith('z.boolean(')) {
            const boolVal = initVal === true || initVal === 'true';
            setvarCalls.push(`setvar('stat_data.${escapedPath}', ${boolVal});`);
          } else {
            const escapedVal = escapeEjsSingleQuoted(initVal);
            setvarCalls.push(`setvar('stat_data.${escapedPath}', '${escapedVal}');`);
          }
        }
      }
    }
    if (setvarCalls.length > 0) {
      const setvarBlock = `<%_ ${setvarCalls.join(' ')} _%>`;
      result = result ? `${setvarBlock}\n${result}` : setvarBlock;
    }
  }

  return appendPlaceholders(draft, result);
}

/**
 * Append status bar and live chat placeholders to a message string.
 * Used for both first_mes and alternate_greetings so that every opening
 * message renders the status bar / live chat panel consistently.
 * - Enables placeholders when the feature is active (and not already present).
 * - Strips residual placeholders when the feature is disabled (user toggled off).
 */
/**
 * 移除消息中残留的占位符（用户先启用又禁用某功能时）。
 * 仅删除占位符本身及其追加时带上的前导换行，不 trim 正文、不折叠空行/段落，
 * 避免像 "Intro\n\n<Placeholder>\n\nMore" 被压成 "Intro\nMore"。
 */
function stripPlaceholder(text: string, placeholder: string): string {
  return text.split(`\n${placeholder}`).join('').split(placeholder).join('');
}

function appendPlaceholders(draft: WizardDraft, base: string): string {
  let result = base;

  // 只要状态栏已启用且存在模板/样式选择，就保留占位符；HTML 可在导出前由模板重新生成。
  const mvuStatusBarActive = draft.mvu?.enabled &&
    draft.mvu.statusBarStyle !== 'none' &&
    Boolean(draft.mvu.statusBarHtml?.trim());
  if (mvuStatusBarActive) {
    if (!result.includes(STATUS_BAR_PLACEHOLDER)) {
      result = result ? `${result}\n${STATUS_BAR_PLACEHOLDER}` : STATUS_BAR_PLACEHOLDER;
    }
  } else {
    // 移除残留的状态栏占位符（用户可能先启用又禁用）
    result = stripPlaceholder(result, STATUS_BAR_PLACEHOLDER);
  }

  // 直播间评论面板占位符：启用时追加，禁用时移除（独立于 MVU，纯正则驱动）
  const liveChatActive = draft.liveStreamChat?.enabled && draft.liveStreamChat.html?.trim();
  if (liveChatActive) {
    if (!result.includes(LIVE_CHAT_PLACEHOLDER)) {
      result = result ? `${result}\n${LIVE_CHAT_PLACEHOLDER}` : LIVE_CHAT_PLACEHOLDER;
    }
  } else {
    // 移除残留的直播面板占位符
    result = stripPlaceholder(result, LIVE_CHAT_PLACEHOLDER);
  }

  return result;
}

/**
 * Build card-level extensions object.
 *
 * 当 MVU 启用时，注册 SillyTavern 酒馆助手（JS-Slash-Runner）所需的：
 *   1. tavern_helper.scripts — MVU 主脚本 + Zod 校验脚本注册
 *   2. regex_scripts — 5 个正则脚本：
 *        - 对 AI 隐藏 <update> 变量更新标签
 *        - 美化 <update> 变量更新标签
 *        - 状态栏界面（替换占位符为 HTML）
 *        - 对AI隐藏状态栏（从 prompt 中删除占位符）
 *
 * 状态栏渲染通过 regex_scripts 实现，不是世界书条目。
 */

function buildCardExtensions(draft: WizardDraft, zodScript?: string): Record<string, unknown> {
  // 直播间评论面板独立于 MVU，纯正则驱动：只要任一启用就需要构建扩展
  const mvuEnabled = isMvuEffectivelyEnabled(draft.mvu);
  const liveChatEnabled = Boolean(draft.liveStreamChat?.enabled && draft.liveStreamChat.html?.trim());
  if (!mvuEnabled && !liveChatEnabled) return {};

  const deps: string[] = [];
  if (mvuEnabled) {
    deps.push('SillyTavern-MVU');
  }

  // ── 酒馆助手脚本注册（仅 MVU）──────────────────────────────────────
  // MVU 主脚本：加载 MagVarUpdate bundle.js，提供变量更新、Zod 校验等功能
  // Zod 脚本：内联的 Zod 4 校验脚本
  // 注意：
  //   - 脚本内容直接内联在 content 字段（酒馆助手要求字段名是 content，不是 script）
  //   - scripts 必须是数组，不是对象（JS-Slash-Runner 校验 z.array(ScriptTree)）
  //   - 每个脚本必须有 name 字段
  const tavernHelperScripts: unknown[] = [];

  if (mvuEnabled && draft.mvu) {
    // MVU 主脚本：从 CDN 加载 MagVarUpdate bundle
    // 锁定到 beta 分支提交 b428179（2026-07-20，与本地 magvarupdate 参考一致），
    // 避免 @beta 浮动引用导致已导出卡片的运行时行为漂移，支持 delta/move 操作
    tavernHelperScripts.push({
      type: 'script',
      name: 'MVU',
      content: "import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@b42817925d0391c15fa242a8238d2bbe28eb6319/artifact/bundle.js'",
      enabled: true,
      id: 'd0311ca6-5e9a-498e-a777-f74dc4dc6b12',
      info: '',
      button: {
        enabled: true,
        buttons: [
          { name: '重新处理变量', visible: true },
          { name: '重新读取初始变量', visible: true },
          { name: '清除旧楼层变量', visible: false },
          { name: '快照楼层', visible: false },
          { name: '重演楼层', visible: false },
          { name: '重试额外模型解析', visible: false },
        ],
      },
      data: {},
      export_with: { data: true, button: true },
    });
    // Zod 脚本内容（从 buildMvuScriptBundle 拿到的 zodTxt）
    tavernHelperScripts.push({
      type: 'script',
      name: 'Zod',
      content: zodScript || '', // 由 assembleCard 传入 bundle.zodTxt
      enabled: true,
      id: '5b3b09af-35e3-4149-a0f7-2f08776ed6a1',
      info: '',
      button: { enabled: true, buttons: [] },
      data: {},
      export_with: { data: true, button: true },
    });
  }

  // ── 正则脚本 ──────────────────────────────────────────────────────────
  const regexScripts: unknown[] = [];

  if (mvuEnabled && draft.mvu) {
    // 3 个正则脚本：对 AI 隐藏 / 美化 <update> 变量更新标签
    // 注意：SillyTavern 要求 regex_scripts 是数组，每个脚本有 scriptName 字段

    // 1. 对AI隐藏变量更新 — 移除 <update>...</update> 标签（AI 回复中的变量更新指令）
    regexScripts.push({
      id: 'aa12731a-97c4-4450-ac2f-0bfe1d6a4f64',
      scriptName: OWN_REGEX_SCRIPT_NAMES.hideVarUpdate,
      findRegex: '/<(update(?:variable)?)>(?:(?!.*<\\/\\1>)(?:(?!<\\1>).)*$|(?:(?!<\\1>).)*<\\/\\1?>)/gsi',
      replaceString: '',
      trimStrings: [],
      placement: [1, 2],
      disabled: false,
      markdownOnly: false,
      promptOnly: true,
      runOnEdit: false,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    });
    // 2. 变量更新中美化 — 未闭合的 <update> 标签美化
    regexScripts.push({
      id: 'b9d5f25b-a9d0-41bf-8a69-602d64bbde22',
      scriptName: OWN_REGEX_SCRIPT_NAMES.varUpdatePending,
      findRegex: '/<(update(?:variable)?)>(?!.*<\\/\\1>)\\s*((?:(?!<\\1>).)*)\\s*$/gsi',
      replaceString: '',
      trimStrings: [],
      placement: [1, 2],
      disabled: false,
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: false,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    });
    // 3. 变量更新美化 — 闭合的 <update>...</update> 标签美化
    regexScripts.push({
      id: '92d49340-fe5e-4929-871f-43d110e5ec76',
      scriptName: OWN_REGEX_SCRIPT_NAMES.varUpdateDone,
      findRegex: '/<(update(?:variable)?)>\\s*((?:(?!<\\1>).)*)\\s*<\\/\\1>/gsi',
      replaceString: '',
      trimStrings: [],
      placement: [1, 2],
      disabled: false,
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: false,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    });

    // 4. 状态栏界面 — 把占位符替换为 HTML 状态栏，只在界面显示（promptOnly=false, markdownOnly=true）
    // 使用 SillyTavern 内置的 {{format_message_variable::}} 宏直接读取 stat_data 值
    // （与可用卡「银帷骑士团」方案一致，不依赖 MVU InitVar 或 JS 渲染脚本）
    if (draft.mvu.statusBarHtml && draft.mvu.statusBarHtml.trim()) {
      const cleanedBase = draft.mvu.statusBarHtml
        .replace(/^@@render_after\s*\n?/, '')
        // 兼容旧版 AI 生成的 EJS getvar -> SillyTavern 内置 format_message_variable 宏
        .replace(/<%-\s*getvar\(\s*(['"])stat_data\.([^'"]+)\1\s*,\s*\{[^)]*\}\s*\)\s*%>/g, '{{format_message_variable::stat_data.$2}}')
        .replace(/<%-\s*getvar\(\s*(['"])stat_data\.([^'"]+)\1\s*\)\s*%>/g, '{{format_message_variable::stat_data.$2}}')
        // {{getvar::}} -> {{format_message_variable::}}（AI 可能生成 getvar 宏）
        .replace(/\{\{getvar::(stat_data\.[^}]+)\}\}/g, '{{format_message_variable::$1}}')
        // 旧版写卡站自定义 __MVU_VAR::...__ 标记 -> ST 内置 format_message_variable 宏
        .replace(/__MVU_VAR::(stat_data\..+?)__/g, '{{format_message_variable::$1}}')
        // CSS 中的 calc(... * 1%) 替换为直接使用宏输出的百分比
        .replace(/width:\s*max\s*\(\s*0%\s*,\s*calc\s*\(\s*\{\{format_message_variable::([^}]+)\}\}\s*\*\s*1%\s*\)\s*\)/gi, 'width:{{format_message_variable::$1}}%');
      // 确保 ```html 围栏存在：SillyTavern 只在 ```html 代码块中执行 <script type="module">
      // （与参考卡「二十一人会」状态栏美化脚本一致）
      const trimmedBase = cleanedBase.trim();
      const cleanHtml = /^```html/i.test(trimmedBase) && /```\s*$/.test(trimmedBase)
        ? cleanedBase
        : '```html\n' + cleanedBase + '\n```';
      // 注意：状态栏的 findRegex 写成不带斜杠的裸串（非 /.../gi 形式），
      // 与参考卡「银帷骑士团」一致。
      // 更正一处旧注释的说法：ST 并不是「对纯字符串做字面替换」——它的
      // regexFromString 里斜杠是可选的，裸串同样会被编译成正则。之所以一直没出问题，
      // 是因为 <StatusPlaceHolderImpl/> 里没有正则元字符，两种解释恰好等价。
      // （试聊侧的 chat-render.parseFindRegex 按同样规则处理裸串。）
      regexScripts.push({
        id: 'c5e7a8d9-1234-4a5b-9c6d-7e8f9a0b1c2d',
        scriptName: REGEX_SCRIPT_NAMES.statusBar,
        findRegex: STATUS_BAR_PLACEHOLDER,
        replaceString: cleanHtml,
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: true,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
      });

      // 5. 对AI隐藏状态栏 — 把占位符从 AI prompt 中删除
      regexScripts.push({
        id: 'd6f8b9e0-2345-4b6c-ad7e-8f9a0b1c2d3e',
        scriptName: OWN_REGEX_SCRIPT_NAMES.hideStatusBar,
        findRegex: '\\n?' + STATUS_BAR_PLACEHOLDER,
        replaceString: '',
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: false,
        promptOnly: true,
        runOnEdit: true,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
      });
    }
  }

  // ── 直播间评论面板正则脚本（独立于 MVU，纯正则驱动）─────────────────
  // 2 个正则脚本：把 <LiveStreamChatImpl/> 占位符替换为面板 HTML（界面显示），
  // 并从 AI prompt 中移除占位符。
  if (liveChatEnabled && draft.liveStreamChat) {
    // SillyTavern 只在 ```html 代码块中执行 <script type="module">
    // （与参考卡「二十一人会」状态栏美化脚本一致，replaceString 以 ```html 开头）
    // 导入时围栏被剥离（便于编辑），导出时重新包裹。
    const rawHtml = draft.liveStreamChat.html;
    const liveChatHtml = /^```html/i.test(rawHtml.trim())
      ? rawHtml
      : '```html\n' + rawHtml + '\n```';
    // 直播间界面 — 替换占位符为面板 HTML（仅界面显示，AI 不可见）
    regexScripts.push({
      id: 'e1a2b3c4-5678-9abc-def0-1234567890ab',
      scriptName: REGEX_SCRIPT_NAMES.liveChat,
      findRegex: LIVE_CHAT_PLACEHOLDER,
      replaceString: liveChatHtml,
      trimStrings: [],
      placement: [2],
      disabled: false,
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: true,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    });
    // 对AI隐藏直播间 — 把占位符从 AI prompt 中删除
    regexScripts.push({
      id: 'f2b3c4d5-6789-abcd-ef01-2345678901bc',
      scriptName: OWN_REGEX_SCRIPT_NAMES.hideLiveChat,
      findRegex: LIVE_CHAT_PLACEHOLDER,
      replaceString: '',
      trimStrings: [],
      placement: [2],
      disabled: false,
      markdownOnly: false,
      promptOnly: true,
      runOnEdit: true,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    });
  }

  const result: Record<string, unknown> = {};

  if (mvuEnabled && draft.mvu) {
    result.mvu_enabled = true;
    result.mvu_dependencies = deps;
    result.mvu_schema_sections = draft.mvu.schemaSections.length;
    result.mvu_has_status_bar = Boolean(draft.mvu.statusBarHtml);
    result.mvu_has_ejs_preprocess = Boolean(draft.mvu.ejsPreprocessContent);
    // 持久化状态栏样式与选项，导入时不再丢失原始配置（旧版导入仅靠 mvu_has_status_bar
    // 布尔值推断会得到无效的 'minimal-dark'，导致 UI 找不到模板）
    result.mvu_status_bar_style = draft.mvu.statusBarStyle || '';
    result.mvu_status_bar_show_icons = Boolean(draft.mvu.statusBarShowIcons);
    if (draft.mvu.statusBarOptions) {
      result.mvu_status_bar_options = draft.mvu.statusBarOptions;
    }
    // 酒馆助手脚本注册
    if (tavernHelperScripts.length > 0) {
      result.tavern_helper = { scripts: tavernHelperScripts, variables: {} };
    }
  }

  // 正则脚本（MVU + 直播间面板合并）
  if (regexScripts.length > 0) {
    result.regex_scripts = regexScripts;
  }

  // 直播间评论面板配置元数据（用于导入时恢复完整配置，不依赖从 HTML 反解析）
  if (liveChatEnabled && draft.liveStreamChat) {
    result.live_stream_chat = {
      enabled: true,
      themeId: draft.liveStreamChat.themeId || 'terminal',
      title: draft.liveStreamChat.title || '直播间',
      maxVisible: draft.liveStreamChat.maxVisible ?? 10,
      initialComments: (draft.liveStreamChat.initialComments ?? []).filter((s) => s.trim()),
    };
  }

  return result;
}

/**
 * Build SillyTavern runtime extensions object for a lorebook entry.
 * This is the common structure shared by both wizard entries and generated character entries.
 * Format aligned with CardForge createEmptyWorldEntry + SillyTavern world-info.
 */
function buildSTExtensions(overrides: {
  position: string;
  displayIndex: number;
  probability?: number;
  group?: string;
  groupWeight?: number;
  selectiveLogic?: number;
  role?: number;
  depth?: number;
  excludeRecursion?: boolean;
  preventRecursion?: boolean;
  caseSensitive?: boolean | null;
  sticky?: number;
  cooldown?: number;
  delay?: number;
  ignoreBudget?: boolean;
  matchWholeWords?: boolean | null;
} = {
  position: 'after_char',
  displayIndex: 0,
}): Record<string, unknown> {
  return {
    position: POSITION_INDEX[overrides.position] ?? 1,
    probability: overrides.probability ?? 100,
    useProbability: true,
    group: overrides.group ?? '',
    group_override: false,
    group_weight: overrides.groupWeight ?? 100,
    selectiveLogic: SELECTIVE_LOGIC_INDEX[overrides.selectiveLogic ?? 0] ?? 0,
    role: overrides.role ?? 0,
    depth: overrides.depth ?? 4,
    // scan_depth 与 depth 在 ST 里是两回事：depth 是 position=at_depth 的插入楼层，
    // scan_depth 才是该条目的关键词扫描深度。此前用 depth 派生 scan_depth 是把两个
    // 语义混成一个，会静默改写导入卡的扫描窗口。草稿模型里没有独立的 per-entry
    // 扫描深度字段，因此写 null = 继承 character_book.scan_depth（本工具在书级设置它）。
    // 第三方卡自带的 scan_depth 由 ENTRY_EXT_IMPORT_WINS_DEFAULTS 保留。
    scan_depth: null,
    exclude_recursion: overrides.excludeRecursion ?? false,
    prevent_recursion: overrides.preventRecursion ?? true,
    delay_until_recursion: false,
    // 保留用户在 UI 中设置的整词匹配偏好；未指定时回退到 null（让 ST 使用其默认）。
    match_whole_words: overrides.matchWholeWords === undefined ? null : overrides.matchWholeWords,
    use_group_scoring: false,
    case_sensitive: overrides.caseSensitive ?? null,
    automation_id: '',
    sticky: overrides.sticky ?? 0,
    cooldown: overrides.cooldown ?? 0,
    delay: overrides.delay ?? 0,
    match_persona_description: false,
    match_character_description: false,
    match_character_personality: false,
    match_character_depth_prompt: false,
    match_scenario: false,
    match_creator_notes: false,
    triggers: [],
    ignore_budget: overrides.ignoreBudget ?? false,
    vectorized: false,
    outlet_name: '',
    display_index: overrides.displayIndex,
  };
}

export function assembleCard(draft: WizardDraft, existingId?: number) {
  // ── Export mode: worldbook-first ───────────────────────────────
  // Character content is injected through draft.lorebookEntries, which is
  // synchronized by the wizard before preview/save.

  // MVU 未启用时，普通世界书条目中的 MVU 资产也应被过滤掉，避免污染未启用 MVU 的卡片。
  const mvuEnabled = isMvuEffectivelyEnabled(draft.mvu);
  // 过滤掉已不存在于当前世界书中的 entryIds，避免下次编辑时生成重复条目。
  const validEntryIds = new Set(draft.lorebookEntries.map((e) => e.id));
  // 世界书名唯一来源：character_book.name、extensions.world 与分阶段调度条目的
  // getWorldInfo 书名参数必须三处一致，否则 ST 里「阶段不切换」（见 resolveBookName）。
  const bookName = resolveBookName(draft);

  // ── Build `description` ─────────────────────────────────────────────────
  // worldbook-first：向导正常流程里角色描述总会被 syncCharacterEntries 转成世界书
  // 条目（跨步骤 3 时注入），description 保持 ''。
  // 例外：第三方导入卡走「cardToDraft → assembleCard」直接归一化路径时没人做同步，
  // 原 data.description 会被彻底丢掉。对「有描述但未同步进世界书」的角色把描述
  // 写回 data.description 保住保真。
  //
  // 判定用 isCharacterDescriptionSynced（lorebook-predicates，与 token-budget 共用）：
  // 按角色限定候选条目 + 覆盖率，而不是「entryIds 命中」或「任意条目内容是描述子串」。
  // entryIds 通道单独不可靠——导出会把条目 id 重排成 1..N（下方 _meta 已按新 id 重映射，
  // 但历史卡里存的仍是草稿 id）；「任意子串」则会误杀第三方卡里复述过世界书内容的描述。
  const description = (draft.characters || [])
    .filter((c) => (c.description || '').trim())
    .filter((c) => !(c.entryIds || []).some((id) => validEntryIds.has(id)))
    .filter((c) => !isCharacterDescriptionSynced(c.name, c.description || '', draft.lorebookEntries))
    .map((c) => c.description.trim())
    .join('\n\n');
  // personality 本工具不产出（无 UI 入口），仅为第三方导入卡做往返直通
  const personality = draft.personality || '';

  // ── Build character_book entries (V2 CharacterBook format) ─────────────
  // V2 spec fields go directly on the entry.
  // SillyTavern runtime fields go in `extensions` (preserved by ST on import).
  // 兼容旧版分阶段调度条目：无后缀变量名在多角色卡中会重复声明，导出前统一迁移；
  // 调度条目里的 getWorldInfo 书名同步对齐当前导出书名（旧卡烤死的书名会失效）。
  const migratedLorebookEntries = draft.lorebookEntries.map((entry) => ({
    ...entry,
    content: alignStagedDispatcherBookName(migrateStagedDispatcherContent(entry.content || ''), bookName),
  }));
  // 导出前自动修复蓝绿灯问题（绿灯无 keys、selective 无 secondary_keys 等）
  const fixedLorebookEntries = fixLorebookBlueGreenLights(migratedLorebookEntries);
  const stagedIndices = findStagedLorebookEntryIndices(fixedLorebookEntries);
  // 草稿条目 id → 导出条目 id。导出会把 id 重排成 1..N，而 _meta.characters[].entryIds
  // 此前存的是草稿 id——两个集合在任何一次往返后必然零交集，让「角色是否已同步」的
  // entryIds 通道结构性失效（也让 syncCharacterEntries 的 id 复用通道永远落到名称兜底）。
  const exportedIdBySourceId = new Map<string, number>();
  const entries: ExportedLorebookEntry[] = fixedLorebookEntries
    .filter((entry, idx) => {
      // MVU 系统条目无论是否启用 MVU 都剔除：启用时由 buildMvuScriptBundle 重新生成，
      // 保留旧条目会导致同名条目重复（往返保真度 bug：导入的旧条目 + 重新生成的条目）。
      if (MVU_LOREBOOK_ENTRY_NAMES.includes(entry.name)) return false;
      if (mvuEnabled) return true;
      // MVU 未启用时，分阶段世界书的调度条目和子阶段条目也不导出
      return !stagedIndices.has(idx);
    })
    .sort((a, b) => (a.insertion_order ?? 0) - (b.insertion_order ?? 0))
    .map((entry, i) => {
      exportedIdBySourceId.set(entry.id, i + 1);
      return ({
    // 直通层铺底：导入卡里本工具不认识的条目级字段。下面的已知字段一律覆盖它。
    ...stripOwnKeys(entry._passthrough?.root ?? {}, OWN_ENTRY_KEYS),
    id: i + 1,
    keys: entry.keys,
    secondary_keys: entry.secondary_keys || [],
    content: entry.content,
    name: entry.name || `Entry ${i + 1}`,
    enabled: entry.enabled,
    insertion_order: entry.insertion_order ?? i,
    case_sensitive: entry.case_sensitive ?? false,
    selective: entry.selective ?? false,
    constant: entry.constant ?? false,
    position: entry.position ?? 'after_char',
    priority: entry.priority ?? 0,
    comment: entry.comment || entry.name || '',
    use_regex: entry.use_regex ?? false,
    extensions: mergeEntryExtensions(buildSTExtensions({
      position: entry.position ?? 'after_char',
      displayIndex: i,
      probability: entry.probability ?? 100,
      group: entry.group || '',
      groupWeight: entry.group_weight ?? 100,
      selectiveLogic: entry.selectiveLogic ?? 0,
      role: entry.role ?? 0,
      depth: entry.depth ?? 4,
      excludeRecursion: entry.exclude_recursion ?? false,
      preventRecursion: entry.prevent_recursion ?? false,
      caseSensitive: entry.case_sensitive ? true : null,
      sticky: entry.sticky,
      cooldown: entry.cooldown,
      delay: entry.delay,
      ignoreBudget: entry.ignore_budget ?? false,
      matchWholeWords: entry.match_whole_words,
    }), entry._passthrough?.extensions),
      });
    });

  // ── MVU entries (embedded when MVU is enabled) ──────────────────────────
  // 入口条件：MVU 启用 且 (有 schemaTsContent 或 schemaSections 非空)
  // buildMvuScriptBundle 内部会兜底生成缺失的 schemaTs/initvar/updateRules
  let mvuEntryOffset = entries.length;
  let mvuBundle: ReturnType<typeof buildMvuScriptBundle> | null = null;
  // 直播间面板启用时，需要让 AI 在每条回复末尾输出占位符，否则面板只在 first_mes 出现一次。
  const liveChatEnabled = Boolean(draft.liveStreamChat?.enabled && draft.liveStreamChat.html?.trim());
  if (mvuEnabled && draft.mvu) {
    // 直播间 + MVU 同时启用：注入 `直播间.评论` 变量到 schema，让 AI 能通过 <UpdateVariable> 更新弹幕
    const mvuForBundle = (liveChatEnabled && draft.liveStreamChat)
      ? injectLiveChatVariable(draft.mvu, draft.liveStreamChat)
      : draft.mvu;
    const bundle = buildMvuScriptBundle(mvuForBundle);
    // MVU 启用 + 直播间启用：把直播间规则追加到变量输出格式条目末尾，让 AI 同时输出两个占位符
    if (liveChatEnabled) {
      bundle.variableOutputFormat = `${bundle.variableOutputFormat}\n${LIVE_CHAT_PROMPT_RULE}`;
    }
    mvuBundle = bundle;

    // EJS预处理 — EJS preprocess entry (only when there are EJS configs using variables)
    if (bundle.ejsPreprocess) {
      mvuEntryOffset++;
      entries.push({
        id: mvuEntryOffset,
        keys: [],
        secondary_keys: [],
        content: bundle.ejsPreprocess,
        name: 'EJS预处理',
        enabled: true,
        insertion_order: 180,
        case_sensitive: false,
        selective: false,
        constant: true,
        position: 'after_char',
        priority: 100,
        comment: 'EJS 变量预处理',
        use_regex: true,
        extensions: buildSTExtensions({
          position: 'at_depth',
          displayIndex: mvuEntryOffset,
          depth: 0,
          preventRecursion: true,
          excludeRecursion: true,
        }),
      });
    }

    // [mvu_update]变量更新规则 — AI update rules (bare YAML, at_depth/0 for MVU parser)
    if (bundle.updateRulesYaml) {
      mvuEntryOffset++;
      entries.push({
        id: mvuEntryOffset,
        keys: [],
        secondary_keys: [],
        content: bundle.updateRulesYaml,
        name: '[mvu_update]变量更新规则',
        enabled: true,
        insertion_order: 190,
        case_sensitive: false,
        selective: false,
        constant: true,
        position: 'after_char',
        priority: 100,
        comment: '[mvu_update]变量更新规则',
        use_regex: true,
        extensions: buildSTExtensions({
          position: 'at_depth',
          displayIndex: mvuEntryOffset,
          depth: 0,
          preventRecursion: true,
          excludeRecursion: true,
        }),
      });
    }

    // [InitVar]请勿打开 — initial variable values (disabled by default, like reference card)
    // 初始值通过 first_mes 中的 EJS setvar 设置，InitVar 仅作为禁用回退
    if (bundle.initvarYaml) {
      mvuEntryOffset++;
      entries.push({
        id: mvuEntryOffset,
        keys: [],
        secondary_keys: [],
        content: bundle.initvarYaml,
        name: '[InitVar]请勿打开',
        enabled: false,
        insertion_order: 200,
        case_sensitive: false,
        selective: false,
        constant: true,
        position: 'after_char',
        priority: 100,
        comment: '[InitVar]请勿打开',
        use_regex: true,
        extensions: buildSTExtensions({
          position: 'at_depth',
          displayIndex: mvuEntryOffset,
          depth: 0,
          preventRecursion: true,
          excludeRecursion: true,
        }),
      });
    }

    // 脚本/MVU.txt 和 脚本/Zod.txt 不作为世界书条目
    // 它们的内容直接内联在 extensions.tavern_helper.scripts 里（酒馆助手脚本区）
    // 状态栏 HTML 通过 regex_scripts 替换 <StatusPlaceHolderImpl/> 占位符，见 buildCardExtensions

    // MVU 变量列表 — Variable list (at_depth/0, 与参考卡「二十一人会」一致)
    if (bundle.variableList) {
      mvuEntryOffset++;
      entries.push({
        id: mvuEntryOffset,
        keys: [],
        secondary_keys: [],
        content: bundle.variableList,
        name: 'MVU 变量列表',
        enabled: true,
        insertion_order: 2001,
        case_sensitive: false,
        selective: false,
        constant: true,
        position: 'after_char',
        priority: 100,
        comment: 'MVU 变量列表',
        use_regex: false,
        extensions: buildSTExtensions({
          position: 'at_depth',
          displayIndex: mvuEntryOffset,
          depth: 0,
          preventRecursion: true,
          excludeRecursion: false,
        }),
      });
    }

    // MVU 变量输出格式 — Full output format with XML tags (at_depth/0, 与参考卡一致)
    // Contains <update_variable_rules>, <status_bar_rule>, <status_current_variable>
    if (bundle.variableOutputFormat) {
      mvuEntryOffset++;
      entries.push({
        id: mvuEntryOffset,
        keys: [],
        secondary_keys: [],
        content: bundle.variableOutputFormat,
        name: 'MVU 变量输出格式',
        enabled: true,
        insertion_order: 2002,
        case_sensitive: false,
        selective: false,
        constant: true,
        position: 'after_char',
        priority: 100,
        comment: 'MVU 变量输出格式',
        use_regex: false,
        extensions: buildSTExtensions({
          position: 'at_depth',
          displayIndex: mvuEntryOffset,
          depth: 0,
          preventRecursion: true,
          excludeRecursion: false,
        }),
      });
    }

    // 状态栏通过 regex_scripts 实现，不放在世界书条目里
  }

  // 直播间面板启用但 MVU 未启用时：创建独立的常驻世界书条目注入 <live_chat_rule>，
  // 让 AI 在每条回复末尾输出 <LiveStreamChatImpl/> 占位符。
  if (!mvuEnabled && liveChatEnabled) {
    mvuEntryOffset++;
    entries.push({
      id: mvuEntryOffset,
      keys: [],
      secondary_keys: [],
      content: LIVE_CHAT_PROMPT_RULE,
      name: '直播间面板规则',
      enabled: true,
      insertion_order: 2002,
      case_sensitive: false,
      selective: false,
      constant: true,
      position: 'after_char',
      priority: 100,
      comment: '直播间面板规则',
      use_regex: false,
      extensions: buildSTExtensions({
        position: 'after_char',
        displayIndex: mvuEntryOffset,
        depth: 4,
        preventRecursion: true,
        excludeRecursion: false,
      }),
    });
  }

  const now = new Date();

  // ── 导入字段直通层 ──────────────────────────────────────────────────────
  // 铺底顺序：直通层 → 本工具生成的字段（覆盖）。已知字段永远以本工具的值为准。
  const passthrough: DraftPassthrough = draft._passthrough ?? {};
  const passData = stripOwnKeys(
    stripOwnKeys(passthrough.data ?? {}, OWN_DATA_KEYS),
    CARD_ENVELOPE_KEYS,
  );
  const passCardExt = stripOwnKeys(passthrough.extensions ?? {}, OWN_CARD_EXT_KEYS);
  const passCharBook = stripOwnKeys(passthrough.characterBook ?? {}, OWN_CHARACTER_BOOK_KEYS);
  const ownCardExt = buildCardExtensions(draft, mvuBundle?.zodTxt);
  // 正则脚本：本工具生成的在前，第三方脚本按原顺序追加在后（导入时已按名去重）
  const mergedRegexScripts = [
    ...((ownCardExt.regex_scripts as unknown[] | undefined) ?? []),
    ...(passthrough.regexScripts ?? []),
  ];

  return {
    // Preserve existing id for edits
    ...(existingId ? { id: existingId } : {}),

    // ── Tavern V3 spec envelope ──────────────────────────────────────────
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      // 第三方卡的未知 data 字段铺底（V3 assets / nickname / group_only_greetings 等）
      ...passData,

      // V1 fields (nested inside data for V2/V3)
      name: draft.cardName,
      description,
      personality,
      scenario: draft.scenario || '',
      first_mes: buildFirstMessage(draft),
      // 对话示例（V2/V3 规范字段）——试聊与 ST 都会读它，必须完整导出
      mes_example: draft.mes_example || '',

      // V2 new fields
      creator_notes: draft.creator_notes?.trim() || DEFAULT_CREATOR_NOTES,
      system_prompt: draft.system_prompt || '',
      post_history_instructions: draft.post_history_instructions || '',
      alternate_greetings: (draft.alternate_greetings || []).map((g) => appendPlaceholders(draft, g)),
      character_book: {
        ...passCharBook,
        name: bookName,
        description: draft.bookDescription || '',
        scan_depth: draft.bookScanDepth ?? 200,
        token_budget: draft.bookTokenBudget ?? 40000,
        recursive_scanning: draft.bookRecursiveScanning ?? false,
        extensions: asRecord(passCharBook.extensions),
        entries,
      },
      tags: draft.tags || [],
      creator: draft.creator || '',
      character_version: draft.character_version || '1.0',
      extensions: {
        // depth_prompt: 空内容占位，保持与 SillyTavern V3 规范一致（参考卡「二十一人会」含此字段）。
        // 放在直通层之前，第三方卡里真正写了内容的 depth_prompt 会覆盖这个占位。
        depth_prompt: DEFAULT_DEPTH_PROMPT,
        // 第三方 / 非本工具生成的扩展铺底（自定义正则以外的扩展键）
        ...passCardExt,
        // 本工具生成的扩展始终优先
        ...ownCardExt,
        // 正则脚本需要合并而非覆盖：本工具的 + 第三方保留的
        ...(mergedRegexScripts.length > 0 ? { regex_scripts: mergedRegexScripts } : {}),
        // SillyTavern uses extensions.world to link the character to its
        // world info file. Without it, ST doesn't auto-load the world book
        // on character selection, forcing a manual reload each time.
        // 必须与 character_book.name 保持相等（有测试锁这个不变式）
        world: bookName,
      },
    },

    // ── App-level metadata (NOT part of Tavern spec, for re-editing) ─────
    _meta: {
      characters: draft.characters.map((c) => ({
        id: c.id || generateId(),
        name: c.name,
        description: c.description,
        // 保存 constant 以便重新打开卡时恢复蓝灯/绿灯设置
        constant: c.constant,
        // 存**导出后**的条目 id：导出把 id 重排成 1..N，存草稿 id 会让重新打开卡时
        // entryIds 与 lorebookEntries 必然对不上（角色的「已同步」判定与 id 复用双双失效）。
        // 映射命中严格强于旧的 validEntryIds 过滤——被过滤掉的条目（MVU 未启用时的
        // 分阶段条目等）本就不在映射里。
        entryIds: (c.entryIds || [])
          .map((id) => exportedIdBySourceId.get(id))
          .filter((id): id is number => id !== undefined)
          .map(String),
      })),
    },

    // Timestamps
    name: draft.cardName,
    createdAt: now,
    updatedAt: now,
    deletedAt: null as Date | null,
  };
}

/**
 * Download a JSON file to the user's device.
 * Exports with V1 legacy top-level fields + V2 data block.
 * This matches SillyTavern's expected import format AND CardForge's export format.
 */
export function exportAsJson(card: ReturnType<typeof assembleCard>) {
  const d = card.data;
  const exportObj = {
    // V1 legacy fields at top level (for backward compatibility)
    name: d.name,
    description: d.description,
    personality: d.personality,
    scenario: d.scenario,
    first_mes: d.first_mes,
    mes_example: d.mes_example,
    creatorcomment: d.creator_notes,
    avatar: 'none',
    talkativeness: '0.5',
    fav: false,
    tags: d.tags || [],
    // V2 spec envelope
    spec: card.spec,
    spec_version: card.spec_version,
    data: d,
    // App-level metadata (not part of the Tavern spec) for re-editing.
    _meta: card._meta,
    create_date: new Date().toISOString(),
  };

  const json = JSON.stringify(exportObj, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${d.name || 'character-card'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export card as PNG with embedded JSON (SillyTavern standard format).
 * Optionally uses a user-provided PNG as the base image.
 * If no PNG provided, generates a minimal placeholder PNG.
 */
export async function exportAsPng(
  card: ReturnType<typeof assembleCard>,
  pngBuffer?: ArrayBuffer,
) {
  const { embedJsonInPng, downloadPng } = await import('./png-service');

  // Only embed the Tavern spec portion (no _meta, no timestamps)
  // V3 spec requires V1 fields duplicated at root level for backward compatibility
  const d = card.data;
  const specData = {
    // Root-level V1 fields (for V1/V3 compatibility)
    name: d.name,
    description: d.description,
    personality: d.personality,
    scenario: d.scenario,
    first_mes: d.first_mes,
    mes_example: d.mes_example ?? '',
    creatorcomment: d.creator_notes ?? '',
    avatar: 'none',
    talkativeness: '0.5',
    fav: false,
    tags: d.tags ?? [],
    // V3 spec envelope
    spec: card.spec,
    spec_version: card.spec_version,
    data: d,
  };
  const pngData = embedJsonInPng(pngBuffer || null, specData);
  downloadPng(pngData, card.data.name || 'character-card');
}

/**
 * Import a character card from a PNG file (SillyTavern format).
 * Extracts embedded JSON from the PNG tEXt chunk.
 * @returns The character card object, or null if no data found.
 */
export async function importFromPng(
  pngBuffer: ArrayBuffer,
): Promise<Record<string, unknown> | null> {
  const { extractJsonFromPng } = await import('./png-service');
  return extractJsonFromPng(pngBuffer);
}

/**
 * Reconstruct MVU config from saved card data.
 * Checks extensions for MVU metadata and lorebook entries for MVU content.
 */
function reconstructMvuConfig(
  data: Record<string, unknown>,
  rawEntries: Array<Record<string, unknown>>,
): MvuConfig | undefined {
  const ext = (data.extensions || {}) as Record<string, unknown>;

  // If MVU was never enabled, skip
  if (!ext.mvu_enabled) return undefined;

  // Extract MVU content from lorebook entries by name
  const mvuEntries = rawEntries.filter(
    e => MVU_LOREBOOK_ENTRY_NAMES.includes((e.name as string) || '')
      || MVU_LOREBOOK_ENTRY_NAMES.includes((e.comment as string) || '')
  );

  const schemaTsContent = '';
  let initvarYamlContent = '';
  let updateRulesYamlContent = '';
  let ejsPreprocessContent = '';
  let statusBarHtml = '';

  for (const entry of mvuEntries) {
    const name = (entry.name as string) || '';
    const content = (entry.content as string) || '';
    if (name === '[InitVar]请勿打开') initvarYamlContent = content;
    else if (name === '[mvu_update]变量更新规则') updateRulesYamlContent = content;
    else if (name === 'EJS预处理') ejsPreprocessContent = content;
  }

  // Recover status bar HTML from extensions
  const regexScripts = (ext.regex_scripts || []) as Array<Record<string, unknown>>;
  for (const script of regexScripts) {
    if ((script.scriptName as string) === REGEX_SCRIPT_NAMES.statusBar) {
      statusBarHtml = ((script.replaceString as string) || '')
        .replace(/^```html\s*/i, '')
        .replace(/\s*```\s*$/i, '');
      break;
    }
  }

  // Reconstruct ejsConfigs by scanning all entries for EJS patterns.
  // This restores the association lost during export (ejsConfigs is not persisted
  // to extensions). Complexity is inferred from content patterns:
  //   - getWorldInfo( → '分阶段调度'
  //   - @@if → '显隐'
  //   - <%_? if / else if → '段落控制'
  //   - <%= → '动态文本'
  const ejsConfigs: EjsEntryConfig[] = [];
  for (const entry of rawEntries) {
    const content = (entry.content as string) || '';
    if (!content.includes('<%') && !content.includes('@@if') && !content.includes('getWorldInfo')) continue;
    const entryId = entry.id != null ? String(entry.id) : '';
    if (!entryId) continue;

    let complexity: EjsEntryConfig['complexity'];
    if (content.includes('getWorldInfo(')) {
      complexity = '分阶段调度';
    } else if (content.includes('@@if')) {
      complexity = '显隐';
    } else if (/<%_?\s*(if|else)/.test(content)) {
      complexity = '段落控制';
    } else if (content.includes('<%=')) {
      complexity = '动态文本';
    } else {
      continue;
    }

    // Extract used variables from getvar('stat_data.XXX[0]') patterns
    const usedVars = Array.from(
      content.matchAll(/getvar\(\s*'stat_data\.([^[\]'"]+)(?:\[\d+\])?'\s*\)/g),
    ).map((m) => m[1]);
    const uniqueVars = Array.from(new Set(usedVars));

    // Extract condition: for 分阶段调度 use axisPath, for others use first if condition
    let condition = '';
    if (complexity === '分阶段调度') {
      const axisMatch = content.match(/getvar\(\s*'stat_data\.([^[\]'"]+)(?:\[\d+\])?'\s*\)/);
      condition = axisMatch ? axisMatch[1] : '';
    } else {
      const ifMatch = content.match(/<%_?\s*if\s*\(([^)]+)\)/) || content.match(/@@if\(([^)]+)\)/);
      condition = ifMatch ? ifMatch[1].trim() : '';
    }

    ejsConfigs.push({ entryId, complexity, condition, usedVariables: uniqueVars });
  }

  return {
    enabled: true,
    mode: 'expert', // Default to expert for reconstructed config
    schemaSections: [], // Sections are lost on export; user can re-import
    updateRules: [],
    ejsConfigs,
    ejsPreprocessContent,
    schemaTsContent,
    initvarYamlContent,
    updateRulesYamlContent,
    statusBarHtml,
    // 优先读取持久化的 mvu_status_bar_style；旧卡没有该字段时回退到基于
    // mvu_has_status_bar 推断（保留旧行为以兼容历史卡片）
    statusBarStyle: (ext.mvu_status_bar_style as string)
      ?? (ext.mvu_has_status_bar ? 'minimal-dark' : ''),
    statusBarShowIcons: ext.mvu_status_bar_show_icons === true,
    statusBarOptions: (ext.mvu_status_bar_options as MvuConfig['statusBarOptions']) ?? {},
  };
}

/**
 * Reconstruct live stream chat config from saved card data.
 * Independent of MVU — looks for the '直播间界面' regex script in extensions.
 * Reads config metadata from `live_stream_chat` extension field if available;
 * falls back to defaults for older cards that only have the regex script.
 */
function reconstructLiveStreamChat(
  data: Record<string, unknown>,
): LiveStreamChatConfig | undefined {
  const ext = (data.extensions || {}) as Record<string, unknown>;
  const regexScripts = Array.isArray(ext.regex_scripts) ? (ext.regex_scripts as Array<Record<string, unknown>>) : [];
  const liveChatScript = regexScripts.find((s) => s.scriptName === REGEX_SCRIPT_NAMES.liveChat);
  if (!liveChatScript) return undefined;
  const html = ((liveChatScript.replaceString as string) || '')
    .replace(/^```html\s*/i, '')
    .replace(/\s*```\s*$/i, '');
  if (!html.trim()) return undefined;

  // 从扩展字段读取配置元数据（新版导出包含此字段）
  const meta = (ext.live_stream_chat ?? {}) as Record<string, unknown>;

  return {
    enabled: true,
    html,
    themeId: (meta.themeId as string) || 'terminal',
    title: (meta.title as string) || '直播间',
    maxVisible: (meta.maxVisible as number) ?? 10,
    initialComments: Array.isArray(meta.initialComments) ? (meta.initialComments as string[]) : [],
  };
}

/**
 * 收集卡片级的「导入字段直通层」——本工具不认识 / 不会自己生成的字段。
 * 注意 data 与 card 在纯 V1 卡里是同一个对象，所以 data 层还要额外排除信封字段。
 */
/** MVU 相关的自有脚本名——仅当 MVU 启用时本工具才会重新生成它们。 */
const MVU_OWNED_SCRIPT_NAMES: ReadonlySet<string> = new Set([
  OWN_REGEX_SCRIPT_NAMES.hideVarUpdate,
  OWN_REGEX_SCRIPT_NAMES.varUpdatePending,
  OWN_REGEX_SCRIPT_NAMES.varUpdateDone,
  OWN_REGEX_SCRIPT_NAMES.statusBar,
  OWN_REGEX_SCRIPT_NAMES.hideStatusBar,
]);

/** 直播间相关的自有脚本名——仅当直播间启用时本工具才会重新生成。 */
const LIVE_CHAT_OWNED_SCRIPT_NAMES: ReadonlySet<string> = new Set([
  OWN_REGEX_SCRIPT_NAMES.liveChat,
  OWN_REGEX_SCRIPT_NAMES.hideLiveChat,
]);

function collectCardPassthrough(
  data: Record<string, unknown>,
  dataExt: Record<string, unknown>,
  charBook: Record<string, unknown> | undefined,
  mvuEnabled: boolean,
  liveChatEnabled: boolean,
): DraftPassthrough | undefined {
  const passthrough: DraftPassthrough = {};

  const foreignData = collectUnknownKeys(
    data,
    OWN_DATA_KEYS,
    (key) => CARD_ENVELOPE_KEYS.has(key),
  );
  if (foreignData) passthrough.data = foreignData;

  // tavern_helper 仅在 MVU 启用时由本工具生成；未启用时它属于第三方内容，应保留。
  const foreignExt = collectUnknownKeys(
    dataExt,
    OWN_CARD_EXT_KEYS,
    (key, value) =>
      (key === 'tavern_helper' && mvuEnabled)
      || (key === 'depth_prompt' && isPlaceholderDepthPrompt(value)),
  );
  if (foreignExt) passthrough.extensions = foreignExt;

  // 非本工具生成的正则脚本（第三方美化脚本等）原样保留；本工具的会在导出时重新生成。
  //
  // 关键：剔除必须与「本工具是否真的会重新生成它」一一对应，不能无条件按名剔。
  // 第三方卡可能带一个名为「状态栏界面」的脚本却没有本工具的 MVU 结构（mvu_enabled 缺失），
  // 此时既不进直通层、又不会被重新生成，整个状态栏 UI 会在往返后静默消失。
  const rawRegexScripts = Array.isArray(dataExt.regex_scripts) ? (dataExt.regex_scripts as unknown[]) : [];
  const willRegenerate = (name: string): boolean => {
    if (MVU_OWNED_SCRIPT_NAMES.has(name)) return mvuEnabled;
    if (LIVE_CHAT_OWNED_SCRIPT_NAMES.has(name)) return liveChatEnabled;
    return false;
  };
  const foreignRegexScripts = rawRegexScripts.filter((s) => {
    const name = (s as { scriptName?: unknown } | null)?.scriptName;
    return typeof name !== 'string' || !willRegenerate(name);
  });
  if (foreignRegexScripts.length > 0) passthrough.regexScripts = foreignRegexScripts;

  if (charBook) {
    const foreignCharBook = collectUnknownKeys(
      charBook,
      OWN_CHARACTER_BOOK_KEYS,
      (key, value) => key === 'extensions' && (!value || Object.keys(value as object).length === 0),
    );
    if (foreignCharBook) passthrough.characterBook = foreignCharBook;
  }

  return Object.keys(passthrough).length > 0 ? passthrough : undefined;
}

/** 收集单个世界书条目的直通字段；无可保留内容时返回 undefined。 */
function collectEntryPassthrough(
  entry: Record<string, unknown>,
  entryExt: Record<string, unknown>,
): LorebookEntryPassthrough | undefined {
  const result: LorebookEntryPassthrough = {};
  const root = collectUnknownKeys(entry, OWN_ENTRY_KEYS);
  if (root) result.root = root;
  const extensions = collectUnknownKeys(
    entryExt,
    OWN_ENTRY_EXT_KEYS,
    (key, value) => key in ENTRY_EXT_IMPORT_WINS_DEFAULTS && equalsImportWinsDefault(key, value),
  );
  if (extensions) result.extensions = extensions;
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Convert an existing card's stored data back to wizard draft format (for editing).
 * Handles both V1 and V2 cards.
 */
export function cardToDraft(card: Record<string, unknown>): WizardDraft {
  const data = (card.data || card) as Record<string, unknown>;
  const meta = (card._meta || {}) as Record<string, unknown>;
  const dataExt = (data.extensions || {}) as Record<string, unknown>;
  const mvuEnabled = dataExt.mvu_enabled === true;

  // Reconstruct characters from _meta, description, or generated character entries
  let characters: WizardDraft['characters'] = [];
  if (meta.characters && Array.isArray(meta.characters) && (meta.characters as unknown[]).length > 0) {
    // Only keep characters with a non-empty name; empty-name entries from _meta
    // would otherwise block worldbook-based reconstruction and get step 2 stuck.
    characters = (meta.characters as unknown[])
      .map((c: unknown) => {
        const ch = c as Record<string, unknown>;
        return {
          id: String(ch.id ?? '') || generateId(),
          name: (ch.name as string) || '',
          description: (ch.description as string) || '',
          entryIds: ((ch.entryIds as Array<string | number>) || []).map((id) => String(id ?? '')),
          constant: typeof ch.constant === 'boolean' ? ch.constant : undefined,
        };
      })
      .filter((c) => (c.name || '').trim()) as WizardDraft['characters'];
  }
  if (characters.length === 0 && data.description) {
    // Fallback: single character from description
    characters = [{
      id: generateId(),
      name: (data.name as string) || '',
      description: (data.description as string) || '',
    }];
  }

  // Reconstruct lorebook entries from character_book.
  // 如果卡片没有启用 MVU，丢弃 MVU 相关世界书条目以及分阶段世界书条目，避免污染编辑器。
  const charBook = data.character_book as Record<string, unknown> | undefined;
  const allRawEntries = ((charBook?.entries || []) as Array<Record<string, unknown>>).map((e) => {
    const migrated: Record<string, unknown> = {
      ...e,
      content: migrateStagedDispatcherContent((e.content as string) || ''),
    };
    return migrated;
  });
  const stagedImportIndices = findStagedLorebookEntryIndices(
    allRawEntries.map((e) => ({
      name: (e.name as string) || '',
      comment: (e.comment as string) || '',
      content: (e.content as string) || '',
    } as LorebookEntry)),
  );
  const rawEntries = allRawEntries.filter(
    (e, idx) => {
      if (mvuEnabled) return true;
      if (MVU_LOREBOOK_ENTRY_NAMES.includes((e.name as string) || '')) return false;
      return !stagedImportIndices.has(idx);
    }
  );

  let reconstructedEntryIds = new Set<string>();
  if (characters.length === 0) {
    // 从自动生成的角色设定条目重建角色。主条目名为 "Name - 角色设定"；
    // 长描述拆分后的续篇条目名为 "Name - 角色设定 (2)" 等，必须合并回同一角色。
    const generatedCharacterEntries = rawEntries.filter((e) => {
      const name = (e.name as string) || '';
      // 不限制 constant：绿灯配角（constant=false）的角色设定条目也要收集，
      // 否则导入后配角会被丢失。角色的 constant 从条目反向推导。
      return /^.+ - 角色设定(\s+\(\d+\))?$/.test(name) && typeof e.content === 'string';
    });

    const entryGroups = new Map<string, Array<{ id: string; content: string; insertionOrder: number; constant: boolean }>>();
    for (const e of generatedCharacterEntries) {
      const name = (e.name as string) || '';
      const baseName = name.replace(/ - 角色设定(\s+\(\d+\))?$/, '');
      const id = String(e.id ?? '') || generateId();
      const insertionOrder = (e.insertion_order as number) ?? 0;
      const constant = e.constant !== false; // undefined / true → 蓝灯（默认）
      if (!entryGroups.has(baseName)) entryGroups.set(baseName, []);
      entryGroups.get(baseName)!.push({ id, content: (e.content as string) || '', insertionOrder, constant });
    }

    reconstructedEntryIds = new Set(
      generatedCharacterEntries.map((e) => String(e.id ?? '')).filter(Boolean),
    );

    characters = Array.from(entryGroups.entries()).map(([baseName, groupEntries]) => {
      const sorted = groupEntries.slice().sort((a, b) => a.insertionOrder - b.insertionOrder);
      // 同一角色的分块条目 constant 应一致；取首条作为角色 constant
      const charConstant = sorted[0]?.constant ?? true;
      return {
        id: generateId(),
        name: baseName,
        description: sorted.map((e) => e.content).join('\n\n'),
        entryIds: sorted.map((e) => e.id),
        constant: charConstant,
      };
    });
  }

  return {
    cardName: (data.name as string) || (card.name as string) || '',
    characters,
    lorebookEntries: rawEntries
      .filter((e) => !reconstructedEntryIds.has(String(e.id ?? '')))
      .map((e, i) => {
        const ext = (e.extensions || {}) as Record<string, unknown>;
        const entryPassthrough = collectEntryPassthrough(e, ext);
        return {
          id: String(e.id ?? '') || generateId(),
          keys: Array.isArray(e.keys) ? (e.keys as unknown[]).map(String) : [],
          secondary_keys: Array.isArray(e.secondary_keys) ? (e.secondary_keys as unknown[]).map(String) : [],
          content: (e.content as string) || '',
          name: (e.name as string) || `Entry ${i + 1}`,
          enabled: (e.enabled as boolean) ?? true,
          constant: (e.constant as boolean) ?? false,
          selective: (e.selective as boolean) ?? false,
          insertion_order: (e.insertion_order as number) ?? i,
          // extensions.position（数值）才是 ST 的权威位置；只读 entry.position 会把
          // at_depth 等扩展位置静默降级成 after_char。
          position: resolveEntryPosition(e.position, ext.position),
          priority: (e.priority as number) ?? 0,
          case_sensitive: (e.case_sensitive as boolean) ?? false,
          comment: (e.comment as string) || (e.name as string) || '',
          use_regex: (e.use_regex as boolean) ?? false,
          // ST runtime fields (from extensions, aligned with CardForge format)
          probability: (ext.probability as number) ?? 100,
          group: (ext.group as string) || '',
          group_weight: (ext.group_weight as number) ?? 100,
          selectiveLogic: SELECTIVE_LOGIC_REVERSE[(ext.selectiveLogic as number) ?? 0] ?? 0,
          role: (ext.role as number) ?? 0,
          // 只读 depth（at_depth 插入楼层）。不再回落到 scan_depth——那是关键词扫描深度，
          // 两者语义不同，塌缩成一个字段会同时算错插入位置与扫描窗口。
          // 导入卡的 scan_depth 由条目直通层原样保留。
          depth: (ext.depth as number) ?? 4,
          exclude_recursion: (ext.exclude_recursion as boolean) ?? false,
          prevent_recursion: (ext.prevent_recursion as boolean) ?? false,
          // 显式 null 表示「继承 ST 全局设置」，须原样保留避免往返时被翻成 true；
          // 字段缺失（undefined）时沿用工具默认 true。
          match_whole_words: ext.match_whole_words === null ? null : ((ext.match_whole_words as boolean) ?? true),
          sticky: (ext.sticky as number) ?? 0,
          cooldown: (ext.cooldown as number) ?? 0,
          delay: (ext.delay as number) ?? 0,
          ignore_budget: (ext.ignore_budget as boolean) ?? false,
          // 导入字段直通层：条目级未知字段 + 本工具无配置入口的 ST 运行时字段
          ...(entryPassthrough ? { _passthrough: entryPassthrough } : {}),
        };
      })
      .sort((a, b) => (a.insertion_order ?? 0) - (b.insertion_order ?? 0)),
    firstMessage: (data.first_mes as string) || '',
    // 对话示例（V2/V3 规范字段）——旧版导入会静默丢弃它
    mes_example: (data.mes_example as string) || '',
    // 性格摘要（V2/V3 规范字段）——往返直通，导出时写回 data.personality
    personality: (data.personality as string) || '',

    // V2 advanced fields
    scenario: (data.scenario as string) || '',
    system_prompt: (data.system_prompt as string) || '',
    post_history_instructions: (data.post_history_instructions as string) || '',
    alternate_greetings: (data.alternate_greetings as string[]) || [],
    creator_notes: (data.creator_notes as string) || '',
    creator: (data.creator as string) || '',
    character_version: (data.character_version as string) || '',
    // tags 归一化为字符串数组：第三方卡可能存成字符串，避免下游 .map/.includes 崩溃
    tags: Array.isArray(data.tags)
      ? (data.tags as unknown[]).map(String)
      : typeof data.tags === 'string' && data.tags.trim()
        ? data.tags.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
    bookScanDepth: (charBook?.scan_depth as number) ?? 200,
    bookTokenBudget: (charBook?.token_budget as number) ?? 40000,
    bookRecursiveScanning: (charBook?.recursive_scanning as boolean) ?? false,
    // 书名保真：自定义书名原样保留；「派生默认形态」（卡名的世界书）存空串，
    // 让书名继续跟随卡名——否则改卡名后书名会卡在旧值。
    // 派生值走 resolveBookName（与导出侧同一函数），杜绝两侧的 trim 语义漂移。
    // 回退到 extensions.world：不少第三方卡只用 world 关联共享世界书、不写
    // character_book.name，只读前者会把这个关联静默改掉。
    bookName: (() => {
      const derivedDefault = resolveBookName({
        cardName: (data.name as string) || (card.name as string) || '',
        bookName: '',
      });
      const pick = (raw: unknown): string => {
        const value = typeof raw === 'string' ? raw.trim() : '';
        return value && value !== derivedDefault ? value : '';
      };
      return pick(charBook?.name) || pick(dataExt.world);
    })(),
    bookDescription: typeof charBook?.description === 'string' ? charBook.description : '',

    // Reconstruct MVU config from extensions + lorebook entries
    mvu: reconstructMvuConfig(data, rawEntries),
    // Reconstruct live stream chat config from regex scripts (independent of MVU)
    // 复用一次 reconstructLiveStreamChat 结果，避免重复扫描正则脚本
    ...(() => {
      const liveStreamChat = reconstructLiveStreamChat(data);
      return {
        liveStreamChat,
        // 导入字段直通层：卡片级未知字段（data / extensions / regex_scripts / character_book）
        _passthrough: collectCardPassthrough(data, dataExt, charBook, mvuEnabled, Boolean(liveStreamChat?.enabled)),
      };
    })(),
    // Shared UI state — start with defaults when loading a card.
    // (This is draft-only UI state, not persisted in the card itself.)
    worldbookBatchCount: 8,
  };
}
