/**
 * ManagerPanel - World book unlock management
 * Migrated from .temp_statusbar.astro
 */

import type { GeneratedEntry, EntityIndex, RevealFlag } from '../types';
import { categoryLabel } from '../utils';

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
}

export function ManagerPanel({
  visible,
  summary,
  stageOrder,
  currentStage,
  flags,
  entityIndex,
  onStageChange,
  onFlagToggle,
  onSyncVariables,
}: ManagerPanelProps) {
  if (!visible) return null;

  return (
    <section id="novelManager" className="novel-manager">
      <div className="novel-manager-head">
        <div>
          <strong>🧭 世界书解锁管理</strong>
          <p id="novelSummaryText">{summary || '尚未生成。'}</p>
        </div>
        <div className="novel-manager-actions">
          <button
            id="btnNovelSyncVariables"
            type="button"
            className="btn novel-sync-btn"
            onClick={onSyncVariables}
          >
            同步到 MVU 变量节点
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
              </button>
            ))}
          </div>
        </div>

        <div className="novel-manager-block">
          <div className="novel-block-title">揭露标记</div>
          <div id="novelFlagList" className="novel-flag-list">
            {flags.length === 0 ? (
              <div className="novel-flag-empty">
                当前工坊没有额外揭露标记，阶段本身就是唯一门控。
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
                    <span>{flag.description || '达到条件后才允许解锁这组资料。'}</span>
                  </div>
                </label>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="novel-preview-shell">
        <div className="novel-preview-head">
          <strong>实体索引预览</strong>
          <span id="novelEntityCount">{entityIndex.length} 个实体</span>
        </div>
        <div id="novelEntityPreview" className="novel-entity-preview">
          {entityIndex.length === 0 ? (
            <div className="novel-entity-empty">当前还没有实体索引。</div>
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
    </section>
  );
}
