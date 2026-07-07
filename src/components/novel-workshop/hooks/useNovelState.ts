/**
 * useNovelState - Core state management hook for Novel Workshop
 * Migrated from .temp_statusbar.astro
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  NovelWorkshopState,
  GateMode,
  NarrativeMode,
  CategoryId,
  EntityCategory,
  EntryStrategy,
  RevealFlag,
  EntityIndex,
  GeneratedEntry,
  VariableBlueprint,
  ImportedFileMeta,
  WorkflowRunState,
  Checkpoint,
  NovelPackage,
} from '../types';
import {
  DEFAULT_STAGE_ORDER,
  DEFAULT_CHUNK_CHAR_LIMIT,
  STORAGE_KEY,
  RAW_STORAGE_PREFIX,
  CHECKPOINT_PREFIX,
} from '../types';
import {
  uniqueStrings,
  stageOptionsForMode,
  stableId,
  sanitizeSegment,
  hashString,
  clampNumber,
} from '../utils';

// ── Default State Factory ─────────────────────────────────────────────────

function createDefaultState(): NovelWorkshopState {
  return {
    sourceText: '',
    contextText: '',
    gateMode: 'stage_flags',
    narrativeMode: 'story',
    entryBudget: 18,
    chunkCharLimit: DEFAULT_CHUNK_CHAR_LIMIT,
    focus: ['character', 'location', 'faction', 'rule'],
    summary: '',
    stageOrder: [...DEFAULT_STAGE_ORDER],
    currentStage: '公开',
    flags: [],
    entityIndex: [],
    generatedEntries: [],
    generatedVariables: [],
    generatedAt: '',
    lastFileName: '',
  };
}

// ── Storage Helpers ────────────────────────────────────────────────────────

function getRawStorageKey(): string {
  const draftId = window.__getCurrentDraftId__ ? window.__getCurrentDraftId__() : '';
  return RAW_STORAGE_PREFIX + (draftId || 'global');
}

function getCheckpointStorageKey(): string {
  const draftId = window.__getCurrentDraftId__ ? window.__getCurrentDraftId__() : '';
  return CHECKPOINT_PREFIX + (draftId || 'global');
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useNovelState() {
  const [state, setState] = useState<NovelWorkshopState>(createDefaultState);
  const [importedFileText, setImportedFileText] = useState<string>('');
  const [importedFileMeta, setImportedFileMeta] = useState<ImportedFileMeta | null>(null);
  const [workflowRunState, setWorkflowRunState] = useState<WorkflowRunState>({
    phase: 'idle',
    extractionDone: 0,
    extractionTotal: 0,
    mergeDone: 0,
    mergeTotal: 0,
  });
  const [statusText, setStatusText] = useState<string>('');
  const [statusColor, setStatusColor] = useState<string>('#34d399');

  const suppressReload = useRef(false);
  const rawSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Status Helper ─────────────────────────────────────────────────────

  const setStatus = useCallback((text: string, color?: string) => {
    setStatusText(text);
    setStatusColor(color || '#34d399');
  }, []);

  // ── Raw State Persistence ─────────────────────────────────────────────

  const saveRawState = useCallback(() => {
    try {
      localStorage.setItem(getRawStorageKey(), JSON.stringify({
        sourceText: state.sourceText,
        contextText: state.contextText,
        gateMode: state.gateMode,
        narrativeMode: state.narrativeMode,
        entryBudget: state.entryBudget,
        chunkCharLimit: state.chunkCharLimit,
        focus: state.focus,
      }));
    } catch {}
  }, [state.sourceText, state.contextText, state.gateMode, state.narrativeMode, state.entryBudget, state.chunkCharLimit, state.focus]);

  const clearRawState = useCallback(() => {
    try { localStorage.removeItem(getRawStorageKey()); } catch {}
  }, []);

  const scheduleRawStateSave = useCallback(() => {
    if (rawSaveTimer.current) clearTimeout(rawSaveTimer.current);
    rawSaveTimer.current = setTimeout(saveRawState, 350);
  }, [saveRawState]);

  const loadRawState = useCallback((currentState: NovelWorkshopState): NovelWorkshopState => {
    try {
      const raw = JSON.parse(localStorage.getItem(getRawStorageKey()) || 'null');
      if (!raw || typeof raw !== 'object') return currentState;
      const next = { ...currentState };
      next.sourceText = String(raw.sourceText || '').trim();
      next.contextText = String(raw.contextText || '').trim();
      if (['stage_flags', 'stage_only', 'public_only'].indexOf(raw.gateMode) >= 0) next.gateMode = raw.gateMode;
      if (['story', 'lore_only'].indexOf(raw.narrativeMode) >= 0) next.narrativeMode = raw.narrativeMode;
      if (raw.entryBudget) next.entryBudget = Number(raw.entryBudget) || next.entryBudget;
      if (raw.chunkCharLimit) next.chunkCharLimit = Number(raw.chunkCharLimit) || next.chunkCharLimit;
      if (Array.isArray(raw.focus)) {
        const validFocus = uniqueStrings(raw.focus).filter((id: string) =>
          ['character', 'location', 'faction', 'rule', 'item'].includes(id)
        ) as CategoryId[];
        next.focus = validFocus.length ? validFocus : ['character', 'location', 'faction', 'rule'];
      }
      return next;
    } catch {
      return currentState;
    }
  }, []);

  // ── Checkpoint Persistence ────────────────────────────────────────────

  const saveCheckpoint = useCallback((checkpoint: Checkpoint) => {
    try { localStorage.setItem(getCheckpointStorageKey(), JSON.stringify(checkpoint)); } catch {}
  }, []);

  const clearCheckpoint = useCallback(() => {
    try { localStorage.removeItem(getCheckpointStorageKey()); } catch {}
  }, []);

  const loadCheckpoint = useCallback((signature: string): Checkpoint | null => {
    try {
      const checkpoint = JSON.parse(localStorage.getItem(getCheckpointStorageKey()) || 'null');
      if (!checkpoint || checkpoint.signature !== signature) return null;
      if (!Array.isArray(checkpoint.partials)) return null;
      if (checkpoint.phase === 'merge' && !Array.isArray(checkpoint.pending)) checkpoint.phase = 'extract';
      return checkpoint;
    } catch {
      return null;
    }
  }, []);

  // ── State Update Helpers ──────────────────────────────────────────────

  const updateState = useCallback((updater: (prev: NovelWorkshopState) => NovelWorkshopState) => {
    setState(prev => {
      const next = updater(prev);
      return next;
    });
  }, []);

  const syncInputsIntoState = useCallback((updates: Partial<NovelWorkshopState>) => {
    setState(prev => {
      const next = { ...prev, ...updates };
      next.stageOrder = stageOptionsForMode(next.gateMode, next.stageOrder);
      if (next.stageOrder.indexOf(next.currentStage) < 0) next.currentStage = next.stageOrder[0];
      if (next.gateMode !== 'stage_flags') next.flags = [];
      return next;
    });
    scheduleRawStateSave();
  }, [scheduleRawStateSave]);

  // ── Combined Source Text ──────────────────────────────────────────────

  const getCombinedSourceText = useCallback((): string => {
    const parts: string[] = [];
    if (importedFileText) parts.push(importedFileText);
    if (state.sourceText) parts.push(state.sourceText);
    return parts.join('\n\n').trim();
  }, [importedFileText, state.sourceText]);

  // ── File Import ──────────────────────────────────────────────────────

  const handleFileImport = useCallback((file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = String(event.target?.result || '');
      setImportedFileText(text);
      setImportedFileMeta({
        name: String(file.name || '未命名文件'),
        charCount: text.length,
      });
      setStatus(`✅ 已载入文件：${file.name}，全文仅保留在内存中。`, '#38bdf8');
    };
    reader.onerror = () => {
      setStatus(`❌ 文件读取失败：${file.name}，请检查文件是否损坏或权限不足。`, '#f87171');
    };
    reader.readAsText(file, 'utf-8');
  }, [setStatus]);

  const clearFile = useCallback(() => {
    setImportedFileText('');
    setImportedFileMeta(null);
    setStatus('已清空当前导入文件，保留手动摘录。', '#64748b');
  }, [setStatus]);

  // ── Reset ────────────────────────────────────────────────────────────

  const resetWorkshop = useCallback(() => {
    setState(createDefaultState());
    setImportedFileText('');
    setImportedFileMeta(null);
    setWorkflowRunState({
      phase: 'idle',
      extractionDone: 0,
      extractionTotal: 0,
      mergeDone: 0,
      mergeTotal: 0,
    });
    clearRawState();
    clearCheckpoint();
    setStatus('已重置小说世界书工坊。', '#64748b');
  }, [clearRawState, clearCheckpoint, setStatus]);

  // ── Load from Extension ──────────────────────────────────────────────

  const loadFromExtension = useCallback(() => {
    if (suppressReload.current) return;
    if (!window.__getCardExtension__) return;
    const data = window.__getCardExtension__(STORAGE_KEY) as Record<string, unknown> | null;
    if (data && typeof data === 'object') {
      setState(prev => {
        const next = { ...prev };
        next.summary = String(data.summary || '').trim();
        next.stageOrder = stageOptionsForMode(next.gateMode, data.stageOrder as string[] | undefined);
        next.currentStage = next.stageOrder.indexOf(data.currentStage as string) >= 0 ? (data.currentStage as string) : next.stageOrder[0];
        next.flags = normalizeFlags((data.flags as unknown[]) || [], []);
        next.entityIndex = normalizeEntityIndex((data.entityIndex as unknown[]) || []);
        next.generatedEntries = normalizeEntries((data.generatedEntries as unknown[]) || [], next.stageOrder);
        next.generatedVariables = normalizeVariables((data.generatedVariables as unknown[]) || []);
        next.generatedAt = String(data.generatedAt || '').trim();
        return loadRawState(next);
      });
    }
  }, [loadRawState]);

  // ── Persist to Extension ─────────────────────────────────────────────

  const persistState = useCallback(() => {
    if (!window.__setCardExtension__) return;
    suppressReload.current = true;
    window.__setCardExtension__(STORAGE_KEY, {
      summary: state.summary,
      stageOrder: state.stageOrder,
      currentStage: state.currentStage,
      flags: state.flags,
      entityIndex: state.entityIndex,
      generatedEntries: state.generatedEntries,
      generatedVariables: state.generatedVariables,
      generatedAt: state.generatedAt,
    });
    suppressReload.current = false;
    saveRawState();
  }, [state, saveRawState]);

  // ── Initialize ───────────────────────────────────────────────────────

  useEffect(() => {
    loadFromExtension();
    window.addEventListener('card-builder-data-changed', loadFromExtension);
    return () => {
      window.removeEventListener('card-builder-data-changed', loadFromExtension);
    };
  }, [loadFromExtension]);

  return {
    // State
    state,
    importedFileText,
    importedFileMeta,
    workflowRunState,
    statusText,
    statusColor,

    // State updaters
    updateState,
    syncInputsIntoState,
    setWorkflowRunState,
    setStatus,

    // File operations
    handleFileImport,
    clearFile,
    getCombinedSourceText,

    // Persistence
    persistState,
    saveCheckpoint,
    clearCheckpoint,
    loadCheckpoint,

    // Actions
    resetWorkshop,
    loadFromExtension,
  };
}

// ── Normalization Helpers ──────────────────────────────────────────────────

function normalizeFlags(flags: any[], prevFlags: RevealFlag[]): RevealFlag[] {
  const prevMap: Record<string, RevealFlag> = {};
  (prevFlags || []).forEach((flag) => { prevMap[flag.id] = flag; });
  return (flags || []).map((flag: any, index: number) => {
    const id = stableId('flag', flag.id || flag.key || flag.label, index);
    const prev = prevMap[id];
    return {
      id,
      label: String(flag.label || flag.name || id).trim(),
      description: String(flag.description || flag.desc || '').trim(),
      value: prev ? !!prev.value : flag.default === true,
    };
  }).filter((flag: RevealFlag, index: number, list: RevealFlag[]) =>
    list.findIndex((item) => item.id === flag.id) === index
  ).slice(0, 16);
}

function normalizeEntityIndex(entityIndex: any[]): EntityIndex[] {
  return (entityIndex || []).map((entity: any, index: number) => {
    const name = String(entity.name || '未命名实体').trim();
    const category = String(entity.category || 'character').toLowerCase() as EntityCategory;
    return {
      id: stableId('entity', entity.id || name, index),
      name,
      category,
      aliases: uniqueStrings(entity.aliases || []),
      summary: String(entity.public_summary || entity.summary || '').trim(),
    };
  }).filter((entity: { id: string; name: string }) => entity.id && entity.name)
    .filter((entity: { id: string; name: string }, index: number, list: { id: string; name: string }[]) =>
      list.findIndex((item) => item.id === entity.id || item.name === entity.name) === index
    ) as EntityIndex[];
}

function normalizeEntries(entries: any[], stageOrder: string[]): GeneratedEntry[] {
  return (entries || []).map((entry: any, index: number) => {
    const stage = stageOrder.indexOf(entry.stage) >= 0 ? entry.stage : stageOrder[0];
    const name = String(entry.name || entry.title || '未命名条目').trim();
    const category = String(entry.category || 'rule').toLowerCase() as EntityCategory;
    let strategy = String(entry.strategy || '').toLowerCase() as EntryStrategy;
    if (['constant', 'selective'].indexOf(strategy) < 0) strategy = category === 'rule' ? 'constant' : 'selective';
    return {
      id: stableId('entry', entry.id || name, index),
      entityId: stableId('entity', entry.entity_id || entry.entityId || name, index),
      category,
      name,
      aspect: String(entry.aspect || entry.slot || '').trim(),
      content: String(entry.content || '').trim(),
      keys: uniqueStrings((entry.keys || []).concat(entry.aliases || [], entry.name ? [entry.name] : [])),
      stage,
      requiredFlags: uniqueStrings(entry.required_flags || entry.requiredFlags || []).map(sanitizeSegment),
      strategy,
      priority: clampNumber(entry.priority, 100, 1000, 700),
    };
  }).filter((entry: { name: string; content: string }) => entry.name && entry.content)
    .filter((entry: { entityId: string; category: string; stage: string; aspect: string; name: string }, index: number, list: { entityId: string; category: string; stage: string; aspect: string; name: string }[]) => {
      const key = [entry.entityId, entry.category, entry.stage, entry.aspect || entry.name].join('|');
      return list.findIndex((item) =>
        [item.entityId, item.category, item.stage, item.aspect || item.name].join('|') === key
      ) === index;
    }) as GeneratedEntry[];
}

function normalizeVariables(vars: any[]): VariableBlueprint[] {
  return (vars || []).map((v: any) => {
    const copy = { ...(v || {}) };
    if (!copy.path) copy.path = copy.name || '';
    return copy;
  }).filter((v: VariableBlueprint) => String(v.path || '').trim());
}
