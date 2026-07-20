/**
 * useNovelState - Core state management hook for Novel Workshop
 * Migrated from .temp_statusbar.astro
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  NovelWorkshopState,
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
  clampNumber,
} from '../utils';
import { consumeWorkshopBridge } from '../../../services/novel-workshop-bridge';
import { readFileText, MAX_NOVEL_FILE_BYTES, formatFileSize } from '../../../services/file-decode';

/** Detect quota/space errors so we can warn instead of silently losing data. */
function isQuotaError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return (
      err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014
    );
  }
  return err instanceof Error && err.name === 'QuotaExceededError';
}

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
  return RAW_STORAGE_PREFIX + 'global';
}

function getCheckpointStorageKey(): string {
  return CHECKPOINT_PREFIX + 'global';
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
    failedChunks: [],
    mergeFallbacks: 0,
  });
  const [statusText, setStatusText] = useState<string>('');
  const [statusColor, setStatusColor] = useState<string>('var(--color-status-success)');

  const rawSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quotaWarnedRef = useRef(false);

  // ── Status Helper ─────────────────────────────────────────────────────

  const setStatus = useCallback((text: string, color?: string) => {
    setStatusText(text);
    setStatusColor(color || 'var(--color-status-success)');
  }, []);

  // Warn about storage exhaustion at most once per session to avoid spamming.
  const warnQuotaOnce = useCallback((message: string) => {
    if (quotaWarnedRef.current) return;
    quotaWarnedRef.current = true;
    setStatus(message, 'var(--color-status-danger)');
  }, [setStatus]);

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
    try {
      localStorage.setItem(getCheckpointStorageKey(), JSON.stringify(checkpoint));
    } catch (err) {
      // A full checkpoint (all partial packages) can exceed localStorage quota.
      // Surface this so the user knows resume may not work — instead of failing
      // silently and losing progress.
      if (isQuotaError(err)) {
        warnQuotaOnce('⚠️ 浏览器本地存储空间不足，断点续跑进度可能无法保存。请清理浏览器存储或分页处理后再试。');
      }
    }
  }, [warnQuotaOnce]);

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

  const handleFileImport = useCallback(async (file: File) => {
    if (!file) return;
    if (file.size > MAX_NOVEL_FILE_BYTES) {
      setStatus(`❌ 文件过大（${formatFileSize(file.size)}），已超出 ${formatFileSize(MAX_NOVEL_FILE_BYTES)} 上限，请拆分或压缩后重试。`, 'var(--color-status-danger)');
      return;
    }
    try {
      const { text, encoding, wasReencoded } = await readFileText(file);
      if (!text.trim()) {
        setStatus(`❌ 文件内容为空：${file.name}`, 'var(--color-status-danger)');
        return;
      }
      setImportedFileText(text);
      setImportedFileMeta({
        name: String(file.name || '未命名文件'),
        charCount: text.length,
      });
      setStatus(
        wasReencoded
          ? `✅ 已载入文件：${file.name}（自动识别为 ${encoding.toUpperCase()} 编码并转码），全文仅保留在内存中。`
          : `✅ 已载入文件：${file.name}，全文仅保留在内存中。`,
        'var(--color-info)'
      );
    } catch (err) {
      setStatus(`❌ 文件读取失败：${file.name}（${err instanceof Error ? err.message : '未知错误'}），请检查文件是否损坏或权限不足。`, 'var(--color-status-danger)');
    }
  }, [setStatus]);

  const clearFile = useCallback(() => {
    setImportedFileText('');
    setImportedFileMeta(null);
    setStatus('已清空当前导入文件，保留手动摘录。', 'var(--color-text-muted)');
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
      failedChunks: [],
      mergeFallbacks: 0,
    });
    clearRawState();
    clearCheckpoint();
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setStatus('已重置小说世界书工坊。', 'var(--color-text-muted)');
  }, [clearRawState, clearCheckpoint, setStatus]);

  // ── Load from Extension ──────────────────────────────────────────────

  const loadFromExtension = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (!data || typeof data !== 'object') return;
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
    } catch {
      // Corrupted storage entry; ignore
    }
  }, [loadRawState]);

  // ── Auto-persist generated state (always uses latest state, no stale closure) ──
  useEffect(() => {
    if (!state.generatedEntries.length && !state.summary) return;
    if (fullSaveTimer.current) clearTimeout(fullSaveTimer.current);
    fullSaveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          summary: state.summary,
          stageOrder: state.stageOrder,
          currentStage: state.currentStage,
          flags: state.flags,
          entityIndex: state.entityIndex,
          generatedEntries: state.generatedEntries,
          generatedVariables: state.generatedVariables,
          generatedAt: state.generatedAt,
        }));
      } catch (err) {
        // localStorage may be full; warn (once) so the user knows results
        // aren't being saved instead of failing silently.
        if (isQuotaError(err) && !quotaWarnedRef.current) {
          quotaWarnedRef.current = true;
          setStatus('⚠️ 浏览器本地存储空间不足，生成的条目可能无法自动保存。请清理浏览器存储后重试。', 'var(--color-status-danger)');
        }
      }
    }, 300);
    return () => {
      if (fullSaveTimer.current) clearTimeout(fullSaveTimer.current);
    };
  }, [state.summary, state.stageOrder, state.currentStage, state.flags, state.entityIndex, state.generatedEntries, state.generatedVariables, state.generatedAt, setStatus]);

  // ── Initialize ───────────────────────────────────────────────────────

  useEffect(() => {
    const bridge = consumeWorkshopBridge();
    if (bridge) {
      setImportedFileText(bridge.sourceText);
      if (bridge.sourceText) {
        setImportedFileMeta({
          name: bridge.title || '来自小说分析',
          charCount: bridge.sourceText.length,
        });
      }
      setState(prev => ({
        ...prev,
        contextText: bridge.contextText,
        lastFileName: bridge.title || '',
      }));
      setStatus('已从小说分析导入原文与分析摘要，可直接生成。', 'var(--color-status-success)');
    }
    loadFromExtension();
  }, [loadFromExtension, setStatus]);

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
      value: prev ? !!prev.value : (flag.value !== undefined ? !!flag.value : flag.default === true),
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
  const seen = new Set<string>();
  return (vars || []).map((v: any) => {
    const copy = { ...(v || {}) };
    if (!copy.path) copy.path = copy.name || '';
    return copy;
  }).filter((v: VariableBlueprint) => {
    const path = String(v.path || '').trim();
    if (!path || seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}
