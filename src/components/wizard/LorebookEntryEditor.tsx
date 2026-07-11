/**
 * LorebookEntryEditor - Single lorebook entry editor panel.
 * Density-aware editor: compact summary + explicit preview/edit actions
 */
import { TextInput } from '../shared/TextInput';
import { TextArea } from '../shared/TextArea';
import { TagInput } from '../shared/TagInput';
import { Button } from '../shared/Button';
import { useTranslation } from '../../i18n/I18nContext';
import {
  LOREBOOK_POSITION_OPTIONS,
  SELECTIVE_LOGIC_OPTIONS,
  LOREBOOK_ROLE_OPTIONS,
} from '../../constants/defaults';
import { themeAlpha } from '../../constants/theme';
import type { LorebookEntry, LorebookPosition } from '../../constants/defaults';

export type EntryExpandLevel = 'collapsed' | 'preview' | 'edit';

function getStrategyBadge(entry: LorebookEntry, t: (key: string) => string) {
  if (entry.constant) return { icon: '\uD83D\uDD35', label: t('lorebook.strategyConstant') };
  if (entry.keys.length === 0) return { icon: '\uD83D\uDD17', label: t('lorebook.strategyEmbed') };
  return { icon: '\uD83D\uDFE2', label: t('lorebook.strategyTrigger') };
}

function estimateTokens(text: string): number {
  return Math.round((text || '').length * 1.3);
}

interface LorebookEntryEditorProps {
  entry: LorebookEntry;
  index: number;
  onUpdate: (index: number, updates: Partial<LorebookEntry>) => void;
  onRemove: (index: number) => void;
  expandLevel?: EntryExpandLevel;
  onSetLevel?: (level: EntryExpandLevel) => void;
  expanding?: boolean;
  onAiExpand?: () => void;
}

export function LorebookEntryEditor({ entry, index, onUpdate, onRemove, expandLevel, onSetLevel, expanding, onAiExpand }: LorebookEntryEditorProps) {
  const { t } = useTranslation();
  const badge = getStrategyBadge(entry, t);
  const isCollapsed = expandLevel === 'collapsed' || expandLevel === undefined;
  const isPreview = expandLevel === 'preview';
  const isEdit = expandLevel === 'edit';
  const hasExpandControl = expandLevel !== undefined;
  const hasKeysIssue = !entry.constant && entry.keys.length === 0;
  const hasContentIssue = !entry.content.trim();
  const contentPreview = entry.content.trim().replace(/\s+/g, ' ').slice(0, 96);

  const borderColor = 'var(--color-border-default)';
  const surfaceBg = 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.5)';
  const mutedText = 'color-mix(in srgb, var(--text-color) 60%, transparent)';
  const faintText = 'color-mix(in srgb, var(--text-color) 40%, transparent)';
  const disabledBorder = 'color-mix(in srgb, var(--color-border-default) 50%, transparent)';
  const warningBorderStrong = 'color-mix(in srgb, var(--color-status-warning) 60%, transparent)';

  const fieldCls = 'w-full rounded border px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]';
  const labelCls = 'text-xs';
  const hintCls = 'text-[10px] mt-0.5';

  return (
    <div className="rounded-xl border overflow-hidden" style={{
      backgroundColor: surfaceBg,
      borderColor: !entry.enabled ? disabledBorder : entry.constant ? warningBorderStrong : borderColor,
      opacity: !entry.enabled ? 0.5 : 1,
    }}>
      {/* Header */}
      <div className="px-3 sm:px-4 py-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="text-base">{badge.icon}</span>
              <h3 className="text-sm font-semibold truncate max-w-full" style={{ color: 'var(--text-color)' }}>
                {entry.name || t('lorebook.entryFallback', { index: String(index + 1) })}
              </h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ color: mutedText, backgroundColor: 'color-mix(in srgb, var(--color-surface-elevated) 50%, transparent)' }}>
                {badge.label}
              </span>
              <span className="text-[10px] font-mono shrink-0" style={{ color: faintText }}>
                {entry.position}
              </span>
              {hasKeysIssue && <span className="text-[10px] rounded px-1.5 py-0.5" style={{ backgroundColor: themeAlpha('warning', 10), color: 'var(--color-status-warning)' }}>缺触发词</span>}
              {hasContentIssue && <span className="text-[10px] rounded px-1.5 py-0.5" style={{ backgroundColor: themeAlpha('danger', 10), color: 'var(--color-status-danger)' }}>空内容</span>}
              {entry.content && (
                <span className="text-[10px] shrink-0" style={{ color: faintText }}>
                  {entry.content.length}{t('common.words')} · {estimateTokens(entry.content)} tokens
                </span>
              )}
            </div>
            {isCollapsed && (
              <div className="mt-1.5 flex flex-col gap-1 sm:flex-row sm:items-center">
                {entry.keys.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {entry.keys.slice(0, 5).map((key, ki) => (
                      <span key={ki} className="rounded px-1.5 py-0.5 text-[10px] font-mono" style={{ backgroundColor: 'color-mix(in srgb, var(--color-surface-raised) 75%, transparent)', color: 'var(--color-text-secondary)' }}>{key}</span>
                    ))}
                    {entry.keys.length > 5 && <span className="text-[10px]" style={{ color: faintText }}>+{entry.keys.length - 5}</span>}
                  </div>
                )}
                {contentPreview && <p className="min-w-0 truncate text-[11px]" style={{ color: faintText }}>{contentPreview}{entry.content.length > 96 ? '...' : ''}</p>}
              </div>
            )}
          </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end shrink-0" onClick={(e) => e.stopPropagation()}>
          {hasExpandControl && (
            <div className="flex items-center rounded-lg p-0.5" style={{ border: '1px solid color-mix(in srgb, var(--color-border-default) 70%, transparent)', backgroundColor: 'color-mix(in srgb, var(--color-surface-base) 35%, transparent)' }}>
              <button type="button" onClick={() => onSetLevel?.('collapsed')} className={`rounded px-2 py-1 text-[10px] transition-colors ${isCollapsed ? 'bg-[var(--color-surface-elevated)] text-[var(--text-color)]' : 'text-[var(--color-text-muted)] hover:text-[var(--text-color)]'}`}>紧凑</button>
              <button type="button" onClick={() => onSetLevel?.('preview')} className={`rounded px-2 py-1 text-[10px] transition-colors ${isPreview ? 'bg-[var(--color-surface-elevated)] text-[var(--text-color)]' : 'text-[var(--color-text-muted)] hover:text-[var(--text-color)]'}`}>预览</button>
              <button type="button" onClick={() => onSetLevel?.('edit')} className={`rounded px-2 py-1 text-[10px] transition-colors ${isEdit ? 'bg-primary-tint text-primary-bright' : 'text-[var(--color-text-muted)] hover:text-[var(--text-color)]'}`}>编辑</button>
            </div>
          )}
          {onAiExpand && isCollapsed && entry.content.length > 0 && (
            <button
              onClick={onAiExpand}
              disabled={expanding}
              className="text-[10px] px-2 py-0.5 rounded bg-gradient-success text-inverse font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {expanding ? '\u23F3' : `\uD83E\uDEB6\u2192\uD83D\uDCD6 ${t('lorebook.aiExpand')}`}
            </button>
          )}
          {onAiExpand && isCollapsed && (
            <button
              onClick={() => onUpdate(index, { expandNsfw: !entry.expandNsfw })}
              className="text-[10px] px-1.5 py-0.5 rounded shrink-0 transition-colors"
              style={entry.expandNsfw ? {
                backgroundColor: themeAlpha('danger', 40),
                color: 'var(--color-status-danger)',
                border: `1px solid ${themeAlpha('danger', 50)}`,
              } : {
                backgroundColor: 'color-mix(in srgb, var(--color-surface-elevated) 50%, transparent)',
                color: 'var(--color-text-muted)',
                border: '1px solid color-mix(in srgb, var(--color-border-default) 50%, transparent)',
              }}
              title={entry.expandNsfw ? t('lorebook.nsfwToggleOn') : t('lorebook.nsfwToggleOff')}
            >
              {entry.expandNsfw ? `\uD83D\uDD1E ${t('common.nsfw')}` : `\uD83D\uDEE1\uFE0F ${t('common.safe')}`}
            </button>
          )}
          <label className="flex items-center gap-1 text-xs" style={{ color: mutedText }}>
            <input type="checkbox" checked={entry.enabled}
              onChange={(e) => onUpdate(index, { enabled: e.target.checked })}
              className="rounded border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--color-primary)]" />
            {t('lorebook.enable')}
          </label>
          <Button variant="danger" size="sm" onClick={() => onRemove(index)}>&times;</Button>
        </div>
      </div>
      </div>

      {/* Level 1: Preview */}
      {isPreview && (
        <div className="px-4 pb-3 pt-2.5 space-y-2" style={{ borderTop: '1px solid color-mix(in srgb, var(--color-border-default) 30%, transparent)' }}>
          <div className="flex items-center gap-2">
            <span className="text-xs shrink-0" style={{ color: faintText }}>{t('lorebook.titleLabel')}:</span>
            <span className="text-sm" style={{ color: 'var(--text-color)' }}>{entry.name || `(${t('common.empty')})`}</span>
          </div>
          {entry.keys.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-xs shrink-0 pt-0.5" style={{ color: faintText }}>{t('lorebook.keysLabel')}:</span>
              <div className="flex flex-wrap gap-1">
                {entry.keys.map((key, ki) => (
                  <span key={ki} className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: 'color-mix(in srgb, var(--color-surface-elevated) 60%, transparent)', color: 'var(--color-text-secondary)' }}>
                    {key}
                  </span>
                ))}
              </div>
            </div>
          )}
          {entry.content && (
            <div>
              <span className="text-xs" style={{ color: faintText }}>{t('lorebook.contentLabel')}:</span>
              <pre className="mt-1 text-xs whitespace-pre-wrap leading-relaxed max-h-[200px] overflow-y-auto rounded-lg p-2.5 border" style={{ color: 'color-mix(in srgb, var(--text-color) 80%, transparent)', backgroundColor: 'color-mix(in srgb, var(--color-surface-base) 50%, transparent)', borderColor: 'color-mix(in srgb, var(--color-border-default) 30%, transparent)' }}>
                {entry.content}
              </pre>
              <p className="text-[10px] mt-1" style={{ color: faintText }}>
                {t('lorebook.charTokenEstimate', { chars: String(entry.content.length), tokens: String(estimateTokens(entry.content)) })}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Level 2: Full Edit Form */}
      {isEdit && (
        <div className="px-4 pb-4 space-y-3 pt-3" style={{ borderTop: '1px solid color-mix(in srgb, var(--color-border-default) 30%, transparent)' }}>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-3">
            <TextInput
              label={t('lorebook.titleLabel')}
              value={entry.name}
              onChange={(e) => onUpdate(index, { name: e.target.value })}
              placeholder={t('lorebook.titlePlaceholder')}
            />
            <div className="flex flex-col gap-1 pt-5">
              <label className="flex items-center gap-1 text-xs" style={{ color: 'color-mix(in srgb, var(--text-color) 80%, transparent)' }}>
                <input type="checkbox" checked={entry.constant}
                  onChange={(e) => onUpdate(index, { constant: e.target.checked })}
                  className="rounded border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--color-primary)]" />
                &#x1F535; {t('lorebook.constantLabel')}
              </label>
            </div>
          </div>

          {!entry.constant && (
            <div className="grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-3">
              <TagInput
                label={t('lorebook.keysLabel')}
                tags={entry.keys}
                onChange={(keys) => onUpdate(index, { keys })}
                placeholder={t('lorebook.keysPlaceholder')}
              />
              <div className="flex flex-col gap-1 pt-5 text-[10px]" style={{ color: faintText }}>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={entry.use_regex}
                    onChange={(e) => onUpdate(index, { use_regex: e.target.checked })}
                    className="rounded border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--color-primary)]" />
                  {t('lorebook.regexLabel')}
                </label>
              </div>
            </div>
          )}

          <TextArea
            label={t('lorebook.contentLabel')}
            value={entry.content}
            onChange={(e) => onUpdate(index, { content: e.target.value })}
            placeholder={t('lorebook.contentPlaceholder')}
            rows={3}
          />
          <p className="text-[10px] -mt-2" style={{ color: faintText }}>
            {t('lorebook.charTokenEstimate', { chars: String((entry.content || '').length), tokens: String(estimateTokens(entry.content)) })}
          </p>

          {/* Trigger & Insertion parameters */}
          <div className="pt-3" style={{ borderTop: '1px solid color-mix(in srgb, var(--color-border-default) 50%, transparent)' }}>
            <p className="text-[11px] font-medium mb-2" style={{ color: mutedText }}>{t('lorebook.triggerParams')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className={labelCls} style={{ color: mutedText }}>{t('lorebook.positionLabel')}</label>
                <select value={entry.position}
                  onChange={(e) => onUpdate(index, { position: e.target.value as LorebookPosition })}
                  className={fieldCls}
                  style={{ borderColor, backgroundColor: 'var(--input-bg)', color: 'var(--text-color)' }}>
                  {LOREBOOK_POSITION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} style={{ color: mutedText }}>{t('lorebook.orderLabel')}</label>
                <input type="number" value={entry.insertion_order}
                  onChange={(e) => onUpdate(index, { insertion_order: parseInt(e.target.value) || 0 })}
                  className={fieldCls}
                  style={{ borderColor, backgroundColor: 'var(--input-bg)', color: 'var(--text-color)' }} />
                <p className={hintCls} style={{ color: faintText }}>{t('lorebook.orderHint')}</p>
              </div>
              <div>
                <label className={labelCls} style={{ color: mutedText }}>{t('lorebook.priorityLabel')}</label>
                <input type="number" value={entry.priority}
                  onChange={(e) => onUpdate(index, { priority: parseInt(e.target.value) || 0 })}
                  className={fieldCls}
                  style={{ borderColor, backgroundColor: 'var(--input-bg)', color: 'var(--text-color)' }} />
                <p className={hintCls} style={{ color: faintText }}>{t('lorebook.priorityHint')}</p>
              </div>
              <div>
                <label className={labelCls} style={{ color: mutedText }}>{t('lorebook.probabilityLabel')}</label>
                <div className="flex items-center gap-1.5">
                  <input type="range" min={0} max={100} step={5} value={entry.probability}
                    onChange={(e) => onUpdate(index, { probability: parseInt(e.target.value) })}
                    className="flex-1 accent-[var(--color-primary)]" />
                  <span className="text-xs text-primary-muted w-8 text-right">{entry.probability}%</span>
                </div>
              </div>
              <div>
                <label className={labelCls} style={{ color: mutedText }}>{t('lorebook.depthLabel')}</label>
                <input type="number" min={0} value={entry.depth}
                  onChange={(e) => onUpdate(index, { depth: parseInt(e.target.value) || 0 })}
                  className={fieldCls}
                  style={{ borderColor, backgroundColor: 'var(--input-bg)', color: 'var(--text-color)' }} />
                <p className={hintCls} style={{ color: faintText }}>{t('lorebook.depthHint')}</p>
              </div>
              <div>
                <label className={labelCls} style={{ color: mutedText }}>{t('lorebook.roleLabel')}</label>
                <select value={entry.role}
                  onChange={(e) => onUpdate(index, { role: parseInt(e.target.value) || 0 })}
                  className={fieldCls}
                  style={{ borderColor, backgroundColor: 'var(--input-bg)', color: 'var(--text-color)' }}>
                  {LOREBOOK_ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Advanced options */}
          <details className="text-sm">
            <summary className="cursor-pointer hover:text-[var(--text-color)] transition-colors" style={{ color: faintText }}>
              {t('lorebook.advancedOptions')}
            </summary>
            <div className="mt-2 space-y-3">
              <div className="grid grid-cols-[auto,1fr] gap-3 items-start">
                <label className="flex items-center gap-1.5 text-xs pt-2" style={{ color: mutedText }}>
                  <input type="checkbox" checked={entry.selective}
                    onChange={(e) => onUpdate(index, { selective: e.target.checked })}
                    className="rounded border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--color-primary)]" />
                  {t('lorebook.selectiveLabel')}
                </label>
                {entry.selective && (
                  <div className="space-y-2">
                    <select value={entry.selectiveLogic}
                      onChange={(e) => onUpdate(index, { selectiveLogic: parseInt(e.target.value) || 0 })}
                      className={fieldCls}
                      style={{ borderColor, backgroundColor: 'var(--input-bg)', color: 'var(--text-color)' }}>
                      {SELECTIVE_LOGIC_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label} &mdash; {opt.desc}</option>
                      ))}
                    </select>
                    <TagInput
                      label={t('lorebook.secondaryKeysLabel')}
                      tags={entry.secondary_keys}
                      onChange={(secondary_keys) => onUpdate(index, { secondary_keys })}
                      placeholder={t('lorebook.secondaryKeysPlaceholder')}
                    />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} style={{ color: mutedText }}>{t('lorebook.groupLabel')}</label>
                  <input type="text" value={entry.group || ''}
                    onChange={(e) => onUpdate(index, { group: e.target.value })}
                    className={fieldCls}
                    style={{ borderColor, backgroundColor: 'var(--input-bg)', color: 'var(--text-color)' }}
                    placeholder={t('lorebook.groupPlaceholder')} />
                  <p className={hintCls} style={{ color: faintText }}>{t('lorebook.groupHint')}</p>
                </div>
                <div>
                  <label className={labelCls} style={{ color: mutedText }}>{t('lorebook.groupWeightLabel')}</label>
                  <input type="number" value={entry.group_weight}
                    onChange={(e) => onUpdate(index, { group_weight: parseInt(e.target.value) || 100 })}
                    className={fieldCls}
                    style={{ borderColor, backgroundColor: 'var(--input-bg)', color: 'var(--text-color)' }} />
                  <p className={hintCls} style={{ color: faintText }}>{t('lorebook.groupWeightHint')}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls} style={{ color: mutedText }}>{t('lorebook.stickyLabel')}</label>
                  <input type="number" min={0} value={entry.sticky}
                    onChange={(e) => onUpdate(index, { sticky: parseInt(e.target.value) || 0 })}
                    className={fieldCls}
                    style={{ borderColor, backgroundColor: 'var(--input-bg)', color: 'var(--text-color)' }} />
                  <p className={hintCls} style={{ color: faintText }}>{t('lorebook.stickyHint')}</p>
                </div>
                <div>
                  <label className={labelCls} style={{ color: mutedText }}>{t('lorebook.cooldownLabel')}</label>
                  <input type="number" min={0} value={entry.cooldown}
                    onChange={(e) => onUpdate(index, { cooldown: parseInt(e.target.value) || 0 })}
                    className={fieldCls}
                    style={{ borderColor, backgroundColor: 'var(--input-bg)', color: 'var(--text-color)' }} />
                  <p className={hintCls} style={{ color: faintText }}>{t('lorebook.cooldownHint')}</p>
                </div>
                <div>
                  <label className={labelCls} style={{ color: mutedText }}>{t('lorebook.delayLabel')}</label>
                  <input type="number" min={0} value={entry.delay}
                    onChange={(e) => onUpdate(index, { delay: parseInt(e.target.value) || 0 })}
                    className={fieldCls}
                    style={{ borderColor, backgroundColor: 'var(--input-bg)', color: 'var(--text-color)' }} />
                  <p className={hintCls} style={{ color: faintText }}>{t('lorebook.delayHint')}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs" style={{ color: mutedText }}>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={entry.exclude_recursion}
                    onChange={(e) => onUpdate(index, { exclude_recursion: e.target.checked })}
                    className="rounded border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--color-primary)]" />
                  {t('lorebook.excludeRecursion')}
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={entry.prevent_recursion}
                    onChange={(e) => onUpdate(index, { prevent_recursion: e.target.checked })}
                    className="rounded border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--color-primary)]" />
                  {t('lorebook.preventRecursion')}
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={entry.match_whole_words}
                    onChange={(e) => onUpdate(index, { match_whole_words: e.target.checked })}
                    className="rounded border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--color-primary)]" />
                  {t('lorebook.matchWholeWords')}
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={entry.case_sensitive}
                    onChange={(e) => onUpdate(index, { case_sensitive: e.target.checked })}
                    className="rounded border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--color-primary)]" />
                  {t('lorebook.caseSensitive')}
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={entry.ignore_budget}
                    onChange={(e) => onUpdate(index, { ignore_budget: e.target.checked })}
                    className="rounded border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--color-primary)]" />
                  {t('lorebook.ignoreBudget')}
                </label>
              </div>
              <div>
                <label className={labelCls} style={{ color: mutedText }}>{t('lorebook.commentLabel')}</label>
                <input type="text" value={entry.comment || ''}
                  onChange={(e) => onUpdate(index, { comment: e.target.value })}
                  className={fieldCls}
                  style={{ borderColor, backgroundColor: 'var(--input-bg)', color: 'var(--text-color)' }}
                  placeholder={t('lorebook.commentPlaceholder')} />
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
