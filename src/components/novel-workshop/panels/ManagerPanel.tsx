/**
 * ManagerPanel - World book unlock management
 * Migrated from .temp_statusbar.astro
 */

import { useMemo, useState, useEffect, useRef, type ReactNode } from 'react';
import type { GeneratedEntry, EntityIndex, RevealFlag, EntityCategory } from '../types';
import { categoryLabel } from '../utils';
import { Modal } from '../../shared/Modal';
import { useToast } from '../../shared/Toast';

const ALL_CATEGORIES: EntityCategory[] = ['character', 'location', 'faction', 'rule', 'item', 'event'];

type ConfirmAction =
  | { type: 'single'; entryId: string; name: string }
  | { type: 'stage'; stage: string; count: number }
  | { type: 'all'; count: number }
  | { type: 'keepOnlyStage'; stage: string; count: number }
  | { type: 'selected'; count: number };

interface ManagerPanelProps {
  visible: boolean;
  summary: string;
  stageOrder: string[];
  currentStage: string;
  flags: RevealFlag[];
  entityIndex: EntityIndex[];
  generatedEntries: GeneratedEntry[];
  onStageChange: (stage: string) => void;
  onFlagToggle: (flagId: string, value: boolean) => void;
  onSyncVariables: () => void;
  onDeleteEntry?: (entryId: string) => void;
  onDeleteEntries?: (entryIds: string[]) => void;
  onUpdateEntry?: (entryId: string, updates: Partial<GeneratedEntry>) => void;
  onUpdateEntries?: (entryIds: string[], updates: Partial<GeneratedEntry>) => void;
  onAddEntry?: (entry: GeneratedEntry) => void;
  onAddEntries?: (entries: GeneratedEntry[]) => void;
  onReorderEntries?: (entryIds: string[]) => void;
  onImportEntries?: (entries: GeneratedEntry[]) => void;
}

function highlightText(text: string, query: string): ReactNode {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let index = lower.indexOf(trimmed);
  while (index !== -1) {
    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    parts.push(
      <mark key={index} className="novel-search-highlight">{text.slice(index, index + trimmed.length)}</mark>,
    );
    lastIndex = index + trimmed.length;
    index = lower.indexOf(trimmed, lastIndex);
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function createEmptyEntry(stage: string): GeneratedEntry {
  return {
    id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    entityId: '',
    category: 'rule',
    name: '新条目',
    aspect: '',
    content: '',
    keys: [],
    stage,
    requiredFlags: [],
    strategy: 'selective',
    priority: 700,
  };
}

function estimateTokens(text: string): number {
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chinese + Math.ceil(englishWords * 0.75);
}

function formatNumber(n: number): string {
  return n.toLocaleString('zh-CN');
}

export function ManagerPanel({
  visible,
  summary,
  stageOrder,
  currentStage,
  flags,
  entityIndex,
  generatedEntries,
  onStageChange,
  onFlagToggle,
  onSyncVariables,
  onDeleteEntry,
  onDeleteEntries,
  onUpdateEntry,
  onUpdateEntries,
  onAddEntry,
  onAddEntries,
  onReorderEntries,
  onImportEntries,
}: ManagerPanelProps) {
  const { addToast } = useToast();

  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<ConfirmAction | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<GeneratedEntry>>({});
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [pendingUndo, setPendingUndo] = useState<{ entries: GeneratedEntry[]; timeoutId: ReturnType<typeof setTimeout> } | null>(null);
  const [bulkEditForm, setBulkEditForm] = useState<{ priority?: string; strategy?: '' | 'constant' | 'selective'; aspect?: string }>({});
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const canDelete = Boolean(onDeleteEntry || onDeleteEntries);
  const canEdit = Boolean(onUpdateEntry);
  const canAdd = Boolean(onAddEntry);
  const canAddMany = Boolean(onAddEntries);
  const canReorder = Boolean(onReorderEntries);
  const canImport = Boolean(onImportEntries);

  // Keyboard shortcuts while editing: ESC cancel, Ctrl/Cmd+Enter save
  useEffect(() => {
    if (!editingEntryId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setEditingEntryId(null);
        setEditForm({});
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const name = editForm.name?.trim();
        if (!name) {
          addToast('error', '条目名称不能为空');
          return;
        }
        onUpdateEntry?.(editingEntryId, editForm);
        addToast('success', `已保存「${name}」`);
        setEditingEntryId(null);
        setEditForm({});
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editingEntryId, editForm, onUpdateEntry, addToast]);

  // Auto-focus name input when entering edit mode
  useEffect(() => {
    if (editingEntryId) {
      const timer = setTimeout(() => nameInputRef.current?.focus(), 30);
      return () => clearTimeout(timer);
    }
  }, [editingEntryId]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of generatedEntries) {
      counts[entry.stage] = (counts[entry.stage] || 0) + 1;
    }
    return counts;
  }, [generatedEntries]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const entry of generatedEntries) {
      set.add(entry.category);
    }
    return Array.from(set);
  }, [generatedEntries]);

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return generatedEntries.filter((entry) => {
      const matchesStage = entry.stage === currentStage;
      const matchesCategory = selectedCategories.size === 0 || selectedCategories.has(entry.category);
      if (!query) return matchesStage && matchesCategory;
      const matchesSearch =
        entry.name.toLowerCase().includes(query) ||
        entry.content.toLowerCase().includes(query) ||
        entry.aspect.toLowerCase().includes(query) ||
        entry.keys.some((key) => key.toLowerCase().includes(query));
      return matchesStage && matchesCategory && matchesSearch;
    });
  }, [generatedEntries, currentStage, selectedCategories, searchQuery]);

  const stats = useMemo(() => {
    const totalEntries = generatedEntries.length;
    const currentStageEntries = generatedEntries.filter((e) => e.stage === currentStage).length;
    const tokenEstimate = generatedEntries.reduce((sum, e) => {
      const text = `${e.name} ${e.aspect} ${e.content} ${e.keys.join(' ')}`;
      return sum + estimateTokens(text);
    }, 0);
    const strategyCounts = generatedEntries.reduce((acc, e) => {
      acc[e.strategy] = (acc[e.strategy] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const categoryCounts = generatedEntries.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return { totalEntries, currentStageEntries, tokenEstimate, strategyCounts, categoryCounts };
  }, [generatedEntries, currentStage]);

  if (!visible) return null;

  const toggleEntry = (id: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpandedEntries(new Set(filteredEntries.map((e) => e.id)));
  const collapseAll = () => setExpandedEntries(new Set());

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedCategories(new Set());
  };

  const startEdit = (entry: GeneratedEntry) => {
    setEditingEntryId(entry.id);
    setEditForm({ ...entry });
    setExpandedEntries((prev) => new Set(prev).add(entry.id));
  };

  const saveEdit = () => {
    if (!editingEntryId || !canEdit) return;
    const name = editForm.name?.trim();
    if (!name) {
      addToast('error', '条目名称不能为空');
      return;
    }
    onUpdateEntry?.(editingEntryId, editForm);
    addToast('success', `已保存「${name}」`);
    setEditingEntryId(null);
    setEditForm({});
  };

  const cancelEdit = () => {
    setEditingEntryId(null);
    setEditForm({});
  };

  const duplicateEntry = (entry: GeneratedEntry) => {
    if (!canAdd) return;
    const newEntry: GeneratedEntry = { ...entry, id: createEmptyEntry(entry.stage).id, name: `${entry.name} (副本)` };
    onAddEntry?.(newEntry);
    addToast('success', `已复制「${entry.name}」`);
    startEdit(newEntry);
  };

  const addEntry = () => {
    if (!canAdd) return;
    const newEntry = createEmptyEntry(currentStage);
    onAddEntry?.(newEntry);
    addToast('info', '已新增空白条目，请编辑内容');
    startEdit(newEntry);
  };

  const moveEntry = (entryId: string, direction: 'up' | 'down') => {
    if (!onReorderEntries) return;
    const ids = generatedEntries.map((e) => e.id);
    const idx = ids.indexOf(entryId);
    if (idx === -1) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= ids.length) return;
    const nextIds = [...ids];
    [nextIds[idx], nextIds[newIdx]] = [nextIds[newIdx], nextIds[idx]];
    onReorderEntries(nextIds);
  };

  // Drag-and-drop handlers (HTML5 native)
  const handleDragStart = (e: React.DragEvent<HTMLElement>, id: string) => {
    if (!canReorder) {
      e.preventDefault();
      return;
    }
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Transparent drag image fallback is handled by browser
  };

  const handleDragOver = (e: React.DragEvent<HTMLElement>, id: string) => {
    if (!canReorder || !draggingId || draggingId === id) return;
    e.preventDefault();
    setDragOverId(id);
  };

  const handleDrop = (e: React.DragEvent<HTMLElement>, targetId: string) => {
    e.preventDefault();
    if (!canReorder || !draggingId || draggingId === targetId) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    const ids = generatedEntries.map((e) => e.id);
    const fromIdx = ids.indexOf(draggingId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    const nextIds = [...ids];
    const [moved] = nextIds.splice(fromIdx, 1);
    nextIds.splice(toIdx, 0, moved);
    onReorderEntries?.(nextIds);
    addToast('success', '已调整条目顺序');
    setDraggingId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
  };

  const exportEntries = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      stage: currentStage,
      entries: filteredEntries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `novel-entries-${currentStage}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    addToast('success', `已导出 ${filteredEntries.length} 条条目`);
  };

  const exportSelectedEntries = () => {
    const selectedEntries = generatedEntries.filter((e) => selectedEntryIds.has(e.id));
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: selectedEntries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `novel-entries-selected-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    addToast('success', `已导出 ${selectedEntries.length} 条选中条目`);
  };

  const importEntries = () => {
    if (!onImportEntries) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const rawEntries = Array.isArray(data.entries) ? data.entries : Array.isArray(data) ? data : null;
        if (!rawEntries) {
          addToast('error', '导入文件格式不正确：未找到 entries 数组');
          return;
        }
        const entries: GeneratedEntry[] = rawEntries.map((e: unknown, i: number) => {
          const src = e as Record<string, unknown>;
          const category = (src.category || 'rule') as EntityCategory;
          const safeCategory = ALL_CATEGORIES.includes(category) ? category : 'rule';
          const stage = typeof src.stage === 'string' && stageOrder.includes(src.stage) ? src.stage : currentStage;
          const keys = Array.isArray(src.keys)
            ? (src.keys as unknown[]).filter((k): k is string => typeof k === 'string')
            : [];
          return {
            id: createEmptyEntry(stage).id,
            entityId: typeof src.entityId === 'string' ? src.entityId : `imported_${i}`,
            category: safeCategory,
            name: (src.name as string) || '导入条目',
            aspect: (src.aspect as string) || '',
            content: (src.content as string) || '',
            keys,
            stage,
            requiredFlags: Array.isArray(src.requiredFlags)
              ? (src.requiredFlags as unknown[]).filter((f): f is string => typeof f === 'string')
              : [],
            strategy: src.strategy === 'constant' ? 'constant' : 'selective',
            priority: typeof src.priority === 'number' ? src.priority : 700,
          };
        });
        onImportEntries(entries);
        addToast('success', `已导入 ${entries.length} 条条目`);
      } catch (err) {
        addToast('error', `导入失败：${err instanceof Error ? err.message : '未知错误'}`);
      }
    };
    input.click();
  };

  const toggleSelectEntry = (id: string) => {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedEntryIds(new Set(filteredEntries.map((e) => e.id)));
  };

  const selectAllEntries = () => {
    setSelectedEntryIds(new Set(generatedEntries.map((e) => e.id)));
  };

  const clearSelection = () => setSelectedEntryIds(new Set());

  const executeDelete = () => {
    if (!confirmDelete || !canDelete) return;

    let deletedEntries: GeneratedEntry[] = [];

    if (confirmDelete.type === 'single') {
      const entry = generatedEntries.find((e) => e.id === confirmDelete.entryId);
      if (entry) deletedEntries = [entry];
      if (onDeleteEntries) {
        onDeleteEntries([confirmDelete.entryId]);
      } else {
        onDeleteEntry?.(confirmDelete.entryId);
      }
      addToast('info', `已删除「${confirmDelete.name}」`);
    } else {
      let ids: string[];
      let message = '';
      switch (confirmDelete.type) {
        case 'stage':
          ids = generatedEntries.filter((e) => e.stage === confirmDelete.stage).map((e) => e.id);
          deletedEntries = generatedEntries.filter((e) => e.stage === confirmDelete.stage);
          message = `已删除「${confirmDelete.stage}」阶段的 ${confirmDelete.count} 个条目`;
          break;
        case 'keepOnlyStage':
          ids = generatedEntries.filter((e) => e.stage !== confirmDelete.stage).map((e) => e.id);
          deletedEntries = generatedEntries.filter((e) => e.stage !== confirmDelete.stage);
          message = `已删除除「${confirmDelete.stage}」外的 ${confirmDelete.count} 个条目`;
          break;
        case 'selected':
          ids = Array.from(selectedEntryIds);
          deletedEntries = generatedEntries.filter((e) => selectedEntryIds.has(e.id));
          message = `已删除选中的 ${confirmDelete.count} 个条目`;
          break;
        default:
          ids = generatedEntries.map((e) => e.id);
          deletedEntries = [...generatedEntries];
          message = `已删除全部 ${confirmDelete.count} 个条目`;
      }
      if (onDeleteEntries) {
        onDeleteEntries(ids);
      } else {
        for (const id of ids) onDeleteEntry?.(id);
      }
      if (confirmDelete.type === 'selected') clearSelection();
      addToast('info', message);
    }

    // Setup undo
    if (deletedEntries.length > 0 && canAddMany) {
      if (pendingUndo) clearTimeout(pendingUndo.timeoutId);
      const timeoutId = setTimeout(() => setPendingUndo(null), 5000);
      setPendingUndo({ entries: deletedEntries, timeoutId });
    }

    setConfirmDelete(null);
  };

  const undoDelete = () => {
    if (!pendingUndo || !canAddMany) return;
    onAddEntries?.(pendingUndo.entries);
    clearTimeout(pendingUndo.timeoutId);
    setPendingUndo(null);
    addToast('success', `已恢复 ${pendingUndo.entries.length} 条删除的条目`);
  };

  const bulkMoveStage = (stage: string) => {
    if (!stage || !onUpdateEntries || selectedEntryIds.size === 0) return;
    onUpdateEntries(Array.from(selectedEntryIds), { stage });
    addToast('success', `已将 ${selectedEntryIds.size} 条条目移动到「${stage}」`);
  };

  const bulkChangeCategory = (category: EntityCategory) => {
    if (!category || !onUpdateEntries || selectedEntryIds.size === 0) return;
    onUpdateEntries(Array.from(selectedEntryIds), { category });
    addToast('success', `已将 ${selectedEntryIds.size} 条条目改为「${categoryLabel(category)}」`);
  };

  const applyBulkEdit = () => {
    if (!onUpdateEntries || selectedEntryIds.size === 0) return;
    const updates: Partial<GeneratedEntry> = {};
    if (bulkEditForm.priority !== undefined && bulkEditForm.priority !== '') {
      const num = Number(bulkEditForm.priority);
      if (!Number.isNaN(num)) updates.priority = num;
    }
    if (bulkEditForm.strategy) updates.strategy = bulkEditForm.strategy;
    if (bulkEditForm.aspect !== undefined && bulkEditForm.aspect.trim()) updates.aspect = bulkEditForm.aspect.trim();
    if (Object.keys(updates).length === 0) return;
    onUpdateEntries(Array.from(selectedEntryIds), updates);
    addToast('success', `已批量修改 ${selectedEntryIds.size} 条条目`);
    setBulkEditForm({});
  };

  const confirmTitle = (action: ConfirmAction) => {
    switch (action.type) {
      case 'single':
        return '删除条目';
      case 'stage':
        return `删除「${action.stage}」全部条目`;
      case 'all':
        return '删除全部条目';
      case 'keepOnlyStage':
        return `仅保留「${action.stage}」`;
      case 'selected':
        return '删除选中条目';
    }
  };

  const confirmMessage = (action: ConfirmAction) => {
    switch (action.type) {
      case 'single':
        return `确定要删除「${action.name}」吗？删除后可在 5 秒内撤销。`;
      case 'stage':
        return `确定要删除「${action.stage}」阶段的 ${action.count} 个条目吗？删除后可在 5 秒内撤销。`;
      case 'all':
        return `确定要删除全部 ${action.count} 个条目吗？删除后可在 5 秒内撤销。`;
      case 'keepOnlyStage':
        return `确定要删除除「${action.stage}」外的 ${action.count} 个条目吗？删除后可在 5 秒内撤销。`;
      case 'selected':
        return `确定要删除选中的 ${action.count} 个条目吗？删除后可在 5 秒内撤销。`;
    }
  };

  const selectedCount = selectedEntryIds.size;

  return (
    <section id="novelManager" className="novel-manager">
      <div className="novel-manager-head">
        <div>
          <strong>🧭 世界书内容管理</strong>
          <p id="novelSummaryText">{summary || '尚未生成。'}</p>
        </div>
        <div className="novel-manager-actions">
          <button
            id="btnNovelSyncVariables"
            type="button"
            className="btn novel-sync-btn"
            onClick={onSyncVariables}
          >
            导出到创建向导（含变量）
          </button>
        </div>
      </div>

      <div className="novel-manager-grid">
        <div className="novel-manager-block">
          <div className="novel-block-title">当前阶段</div>
          <div id="novelStageButtons" className="novel-stage-buttons">
            {stageOrder.map((stage) => (
              <button
                key={stage}
                type="button"
                className={`novel-stage-btn ${stage === currentStage ? 'active' : ''}`}
                onClick={() => onStageChange(stage)}
              >
                {stage}
                <span className="novel-stage-count">{stageCounts[stage] || 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="novel-manager-block">
          <div className="novel-block-title">剧情开关</div>
          <div id="novelFlagList" className="novel-flag-list">
            {flags.length === 0 ? (
              <div className="novel-flag-empty">
                当前没有额外的剧情开关，剧情阶段就是唯一的控制方式。
              </div>
            ) : (
              flags.map((flag) => (
                <label key={flag.id} className="novel-flag-item">
                  <input
                    type="checkbox"
                    checked={flag.value}
                    onChange={(e) => onFlagToggle(flag.id, e.target.checked)}
                  />
                  <div className="novel-flag-copy">
                    <strong>{flag.label}</strong>
                    <span>{flag.description || '开启后才会显示对应的资料。'}</span>
                  </div>
                </label>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="novel-preview-shell">
        <div className="novel-preview-head">
          <strong>世界书条目预览</strong>
          <span id="novelEntryCount">
            {filteredEntries.length} / {generatedEntries.length} 条
          </span>
        </div>

        <div className="novel-entry-stats">
          <div className="novel-stat-card">
            <span className="novel-stat-value">{formatNumber(stats.totalEntries)}</span>
            <span className="novel-stat-label">总条目</span>
          </div>
          <div className="novel-stat-card">
            <span className="novel-stat-value">{formatNumber(stats.currentStageEntries)}</span>
            <span className="novel-stat-label">当前阶段</span>
          </div>
          <div className="novel-stat-card">
            <span className="novel-stat-value">{formatNumber(stats.tokenEstimate)}</span>
            <span className="novel-stat-label">预估 Token</span>
          </div>
          <div className="novel-stat-badges">
            {Object.entries(stats.categoryCounts).map(([category, count]) => (
              <span key={category} className={`novel-stat-badge category-${category}`}>
                {categoryLabel(category)} {count}
              </span>
            ))}
            {Object.entries(stats.strategyCounts).map(([strategy, count]) => (
              <span key={strategy} className={`novel-stat-badge strategy-${strategy}`}>
                {strategy === 'constant' ? '常驻' : '触发'} {count}
              </span>
            ))}
          </div>
        </div>

        <div className="novel-entry-toolbar">
          <input
            type="text"
            className="novel-entry-search"
            placeholder="搜索名称、内容、触发词…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="novel-entry-bulk">
            <button type="button" className="novel-bulk-btn" onClick={expandAll}>
              全部展开
            </button>
            <button type="button" className="novel-bulk-btn" onClick={collapseAll}>
              全部收起
            </button>
            {canAdd && (
              <button type="button" className="novel-bulk-btn" onClick={addEntry}>
                + 新增条目
              </button>
            )}
            <button type="button" className="novel-bulk-btn" onClick={exportEntries}>
              导出当前
            </button>
            {selectedCount > 0 && (
              <button type="button" className="novel-bulk-btn" onClick={exportSelectedEntries}>
                导出选中
              </button>
            )}
            {canImport && (
              <button type="button" className="novel-bulk-btn" onClick={importEntries}>
                导入 JSON
              </button>
            )}
            {canDelete && (
              <>
                <button
                  type="button"
                  className="novel-bulk-btn danger"
                  onClick={() =>
                    setConfirmDelete({
                      type: 'stage',
                      stage: currentStage,
                      count: generatedEntries.filter((e) => e.stage === currentStage).length,
                    })
                  }
                >
                  删除本阶段
                </button>
                <button
                  type="button"
                  className="novel-bulk-btn danger"
                  onClick={() =>
                    setConfirmDelete({
                      type: 'keepOnlyStage',
                      stage: currentStage,
                      count: generatedEntries.filter((e) => e.stage !== currentStage).length,
                    })
                  }
                >
                  仅保留本阶段
                </button>
              </>
            )}
          </div>
        </div>

        {categories.length > 0 && (
          <div className="novel-entry-categories">
            <span className="novel-entry-categories-label">类别筛选：</span>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={`novel-entry-category ${selectedCategories.has(category) ? 'active' : ''}`}
                onClick={() => toggleCategory(category)}
              >
                {categoryLabel(category)}
              </button>
            ))}
            {(searchQuery.trim() || selectedCategories.size > 0) && (
              <button type="button" className="novel-entry-clear-filter" onClick={clearFilters}>
                清除筛选
              </button>
            )}
          </div>
        )}

        {selectedCount > 0 && onUpdateEntries && (
          <div className="novel-entry-selection-bar">
            <span className="novel-selection-count">已选 {selectedCount} 条</span>
            <select
              className="novel-entry-select"
              value=""
              onChange={(e) => bulkMoveStage(e.target.value)}
            >
              <option value="">移动到阶段…</option>
              {stageOrder.map((stage) => (
                <option key={stage} value={stage}>{stage}</option>
              ))}
            </select>
            <select
              className="novel-entry-select"
              value=""
              onChange={(e) => bulkChangeCategory(e.target.value as EntityCategory)}
            >
              <option value="">改类别…</option>
              {ALL_CATEGORIES.map((category) => (
                <option key={category} value={category}>{categoryLabel(category)}</option>
              ))}
            </select>
            <input
              type="number"
              className="novel-entry-select"
              placeholder="优先级"
              value={bulkEditForm.priority ?? ''}
              onChange={(e) => setBulkEditForm((prev) => ({ ...prev, priority: e.target.value }))}
              title="批量修改优先级"
            />
            <select
              className="novel-entry-select"
              value={bulkEditForm.strategy ?? ''}
              onChange={(e) => setBulkEditForm((prev) => ({ ...prev, strategy: e.target.value as 'constant' | 'selective' | '' }))}
              title="批量修改策略"
            >
              <option value="">策略…</option>
              <option value="selective">触发</option>
              <option value="constant">常驻</option>
            </select>
            <input
              type="text"
              className="novel-entry-select"
              placeholder="方面"
              value={bulkEditForm.aspect ?? ''}
              onChange={(e) => setBulkEditForm((prev) => ({ ...prev, aspect: e.target.value }))}
              title="批量修改方面"
            />
            <button type="button" className="novel-bulk-btn primary" onClick={applyBulkEdit}>
              应用批量修改
            </button>
            <button type="button" className="novel-bulk-btn" onClick={selectAllFiltered}>
              全选当前
            </button>
            <button type="button" className="novel-bulk-btn" onClick={selectAllEntries}>
              全选全部
            </button>
            <button type="button" className="novel-bulk-btn" onClick={clearSelection}>
              取消选择
            </button>
            {canDelete && (
              <button
                type="button"
                className="novel-bulk-btn danger"
                onClick={() => setConfirmDelete({ type: 'selected', count: selectedCount })}
              >
                删除选中
              </button>
            )}
          </div>
        )}

        {pendingUndo && (
          <div className="novel-undo-bar">
            <span>已删除 {pendingUndo.entries.length} 条条目</span>
            <button type="button" className="novel-undo-btn" onClick={undoDelete}>
              撤销
            </button>
          </div>
        )}

        <div id="novelEntryPreview" className="novel-entry-preview">
          {generatedEntries.length === 0 ? (
            <div className="novel-entity-empty">当前还没有生成的世界书条目。</div>
          ) : filteredEntries.length === 0 ? (
            <div className="novel-entity-empty">当前筛选条件下没有条目。</div>
          ) : (
            filteredEntries.map((entry) => {
              const isEditing = editingEntryId === entry.id;
              const isSelected = selectedEntryIds.has(entry.id);
              const isDragging = draggingId === entry.id;
              const isDragOver = dragOverId === entry.id;

              return (
                <article
                  key={entry.id}
                  className={`novel-entry-card ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
                  draggable={canReorder}
                  onDragStart={(e) => handleDragStart(e, entry.id)}
                  onDragOver={(e) => handleDragOver(e, entry.id)}
                  onDrop={(e) => handleDrop(e, entry.id)}
                  onDragEnd={handleDragEnd}
                >
                  {isEditing ? (
                    <div className="novel-entry-editor">
                      <div className="novel-editor-grid">
                        <label>
                          <span>名称</span>
                          <input
                            ref={nameInputRef}
                            type="text"
                            value={editForm.name ?? ''}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                          />
                        </label>
                        <label>
                          <span>方面</span>
                          <input
                            type="text"
                            value={editForm.aspect ?? ''}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, aspect: e.target.value }))}
                          />
                        </label>
                        <label>
                          <span>阶段</span>
                          <select
                            value={editForm.stage ?? currentStage}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, stage: e.target.value }))}
                          >
                            {stageOrder.map((stage) => (
                              <option key={stage} value={stage}>{stage}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>类别</span>
                          <select
                            value={editForm.category ?? 'rule'}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, category: e.target.value as EntityCategory }))}
                          >
                            {ALL_CATEGORIES.map((category) => (
                              <option key={category} value={category}>{categoryLabel(category)}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>策略</span>
                          <select
                            value={editForm.strategy ?? 'selective'}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, strategy: e.target.value as 'constant' | 'selective' }))}
                          >
                            <option value="selective">触发</option>
                            <option value="constant">常驻</option>
                          </select>
                        </label>
                        <label>
                          <span>优先级</span>
                          <input
                            type="number"
                            value={editForm.priority ?? 700}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, priority: parseInt(e.target.value, 10) || 0 }))}
                          />
                        </label>
                      </div>
                      <label className="novel-editor-full">
                        <span>触发词（每行一个）</span>
                        <textarea
                          rows={2}
                          value={(editForm.keys ?? []).join('\n')}
                          onChange={(e) =>
                            setEditForm((prev) => ({
                              ...prev,
                              keys: e.target.value.split('\n').map((k) => k.trim()).filter(Boolean),
                            }))
                          }
                        />
                      </label>
                      <label className="novel-editor-full">
                        <span>内容</span>
                        <textarea
                          rows={5}
                          value={editForm.content ?? ''}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, content: e.target.value }))}
                        />
                      </label>
                      <div className="novel-editor-actions">
                        <button type="button" className="novel-bulk-btn" onClick={cancelEdit}>
                          取消
                        </button>
                        <button
                          type="button"
                          className="novel-bulk-btn primary"
                          disabled={!editForm.name?.trim()}
                          onClick={saveEdit}
                        >
                          保存
                        </button>
                      </div>
                      {!editForm.name?.trim() && (
                        <div className="novel-editor-error">条目名称不能为空</div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="novel-entry-row">
                        <div className="novel-entry-select-wrap">
                          {onUpdateEntries && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectEntry(entry.id)}
                            />
                          )}
                          <div className="novel-entry-main">
                            <span className="novel-entity-meta">{categoryLabel(entry.category)}</span>
                            <strong>{highlightText(entry.name, searchQuery)}</strong>
                            {entry.aspect && (
                              <span className="novel-entry-aspect">{highlightText(entry.aspect, searchQuery)}</span>
                            )}
                            {!entry.content.trim() && (
                              <span className="novel-entry-empty-content" title="内容为空，导出后该条目不会生效">空内容</span>
                            )}
                          </div>
                        </div>
                        <div className="novel-entry-actions">
                          {canEdit && (
                            <button type="button" className="novel-entry-toggle" onClick={() => startEdit(entry)}>
                              编辑
                            </button>
                          )}
                          {canAdd && (
                            <button type="button" className="novel-entry-toggle" onClick={() => duplicateEntry(entry)}>
                              复制
                            </button>
                          )}
                          <button
                            type="button"
                            className="novel-entry-toggle"
                            onClick={() => toggleEntry(entry.id)}
                          >
                            {expandedEntries.has(entry.id) ? '收起' : '展开'}
                          </button>
                          {canReorder && (
                            <>
                              <button
                                type="button"
                                className="novel-entry-toggle"
                                title="上移"
                                onClick={() => moveEntry(entry.id, 'up')}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="novel-entry-toggle"
                                title="下移"
                                onClick={() => moveEntry(entry.id, 'down')}
                              >
                                ↓
                              </button>
                            </>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              className="novel-entry-delete"
                              onClick={() =>
                                setConfirmDelete({ type: 'single', entryId: entry.id, name: entry.name })
                              }
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="novel-entry-tags">
                        {entry.keys.slice(0, 8).map((key, idx) => (
                          <span key={`${key}-${idx}`} className="novel-entry-key">{highlightText(key, searchQuery)}</span>
                        ))}
                        {entry.keys.length > 8 && (
                          <span className="novel-entry-key">+{entry.keys.length - 8}</span>
                        )}
                        <span className={`novel-entry-strategy ${entry.strategy}`}>
                          {entry.strategy === 'constant' ? '常驻' : '触发'}
                        </span>
                        <span className="novel-entry-priority">优先级 {entry.priority}</span>
                        {canReorder && <span className="novel-entry-drag-hint" title="拖拽可排序">⋮⋮</span>}
                      </div>
                      {expandedEntries.has(entry.id) && (
                        <pre className="novel-entry-content">{highlightText(entry.content, searchQuery)}</pre>
                      )}
                    </>
                  )}
                </article>
              );
            })
          )}
        </div>
      </div>

      <div className="novel-preview-shell" style={{ marginTop: 14 }}>
        <div className="novel-preview-head">
          <strong>角色/地点/势力一览</strong>
          <span id="novelEntityCount">{entityIndex.length} 个条目</span>
        </div>
        <div id="novelEntityPreview" className="novel-entity-preview">
          {entityIndex.length === 0 ? (
            <div className="novel-entity-empty">当前还没有角色和设定信息。</div>
          ) : (
            entityIndex.slice(0, 12).map((entity) => (
              <article key={entity.id} className="novel-entity-card">
                <span className="novel-entity-meta">{categoryLabel(entity.category)}</span>
                <strong>{entity.name}</strong>
                <p>{entity.summary || '暂无摘要'}</p>
              </article>
            ))
          )}
        </div>
      </div>

      <Modal
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={confirmDelete ? confirmTitle(confirmDelete) : ''}
        maxWidth="max-w-md"
      >
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.84rem', lineHeight: 1.6 }}>
          {confirmDelete ? confirmMessage(confirmDelete) : ''}
        </p>
        <div
          className="flex justify-end gap-3 mt-6"
          style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'flex-end' }}
        >
          <button
            type="button"
            className="novel-bulk-btn"
            onClick={() => setConfirmDelete(null)}
          >
            取消
          </button>
          <button
            type="button"
            className="novel-bulk-btn danger"
            onClick={executeDelete}
          >
            确认删除
          </button>
        </div>
      </Modal>
    </section>
  );
}
