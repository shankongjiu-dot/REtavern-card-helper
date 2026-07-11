/**
 * NovelWorkshop - Main entry component
 * Migrated from .temp_statusbar.astro
 */

import { useState } from 'react';
import { useNovelState } from './hooks/useNovelState';
import { HeaderBanner } from './panels/HeaderBanner';
import { ImportPanel } from './panels/ImportPanel';
import { ConfigPanel } from './panels/ConfigPanel';
import { PipelinePanel } from './panels/PipelinePanel';
import { ManagerPanel } from './panels/ManagerPanel';
import { NovelStatusBar } from './shared/NovelStatusBar';
import { extractNovelChunk, mergeNovelPackages, mergePackagesLocally, emptyPackage } from '../../services/novel-workshop-service';
import { splitTextIntoChunks, buildCallEstimate, assertWorkflowAffordable, hashString } from './utils';
import { MERGE_BATCH_SIZE } from './types';
import type { NovelPackage, Checkpoint } from './types';
import { THEME_TOKENS } from '../../constants/theme';
import './novel-workshop.css';

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
    persistState,
    resetWorkshop,
  } = useNovelState();

  const [isGenerating, setIsGenerating] = useState(false);

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
      setStatus('文本分片为空，无法生成', THEME_TOKENS.danger);
      return;
    }

    const total = chunks.length;
    const signature = hashString(source + state.chunkCharLimit);
    const existingCp = loadCheckpoint(signature);

    let partials: NovelPackage[] = [];
    let skipToMerge = false;
    if (existingCp && Array.isArray(existingCp.partials) && existingCp.partials.length > 0) {
      partials = [...existingCp.partials];
      if (existingCp.phase === 'merge') {
        skipToMerge = true;
        setStatus(`检测到断点，跳过抽取直接进入合并（已抽取 ${partials.length}/${total} 片）`, THEME_TOKENS.info);
      } else {
        setStatus(`检测到断点，从第 ${partials.length + 1} 片继续抽取`, THEME_TOKENS.info);
      }
    }

    setIsGenerating(true);
    setWorkflowRunState({
      phase: 'extract',
      extractionDone: partials.length,
      extractionTotal: total,
      mergeDone: 0,
      mergeTotal: 0,
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

      // ── Extract phase ──
      if (!skipToMerge) {
        for (let i = partials.length; i < total; i++) {
          setStatus(`抽取片段 ${i + 1}/${total}…`, THEME_TOKENS.info);
          const pkg = await extractNovelChunk(chunks[i], i, total, config, (chunk) => {
            setStatus(`抽取片段 ${i + 1}/${total}：${chunk.slice(-40)}`, THEME_TOKENS.info);
          });
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
          setWorkflowRunState(prev => ({ ...prev, extractionDone: i + 1 }));
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
          mergeDone: 0,
          mergeTotal,
        });

        let current = [...partials];
        let mergeDone = 0;

        while (current.length > 1) {
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
            if (batch.length <= 1) {
              merged.push(batch[0] || emptyPackage());
            } else {
              setStatus(`合并任务 ${mergeDone + 1}/${mergeTotal}…`, THEME_TOKENS.purple);
              const result = await mergeNovelPackages(batch, mergeDone, mergeTotal, () => {});
              merged.push(result);
              mergeDone++;
              setWorkflowRunState(prev => ({ ...prev, mergeDone }));
              const cp: Checkpoint = {
                signature,
                sourceHash: signature,
                chunkSize: state.chunkCharLimit,
                totalChunks: total,
                phase: 'merge',
                partials: [],
                pending: merged,
                mergeDone,
                mergeTotal,
                updatedAt: new Date().toISOString(),
              };
              saveCheckpoint(cp);
            }
          }
          current = merged;
        }
        finalPackage = current[0] || emptyPackage();
      }

      // ── Write to state ──
      updateState(prev => ({
        ...prev,
        summary: finalPackage.summary,
        stageOrder: finalPackage.stage_order.length ? finalPackage.stage_order : prev.stageOrder,
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
        generatedEntries: (finalPackage.entries || []).map((e, i) => ({
          id: e.id || `entry_${i}`,
          entityId: e.entity_id || e.entityId || `entity_${i}`,
          category: (e.category || 'rule') as 'character' | 'location' | 'faction' | 'rule' | 'item' | 'event',
          name: e.name || e.title || '未命名条目',
          aspect: e.aspect || e.slot || '',
          content: e.content || '',
          keys: e.keys || [],
          stage: e.stage || prev.stageOrder[0] || '公开',
          requiredFlags: e.required_flags || e.requiredFlags || [],
          strategy: ((e.strategy || 'selective').toLowerCase() === 'constant' ? 'constant' : 'selective') as 'constant' | 'selective',
          priority: e.priority || 700,
        })),
        generatedVariables: (finalPackage.variables || []).filter(v => v && v.path),
        generatedAt: new Date().toISOString(),
      }));

      // ── Inject to host worldbook (if available) ──
      const hostApi = typeof window !== 'undefined' ? window.__setWorldbookEntries__ : undefined;
      const entryCount = (finalPackage.entries || []).length;
      if (hostApi) {
        const mapped = (finalPackage.entries || []).map(e => ({
          comment: e.name || e.title || '',
          content: e.content || '',
          keys: e.keys || [],
          strategy: (e.strategy || 'selective').toLowerCase() === 'constant' ? 'constant' : 'selective',
          enabled: true,
        }));
        hostApi(mapped);
        setStatus(`已生成并注入 ${entryCount} 条世界书条目`, THEME_TOKENS.success);
      } else {
        setStatus(`已生成 ${entryCount} 条条目（未检测到宿主，未注入）`, THEME_TOKENS.info);
      }

      persistState();
      clearCheckpoint();
      setWorkflowRunState(prev => ({ ...prev, phase: 'done' }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成过程出错';
      setStatus(`❌ ${msg}`, THEME_TOKENS.danger);
      setWorkflowRunState(prev => ({ ...prev, phase: 'idle' }));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSyncVariables = () => {
    if (!state.generatedVariables.length) {
      setStatus('没有可同步的变量', THEME_TOKENS.danger);
      return;
    }
    const hostApi = typeof window !== 'undefined' ? window.__applyExternalVariableDesign__ : undefined;
    if (!hostApi) {
      setStatus('未检测到宿主变量设计接口', THEME_TOKENS.danger);
      return;
    }
    const variables = state.generatedVariables.map(v => ({
      path: v.path,
      type: v.type,
      options: v.options,
      default: v.default,
      description: v.description,
      check: v.check,
    }));
    const result = hostApi({
      source: 'novelWorkshop',
      message: '从小说工坊同步变量蓝图',
      design: {
        summary: state.summary,
        variables,
      },
    });
    setStatus(`已同步 ${result.count} 个变量到 MVU`, THEME_TOKENS.success);
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
          persistState();
        }}
        onFlagToggle={(flagId, value) => {
          updateState(prev => ({
            ...prev,
            flags: prev.flags.map(f => f.id === flagId ? { ...f, value } : f),
          }));
          persistState();
        }}
        onSyncVariables={handleSyncVariables}
      />

      <NovelStatusBar text={statusText} color={statusColor} />
    </div>
  );
}
