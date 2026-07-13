/**
 * NovelWorkshop - Main entry component
 * Migrated from .temp_statusbar.astro
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNovelState } from './hooks/useNovelState';
import { HeaderBanner } from './panels/HeaderBanner';
import { ImportPanel } from './panels/ImportPanel';
import { ConfigPanel } from './panels/ConfigPanel';
import { PipelinePanel } from './panels/PipelinePanel';
import { ManagerPanel } from './panels/ManagerPanel';
import { NovelStatusBar } from './shared/NovelStatusBar';
import { extractNovelChunk, mergeNovelPackages, mergePackagesLocally, emptyPackage } from '../../services/novel-workshop-service';
import { saveWorkshopLorebookImport } from '../../services/novel-workshop-bridge';
import { splitTextIntoChunks, buildCallEstimate, assertWorkflowAffordable, hashString } from './utils';
import { MERGE_BATCH_SIZE } from './types';
import type { NovelPackage, Checkpoint, GeneratedEntry, VariableBlueprint, EntityIndex } from './types';
import { THEME_TOKENS } from '../../constants/theme';
import './novel-workshop.css';

/**
 * Conservatively sync entityIndex with generatedEntries.
 * Only updates name/category for entities whose id matches an entry's entityId.
 * Does not remove entities or rewrite summaries to avoid losing AI-generated context.
 */
function syncEntityIndex(entities: EntityIndex[], entries: GeneratedEntry[]): EntityIndex[] {
  const entityMap = new Map<string, GeneratedEntry>();
  for (const entry of entries) {
    if (!entry.entityId) continue;
    if (!['character', 'location', 'faction'].includes(entry.category)) continue;
    if (!entityMap.has(entry.entityId)) {
      entityMap.set(entry.entityId, entry);
    }
  }

  return entities.map((entity) => {
    const matched = entityMap.get(entity.id);
    if (!matched) return entity;
    return {
      ...entity,
      name: matched.name,
      category: matched.category,
    };
  });
}

function packageEntriesToGeneratedEntries(
  entries: NovelPackage['entries'],
  stageOrder: string[],
): GeneratedEntry[] {
  return (entries || []).map((e, i) => ({
    id: e.id || `entry_${i}`,
    entityId: e.entity_id || e.entityId || `entity_${i}`,
    category: (e.category || 'rule') as GeneratedEntry['category'],
    name: e.name || e.title || '未命名条目',
    aspect: e.aspect || e.slot || '',
    content: e.content || '',
    keys: e.keys || [],
    stage: e.stage || stageOrder[0] || '公开',
    requiredFlags: e.required_flags || e.requiredFlags || [],
    strategy: ((e.strategy || 'selective').toLowerCase() === 'constant' ? 'constant' : 'selective') as GeneratedEntry['strategy'],
    priority: e.priority || 700,
  }));
}

function packageVariablesToBlueprints(variables: NovelPackage['variables']): VariableBlueprint[] {
  return (variables || []).filter((v): v is VariableBlueprint => !!v && !!v.path);
}

export function NovelWorkshop() {
  const {
    state,
    importedFileMeta,
    workflowRunState,
    statusText,
    statusColor,
    updateState,
    syncInputsIntoState,
    setWorkflowRunState,
    setStatus,
    saveCheckpoint,
    loadCheckpoint,
    clearCheckpoint,
    handleFileImport,
    clearFile,
    getCombinedSourceText,
    resetWorkshop,
  } = useNovelState();

  const navigate = useNavigate();
  const [isGenerating, setIsGenerating] = useState(false);
  const [stallWarning, setStallWarning] = useState(false);
  const [stallCritical, setStallCritical] = useState(false);
  const lastStatusUpdateRef = useRef<number>(Date.now());
  const shouldAbortRef = useRef(false);

  useEffect(() => {
    if (!isGenerating) {
      setStallWarning(false);
      setStallCritical(false);
      return;
    }
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastStatusUpdateRef.current;
      if (elapsed > 120000) {
        setStallCritical(true);
      } else if (elapsed > 60000) {
        setStallWarning(true);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isGenerating]);

  const handleAbort = () => {
    shouldAbortRef.current = true;
  };

  const handleGenerate = async () => {
    if (isGenerating) return;

    const source = getCombinedSourceText();
    if (!source) {
      setStatus('请先导入或粘贴小说文本', THEME_TOKENS.danger);
      return;
    }

    let estimate;
    try {
      estimate = buildCallEstimate(source, state.chunkCharLimit);
      assertWorkflowAffordable(estimate);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '调用预算检查失败', THEME_TOKENS.danger);
      return;
    }

    const chunks = splitTextIntoChunks(source, state.chunkCharLimit);
    if (!chunks.length) {
      setStatus('文本分段为空，无法生成', THEME_TOKENS.danger);
      return;
    }

    const total = chunks.length;
    const configFingerprint = JSON.stringify({
      gateMode: state.gateMode,
      narrativeMode: state.narrativeMode,
      focus: [...state.focus].sort(),
      entryBudget: state.entryBudget,
      chunkCharLimit: state.chunkCharLimit,
      contextText: state.contextText.slice(0, 200),
    });
    const signature = hashString(source + '|' + source.length + '|' + configFingerprint);
    const existingCp = loadCheckpoint(signature);

    let partials: NovelPackage[] = [];
    let skipToMerge = false;
    let resumedMergeDone = 0;
    const failedChunks: number[] = [];
    let mergeFallbacks = 0;
    if (existingCp && Array.isArray(existingCp.partials)) {
      if (existingCp.phase === 'merge' && Array.isArray(existingCp.pending) && existingCp.pending.length > 0) {
        partials = [...existingCp.pending];
        skipToMerge = true;
        resumedMergeDone = existingCp.mergeDone || 0;
        setStatus(`检测到上次未完成的进度，跳过提取直接进入合并（剩余 ${partials.length} 批待合并）`, THEME_TOKENS.info);
      } else if (existingCp.partials.length > 0) {
        partials = [...existingCp.partials];
        setStatus(`检测到上次未完成的进度，从第 ${partials.length + 1} 段继续提取`, THEME_TOKENS.info);
      }
    }

    shouldAbortRef.current = false;
    lastStatusUpdateRef.current = Date.now();
    setStallWarning(false);
    setStallCritical(false);

    const updateStatus = (text: string, color: string) => {
      lastStatusUpdateRef.current = Date.now();
      setStallWarning(false);
      setStallCritical(false);
      setStatus(text, color);
    };

    setIsGenerating(true);
    setWorkflowRunState({
      phase: 'extract',
      extractionDone: partials.length,
      extractionTotal: total,
      mergeDone: 0,
      mergeTotal: 0,
      failedChunks: [],
      mergeFallbacks: 0,
    });

    try {
      const config = {
        gateMode: state.gateMode,
        narrativeMode: state.narrativeMode,
        focus: state.focus,
        stageOrder: state.stageOrder,
        entryBudget: state.entryBudget,
        contextText: state.contextText,
      };

      // ── Extract phase (with per-chunk fallback) ──
      let aborted = false;
      if (!skipToMerge) {
        for (let i = partials.length; i < total; i++) {
          if (shouldAbortRef.current) {
            aborted = true;
            break;
          }
          updateStatus(`正在提取第 ${i + 1}/${total} 段…`, THEME_TOKENS.info);
          let pkg: NovelPackage | null = null;
          try {
            pkg = await extractNovelChunk(chunks[i], i, total, config, (chunk) => {
              updateStatus(`正在提取第 ${i + 1}/${total} 段：${chunk.slice(-40)}`, THEME_TOKENS.info);
            });
          } catch {
            updateStatus(`⚠️ 第 ${i + 1} 段提取失败，正在重试…`, THEME_TOKENS.warning);
            try {
              pkg = await extractNovelChunk(chunks[i], i, total, config, () => {});
            } catch {
              failedChunks.push(i);
              updateStatus(`⚠️ 第 ${i + 1} 段提取失败已跳过，继续处理下一段`, THEME_TOKENS.warning);
            }
          }
          if (pkg) {
            partials.push(pkg);
            const cp: Checkpoint = {
              signature,
              sourceHash: signature,
              chunkSize: state.chunkCharLimit,
              totalChunks: total,
              phase: 'extract',
              partials,
              updatedAt: new Date().toISOString(),
            };
            saveCheckpoint(cp);
          }
          setWorkflowRunState(prev => ({
            ...prev,
            extractionDone: i + 1,
            failedChunks: [...failedChunks],
          }));
        }

        if (aborted) {
          updateStatus('⏹️ 已中止生成。已保存当前进度，下次点击生成会从断点继续。', THEME_TOKENS.warning);
          setWorkflowRunState(prev => ({ ...prev, phase: 'idle' }));
          return;
        }

        if (partials.length === 0) {
          throw new Error('所有片段提取均失败，无法继续。请检查网络连接或 API 设置后重试。');
        }
        if (failedChunks.length > 0) {
          updateStatus(`⚠️ 有 ${failedChunks.length} 段提取失败已跳过，将基于成功的 ${partials.length} 段继续合并`, THEME_TOKENS.warning);
        }
      }

      // ── Merge phase ──
      let finalPackage: NovelPackage;
      if (partials.length <= 1) {
        finalPackage = partials[0] || emptyPackage();
      } else {
        const mergeTotal = estimate.mergeCalls || (partials.length - 1);
        setWorkflowRunState({
          phase: 'merge',
          extractionDone: total,
          extractionTotal: total,
          mergeDone: resumedMergeDone,
          mergeTotal,
          failedChunks: [...failedChunks],
          mergeFallbacks,
        });

        let current = [...partials];
        let mergeDone = resumedMergeDone;

        while (current.length > 1) {
          if (shouldAbortRef.current) {
            aborted = true;
            break;
          }

          // Save the full list of packages that still need merging at the start
          // of each round. If the user aborts mid-round, the next run resumes
          // from this exact snapshot instead of a partially-processed batch,
          // which would drop the unprocessed batches.
          const cp: Checkpoint = {
            signature,
            sourceHash: signature,
            chunkSize: state.chunkCharLimit,
            totalChunks: total,
            phase: 'merge',
            partials: [],
            pending: current,
            mergeDone,
            mergeTotal,
            updatedAt: new Date().toISOString(),
          };
          saveCheckpoint(cp);

          if (current.length <= 2) {
            current = [mergePackagesLocally(current)];
            break;
          }
          const batches: NovelPackage[][] = [];
          for (let i = 0; i < current.length; i += MERGE_BATCH_SIZE) {
            batches.push(current.slice(i, i + MERGE_BATCH_SIZE));
          }
          const merged: NovelPackage[] = [];
          for (const batch of batches) {
            if (shouldAbortRef.current) {
              aborted = true;
              break;
            }
            if (batch.length <= 1) {
              merged.push(batch[0] || emptyPackage());
            } else {
              updateStatus(`正在合并 ${mergeDone + 1}/${mergeTotal}…`, THEME_TOKENS.purple);
              let result: NovelPackage;
              try {
                result = await mergeNovelPackages(batch, mergeDone, mergeTotal, () => {});
              } catch {
                mergeFallbacks++;
                updateStatus(`⚠️ 第 ${mergeDone + 1} 次合并失败，改用本地合并`, THEME_TOKENS.warning);
                result = mergePackagesLocally(batch);
              }
              merged.push(result);
              mergeDone++;
              setWorkflowRunState(prev => ({ ...prev, mergeDone, mergeFallbacks }));
            }
          }
          if (aborted) break;
          current = merged;
        }

        if (aborted) {
          updateStatus('⏹️ 已中止生成。已保存当前进度，下次点击生成会从断点继续。', THEME_TOKENS.warning);
          setWorkflowRunState(prev => ({ ...prev, phase: 'idle' }));
          return;
        }

        finalPackage = current[0] || emptyPackage();
      }

      // ── Write to state ──
      const stageOrderForState = finalPackage.stage_order.length ? finalPackage.stage_order : state.stageOrder;
      updateState(prev => ({
        ...prev,
        summary: finalPackage.summary,
        stageOrder: stageOrderForState,
        flags: (finalPackage.reveal_flags || []).map((f, i) => ({
          id: f.id || `flag_${i}`,
          label: f.label || f.name || `标记${i + 1}`,
          description: f.description || f.desc || '',
          value: f.default === true,
        })),
        entityIndex: (finalPackage.entity_index || []).map((e, i) => ({
          id: e.id || `entity_${i}`,
          name: e.name || '未命名实体',
          category: (e.category || 'character') as 'character' | 'location' | 'faction' | 'rule' | 'item' | 'event',
          aliases: e.aliases || [],
          summary: e.public_summary || e.summary || '',
        })),
        generatedEntries: packageEntriesToGeneratedEntries(finalPackage.entries, stageOrderForState),
        generatedVariables: packageVariablesToBlueprints(finalPackage.variables),
        generatedAt: new Date().toISOString(),
      }));

      // ── Save to sessionStorage bridge and navigate to wizard ──
      const stageOrderForBridge = finalPackage.stage_order.length ? finalPackage.stage_order : state.stageOrder;
      const generatedEntries = packageEntriesToGeneratedEntries(finalPackage.entries, stageOrderForBridge);
      const generatedVariables = packageVariablesToBlueprints(finalPackage.variables);
      const entryCount = (finalPackage.entries || []).length;

      const importedEntries = entryCount > 0
        ? saveWorkshopLorebookImport(
            state.lastFileName || '小说世界书',
            generatedEntries,
            generatedVariables,
            finalPackage.summary || '',
            stageOrderForBridge,
          )
        : [];

      const warnings: string[] = [];
      if (failedChunks.length > 0) {
        warnings.push(`${failedChunks.length} 段提取失败已跳过`);
      }
      if (mergeFallbacks > 0) {
        warnings.push(`${mergeFallbacks} 次合并改用了本地合并`);
      }
      const warningSuffix = warnings.length ? `（注意：${warnings.join('，')}）` : '';

      if (importedEntries.length > 0) {
        updateStatus(`已生成 ${importedEntries.length} 条世界书条目，正在跳转到创建向导…${warningSuffix}`, THEME_TOKENS.success);
      } else if (entryCount > 0) {
        updateStatus(`生成完成但所有条目内容为空，未导入${warningSuffix}`, THEME_TOKENS.warning);
      } else {
        updateStatus(`生成完成但未产出有效条目${warningSuffix}`, THEME_TOKENS.warning);
      }

      clearCheckpoint();
      setWorkflowRunState(prev => ({ ...prev, phase: 'done' }));

      if (importedEntries.length > 0) {
        navigate('/wizard?fromWorkshop=1');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成过程出错';
      setStatus(`❌ ${msg}`, THEME_TOKENS.danger);
      setWorkflowRunState(prev => ({ ...prev, phase: 'idle' }));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSyncVariables = () => {
    if (!state.generatedEntries.length) {
      setStatus('没有可导出的条目和变量', THEME_TOKENS.danger);
      return;
    }
    try {
      const imported = saveWorkshopLorebookImport(
        state.lastFileName || '小说世界书',
        state.generatedEntries,
        state.generatedVariables,
        state.summary || '',
        state.stageOrder,
      );
      if (imported.length === 0) {
        setStatus('导出失败：所有条目内容为空', THEME_TOKENS.warning);
        return;
      }
      setStatus(`已导出 ${imported.length} 条条目，正在跳转到创建向导…`, THEME_TOKENS.success);
      navigate('/wizard?fromWorkshop=1&step=4');
    } catch (err) {
      setStatus(`导出失败：${err instanceof Error ? err.message : '未知错误'}`, THEME_TOKENS.danger);
    }
  };

  const handleDeleteGeneratedEntry = (entryId: string) => {
    updateState((prev) => {
      const nextEntries = prev.generatedEntries.filter((entry) => entry.id !== entryId);
      return { ...prev, generatedEntries: nextEntries, entityIndex: syncEntityIndex(prev.entityIndex, nextEntries) };
    });
  };

  const handleDeleteGeneratedEntries = (entryIds: string[]) => {
    const idSet = new Set(entryIds);
    updateState((prev) => {
      const nextEntries = prev.generatedEntries.filter((entry) => !idSet.has(entry.id));
      return { ...prev, generatedEntries: nextEntries, entityIndex: syncEntityIndex(prev.entityIndex, nextEntries) };
    });
  };

  const handleUpdateGeneratedEntry = (entryId: string, updates: Partial<GeneratedEntry>) => {
    updateState((prev) => {
      const nextEntries = prev.generatedEntries.map((entry) =>
        entry.id === entryId ? { ...entry, ...updates } : entry,
      );
      return { ...prev, generatedEntries: nextEntries, entityIndex: syncEntityIndex(prev.entityIndex, nextEntries) };
    });
  };

  const handleUpdateGeneratedEntries = (entryIds: string[], updates: Partial<GeneratedEntry>) => {
    const idSet = new Set(entryIds);
    updateState((prev) => {
      const nextEntries = prev.generatedEntries.map((entry) =>
        idSet.has(entry.id) ? { ...entry, ...updates } : entry,
      );
      return { ...prev, generatedEntries: nextEntries, entityIndex: syncEntityIndex(prev.entityIndex, nextEntries) };
    });
  };

  const handleAddGeneratedEntry = (entry: GeneratedEntry) => {
    updateState((prev) => {
      const nextEntries = [...prev.generatedEntries, entry];
      return { ...prev, generatedEntries: nextEntries, entityIndex: syncEntityIndex(prev.entityIndex, nextEntries) };
    });
  };

  const handleAddGeneratedEntries = (entries: GeneratedEntry[]) => {
    updateState((prev) => {
      const nextEntries = [...prev.generatedEntries, ...entries];
      return { ...prev, generatedEntries: nextEntries, entityIndex: syncEntityIndex(prev.entityIndex, nextEntries) };
    });
  };

  const handleReorderGeneratedEntries = (entryIds: string[]) => {
    updateState((prev) => {
      const idToEntry = new Map(prev.generatedEntries.map((e) => [e.id, e]));
      const nextEntries = entryIds.map((id) => idToEntry.get(id)).filter((e): e is GeneratedEntry => Boolean(e));
      // Append any entries missing from the provided order at the end to avoid data loss
      const seenIds = new Set(entryIds);
      for (const entry of prev.generatedEntries) {
        if (!seenIds.has(entry.id)) nextEntries.push(entry);
      }
      return { ...prev, generatedEntries: nextEntries };
    });
  };

  const handleImportGeneratedEntries = (entries: GeneratedEntry[]) => {
    updateState((prev) => {
      const nextEntries = [...prev.generatedEntries, ...entries];
      return { ...prev, generatedEntries: nextEntries, entityIndex: syncEntityIndex(prev.entityIndex, nextEntries) };
    });
  };

  return (
    <div className="novel-workshop-panel">
      <HeaderBanner
        summary={state.summary}
        generatedEntries={state.generatedEntries}
        entityIndex={state.entityIndex}
        flags={state.flags}
        generatedVariables={state.generatedVariables}
      />

      <ImportPanel
        sourceText={state.sourceText}
        contextText={state.contextText}
        importedFileMeta={importedFileMeta}
        onSourceTextChange={(text) => syncInputsIntoState({ sourceText: text })}
        onContextTextChange={(text) => syncInputsIntoState({ contextText: text })}
        onFileImport={handleFileImport}
        onClearFile={clearFile}
      />

      {isGenerating && stallCritical && (
        <div className="rounded-lg border p-3 flex items-center justify-between gap-3" style={{ borderColor: 'color-mix(in srgb, var(--color-status-danger) 35%, transparent)', backgroundColor: 'color-mix(in srgb, var(--color-status-danger) 12%, transparent)' }}>
          <span className="text-sm" style={{ color: 'var(--color-status-danger)' }}>
            🔴 AI 已超过 120 秒没有新内容输出，建议中止以节省时间和费用。已完成的段落会自动保存。
          </span>
          <button
            type="button"
            onClick={handleAbort}
            className="rounded-lg px-3 py-1.5 text-sm font-bold text-white whitespace-nowrap"
            style={{ backgroundColor: 'var(--color-status-danger)' }}
          >
            中止生成
          </button>
        </div>
      )}
      {isGenerating && stallWarning && !stallCritical && (
        <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'color-mix(in srgb, var(--color-status-warning) 35%, transparent)', backgroundColor: 'color-mix(in srgb, var(--color-status-warning) 12%, transparent)', color: 'var(--color-status-warning)' }}>
          ⚠️ AI 已超过 60 秒没有新内容输出，可能卡住了。请耐心等待，或等到 120 秒后可以中止。
        </div>
      )}

      <PipelinePanel
        source={getCombinedSourceText()}
        chunkCharLimit={state.chunkCharLimit}
        gateMode={state.gateMode}
        narrativeMode={state.narrativeMode}
        entryBudget={state.entryBudget}
        workflowRunState={workflowRunState}
      />

      <ConfigPanel
        gateMode={state.gateMode}
        narrativeMode={state.narrativeMode}
        entryBudget={state.entryBudget}
        chunkCharLimit={state.chunkCharLimit}
        focus={state.focus}
        stageOrder={state.stageOrder}
        currentStage={state.currentStage}
        isGenerating={isGenerating}
        onGateModeChange={(mode) => syncInputsIntoState({ gateMode: mode })}
        onNarrativeModeChange={(mode) => syncInputsIntoState({ narrativeMode: mode })}
        onEntryBudgetChange={(budget) => syncInputsIntoState({ entryBudget: budget })}
        onChunkCharLimitChange={(limit) => syncInputsIntoState({ chunkCharLimit: limit })}
        onFocusChange={(focus) => syncInputsIntoState({ focus })}
        onGenerate={handleGenerate}
        onReset={resetWorkshop}
      />

      <ManagerPanel
        visible={state.generatedEntries.length > 0}
        summary={state.summary}
        stageOrder={state.stageOrder}
        currentStage={state.currentStage}
        flags={state.flags}
        entityIndex={state.entityIndex}
        generatedEntries={state.generatedEntries}
        onStageChange={(stage) => {
          updateState(prev => ({ ...prev, currentStage: stage }));
        }}
        onFlagToggle={(flagId, value) => {
          updateState(prev => ({
            ...prev,
            flags: prev.flags.map(f => f.id === flagId ? { ...f, value } : f),
          }));
        }}
        onSyncVariables={handleSyncVariables}
        onDeleteEntry={handleDeleteGeneratedEntry}
        onDeleteEntries={handleDeleteGeneratedEntries}
        onUpdateEntry={handleUpdateGeneratedEntry}
        onUpdateEntries={handleUpdateGeneratedEntries}
        onAddEntry={handleAddGeneratedEntry}
        onAddEntries={handleAddGeneratedEntries}
        onReorderEntries={handleReorderGeneratedEntries}
        onImportEntries={handleImportGeneratedEntries}
      />

      <NovelStatusBar text={statusText} color={statusColor} />
    </div>
  );
}
