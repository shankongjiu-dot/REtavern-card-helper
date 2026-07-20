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
  /** UI-only flag: entry was generated in Step 2 (skeleton mode).
   *  Used to render a "🦴 骨架" badge in Step 4 so users can track which entries
   *  still need AI expansion. Not exported to the SillyTavern card format. */
  fromSkeleton?: boolean;
  /** UI-only flag: entry has been AI-expanded in Step 4 (originally a skeleton).
   *  Renders a "✅ 已展开" badge so users can see at-a-glance what's done. */
  skeletonExpanded?: boolean;
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
  match_whole_words: boolean;
  sticky: number;
  cooldown: number;
  delay: number;
  ignore_budget: boolean;
  /** Optional SillyTavern runtime extensions (display_index, depth, etc.) */
  extensions?: Record<string, unknown>;
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
}

/** AI parsed result for lorebook entry generation */
export interface AIGeneratedLorebookEntry {
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
  /** 剧情 标签/模板：'pure-love' | 'ntr' | 'dual-route' */
  templateId: 'pure-love' | 'ntr' | 'dual-route';
  /** 调度条目命名前缀（如 "林雅宁分阶段人设"），默认 "分阶段人设" */
  dispatcherPrefix: string;
  /** AI 剖析出的角色阶段框架列表 */
  characters: StagedModeCharacter[];
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

/** 世界观锚定 — 结构化约束，防止 AI 生成偏离设定 */
export interface WorldAnchor {
  /** 时代背景：现代/古代/未来/架空/自定义 */
  era: string;
  /** 核心规则：这个世界的基本法则（如"无魔法"、"科技水平约2024年"） */
  coreRules: string;
  /** 禁止偏离项：AI 绝对不能违反的硬性约束（如"不存在超自然力量"） */
  hardConstraints: string;
  /** 基调/氛围：世界的整体调性 */
  tone: string;
}

/** 将 WorldAnchor 格式化为 prompt 注入文本 */
export function formatWorldAnchorForPrompt(anchor: WorldAnchor | undefined): string {
  if (!anchor) return '';
  const parts: string[] = [];
  if (anchor.era) parts.push(`时代背景: ${anchor.era}`);
  if (anchor.coreRules) parts.push(`核心规则: ${anchor.coreRules}`);
  if (anchor.hardConstraints) parts.push(`禁止偏离: ${anchor.hardConstraints}`);
  if (anchor.tone) parts.push(`基调氛围: ${anchor.tone}`);
  return parts.join('\n');
}

/** Wizard draft state shape (shared across pages, hooks, services) */
export interface WizardDraft {
  cardName: string;
  characters: WizardCharacter[];
  lorebookEntries: LorebookEntry[];
  firstMessage: string;
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
  /** World rules / generation constraints (persisted across sessions) */
  worldRules?: string;
  /** 世界观锚定 — 结构化约束 */
  worldAnchor?: WorldAnchor;
  /** Shared UI state between Step 2 (skeleton) and Step 4 (detail worldbook) — keeps the
   *  topic / counts / mode in sync so users don't lose inputs when navigating back & forth. */
  skeletonTopic?: string;
  skeletonCount?: number;
  worldbookBatchCount?: number;
  skeletonModeEnabled?: boolean;
  /** MVU + EJS configuration */
  mvu?: MvuConfig;
  /** Whether to use MVU-aware export (embeds scripts, Zod.txt, regex) */
  useMvuExport?: boolean;
  /** 分阶段模式配置（步骤6，可选启用） */
  stagedMode?: StagedModeConfig;
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
 * Empty lorebook entry template for Step 2/4 (World Book skeleton + detail).
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
 */
export const WIZARD_DRAFT_VERSION = 5;

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
    },
    useMvuExport: false,

    // Step 6: Staged Mode (optional, off by default)
    stagedMode: {
      enabled: false,
      templateId: 'pure-love',
      dispatcherPrefix: '分阶段人设',
      characters: [],
    },

    // Step 7: First message
    firstMessage: '',

    // ── V2 Advanced Fields ──────────────────────────────────────────────────
    scenario: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [] as string[],
    creator_notes: '',
    creator: '',
    character_version: '',
    tags: [] as string[],
    bookScanDepth: 200,
    bookTokenBudget: 1500,
    bookRecursiveScanning: false,
    worldbookNsfw: false,
    worldRules: '',
    worldAnchor: { era: '', coreRules: '', hardConstraints: '', tone: '' },
    // Shared UI state between Step 2 (skeleton) & Step 4 (detail worldbook)
    skeletonTopic: '',
    skeletonCount: 8,
    worldbookBatchCount: 8,
    skeletonModeEnabled: true,
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
  };
}

/** Wizard step definitions with labels and validation flags */
export const WIZARD_STEPS = [
  { id: 1, label: '卡片名称', required: true },
  { id: 2, label: '世界书骨架', required: false },
  { id: 3, label: '角色配置', required: true },
  { id: 4, label: '世界书细节', required: false },
  { id: 5, label: 'MVU变量', required: false },
  { id: 6, label: '分阶段模式', required: false },
  { id: 7, label: '开场白', required: true },
  { id: 8, label: '美化导出', required: false },
] as const;
