/**
 * HeaderBanner - Top banner with title and stats
 * Migrated from .temp_statusbar.astro
 */

import type { GeneratedEntry, EntityIndex, RevealFlag, VariableBlueprint } from '../types';

interface HeaderBannerProps {
  summary: string;
  generatedEntries: GeneratedEntry[];
  entityIndex: EntityIndex[];
  flags: RevealFlag[];
  generatedVariables: VariableBlueprint[];
}

export function HeaderBanner({
  generatedEntries,
  entityIndex,
  flags,
  generatedVariables,
}: HeaderBannerProps) {
  const chips: string[] = [];
  if (generatedEntries.length) chips.push(`📖 世界书条目 ${generatedEntries.length}`);
  if (entityIndex.length) chips.push(`🧬 角色/设定 ${entityIndex.length}`);
  if (flags.length) chips.push(`🔐 剧情开关 ${flags.length}`);
  if (generatedVariables.length) chips.push(`🧠 记忆变量 ${generatedVariables.length}`);
  if (!chips.length) chips.push('等待导入文本');

  return (
    <div className="novel-header">
      <div className="novel-header-badge">NOVEL LORE WORKSHOP</div>
      <div className="novel-header-main">
        <div className="novel-header-copy">
          <h2>📚 小说世界书工坊</h2>
          <p>把长篇小说整理成世界书资料，同时生成用于控制剧情解锁的 AI 记忆变量。</p>
        </div>
        <div className="novel-header-orbit">
          <span className="novel-orbit-ring" />
          <span className="novel-orbit-core">MVU</span>
        </div>
      </div>
      <div className="novel-stats" id="novelStatsBar">
        {chips.map((label, index) => (
          <span key={index} className="novel-stat-chip">{label}</span>
        ))}
      </div>
    </div>
  );
}
