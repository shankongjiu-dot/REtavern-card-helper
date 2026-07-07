/**
 * NovelWorkshop - Main entry component
 * Migrated from .temp_statusbar.astro
 */

import { useNovelState } from './hooks/useNovelState';
import { HeaderBanner } from './panels/HeaderBanner';
import { ImportPanel } from './panels/ImportPanel';
import { ConfigPanel } from './panels/ConfigPanel';
import { PipelinePanel } from './panels/PipelinePanel';
import { ManagerPanel } from './panels/ManagerPanel';
import { NovelStatusBar } from './shared/NovelStatusBar';
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
    handleFileImport,
    clearFile,
    getCombinedSourceText,
    persistState,
    resetWorkshop,
  } = useNovelState();

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
        onGateModeChange={(mode) => syncInputsIntoState({ gateMode: mode })}
        onNarrativeModeChange={(mode) => syncInputsIntoState({ narrativeMode: mode })}
        onEntryBudgetChange={(budget) => syncInputsIntoState({ entryBudget: budget })}
        onChunkCharLimitChange={(limit) => syncInputsIntoState({ chunkCharLimit: limit })}
        onFocusChange={(focus) => syncInputsIntoState({ focus })}
        onGenerate={() => {
          // TODO: Implement generation workflow
        }}
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
        onSyncVariables={() => {
          // TODO: Implement MVU sync
        }}
      />

      <NovelStatusBar text={statusText} color={statusColor} />
    </div>
  );
}
