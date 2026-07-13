/**
 * Novel Workshop - TypeScript type definitions
 * Migrated from .temp_statusbar.astro
 */

// ── Core State Types ──────────────────────────────────────────────────────

export type GateMode = 'stage_flags' | 'stage_only' | 'public_only';
export type NarrativeMode = 'story' | 'lore_only';
export type CategoryId = 'character' | 'location' | 'faction' | 'rule' | 'item';

export interface NovelWorkshopState {
  sourceText: string;
  contextText: string;
  gateMode: GateMode;
  narrativeMode: NarrativeMode;
  entryBudget: number;
  chunkCharLimit: number;
  focus: CategoryId[];
  summary: string;
  stageOrder: string[];
  currentStage: string;
  flags: RevealFlag[];
  entityIndex: EntityIndex[];
  generatedEntries: GeneratedEntry[];
  generatedVariables: VariableBlueprint[];
  generatedAt: string;
  lastFileName: string;
}

export interface RevealFlag {
  id: string;
  label: string;
  description: string;
  value: boolean;
}

export interface EntityIndex {
  id: string;
  name: string;
  category: EntityCategory;
  aliases: string[];
  summary: string;
}

export type EntityCategory = 'character' | 'location' | 'faction' | 'rule' | 'item' | 'event';

export interface GeneratedEntry {
  id: string;
  entityId: string;
  category: EntityCategory;
  name: string;
  aspect: string;
  content: string;
  keys: string[];
  stage: string;
  requiredFlags: string[];
  strategy: EntryStrategy;
  priority: number;
}

export type EntryStrategy = 'constant' | 'selective';

export interface VariableBlueprint {
  path: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  options?: string[];
  default?: unknown;
  description: string;
  check?: string[];
  min?: number;
  max?: number;
}

// ── Workflow Types ────────────────────────────────────────────────────────

export type WorkflowPhase = 'idle' | 'extract' | 'merge' | 'inject' | 'done';

export interface WorkflowRunState {
  phase: WorkflowPhase;
  extractionDone: number;
  extractionTotal: number;
  mergeDone: number;
  mergeTotal: number;
  failedChunks: number[];
  mergeFallbacks: number;
}

export interface CallEstimate {
  sourceChars: number;
  chunkCount: number;
  mergeCalls: number;
  totalCalls: number;
  chunkSize: number;
}

export interface Checkpoint {
  signature: string;
  sourceHash: string;
  chunkSize: number;
  totalChunks: number;
  phase: 'extract' | 'merge';
  partials: NovelPackage[];
  pending?: NovelPackage[];
  mergeDone?: number;
  mergeTotal?: number;
  updatedAt: string;
}

// ── Package Types ─────────────────────────────────────────────────────────

export interface NovelPackage {
  summary: string;
  stage_order: string[];
  stageOrder?: string[];
  reveal_flags: RevealFlagData[];
  revealFlags?: RevealFlagData[];
  entity_index: EntityIndexData[];
  entityIndex?: EntityIndexData[];
  variables: VariableBlueprint[];
  entries: EntryData[];
}

export interface RevealFlagData {
  id: string;
  label: string;
  name?: string;
  description?: string;
  desc?: string;
  default?: boolean;
}

export interface EntityIndexData {
  id: string;
  name: string;
  category: string;
  aliases?: string[];
  public_summary?: string;
  summary?: string;
}

export interface EntryData {
  id?: string;
  entity_id?: string;
  entityId?: string;
  category?: string;
  name?: string;
  title?: string;
  aspect?: string;
  slot?: string;
  content?: string;
  keys?: string[];
  aliases?: string[];
  stage?: string;
  required_flags?: string[];
  requiredFlags?: string[];
  strategy?: string;
  priority?: number;
}

// ── File Import Types ─────────────────────────────────────────────────────

export interface ImportedFileMeta {
  name: string;
  charCount: number;
}

// ── API Types ─────────────────────────────────────────────────────────────

export interface ChatPrompt {
  system: string;
  user: string;
}

export interface ApiResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

// ── UI Types ──────────────────────────────────────────────────────────────

export interface FocusOption {
  id: CategoryId;
  label: string;
}

export interface WorkflowStep {
  title: string;
  detail: string;
}

export interface CategoryLabelMap {
  [key: string]: string;
}

// ── Constants ─────────────────────────────────────────────────────────────

export const DEFAULT_STAGE_ORDER = ['公开', '前期', '中期', '后期', '终局'] as const;

export const FOCUS_OPTIONS: FocusOption[] = [
  { id: 'character', label: '人物' },
  { id: 'location', label: '地点' },
  { id: 'faction', label: '势力' },
  { id: 'rule', label: '规则' },
  { id: 'item', label: '物品' },
];

export const CATEGORY_LABELS: CategoryLabelMap = {
  character: '人物',
  location: '地点',
  faction: '势力',
  rule: '规则',
  item: '物品',
  event: '事件',
};

export const DEFAULT_CHUNK_CHAR_LIMIT = 20000;
export const DEFAULT_SAFE_PROMPT_TOKENS = 50000;
export const LONG_CONTEXT_SAFE_PROMPT_TOKENS = 1000000;
export const MERGE_BATCH_SIZE = 6;
export const MAX_WORKFLOW_CALLS = 80;

export const STORAGE_KEY = 'novelWorkshop';
export const RAW_STORAGE_PREFIX = 'novelWorkshopRaw::';
export const CHECKPOINT_PREFIX = 'novelWorkshopCheckpoint::';
