/**
 * ConfigPanel - Configuration options
 * Migrated from .temp_statusbar.astro
 */

import type { GateMode, NarrativeMode, CategoryId } from '../types';
import { FOCUS_OPTIONS, DEFAULT_STAGE_ORDER } from '../types';

interface ConfigPanelProps {
  gateMode: GateMode;
  narrativeMode: NarrativeMode;
  entryBudget: number;
  chunkCharLimit: number;
  focus: CategoryId[];
  stageOrder: string[];
  currentStage: string;
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
    ? '只做世界观：尽量去掉剧情时间线，不强调先后推进，优先保留稳定设定。'
    : '按剧情推进：允许保留阶段性关系变化、关键事件后果和阅读顺序。';

  return (
    <div className="novel-grid">
      <section className="novel-card novel-config-card">
        <div className="novel-card-head">
          <strong>门控设计</strong>
          <span>世界书 + 变量联动</span>
        </div>
        <div className="novel-card-body">
          <div className="grid-2" style={{ marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>门控模式</label>
              <select
                id="novelGateMode"
                value={gateMode}
                onChange={(e) => onGateModeChange(e.target.value as GateMode)}
              >
                <option value="stage_flags">阶段 + 揭露标记</option>
                <option value="stage_only">仅剧情阶段</option>
                <option value="public_only">仅公开资料</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>条目预算</label>
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
              <label>整理模式</label>
              <select
                id="novelNarrativeMode"
                value={narrativeMode}
                onChange={(e) => onNarrativeModeChange(e.target.value as NarrativeMode)}
              >
                <option value="story">按剧情推进</option>
                <option value="lore_only">只做世界观</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>模式说明</label>
              <div id="novelNarrativeHint" className="novel-inline-note">
                {narrativeHint}
              </div>
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>单次分片字数</label>
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
              <label>上下文提醒</label>
              <div className="novel-inline-note">
                模型限制按 token 算，不按字数算。这里是经验字数上限，用来做稳妥分片。
              </div>
            </div>
          </div>

          <div className="novel-focus-wrap">
            <label className="novel-focus-label">抽取重点</label>
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
              <span>默认解锁路径</span>
              <strong>公开 → 前期 → 中期 → 后期 → 终局</strong>
            </div>
            <div className="novel-stage-preview-track">
              {DEFAULT_STAGE_ORDER.map((stage) => (
                <span key={stage}>{stage}</span>
              ))}
            </div>
          </div>

          <div className="novel-action-stack">
            <button
              id="btnNovelGenerate"
              type="button"
              className="btn novel-primary-btn"
              onClick={onGenerate}
            >
              🧬 生成并注入小说世界书
            </button>
            <button
              id="btnNovelReset"
              type="button"
              className="btn novel-secondary-btn"
              onClick={onReset}
            >
              重置工坊
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
