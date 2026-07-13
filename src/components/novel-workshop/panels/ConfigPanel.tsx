/**
 * ConfigPanel - Configuration options
 * Migrated from .temp_statusbar.astro
 */

import type { GateMode, NarrativeMode, CategoryId } from '../types';
import { FOCUS_OPTIONS } from '../types';

interface ConfigPanelProps {
  gateMode: GateMode;
  narrativeMode: NarrativeMode;
  entryBudget: number;
  chunkCharLimit: number;
  focus: CategoryId[];
  stageOrder: string[];
  currentStage: string;
  isGenerating?: boolean;
  onGateModeChange: (mode: GateMode) => void;
  onNarrativeModeChange: (mode: NarrativeMode) => void;
  onEntryBudgetChange: (budget: number) => void;
  onChunkCharLimitChange: (limit: number) => void;
  onFocusChange: (focus: CategoryId[]) => void;
  onGenerate: () => void;
  onReset: () => void;
}

export function ConfigPanel({
  gateMode,
  narrativeMode,
  entryBudget,
  chunkCharLimit,
  focus,
  stageOrder,
  currentStage,
  isGenerating,
  onGateModeChange,
  onNarrativeModeChange,
  onEntryBudgetChange,
  onChunkCharLimitChange,
  onFocusChange,
  onGenerate,
  onReset,
}: ConfigPanelProps) {
  const handleFocusToggle = (id: CategoryId) => {
    const next = focus.includes(id)
      ? focus.filter((f) => f !== id)
      : [...focus, id];
    onFocusChange(next.length ? next : ['character']);
  };

  const narrativeHint = narrativeMode === 'lore_only'
    ? '只整理设定（不按剧情顺序）：尽量去掉剧情时间线，不强调先后顺序，优先保留稳定不变的设定。'
    : '按剧情顺序整理：允许保留随剧情发展的关系变化、关键事件后果和阅读顺序。';

  return (
    <div className="novel-grid">
      <section className="novel-card novel-config-card">
        <div className="novel-card-head">
          <strong>解锁方式设置</strong>
          <span>控制世界书内容何时出现</span>
        </div>
        <div className="novel-card-body">
          <div className="grid-2" style={{ marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>解锁方式</label>
              <select
                id="novelGateMode"
                value={gateMode}
                onChange={(e) => onGateModeChange(e.target.value as GateMode)}
              >
                <option value="stage_flags">剧情阶段 + 剧情开关</option>
                <option value="stage_only">只按剧情阶段</option>
                <option value="public_only">只做公开信息</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>每个片段最多生成几条</label>
              <input
                id="novelEntryBudget"
                type="number"
                min={1}
                value={entryBudget}
                onChange={(e) => onEntryBudgetChange(Number(e.target.value) || 18)}
              />
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>整理方式</label>
              <select
                id="novelNarrativeMode"
                value={narrativeMode}
                onChange={(e) => onNarrativeModeChange(e.target.value as NarrativeMode)}
              >
                <option value="story">按剧情顺序整理</option>
                <option value="lore_only">只整理设定（不按剧情顺序）</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>说明</label>
              <div id="novelNarrativeHint" className="novel-inline-note">
                {narrativeHint}
              </div>
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>每次处理多少字</label>
              <select
                id="novelChunkSize"
                value={chunkCharLimit}
                onChange={(e) => onChunkCharLimitChange(Number(e.target.value) || 20000)}
              >
                <option value={12000}>12,000 字</option>
                <option value={20000}>20,000 字</option>
                <option value={32000}>32,000 字</option>
                <option value={50000}>50,000 字</option>
                <option value={80000}>80,000 字</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>提示</label>
              <div className="novel-inline-note">
                AI 一次能处理的文字有上限。这里设的是每段大约多少字，用来把长文本分成几段分别处理。
              </div>
            </div>
          </div>

          <div className="novel-focus-wrap">
            <label className="novel-focus-label">重点提取哪些内容</label>
            <div id="novelFocusTags" className="novel-focus-tags">
              {FOCUS_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`novel-focus-tag ${focus.includes(option.id) ? 'active' : ''}`}
                  onClick={() => handleFocusToggle(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="novel-stage-preview">
            <div className="novel-stage-preview-head">
              <span>剧情阶段顺序</span>
              <strong>{stageOrder.join(' → ')}</strong>
            </div>
            <div className="novel-stage-preview-track">
              {stageOrder.map((stage, i) => (
                <span key={stage + i} className={stage === currentStage ? 'active' : ''}>{stage}</span>
              ))}
            </div>
          </div>

          <div className="novel-action-stack">
            <button
              id="btnNovelGenerate"
              type="button"
              className="btn novel-primary-btn"
              onClick={onGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? '⏳ 生成中…' : '🧬 生成并导出到创建向导'}
            </button>
            <button
              id="btnNovelReset"
              type="button"
              className="btn novel-secondary-btn"
              onClick={onReset}
              disabled={isGenerating}
            >
              重置工坊
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
