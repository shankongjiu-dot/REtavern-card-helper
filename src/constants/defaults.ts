/**
 * Default structures and factory functions for the Tavern Card Helper.
 * Aligned with SillyTavern Character Card V2 specification.
 *
 * V2 Spec reference: https://github.com/malfoyslastname/character-card-spec-v2
 *
 * Key design principle:
 *   - `description` holds core character info (always in context = "Permanent Tokens")
 *   - `character_book` (World Book / Lorebook) holds detailed character info
 *     as keyword-triggered entries, dynamically inserted when relevant
 *   - `personality` is a brief summary (also permanent)
 *   - `scenario` is the dialogue context/circumstances (also permanent)
 */

/** Generate a unique ID for in-memory objects */
export function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Full lorebook entry interface (shared across components, hooks, services) */
export interface LorebookEntry {
  id: string;
  name: string;
  keys: string[];
  secondary_keys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  selective: boolean;
  insertion_order: number;
  position: LorebookPosition;
  priority: number;
  case_sensitive: boolean;
  comment: string;
  /** Per-entry NSFW toggle for AI expansion feature */
  expandNsfw?: boolean;
  /** UI-only flag: 条目由「锚定世界观」步骤的 AI 总纲生成器创建。
   *  用于在 Step 4 渲染"⚓ 锚定"徽章，便于识别世界观锚定产物。
   *  Not exported to the SillyTavern card format. */
  fromAnchor?: boolean;
  // ST runtime
  probability: number;
  group: string;
  group_weight: number;
  selectiveLogic: number;
  role: number;
  depth: number;
  exclude_recursion: boolean;
  prevent_recursion: boolean;
  use_regex: boolean;
  /** null 表示「继承 SillyTavern 全局设置」，用于忠实回写外部卡片的 inherit 语义 */
  match_whole_words: boolean | null;
  sticky: number;
  cooldown: number;
  delay: number;
  ignore_budget: boolean;
  /** Optional SillyTavern runtime extensions (display_index, depth, etc.) */
  extensions?: Record<string, unknown>;
  /** 导入第三方卡时暂存的、本工具不认识的条目级字段（见 DraftPassthrough） */
  _passthrough?: LorebookEntryPassthrough;
}

/**
 * 单个世界书条目的「导入字段直通层」。
 * 由 card-exporter 的 cardToDraft 填充、assembleCard 消费；UI 不编辑它。
 */
export interface LorebookEntryPassthrough {
  /** 条目根层级的未知字段（V2/V3 规范之外的第三方扩展字段） */
  root?: Record<string, unknown>;
  /** entry.extensions 中本工具不生成、或本工具写死常量且无配置入口的 ST 运行时字段
   *  （automation_id / vectorized / use_probability / delay_until_recursion 等） */
  extensions?: Record<string, unknown>;
}

/**
 * 「导入字段直通层」——导入第三方 SillyTavern 卡时，把本工具不认识的字段原样存下来，
 * 导出时先铺底再由本工具生成的字段覆盖，从而避免「导入即破坏」。
 *
 * 关键约束：**已知字段永远以本工具的值为准**。直通层只填补空缺，
 * 绝不改变本工具对自家字段的正常导出行为。
 */
export interface DraftPassthrough {
  /** data 层未知字段（如 V3 的 assets / nickname / group_only_greetings / source 等） */
  data?: Record<string, unknown>;
  /** data.extensions 中非本工具生成的键（第三方扩展、depth_prompt 实际内容等） */
  extensions?: Record<string, unknown>;
  /** data.extensions.regex_scripts 中非本工具生成的正则脚本（第三方美化脚本等） */
  regexScripts?: unknown[];
  /** character_book 层未知字段（含其自身的 extensions） */
  characterBook?: Record<string, unknown>;
}

/** Wizard character (Step 3) — simplified: name + description + optional alignment */
export interface WizardCharacter {
  id: string;
  name: string;
  description: string;
  /** Optional D&D-style moral alignment constraint for AI generation */
  alignment?: string;
  /** Whether NSFW content generation is allowed for this character */
  nsfw?: boolean;
  /** IDs of world book entries auto-generated from this character */
  entryIds?: string[];
  /**
   * 角色设定世界书条目是否常驻（蓝灯 constant=true）。
   * undefined / true → 蓝灯：始终注入上下文（主角、重要配角）
   * false → 绿灯：关键词触发才注入（次要配角，省 token）
   * AI 生成时自动判断；用户可在角色卡片上手动切换。
   */
  constant?: boolean;
  /** 三面性：角色在不同压力下的表现层次（专家模式高级选项） */
  threeFaces?: Array<{
    face: string;
    trigger: string;
    change: string;
    behavior: string;
  }>;
}

/** D&D nine-grid alignment options (optional personality constraint) */
export const CHARACTER_ALIGNMENTS = [
  { value: '守序善良', label: '守序善良', desc: '恪守正义与秩序，为公义而行' },
  { value: '中立善良', label: '中立善良', desc: '心存善念，不拘泥于规则' },
  { value: '混乱善良', label: '混乱善良', desc: '以良知行事，蔑视不义的秩序' },
  { value: '守序中立', label: '守序中立', desc: '信奉秩序与纪律，不偏善恶' },
  { value: '绝对中立', label: '绝对中立', desc: '不偏不倚，顺其自然' },
  { value: '混乱中立', label: '混乱中立', desc: '追求自由，随心所欲' },
  { value: '守序邪恶', label: '守序邪恶', desc: '利用规则与体制谋取私利' },
  { value: '中立邪恶', label: '中立邪恶', desc: '不择手段，唯利是图' },
  { value: '混乱邪恶', label: '混乱邪恶', desc: '以破坏和混乱为乐' },
] as const;

/** AI parsed result for character generation (simplified) */
export interface AIGeneratedCharacter {
  name?: string;
  description?: string;
  /** AI 判断：主角/重要配角 → true（蓝灯常驻），次要配角 → false（绿灯触发） */
  constant?: boolean;
}

/** AI parsed result for lorebook entry generation */
export interface AIGeneratedLorebookEntry {
  /** "create" = new entry, "update" = enrich existing entry (merge content) */
  action?: 'create' | 'update';
  /** When action="update", the id of the existing entry to update */
  targetId?: string;
  name?: string;
  keys?: string[];
  secondary_keys?: string[];
  content?: string;
  comment?: string;
  constant?: boolean;
  selective?: boolean;
  selectiveLogic?: number;
  insertion_order?: number;
  position?: string;
  priority?: number;
  probability?: number;
  group?: string;
  group_weight?: number;
  role?: number;
  depth?: number;
  exclude_recursion?: boolean;
  prevent_recursion?: boolean;
  sticky?: number;
  cooldown?: number;
  delay?: number;
  use_regex?: boolean;
  match_whole_words?: boolean;
  ignore_budget?: boolean;
}

/** AI organize suggestion for a lorebook entry */
export interface AIOrganizeSuggestion {
  index: number;
  position?: string;
  insertion_order?: number;
  depth?: number;
  probability?: number;
  constant?: boolean;
  reason?: string;
}

/** AI key generation result */
export interface AIGeneratedKeys {
  index: number;
  keys: string[];
}

/** MVU variable visibility prefix */
export type MvuPrefix = '' | '_' | '$';

/** MVU variable definition (derived from schema.ts) */
export interface MvuVariable {
  /** Variable path in dot notation (e.g. "角色.好感度") */
  path: string;
  /** Zod type: "z.string()", "z.coerce.number()", "z.enum([...])", "z.object({...})", "z.record(...)" */
  zodType: string;
  /** Human-readable description */
  description: string;
  /** Visibility prefix: '' = visible+updatable, '_' = visible+readonly, '$' = hidden */
  prefix: MvuPrefix;
  /** Initial value (from initvar) */
  initialValue: unknown;
  /** For enum types: allowed values */
  enumValues?: string[];
  /** For number types: range [min, max] */
  range?: { min: number; max: number };
  /** For number types: category segments */
  categories?: Array<{ range: string; label: string }>;
  /** For complex types: format hint */
  format?: string;
}

/** MVU variable update rule */
export interface MvuUpdateRule {
  /** Variable path in dot notation */
  path: string;
  /** Type hint for AI: "number", "string", or union of string literals */
  type?: string;
  /** Numeric range: "0~100" */
  range?: string;
  /** Numeric range categories */
  category?: Record<string, string>;
  /** Format hint */
  format?: string;
  /** Natural language check rules */
  check?: string[];
  /** Value description */
  value?: string;
}

/** MVU schema section */
export interface MvuSchemaSection {
  /** Section name (e.g. "角色", "世界", "主角") */
  name: string;
  /** Variables in this section */
  variables: MvuVariable[];
}

/** EJS entry configuration */
export interface EjsEntryConfig {
  /** Entry ID in lorebookEntries */
  entryId: string;
  /** EJS complexity level */
  complexity: '显隐' | '段落控制' | '动态文本' | '分阶段调度';
  /** Condition expression (for @@if or if/else) */
  condition: string;
  /** Variable names used in this entry */
  usedVariables: string[];
}

/** MVU + EJS configuration for the card */
export interface MvuConfig {
  /** Whether MVU is enabled */
  enabled: boolean;
  /** Editor mode: 'expert' = full manual control, 'beginner' = AI-assisted simplified */
  mode: 'expert' | 'beginner';
  /** Currently selected beginner template id (when mode === 'beginner') */
  beginnerTemplateId?: string;
  /** Schema sections */
  schemaSections: MvuSchemaSection[];
  /** Update rules */
  updateRules: MvuUpdateRule[];
  /** EJS configurations */
  ejsConfigs: EjsEntryConfig[];
  /** EJS preprocess entry content (define() statements) */
  ejsPreprocessContent: string;
  /** Raw schema.ts content */
  schemaTsContent: string;
  /** Raw initvar.yaml content */
  initvarYamlContent: string;
  /** Raw 变量更新规则.yaml content */
  updateRulesYamlContent: string;
  /** Status bar HTML template (for SillyTavern render_after) */
  statusBarHtml: string;
  /** Status bar style preset id */
  statusBarStyle: string;
  /** Whether to show decorative emoji/symbols in the status bar (default false = clean Chinese-friendly display) */
  statusBarShowIcons?: boolean;
  /** Status bar customization options (theme, title, avatar, collapse) */
  statusBarOptions?: StatusBarOptions;
}

/** Status bar customization options used by StepStagedMode and status-bar-templates */
export interface StatusBarOptions {
  /** Theme id (terminal/parchment/glass/paper) */
  themeId?: string;
  /** Status bar header title */
  title?: string;
  /** Whether to show avatar in header (default true for parchment, false for terminal) */
  showAvatar?: boolean;
  /** Whether to collapse all sections by default */
  collapseAll?: boolean;
  /** Overall opacity (0.7~1) */
  opacity?: number;
  /** Information density */
  density?: 'compact' | 'comfortable';
  /** Enable value transition animations */
  animated?: boolean;
  /** Show decorative section icons */
  showIcons?: boolean;
}

/** 分阶段模式：单个角色一个阶段轴的剖析结果 */
export interface StagedModeCharacter {
  /** 角色名 */
  name: string;
  /** 来源世界书条目 comment（便于追溯） */
  sourceComment?: string;
  /** 一句话身份概括 */
  summary: string;
  /** 阶段轴变量路径（点分，必须已在 MVU 中定义，如 "林雅宁.情感天平"） */
  axisPath: string;
  /** 阶段轴变量类型：'number'（数值阈值型）| 'enum'（离散型） */
  axisType: 'number' | 'enum';
  /** 数值轴比较方向（仅 number）：'>=' 阈值以上触发 | '<=' 阈值以下触发 */
  numericDirection?: '>=' | '<=';
  /** 阶段列表（顺序即 if/else if 顺序，从最极端到初始，或从初始到极端） */
  stages: StagedModeStage[];
}

/** 分阶段模式：单个阶段定义 */
export interface StagedModeStage {
  /** 阶段名（用作子条目 comment 后缀与展示） */
  name: string;
  /** 触发条件表达式（不含外层括号），如 ">= 90" / "<= -80" / "=== '朋友'" */
  condition: string;
  /** AI 给出的简单人设/剧情注解（可重 roll） */
  annotation: string;
  /** 该阶段的子条目内容（AI 生成的人设/剧情详细文本，键值对或自然段） */
  content?: string;
}

/** 分阶段模式配置（新步骤 StepStagedMode 的状态） */
export interface StagedModeConfig {
  /** 是否启用分阶段模式 */
  enabled: boolean;
  /** 剧情模板 id（见 staged-templates.ts 的 STAGED_TEMPLATES，如 'pure-love'/'ntr'/'dual-route'/'cultivation' 等） */
  templateId: string;
  /** 调度条目命名前缀（如 "林雅宁分阶段人设"），默认 "分阶段人设" */
  dispatcherPrefix: string;
  /** AI 剖析出的角色阶段框架列表 */
  characters: StagedModeCharacter[];
}

/**
 * 直播间评论面板配置（独立于 MVU，纯正则驱动）。
 *
 * 架构：
 *   - 注入层：占位符 `<LiveStreamChatImpl/>` 由 card-exporter 追加到 first_mes
 *   - 渲染层：运行时 JS 立即渲染内置初始评论（无需任何外部依赖）
 *   - 增强层（可选）：若 MVU 运行时可用，订阅 VARIABLE_UPDATE_ENDED 事件
 *             读取 `stat_data.直播间.评论` 实现动态更新
 *
 * 通过 regex_scripts 替换占位符为面板 HTML（markdownOnly），
 * 并从 AI prompt 中移除占位符（promptOnly）。
 */
export interface LiveStreamChatConfig {
  /** 是否启用直播间评论面板 */
  enabled: boolean;
  /** 面板 HTML 文档（由 generateLiveChatHtml 生成，含 <style> + <script> + <body>） */
  html: string;
  /** 跟随状态栏主题 id（terminal/parchment/glass/paper） */
  themeId?: string;
  /** 面板标题（默认 "直播间"） */
  title?: string;
  /** 初始评论数显示上限（超出滚动，默认 10） */
  maxVisible?: number;
  /** 内置初始评论（每条一行，开播时立即渲染，无需 MVU） */
  initialComments?: string[];
}

/**
 * World book entry names that belong to the MVU system.
 * When MVU is disabled these entries should not be exported or edited.
 */
export const MVU_LOREBOOK_ENTRY_NAMES: readonly string[] = [
  '[InitVar]请勿打开',
  '[mvu_update]变量更新规则',
  'EJS预处理',
  '变量列表',
  '变量列表.txt',
  '变量输出格式',
  '变量输出格式.txt',
  'MVU 变量列表',
  'MVU 变量输出格式',
  '[mvu_update]变量输出格式',
];

/**
 * SillyTavern regex_scripts 中由本工具生成的界面脚本名。
 * 这些字符串同时用于「写入」(导出时设置 scriptName) 与「匹配」(导入/校验/补丁时按名查找)，
 * 任一处拼写不一致都会静默断开状态栏 / 直播间界面的接线，故集中定义为唯一来源。
 */
export const REGEX_SCRIPT_NAMES = {
  statusBar: '状态栏界面',
  liveChat: '直播间界面',
} as const;

/** 世界观锚定 — 按「从大到小细化」的漏斗顺序锚定创作方向，防止 AI 生成偏离设定。
 *  用户填入后既作为 AI 生成时的硬约束注入，也作为「锚定世界观」步骤的输入：
 *  AI 据此扩写出 1 条总纲条目 + N 条子条目（地点/规则/组织等）直接加入世界书。
 *  字段顺序即思考路径：类型 → 时代/年份 → 文化背景 → 人文细节 → 硬性约束。 */
export interface WorldAnchor {
  /** 类型：最宏观的世界观类型（异世界/平行世界/赛博朋克/奇幻/末日/校园/都市…） */
  type: string;
  /** 时代/年份：时代或具体年份（古代/中世纪/近现代/近未来/2024年/唐朝…） */
  era: string;
  /** 文化背景：国家/文化圈（中国/欧洲/日本/韩国/美国/架空…） */
  culture: string;
  /** 人文细节：宗教/礼仪/饮食/习俗 等创作方向，自由文本 */
  humanity: string;
  /** 硬性约束：AI 绝对不能违反的（如"无魔法"、"科技不超过2024年"） */
  constraints: string;
}

/** 将 WorldAnchor 格式化为 prompt 注入文本（按从大到小顺序） */
export function formatWorldAnchorForPrompt(anchor: WorldAnchor | undefined): string {
  if (!anchor) return '';
  const parts: string[] = [];
  if (anchor.type) parts.push(`世界观类型: ${anchor.type}`);
  if (anchor.era) parts.push(`时代/年份: ${anchor.era}`);
  if (anchor.culture) parts.push(`文化背景: ${anchor.culture}`);
  if (anchor.humanity) parts.push(`人文细节: ${anchor.humanity}`);
  if (anchor.constraints) parts.push(`硬性约束: ${anchor.constraints}`);
  return parts.join('\n');
}

/** Wizard draft state shape (shared across pages, hooks, services) */
export interface WizardDraft {
  cardName: string;
  characters: WizardCharacter[];
  lorebookEntries: LorebookEntry[];
  firstMessage: string;
  /** 对话示例（V2/V3 `mes_example`，`<START>` 分隔的示例对话）。
   *  可选是为了兼容不带该字段的历史草稿与既有 WizardDraft 字面量；
   *  createEmptyDraft 会给出 '' 默认值，消费侧一律按 `draft.mes_example || ''` 读取。 */
  mes_example?: string;
  /** 性格摘要（V2/V3 `personality`）。本工具的向导不产出它（worldbook-first），
   *  但第三方导入卡会带——往返直通防止丢失。可选性与默认值约定同 mes_example。
   *  暂无 UI 入口（后续可挂在步骤 7 高级区）。 */
  personality?: string;
  /** 世界书名（`character_book.name`）。空串 = 按卡名派生默认值（resolveBookName）。
   *  第三方导入卡的自定义书名靠它保真；cardToDraft 读到「派生默认形态」的书名时
   *  会存空串，让书名继续跟随卡名。 */
  bookName?: string;
  /** 世界书描述（`character_book.description`）——第三方卡往返直通，无 UI 入口 */
  bookDescription?: string;
  // V2 advanced fields
  scenario: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  creator_notes: string;
  creator: string;
  character_version: string;
  tags: string[];
  bookScanDepth: number;
  bookTokenBudget: number;
  bookRecursiveScanning: boolean;
  /** Whether NSFW content generation is allowed for world book entries */
  worldbookNsfw?: boolean;
  /** 世界观锚定 — 锚定创作方向的风格/地点/约束。既作 AI 生成约束注入，
   *  也是「锚定世界观」步骤的输入，AI 据此扩写出总纲+子条目加入世界书。 */
  worldAnchor?: WorldAnchor;
  /** Step 4 世界书细节 AI 生成时的「世界观约束与运行规则」内容输入，跨步骤保留 */
  worldRules?: string;
  /** Shared UI state — Step 4 世界书细节的主题/方向输入，跨步骤保留以免用户重复输入 */
  worldbookTopic?: string;
  /** Shared UI state — Step 4 世界书细节的批量生成数量，跨步骤保留以免用户重复输入。 */
  worldbookBatchCount?: number;
  /** MVU + EJS configuration */
  mvu?: MvuConfig;
  /** Whether to use MVU-aware export (embeds scripts, Zod.txt, regex) */
  useMvuExport?: boolean;
  /** 分阶段模式配置（步骤6，可选启用） */
  stagedMode?: StagedModeConfig;
  /** 直播间评论面板配置（步骤8，独立于 MVU，纯正则驱动） */
  liveStreamChat?: LiveStreamChatConfig;
  /** 导入字段直通层（内部字段，非 UI 编辑项）：保存导入卡中本工具不认识的字段，
   *  导出时原样回写。详见 DraftPassthrough。 */
  _passthrough?: DraftPassthrough;
}

/** Empty character template for Step 3 of the wizard */
export function createEmptyCharacter(): WizardCharacter {
  return {
    id: generateId(),
    name: '',
    description: '',
  };
}

/**
 * Empty lorebook entry template for Step 2/4 (锚定世界观 + 世界书细节).
 * Aligned with SillyTavern runtime format (CardForge reference).
 *
 * V2 Spec fields (embedded in PNG):
 *   keys, content, enabled, insertion_order, case_sensitive,
 *   name, priority, id, comment, selective, secondary_keys, constant, position
 *
 * SillyTavern runtime fields (stored in extensions, used by ST engine):
 *   probability, group, group_weight, selectiveLogic, role,
 *   sticky, cooldown, delay, depth, scan_depth,
 *   exclude_recursion, prevent_recursion, use_regex,
 *   match_whole_words, ignore_budget
 *
 * Reference: https://github.com/Anastasia2372/sillytavern-cardforge
 */
export function createEmptyLorebookEntry(): LorebookEntry {
  return {
    // ── Core fields (V2 spec) ───────────────────────────────────────────────
    id: generateId(),
    name: '',                         // Entry title / memo (human reference only)
    keys: [] as string[],             // Primary trigger keywords
    secondary_keys: [] as string[],   // Filter keywords (used with selective)
    content: '',                      // Text inserted into AI prompt when triggered
    enabled: true,
    constant: false,                  // If true, always inserted (within budget)
    selective: false,                 // If true, use secondary_keys with selectiveLogic
    insertion_order: 100,             // Lower = inserted first, higher = closer to end
    position: 'after_char' as LorebookPosition,
    priority: 50,                     // Token budget: lower = discarded first
    case_sensitive: false,
    comment: '',                      // Optional memo/comment

    // ── SillyTavern runtime fields (extensions) ─────────────────────────────
    probability: 100,                 // Trigger % (100 = always, 50 = 50%, 0 = never)
    group: '',                        // Inclusion group name (only one entry per group fires)
    group_weight: 100,                // Weight for random selection within group
    selectiveLogic: 0,                // Secondary key logic: 0=AND ANY, 1=AND ALL, 2=NOT ALL, 3=NOT ANY
    role: 0,                          // Message role: 0=System, 1=User, 2=Assistant
    depth: 4,                         // Scan depth (how many messages back to scan for keys)
    exclude_recursion: false,         // Cannot be activated by other entries
    prevent_recursion: false,         // Cannot trigger other entries
    use_regex: false,                 // Keys use regex matching
    match_whole_words: true,          // Only match whole words
    sticky: 0,                        // Stays active for N messages after trigger
    cooldown: 0,                      // Cannot re-trigger for N messages after deactivation
    delay: 0,                         // Cannot trigger until N messages exist in chat
    ignore_budget: false,             // Ignore token budget (always insert if triggered)
  };
}

/** Lorebook entry position values (SillyTavern V2 + runtime, 7 options) */
export type LorebookPosition =
  | 'before_char'      // Before character definitions (moderate impact)
  | 'after_char'       // After character definitions (greater impact)
  | 'before_example'   // Before example messages
  | 'after_example'    // After example messages
  | 'before_author'    // Before author's note
  | 'after_author'     // After author's note
  | 'at_depth';        // At specific depth (ST runtime extension)

/** Position display options for UI dropdown */
export const LOREBOOK_POSITION_OPTIONS = [
  { value: 'before_char', label: '角色定义之前', desc: '适中影响力' },
  { value: 'after_char', label: '角色定义之后', desc: '较大影响力（推荐）' },
  { value: 'before_example', label: '示例消息之前', desc: '解析为对话块' },
  { value: 'after_example', label: '示例消息之后', desc: '解析为对话块' },
  { value: 'before_author', label: '作者注释之前', desc: '取决于AN位置' },
  { value: 'after_author', label: '作者注释之后', desc: '取决于AN位置' },
  { value: 'at_depth', label: '指定深度', desc: '在指定消息深度处插入' },
] as const;

/** Secondary key logic modes (selectiveLogic) */
export const SELECTIVE_LOGIC_OPTIONS = [
  { value: 0, label: '与任意 (AND ANY)', desc: '任一过滤词匹配即触发' },
  { value: 1, label: '与所有 (AND ALL)', desc: '全部过滤词匹配才触发' },
  { value: 2, label: '非所有 (NOT ALL)', desc: '至少一个不匹配时触发' },
  { value: 3, label: '非任何 (NOT ANY)', desc: '全部不匹配时触发' },
] as const;

/** Message role options */
export const LOREBOOK_ROLE_OPTIONS = [
  { value: 0, label: 'System', desc: '系统消息（默认）' },
  { value: 1, label: 'User', desc: '用户消息' },
  { value: 2, label: 'Assistant', desc: 'AI消息' },
] as const;

/**
 * Version number for persisted wizard drafts.
 * Bump this whenever the draft shape changes incompatibly so that old cached
 * drafts are discarded on app restart.
 *
 * V6 → V7：合并「世界观锚定」+「世界书骨架」为「锚定世界观」步骤。
 * - worldAnchor 重构为从大到小漏斗字段（type/era/culture/humanity/constraints），
 *   旧字段映射 era→era、hardConstraints→constraints（coreRules/tone 丢弃）
 * - 移除 skeletonTopic / skeletonCount / skeletonModeEnabled（worldRules 保留为第四步内容输入）
 * - lorebookEntries 内 fromSkeleton/skeletonExpanded → fromAnchor
 */
export const WIZARD_DRAFT_VERSION = 7;

/**
 * 世界书名的唯一推导来源。导出的 `character_book.name`、`extensions.world` 与
 * 分阶段调度条目里 `getWorldInfo("书名", ...)` 的第一个参数**必须**都经由这里，
 * 三者不一致时 ST 里 `loadWorldInfo(书名)` 精确匹配失败、调度条目拉不到子条目，
 * 表现为「阶段不切换」。draft.bookName 非空 = 用户/导入卡的自定义书名；
 * 空串 = 按卡名派生默认值。
 */
export function resolveBookName(draft: Pick<WizardDraft, 'cardName' | 'bookName'>): string {
  // cardName 必须 trim：cardToDraft 侧比对导入书名时做了 trim，两侧不对称会把
  // 「 阿绫的世界书」（卡名带前导空格）误判成用户自定义书名，此后改卡名书名不再跟随
  return draft.bookName?.trim() || `${(draft.cardName ?? '').trim()}的世界书`;
}

/**
 * Empty wizard draft state.
 * Includes all SillyTavern V2 spec fields.
 */
export function createEmptyDraft(): WizardDraft {
  return {
    cardName: '',

    // Step 3: Characters → auto-injected into world book entries
    characters: [createEmptyCharacter()],

    // Step 2/4: World Book (skeleton + detail) / Character Book entries
    lorebookEntries: [],

    // Step 5: MVU Variables (optional)
    mvu: {
      enabled: false,
      mode: 'beginner',
      beginnerTemplateId: undefined,
      schemaSections: [],
      updateRules: [],
      ejsConfigs: [],
      ejsPreprocessContent: '',
      schemaTsContent: '',
      initvarYamlContent: '',
      updateRulesYamlContent: '',
      statusBarHtml: '',
      statusBarStyle: 'compact-panel',
      statusBarShowIcons: false,
      statusBarOptions: {},
    },
    useMvuExport: false,

    // Step 6: Staged Mode (optional, off by default)
    stagedMode: {
      enabled: false,
      templateId: 'pure-love',
      dispatcherPrefix: '分阶段人设',
      characters: [],
    },

    // Step 8: Live Stream Chat Panel (optional, off by default, independent of MVU)
    liveStreamChat: {
      enabled: false,
      html: '',
      themeId: 'terminal',
      title: '直播间',
      maxVisible: 10,
      initialComments: [],
    },

    // Step 7: First message
    firstMessage: '',

    // ── V2 Advanced Fields ──────────────────────────────────────────────────
    /** 对话示例（V2/V3 mes_example）——导入的 ST 卡会带回来，导出时原样写入 data.mes_example */
    mes_example: '',
    /** 性格摘要（V2/V3 personality）——同 mes_example 的往返直通，无 UI 入口 */
    personality: '',
    /** 世界书名/描述——空串 = 按卡名派生（见 resolveBookName） */
    bookName: '',
    bookDescription: '',
    scenario: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [] as string[],
    creator_notes: '',
    creator: '',
    character_version: '',
    tags: [] as string[],
    bookScanDepth: 200,
    bookTokenBudget: 40000,
    bookRecursiveScanning: false,
    worldbookNsfw: false,
    worldAnchor: { type: '', era: '', culture: '', humanity: '', constraints: '' },
    worldRules: '',
    worldbookTopic: '',
    worldbookBatchCount: 8,
  };
}

/** Create an empty MVU config (returns non-optional MvuConfig for type safety) */
export function createEmptyMvuConfig(): MvuConfig {
  return {
    enabled: false,
    mode: 'beginner',
    beginnerTemplateId: undefined,
    schemaSections: [],
    updateRules: [],
    ejsConfigs: [],
    ejsPreprocessContent: '',
    schemaTsContent: '',
    initvarYamlContent: '',
    updateRulesYamlContent: '',
    statusBarHtml: '',
    statusBarStyle: 'compact-panel',
    statusBarShowIcons: false,
    statusBarOptions: {},
  };
}

/** Wizard step definitions with labels and validation flags */
export const WIZARD_STEPS = [
  { id: 1, label: '卡片名称', required: true },
  { id: 2, label: '锚定世界观', required: false },
  { id: 3, label: '角色配置', required: true },
  { id: 4, label: '世界书细节', required: false },
  { id: 5, label: 'MVU变量', required: false },
  { id: 6, label: '分阶段模式', required: false },
  { id: 7, label: '开场白', required: true },
  { id: 8, label: '直播包装', required: false },
  { id: 9, label: '美化导出', required: false },
] as const;

// ── 开场白文风预设 ──────────────────────────────────────────────
// 借鉴「双人成行v10.0」文风预设，忽略 NSFW 文风。
// 用户选择文风后，AI 生成开场白时会按该文风对文本进行润色。

export interface WritingStyle {
  id: string;
  label: string;
  category: string;
  content: string;
}

export const WRITING_STYLES: WritingStyle[] = [
  // ── 轻松温馨向 ──
  {
    id: 'light-novel',
    label: '日系轻小说',
    category: '轻松温馨向',
    content: `文风: 日系轻小说
核心结构: 对话 + 叙述
具体解构:
  - 对话: 角色不是机器人，他们会说错话，也会有各种的语气词和推断词等主观性词汇。角色的对话与叙述相辅相成，一同构建起一篇轻小说。
  - 叙述-描述: 对于角色对话的补充说明（如环境描写、角色神态、角色补充动作、控制节奏/氛围等）。叙述需要根据故事主角的视角进行展开，一切的看法、主观上的情感、事物的描述都是如此。对于角色而言，其动作是关键，务必以生动多样化的动词来描写一个角色的动作。
  - 叙述-内心独白: 展现角色的内心世界，塑造一个立体、复杂且并不可靠的叙述者形象。形式上包含内心评论、情绪反应、主观解读。
额外:
  - 叙述主观性: 代入主角，以主角为准，文章中应该存在主角主观的词语，避免完全客观。
  - 叙述情感性: 想想故事进行到此处时主角/角色会有的情感并且在叙述中来体现情感，而非单纯的客观描述。
  - 独白深度性: 在一个事件中，角色会对事件的过程进行思考或表达感想，这些都属于内心独白，请务必要在正文中体现。`,
  },
  {
    id: 'adult-fairy-tale',
    label: '成人童话',
    category: '轻松温馨向',
    content: `文风：成人童话
这类文字不要写成儿童故事，而是借童话的壳写成年人才能懂的孤独、选择和告别。语言要干净，句子不必花哨，意象可以有一点透明的冷光：雪、玻璃、星星、旧车站、无人应答的电话、被风吹动的窗帘。
写法上，故事可以带一点不合常理的温柔，比如路灯会记住人的名字，海鸟会替人带信，火车开向一个不存在于地图上的地方。但这些奇异的东西不要解释得太满，像生活里偶然遇见的一件怪事，让它自然留在那里。
对话要朴素。角色谈幸福、死亡、亏欠、爱与自由时，不要说成哲学论文，尽量像人在夜里散步时随口说出的真话。悲伤不要煽情，希望也不要喊口号。写到残酷处，笔要轻一点，越轻越疼。
适合的节奏是缓慢、安静、带旅途感。每一轮推进一个小发现，或一次小小的分别。结尾可以留一点空白，让读者自己明白人物没有说出口的部分。`,
  },
  {
    id: 'toaster',
    label: '烤面包机',
    category: '轻松温馨向',
    content: `文风：烤面包机
核心理念: 在失序中寻找温暖，于平凡中提炼荒诞。此文风旨在将日常生活中那些烤得微焦的边缘，变成温暖而金黄的笑声碎屑，拥抱那些尴尬的沉默、不那么光鲜的真相，以及藏在普通星期二里的所有奇特之美。
一、核心视角：一个过度思考的观察者
  - 放大平凡的荒诞: 赋予平凡事物以人性，放大其内在的荒诞剧场感。观察对象不是宏大叙事，而是一台会叹气的自助结账机、一盆拒绝上进的绿植，或一只眼神里充满批判的猫。语调是温暖的讽刺，既承认混乱，也品味甜蜜。
  - 内心独白是发动机: 第一人称的内心独白是反转和吐槽的核心。这个声音不可靠、爱自我拆台，充满了内在矛盾与喜剧性的否认。它是整个故事的节奏器和包袱来源。
二、叙事节奏：失序的呼吸感
  - 碎片化的心跳: 用短促、断裂的段落构建节奏，像心跳一样不规则。随时插入括号里的私语、跑题的联想或一个突兀的反问，打断流畅的叙事。
  - 拥抱无序: 坦然接受叙事速度的无序和不连贯，因为这恰恰是真实生活不可预测的倒影。
三、角色与世界：温柔的笨拙
  - 由怪癖构成的角色: 角色由其微小的怪癖、不着调的逻辑和言不由衷的对话构成。他们很少有戏剧性的宣言，更多的是犹豫、反讽和半吊子的自我认知。
  - 在脆弱上涂抹幽默: 情感的核心是负面情绪时也要自带笑点，挫败感是宣泄的奇观。结局不必圆满，有时，一块涂好黄油的吐司就是与世界的和解。`,
  },
  {
    id: 'heartbeat-narrative',
    label: '流转心跳叙事',
    category: '轻松温馨向',
    content: `文风：流转心跳叙事
基调：轻松、静谧、微甜、有趣、鲜活交替出现
段落指导：根据情绪的交替来决定段落的长短。以对话为标识切分段落每段控制在10-50字左右。对话必须使用双引号包裹，且对话与动作神态描写应当合理分段，避免揉捏在一起。
文风指导：
一、语言层面的特征：语言节奏根据场景灵活切换。在轻松有趣的场景中，对话语速加快，带有俏皮的反问和玩笑；在静谧微甜的场景中，语言变得轻柔舒缓。
二、故事上的特征：情节呈现出动静结合的错落感。前一刻可能还在互相打趣捉弄，下一刻就能切换到在星光和海风中自然地互诉心声的安宁状态。趣味性来自于打破常规的小恶作剧，静谧感来自于恶作剧之后的包容与陪伴。
三、人物情感上的特征：人物情感应当鲜活饱满。角色不是刻板的设定，而是会生气、会害羞、会开玩笑的立体存在。情感的表达在五种基调中来回游走。拌嘴时是有趣和轻松，肢体不经意触碰时是微甜，深夜相拥时是静谧。
四、故事画面感的特征：正文创作必须注重场景氛围的流转。时而要像明亮的阳光一样充满色彩和欢声笑语，镜头捕捉人物生动的表情；时而则要像水中的月亮一样清冷而温柔，镜头聚焦于缓慢的肢体触碰。`,
  },
  {
    id: 'chatterbox',
    label: '碎嘴子',
    category: '轻松温馨向',
    content: `文风：饭桌碎嘴皮子体
写法：
  - 语言平实自然，口语化，对话多多，少点形容词堆砌，全部用正面简约句，不写"没做xx"。
  - 核心只有人物的情绪、心理活动、嘴里说的话。尤其是那点见不得人的心动，嘴上死活不认，心里翻来覆去地猜。用"也许/可能/该不会/会不会/说不定/但又觉得/可是/还是说"这种词儿，让心悬着荡秋千。
  - 尾巴词也给我跟上，"啦、啊、吧、了、着"问号感叹号能用就用。
  - 外在描写给个氛围感和架势就行，别老捣鼓语气和动作细节。动词也别老用"看"和"说"，用"打量"、"开口"这种双音节词。
  - 别写否肯句、比拟句、递进句。别写声音怎么传播、动作的大小轻重缓急快慢高低。别写客观总结、复述剧情、替主角解释动机。
  - 总之，骂脏话是关心，多点一个菜是心疼。幽默是壳，越贫的地方底下越藏着东西。喻情于物是好东西，写吃的就往香了写，往馋了写。吃吃喝喝是锚点，那点犹豫来犹豫去的小心思才是饭桌底下悄悄勾着的脚。`,
  },
  {
    id: 'romance-novel',
    label: '恋爱小说',
    category: '轻松温馨向',
    content: `文风：恋爱小说
恋爱不要急着写成告白或结果，重点写两个人怎么一点点意识到自己在意对方。节奏可以慢，慢在对视、停顿、错开的手、没说完的话和突然记住的小习惯里。
语言要清透，段落可以短一些，但不要空泛唯美。光影、雨声、汽水糖、校服袖口、聊天框、折纸、钥匙扣这些小物件都可以成为情感锚点。物件出现时要和情节有关系，不要只是摆设。
对话要像年轻人真的会说的话。有人逗弄，有人嘴硬，有人短句回应，有人故作轻松。情绪上来时，称呼、停顿和改口比大段情话更有用。
亲密接触要写得含蓄。可以写指腹擦过手背、肩膀靠近、呼吸变轻、耳朵发烫，但点到为止。甜不是腻，暧昧不是轻浮。让人物保留羞涩、犹豫和笨拙的勇敢。`,
  },
  // ── 情绪表达向 ──
  {
    id: 'old-vhs',
    label: '旧录像带质感',
    category: '情绪表达向',
    content: `文风：旧录像带质感
核心要求：模仿旧录像带（VHS）那种模糊、重影、带点电磁干扰的感觉，不要写得太清晰。
具体描写逻辑：
  1. 视觉重影：动作和光影要慢半拍。比如人走过去了，影子或灯光还留在原地一点点，带点拖尾效果。
  2. 情绪重力：心情沉重时，周围的烟雾、头发、灰尘要像在水里一样飘起来，半浮在空中。
  3. 万物半睡半醒：路灯、路边的贩卖机都要写得像没睡醒的人，比如路灯在打瞌睡，贩卖机在小声哼歌。
感官描写技巧：
  - 五感乱套：用形容听觉的词写视觉，用形容味道的词写触觉。比如"吸入蓝色的静电"、"听起来很粗糙的噪音"。
  - 情绪实体化：把抽象的心情写成看得见摸得着的粘稠东西。比如尴尬像"透明雨衣"粘在身上，难过像"融化的冰淇淋"。
  - 声音有温度：说话的声音要有重量或者温度，比如话掉在地上，或者像黄油一样化开。
镜头与禁忌：
  - 别只盯着人：多描写旁边的电线杆、空易拉罐、云流动的样子。
  - 严禁大吵大闹：再激烈的吵架也要写成"无线电信号干扰"那种沙沙声，要压抑、安静。
  - 禁用精确数字：不准说"5米"、"10分钟"，要用感性的说法，比如"一首歌的时间"。
  - 全局语气：丧甜丧甜的（忧郁但温柔）。`,
  },
  {
    id: 'cold-dreamcore',
    label: '冷冽与梦核',
    category: '情绪表达向',
    content: `文风：冷冽与梦核
这条文风适合写旧城市、夜班、雨后的店铺、凌晨电车和醒来后说不清的梦。画面要有一点胶片颗粒感，东西像被人用过很久：冷掉的咖啡、起毛的围巾、失真的广播、墙皮、烟灰缸、便利店灯箱。
日常部分写得冷一点，别急着解释情绪。让人物先做事、看东西、听见声音，再从细节里漏出疲惫或在意。可以有轻微反讽，但不要像旁白在卖弄聪明。
进入亲密、回忆或精神恍惚的段落时，距离可以拉近。写温度、气味、手边物件和突然冒出来的联想。梦核不是乱写幻觉，而是让现实稍微错位：走廊比记忆里更长，自动门开合得像呼吸，某句对话像昨晚已经发生过。
宏大的社会背景只当背景音处理，别正面讲大道理。危险、阶层、城市压力可以从收银机、新闻声、路边巡逻灯、关门后的空街里透出来。`,
  },
  {
    id: 'plain-description',
    label: '白描文风',
    category: '情绪表达向',
    content: `文风：白描
白描不是没味道，也不是把句子写干。它只是少解释，少替人物说心里话，把人放在动作、东西和时间里。人物难过，就写他把碗洗完、擦干、又放回原处；人物犹豫，就写线在手上多绕了一圈，门开了又没出去。
大事可以轻轻带过，小物件反而要准。钥匙、半碗冷饭、旧棉袄、窗台灰、集市最后一块豆腐，都可以比一大段心理描写更有用。
句子要平实，有一点生活里的老派口气。不要频繁总结"这意味着什么"，也不要把情绪翻译成概念。对话尽量短，人物该问庄稼就问庄稼，该问钱就问钱，不必每句话都说爱恨。
场景之间可以直接切。空一拍，时间就过去了。读者能自己补上的地方，不要替他补完。`,
  },
  // ── 神秘高压向 ──
  {
    id: 'explicit-pressure',
    label: '显性高压',
    category: '神秘高压向',
    content: `文风：显性高压
这条写法适合压迫感很强的场景：审问、追捕、权力对峙、密闭空间、暴雨夜里的争执。重点不是堆狠话，而是让人物没有余地。
语言要短、硬、直接。环境也要跟着收窄：门锁、灯管、桌沿、湿鞋印、越来越近的脚步声。不要大段解释恐惧，写角色能抓住什么、避开什么、哪句话被打断、哪个选择被堵死。
高压场景里，每个人都要有明确目的。强势的一方不必一直咆哮，越冷静越危险；弱势的一方也不要只会崩溃，可以算计、拖延、试探、沉默，甚至在很小的地方保住体面。
节奏上多用逼近感。每一段都让局面少一个出口，但不要为了刺激强行升级。压迫感来自合理的后果，而不是作者替场面加音效。`,
  },
  {
    id: 'magical-realism',
    label: '魔幻现实',
    category: '神秘高压向',
    content: `文风：魔幻现实
魔幻现实要先有现实。先写土地、饭菜、方言、债、亲戚、牲口、天气、规矩和人情，再让不可思议的事像一件家常事那样发生。死人托梦、井水说话、树影长出人脸，都不必惊天动地，村里人也许只会问它耽不耽误明天赶集。
语言可以粗粝一点，有泥、有汗、有饭香和尘土。不要把粗俗当噱头，脏话和荒诞都要贴着人物出身和处境来。悲悯比猎奇重要，荒唐背后要看得见人为什么活成这样。
叙事可以带一点传说口吻，也可以让边缘人物、动物、器物说话。但视角一旦选定，就按它能知道的东西写，不要突然变成全知解说。
魔幻部分不要解释原理。它像地方上的老规矩，大家半信半疑，却照样过日子。`,
  },
  {
    id: 'abyss-nursery-rhyme',
    label: '深渊童谣',
    category: '神秘高压向',
    content: `文风：深渊童谣
这条文风写的是童话表面下的不安。句子可以温柔，画面可以漂亮，但漂亮里要有一点冷：坏掉的八音盒、空摇篮、潮湿的墙纸、没有影子的花、总是唱错一句的孩子。
不要写成血腥展示，也不要用说明书解释恐怖。真正吓人的地方应该很小：角色发现糖罐里不是糖，楼下的歌每天少一个字，镜子里的自己比现实慢半拍。
叙述声音可以天真，甚至带一点宠溺，但不要卖萌。它越像在讲睡前故事，下面的不对劲越明显。人物可以把可怕的事说得很平常，因为他们已经在这样的世界里生活太久。
适合用重复句、童谣、颜色和物件回环制造节奏。每次重复都改动一点点，让读者意识到事情正在滑向更深处。`,
  },
  {
    id: 'post-311',
    label: '后311',
    category: '神秘高压向',
    content: `文风：后311
这条文风写灾后、事故后、青春期的荒地和城市边缘。不要把人物写成宣言机器，他们通常说不清自己在反抗什么，只是觉得空气太闷，水泥太冷，霓虹灯照得人想逃。
画面可以偏日本独立电影：便利店、河堤、废弃校舍、自动贩卖机、地下通道、潮湿的球鞋。情绪不要喊出来，用身体和小动作写：跑到没气、把烟按灭、反复擦同一块玻璃、在吵闹里忽然安静。
语言可以断一点，但别乱。热的段落写冲动、噪音、摩擦和短句；冷的段落写长一点，像镜头从人物身上移开，看城市自己发呆。
不要轻易给答案。结尾可以只留下一个动作：有人回头，有人没回头，电车进站，雨停了一半。`,
  },
  // ── 小说故事向 ──
  {
    id: 'realistic-western-fantasy',
    label: '写实西幻',
    category: '小说故事向',
    content: `文风：写实西幻
写实西幻不要只写城堡、骑士和预言。先让世界有重量：泥路、马粪、湿斗篷、盐价、磨损的甲片、炉火边的谣言。权力不是抽象名词，它体现在谁能吃热饭、谁要守夜、谁的姓氏能让士兵让路。
角色做决定时，先考虑能不能活、家族会不会倒、粮草够不够、消息是不是真的。荣誉可以存在，但荣誉要付账。不要让人物因为作者需要突然高尚或突然愚蠢。
战斗写得笨重一点。盔甲会沉，剑会卷刃，人会喘不上气，伤口会影响下一次抬手。阴谋也不要全靠天才台词，更多时候靠误会、迟到的信、被买通的仆人、没有说出口的亲缘关系。
世界观信息尽量从对话、习俗、称呼、食物和路途里露出来。别开百科词条。`,
  },
  {
    id: 'prose-novel',
    label: '散文小说',
    category: '小说故事向',
    content: `文风：散文小说风
文风指导：
1. 故事导向，情节导向。一切的内容都为故事服务，删繁就简。镜头着眼于故事、环境，而非单个人的精细处。写场景、动作，直到必要的内涵表达、情绪表达处才写细微的神态、异动。对话与故事应当是交融的，且大多数时候由故事推动对话。
2. 一切的饮食生活、花草树木，都不游离于故事之外，他们的出现是有益于故事而精简准确的。长篇累牍的故事外的描写会影响故事的流淌。但要注意，精简准确不是语言平泛，而是生动的独到。
情绪表达：
1. 一切情愁都由语言、人物来体现，而非通过旁白讲述。故事中没有"旁白"，故事就是故事，假的要做真的写，真的要做假的写，写作方法是文学的口语，文学的通俗。
2. "随遇而安"。故事的人物总是在情节中隐晦地透露出人性之美，面对生活痛痒，主人公采取的不是"逆来顺受"的悲观态度，而是"随遇而安"的坦然拥抱。
段落指导：段落宜细碎、疏朗。多用三五句话构成的小段落。直白流畅，短句子多，但是段落不散，结构有序。
语言特色：
1. 短句为主：拆解长句与复杂从句。多用流水句，话题推进。
2. 词汇贴到人物来写：多用平实的老派白话与单音节动词，带入自然的口语色彩。
3. 情感留白：叙事语调如话家常。面对大悲大喜，当作寻常日子来写。用客观发生的事实与具体动作代替主观抒情与心理剖析。
4. 有传统文章自然的韵律节奏。`,
  },
  {
    id: 'western-magic',
    label: '西方魔幻',
    category: '小说故事向',
    content: `文风：西方魔幻
这条写法可以更有奇观感，但奇观要落地。魔法学校、古老森林、边境酒馆、龙骨城墙都可以写，重点是让角色真的生活在这些东西旁边，而不是站在景点前介绍。
魔法要有代价或习惯用法。一个小咒语可能要练很多年，一枚护符可能只在雨夜管用，古老家族的誓言可能比法律更麻烦。惊奇感来自规则清楚后的突破，而不是随手万能。
语言可以稍微厚重，保留传说、歌谣、纹章、古老称谓带来的距离感。但不要堆名词。读者需要先看见火光、石阶、斗篷上的雨，再相信这个世界很大。
人物仍然按人来写。巫师会怕冷，骑士会算钱，公主也可能先考虑明天怎么离开这座城。`,
  },
  {
    id: 'chendong-webnovel',
    label: '辰东网文',
    category: '小说故事向',
    content: `文风：辰东网文
这条文风可以写得宏大、热血、带远古谜团，但不要一上来就把词堆满。先给一个抓人的物件或场景：黑暗宇宙里的铜棺、荒山上的残碑、雪地里半截断剑、没人敢靠近的旧矿坑。让读者先想知道它从哪来。
主角的气势要靠选择和承受写出来，不要只靠旁白夸。越大的命运，越要有具体代价：旧友离散、身体受创、背负误解、明知会输也要往前走。
战斗可以磅礴，但要有层次。先写人怎么动，再写天地如何响应。异象不必每次都毁天灭地，关键时刻一次够用。搞笑配角可以调节气氛，但别打断真正悲壮的地方。
悬念可以挖，但每轮至少给一点回报：一块碑文、一个名字、一次旧传说的应验。宏大不是空喊，是让很多小线慢慢扣到一起。`,
  },
  {
    id: 'russian-suffering',
    label: '俄式苦难文风',
    category: '小说故事向',
    content: `文风：俄式苦难文风
这条文风不写宏大的励志弧线，只写人怎样在冷、饿、穷、疲惫和沉默里继续过下去。故事可以很小：等车、排队、修工具、照镜子、送一段路、在雪里把东西搬完。
叙述要像外部观察者，盯住动作和物质细节。镜子、制服、冻硬的手、磨损的鞋底、烟、斧柄、木屋、结冰的呼吸，都比心理剖白更重要。人物难过，不必说难过，写他把帽子摘下又戴回去。
句子可以短，事实一个接一个落下。不要过度修饰，也不要急着同情。寒冷就是寒冷，饥饿就是饥饿，生活不会因为一句漂亮话变好。
对话少而硬，常常是问答、命令、重复或沉默。人物可以清醒地知道自己处境糟糕，但仍然做该做的事。结尾不要强行救赎，留一点灰白色的余味。`,
  },
  {
    id: 'dark-western-fantasy',
    label: '暗黑西幻',
    category: '小说故事向',
    content: `文风：暗黑西幻
暗黑西幻要先让世界不好过。城堡潮湿，盔甲生锈，面包发硬，祈祷不一定有回应。不要把黑暗写成漂亮的装饰，写它怎么压在人身上：寒冷、饥饿、债务、伤口、瘟疫、贵族一句话带来的后果。
叙事先落在身体和物件上，再谈命运。宏大的战争可以从一枚磨钝的刀、一只冻裂的手、马厩里的腐草味开始。越大的事件，越要抓住小细节。
对白短促，像人在危险里省着力气说话。角色可以讥讽、咳嗽、吐掉血沫，也可以沉默。台词要有言外之意，别让人物站在那里解释世界观。
人物不靠苦难升华，他们只是变得更务实。骑士会害怕，巫师会算账，国王也会在夜里咳得直不起腰。每个人都受限于自己知道的东西，别用全知视角替他们做聪明决定。`,
  },
  // ── 古风 ──
  {
    id: 'four-char-blade',
    label: '四字为锋',
    category: '古风',
    content: `文风：半文半白叙事
1. 句式与节奏（四字为锋，极简截断）
  - 规格定音：短句截断，四字为锋。以四字词组作为叙事推进的鼓点。长短句交错，四字短刃主攻，长句铺陈底色。不设过渡语，留白四成。
  - 碎句砸落：以逗号蓄势，以句号杀人。动作连贯、意象叠加处多用逗号压实；唯有绝杀、定格、生死转折处，方用句号强行切断呼吸制造心跳骤停感。
  - 禁换行泄气：严禁频繁换行。以紧凑的顿号和逗号连缀微观动作，憋住胸中一口真气。直到段落末尾重锤落音，才落句号收刀。
2. 意象与感官（古意冷硬，微观放大）
  - 半文半白肌理：择古意冷硬之象。巧嵌虚词（乃、亦、骤、皆、且、矣、哉、之、其）以生凛冽古韵。
  - 诗化意象：择古意自然之象，连续叠加三象。月光一瓢雪水，泼于青石阶。檀香凝鼻端，一线入针。
  - 质感色彩与敌意：万物皆带重量与锋芒。写生铁的冷、血的粘稠、泥沙的粗粝。
  - 视听极度拉近：不写宏观全景。无限放大微观的物理声响或生理触觉。
3. 动词与白描（动作拆解，刀刀见骨）
  - 慢放与拆解：严禁概括性交锋。必须拆解肌肉发力、兵器轨迹、重心偏移。
  - 炼字与动态：一字见瞬时动态。风削山脊。指捻花瓣，嫣红洇入甲缝。
  - 奇崛意象（禁比喻词）：禁止使用"像、如"。直接陈述意象。
  - 情绪彻底剥离：严禁"恐惧、愤怒"等心理词。一切情绪皆化为生理极限反应。
4. 技法与留白（镜头跳跃，不设过渡）
  - 剪辑与清冷节奏：场景与动作转接不设任何过渡语，直接生硬切入。
  - 情感物化：以器物之变传情。伞骨积雪倾泻。砚中墨凝。
  - 压迫感定格：段落末尾，必以极短句或单字收束。如重锤落音，定格生死瞬间。`,
  },
  {
    id: 'dream-red-chamber',
    label: '红楼一梦',
    category: '古风',
    content: `文风：红楼一梦
一、语言层面的特征
1. 整体语言风格：模仿《红楼梦》叙述语言，以文言文为核心内容，但融入白话语感，形成舒缓雅致的节奏。例如用便、因、话说、只当、原等文言过渡词，避免现代词汇，是"带着白话味的文言"。
2. 语法风格：
  - 节奏干净舒缓，韵律感较为明显。多用短句、散句，而辅以韵文，且韵文以四六句为多。
  - 旁白使用文言词，虚词、动词、形容词以上古——中古汉语，古白话常用词为主。在日常生活词汇上使用双音节古词，人物对话上使用近古白话。
  - 旁白行文上，多用"上古汉语""中古汉语"的虚词用法和简约的断句风格，句子结构简单却有古味。涉及到人物对白，佐近古白话和唐以后逐渐形成的近代汉语句式。少用定语小句，多用流水句。
3. 语用层面：人物对话需贴合身份：上层人物多用典雅语言，下层人物偏口语俚俗。关键处可插入韵语或对句总结。情绪激烈处反用简笔，避免直抒胸臆。通过细节动作传达情感：拨弄衣带、拈花不语、对灯出神、欲言又止等。
二、叙事
主要从某一人物的感官和内心展开叙述，不随意跳转。闲笔点缀：叙事中穿插景物、器物、服饰、饮食等细节描写，看似闲笔，实则烘托氛围或暗示情绪。
三、美学意境
以景写情：情绪与景物交融，通过环境描写烘托人物心境。自然意象常用来象征人物气质：如梅花喻孤傲，海棠喻娇憨，柳絮喻飘零。`,
  },
  // ── 特殊向 ──
  {
    id: 'kill-eight-part',
    label: '杀八股',
    category: '特殊向',
    content: `文风：杀八股
这条用来拆掉一眼能看出套路的句子。少写"他感到""她意识到""空气仿佛凝固"，多写事情本身怎么发生。正文开头直接接上一句对白、动作后果、角色反应或现场冲突，别每轮都从沉默、灯光、空气、心跳、风声写起。
开头尤其要干净。不要写"像一颗石子投入心湖""空气中泛起涟漪""沉默蔓延开来""光影拉长了某种情绪"这类熟句。
句子先求准，再求好看。能用一个动词解决的，不堆三个形容词。能让人物自己说出来的，不让旁白替他总结。写感官时按人真正接收信息的顺序来：先闻到油烟，再看见灶台边的水，最后才知道屋里有人刚离开。
比喻要少而贴身。月光、潮水、刀、野兽、深渊这些词别到处乱贴。比喻一旦出现，必须和角色身份、场景物件、当时情绪有关。
少给情绪贴标签。别急着写"他很愤怒""她终于崩溃"。把愤怒写成一句没说完的话、放重的杯子、突然改口、绕开的视线，或者继续做一件看似无关的小事。
段落要有呼吸。紧张处短，承接处稳，情绪落下去时留一点白。每段都问一句：删掉这句话，剧情、人物或气氛有没有少东西？没有就删。`,
  },
  {
    id: 'ensemble-cast',
    label: '群像文风',
    category: '特殊向',
    content: `文风：无主角群像宏大叙事
核心结构：多视角切片 + 事件轴推进
具体解构：
  - 多视角切片-局部信息视角：单一角色在特定时间点的主观所见所思与所为。角色绝对没有"上帝视角"，他们被困在自己的"信息茧房"中，只基于自身的阶级、处境和有限认知做出判断与行动。视角的切换往往伴随身份地位的巨大落差，以此构建全貌。
  - 事件轴推进-冷峻客观叙述：对无情的物理环境、时间流逝、不可抗力事件的客观描述。叙述需要剥离作者的悲悯与偏向，以绝对中立甚至冷酷的态度展现事件的碾压感。
  - 角色动机-绝对自洽的微观聚焦：展现每个人作为"自己生命主角"的合理性，消解传统意义上的"绝对正邪"。高度聚焦于最微观、粗糙的物理感官和最朴素的执念。
额外技巧：
  - 叙述微观性：代入当前视角的角色时，避免空洞的宏大抒情，将笔触狠狠砸向最真实的细节。
  - 情感反差性：利用蒙太奇手法，将角色个体的极端情绪与宏观世界的无动于衷并列，营造宿命感。
  - 视角流转机制：不能硬切，需要依靠"视觉/听觉共享"、"物件传递"或"严格的时间戳"来完成自然过渡。关键节点用长篇幅细致刻画感官，边缘角色用蒙太奇闪回一笔带过。
  - 镜头抽离性：在角色视角的高潮或生死瞬间，果断切断描写，将镜头拉远，无情地转向下一个视角。`,
  },
  {
    id: 'adaptive',
    label: '自适应文风',
    category: '特殊向',
    content: `文风：自由文风
AI 会根据当前的故事情感基调，结合当前剧情、世界观和人物设定自由选择合适的作家文风进行创作。`,
  },
  {
    id: 'black-humor',
    label: '黑色幽默',
    category: '特殊向',
    content: `文风：黑色幽默叙事
指正文以严肃、冷静、近乎纪实的语感，阐述荒谬、残酷、反常的内容。用一本正经的口吻，说离谱的话。不主动强调笑点，不解释幽默，也不提醒读者哪里荒谬。越平静，越荒谬。
整体基调：冷静、荒谬、冷幽默、克制、正常中的不对劲。
核心原则：
  - 用严肃语气描述荒谬内容
  - 逻辑自洽与荒谬感共存
  - 幽默感隐藏在叙事内部，而非浮于表面
  - 不主动制造"段子感"
  - 让荒谬自然发生
黑色幽默的主要体现位置：旁白、环境描写、事件转述、现实观察、转场句。角色本身可以完全正常。
叙述风格要求：使用冷静、认真、近乎纪实的口吻。即使事件本身荒谬、残酷、滑稽，也依然保持平静叙述。
克制原则：幽默感应低频出现，并自然嵌入叙事。大部分正文依然保持正常、克制、稳定、文学化。允许长时间完全没有黑色幽默表达。不要为了"保持文风"而强行输出荒谬句子。
禁止事项：连续使用荒谬比喻、高频社会观察、段段都有作者吐槽、故意制造金句感、互联网段子感、脱口秀式表达、刻意玩梗、过强的"作者存在感"。`,
  },
  {
    id: 'comedy-webnovel',
    label: '搞笑网文',
    category: '特殊向',
    content: `文风：搞笑网文
这条文风要轻快、接地气、反差强。设定可以很正经，角色脑子里的反应一定要活：看见神兵先想能不能换钱，看见仙人做饭先闻香味，看见大场面第一反应是"这合理吗"。
节奏要快，少铺环境，直接把人物扔进事件里。动作干脆，心理活动口语化，震惊和吐槽可以短句爆出来，但不要每句话都像段子。好笑来自人物认真处理离谱事件，而不是旁白一直提醒读者这里很好笑。
夸张可以用，但要有画面。普通炒菜可以写到金光冲天，普通推门可以像副本开怪，普通人出场可以自带荒唐气势。夸张之后要立刻落回人物的具体目标：吃饭、挣钱、保命、赢一口气。
禁止苦大仇深和长篇说教。人物可以倒霉，但基调要松。爽感要直接，笑点要跟剧情一起往前走。`,
  },
  {
    id: 'chat-style',
    label: '聊天风格',
    category: '特殊向',
    content: `文风：聊天风格
定义：扮演角色，与用户进行聊天。
特征：
  - 模拟手机聊天软件的对话形式
  - 用户说一句，回复一句
  - 深刻代入角色身份
  - 仅输出必要的对话内容，无需额外描述`,
  },
];
