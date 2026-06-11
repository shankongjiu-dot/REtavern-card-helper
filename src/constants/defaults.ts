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
}

/** Wizard character (Step 2) — simplified: name + description only */
export interface WizardCharacter {
  id: string;
  name: string;
  description: string;
  /** IDs of world book entries auto-generated from this character */
  entryIds?: string[];
}

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

/** MVU variable kind (aligned with world-book-mcp v5) */
export type MvuVariableKind = 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'record';

/** A single MVU variable definition */
export interface MvuVariable {
  id: string;
  path: string[];          // e.g. ['角色A', '好感度']
  kind: MvuVariableKind;
  defaultValue: unknown;
  description: string;
  enumValues?: string[];
  min?: number;
  max?: number;
  hidden?: boolean;        // $ prefix: invisible to AI
  readonly?: boolean;      // _ prefix: visible but not updatable by AI
  isSeparator?: boolean;   // true for separator/label-only rows (no value)
}

/** Suggested MVU variable from AI analysis */
export interface AIGeneratedMvuVariable {
  path: string[];
  kind: MvuVariableKind;
  defaultValue: unknown;
  description: string;
  enumValues?: string[];
  min?: number;
  max?: number;
  hidden?: boolean;
  readonly?: boolean;
}

/** MVU asset configuration for the card */
export interface MvuConfig {
  enabled: boolean;
  variables: MvuVariable[];
  // Generated asset text (cached for preview)
  schemaJs: string;
  initvarYaml: string;
  updateRulesYaml: string;
  variableListMd: string;
  outputFormatMd: string;
  // Frontend beautification
  statusBarEnabled: boolean;
  statusBarHtml: string;
  statusBarCss: string;
  statusBarMode: 'safe_macro' | 'dynamic_js';
  // Custom beautification requirements (user-inputted description for AI generation)
  statusBarStylePrompt: string;   // User's visual style description
  statusBarCustomEnabled: boolean; // Whether to use custom style instead of default
  // Story view beautification
  storyBeautifyEnabled: boolean;
  storyBeautifyTag: string;
  storyBeautifyHtml: string;
}

/** Wizard draft state shape (shared across pages, hooks, services) */
export interface WizardDraft {
  cardName: string;
  characters: WizardCharacter[];
  lorebookEntries: LorebookEntry[];
  firstMessage: string;
  exampleDialogues: string;
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
  // Step 6: MVU & Beautification
  mvu: MvuConfig;
}

/** Empty character template for Step 2 of the wizard */
export function createEmptyCharacter(): WizardCharacter {
  return {
    id: generateId(),
    name: '',
    description: '',
  };
}

/**
 * Empty lorebook entry template for Step 3 (World Book).
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
 * Empty wizard draft state.
 * Includes all SillyTavern V2 spec fields.
 */
export function createEmptyDraft(): WizardDraft {
  return {
    cardName: '',

    // Step 2: Characters → auto-injected into world book entries
    characters: [createEmptyCharacter()],

    // Step 3: World Book / Character Book entries
    lorebookEntries: [],

    // Step 4: First message
    firstMessage: '',

    // Step 5: Example dialogues (use <START> tags per SillyTavern convention)
    exampleDialogues: '',

    // ── V2 Advanced Fields ──────────────────────────────────────────────────
    // Scenario: circumstances and context of the dialogue (permanent token)
    scenario: '',

    // System prompt override (empty = use user's default)
    system_prompt: '',

    // Post-history instructions / jailbreak override
    post_history_instructions: '',

    // Alternate greetings (shown as "swipes" on first message)
    alternate_greetings: [] as string[],

    // Creator metadata (not used in prompt)
    creator_notes: '',
    creator: '',
    character_version: '',

    // Tags for frontend sorting/filtering
    tags: [] as string[],

    // Character Book-level settings
    bookScanDepth: 200,
    bookTokenBudget: 500,
    bookRecursiveScanning: false,

    // Step 6: MVU & Beautification
    mvu: createEmptyMvuConfig(),
  };
}

/** Empty MVU configuration */
export function createEmptyMvuConfig(): MvuConfig {
  return {
    enabled: false,
    variables: [],
    schemaJs: '',
    initvarYaml: '',
    updateRulesYaml: '',
    variableListMd: '',
    outputFormatMd: '',
    statusBarEnabled: false,
    statusBarHtml: '',
    statusBarCss: '',
    statusBarMode: 'safe_macro',
    statusBarStylePrompt: '',
    statusBarCustomEnabled: false,
    storyBeautifyEnabled: false,
    storyBeautifyTag: 'story_view',
    storyBeautifyHtml: '',
  };
}

/** Wizard step definitions with labels and validation flags */
export const WIZARD_STEPS = [
  { id: 1, label: '卡片名称', required: true },
  { id: 2, label: '角色配置', required: true },
  { id: 3, label: '世界书', required: false },
  { id: 4, label: '开场白', required: true },
  { id: 5, label: '示例对话', required: false },
  { id: 6, label: '美化/MVU', required: false },
  { id: 7, label: '预览保存', required: true },
] as const;
