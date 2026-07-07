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
  if (generatedEntries.length) chips.push(`📖 条目 ${generatedEntries.length}`);
  if (entityIndex.length) chips.push(`🧬 实体 ${entityIndex.length}`);
  if (flags.length) chips.push(`🔐 标记 ${flags.length}`);
  if (generatedVariables.length) chips.push(`🧠 AI 变量蓝图 ${generatedVariables.length}`);
  if (!chips.length) chips.push('等待导入文本');

  return (
    <div className="novel-header">
      <div className="novel-header-badge">NOVEL LORE WORKSHOP</div>
      <div className="novel-header-main">
        <div className="novel-header-copy">
          <h2>📚 小说世界书工坊</h2>
          <p>把长篇小说整理成可控的世界书包，同时生成真正用于管理解锁状态的 MVU 变量。</p>
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
