/**
 * WorldAnchorPanel — 世界观锚定结构化约束面板.
 * Provides structured fields (era, coreRules, hardConstraints, tone) to prevent
 * AI from deviating from established world settings during generation.
 */
import { useState } from 'react';
import { themeAlpha } from '../../constants/theme';
import type { WorldAnchor } from '../../constants/defaults';

const ERA_CHIPS = ['现代都市', '近现代', '古代', '未来科幻', '奇幻架空', '末日生存', '校园日常'] as const;

interface WorldAnchorPanelProps {
  anchor: WorldAnchor;
  onChange: (anchor: WorldAnchor) => void;
  defaultExpanded?: boolean;
}

export function WorldAnchorPanel({ anchor, onChange, defaultExpanded = true }: WorldAnchorPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const C = {
    text: 'var(--text-color)',
    secondary: 'var(--color-text-secondary)',
    muted: 'var(--color-text-muted)',
    border: 'var(--color-border-default)',
    inputBg: 'var(--input-bg)',
    inputBorder: 'var(--input-border)',
    primary: 'var(--color-primary)',
    warning: 'var(--color-status-warning)',
  } as const;

  const update = (field: keyof WorldAnchor, value: string) => {
    onChange({ ...anchor, [field]: value });
  };

  const textareaStyle: React.CSSProperties = {
    width: '100%',
    minHeight: '60px',
    padding: '8px 10px',
    borderRadius: '8px',
    border: `1px solid ${C.inputBorder}`,
    background: C.inputBg,
    color: C.text,
    fontSize: '13px',
    lineHeight: '1.5',
    resize: 'vertical',
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: C.secondary,
    marginBottom: '4px',
  };

  return (
    <div
      className="rounded-xl mb-4"
      style={{
        border: `1.5px solid ${themeAlpha('warning', 40)}`,
        background: themeAlpha('warning', 6),
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 cursor-pointer"
        style={{ background: 'transparent', border: 'none', textAlign: 'left' }}
      >
        <span style={{ fontSize: '16px' }}>⚓</span>
        <span style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>世界观锚定</span>
        <span style={{ fontSize: '11px', color: C.muted, marginLeft: '4px' }}>
          防止 AI 偏离设定
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: C.muted }}>
          {expanded ? '▼' : '▶'}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Era field with quick-select chips */}
          <div>
            <label style={labelStyle}>时代背景</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {ERA_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => update('era', chip)}
                  className="px-2.5 py-1 rounded-full text-xs cursor-pointer transition-colors"
                  style={{
                    border: `1px solid ${anchor.era === chip ? C.primary : C.border}`,
                    background: anchor.era === chip ? themeAlpha('primary', 15) : 'transparent',
                    color: anchor.era === chip ? C.primary : C.secondary,
                    fontWeight: anchor.era === chip ? 600 : 400,
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={anchor.era}
              onChange={(e) => update('era', e.target.value)}
              placeholder="自定义时代背景（如：蒸汽朋克、赛博朋克2077...）"
              className="w-full px-2.5 py-1.5 rounded-lg text-sm"
              style={{
                border: `1px solid ${C.inputBorder}`,
                background: C.inputBg,
                color: C.text,
                outline: 'none',
              }}
            />
          </div>

          {/* Core rules */}
          <div>
            <label style={labelStyle}>核心规则</label>
            <textarea
              value={anchor.coreRules}
              onChange={(e) => update('coreRules', e.target.value)}
              placeholder="例：这是一个以都市为背景的现代世界，存在隐藏的超能力者组织..."
              style={textareaStyle}
              rows={2}
            />
          </div>

          {/* Hard constraints */}
          <div>
            <label style={labelStyle}>禁止偏离项</label>
            <textarea
              value={anchor.hardConstraints}
              onChange={(e) => update('hardConstraints', e.target.value)}
              placeholder="例：不存在魔法或超自然力量；科技水平不超过2024年；没有外星人入侵..."
              style={{
                ...textareaStyle,
                borderColor: themeAlpha('warning', 50),
              }}
              rows={2}
            />
          </div>

          {/* Tone */}
          <div>
            <label style={labelStyle}>基调/氛围</label>
            <textarea
              value={anchor.tone}
              onChange={(e) => update('tone', e.target.value)}
              placeholder="例：轻松日常为主，偶尔有紧张悬疑..."
              style={textareaStyle}
              rows={2}
            />
          </div>

          {/* Hint text */}
          <p style={{ fontSize: '11px', color: C.muted, margin: 0, lineHeight: '1.4' }}>
            这些约束会注入所有 AI 生成环节（骨架、展开、角色），并导出为常驻世界书条目
          </p>
        </div>
      )}
    </div>
  );
}
