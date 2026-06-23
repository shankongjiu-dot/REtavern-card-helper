/**
 * LorebookEntryEditor - Single lorebook entry editor panel.
 *
 * Three-level expand for information density:
 *   Level 0 (collapsed): Header only — title, badge, position, keys preview, char count
 *   Level 1 (preview):   Title + content as read-only preview (compact, high density)
 *   Level 2 (edit):      Full editing form with all parameters
 *
 * Click header to cycle: collapsed → preview → edit → collapsed
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
import type { LorebookEntry, LorebookPosition } from '../../constants/defaults';

export type EntryExpandLevel = 'collapsed' | 'preview' | 'edit';

/** Determine trigger strategy badge */
function getStrategyBadge(entry: LorebookEntry, t: (key: string) => string) {
  if (entry.constant) return { icon: '🔵', label: t('lorebook.strategyConstant') };
  if (entry.keys.length === 0) return { icon: '🔗', label: t('lorebook.strategyEmbed') };
  return { icon: '🟢', label: t('lorebook.strategyTrigger') };
}

/** Rough token estimate (~1.3 tokens per char for CJK) */
function estimateTokens(text: string): number {
  return Math.round((text || '').length * 1.3);
}

interface LorebookEntryEditorProps {
  entry: LorebookEntry;
  index: number;
  onUpdate: (index: number, updates: Partial<LorebookEntry>) => void;
  onRemove: (index: number) => void;
  /** Current expand level */
  expandLevel?: EntryExpandLevel;
  /** Cycle expand level: collapsed → preview → edit → collapsed */
  onCycleExpand?: () => void;
  /** Whether this entry is currently being AI-expanded */
  expanding?: boolean;
  /** Callback to trigger AI expansion of this entry */
  onAiExpand?: () => void;
}

export function LorebookEntryEditor({ entry, index, onUpdate, onRemove, expandLevel, onCycleExpand, expanding, onAiExpand }: LorebookEntryEditorProps) {
  const { t } = useTranslation();
  const badge = getStrategyBadge(entry, t);
  const isCollapsed = expandLevel === 'collapsed' || expandLevel === undefined;
  const isPreview = expandLevel === 'preview';
  const isEdit = expandLevel === 'edit';
  const hasExpandControl = expandLevel !== undefined;

  const fieldCls = 'w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-200';
  const labelCls = 'text-xs text-slate-400';
  const hintCls = 'text-[10px] text-slate-500 mt-0.5';

  return (
    <div className={`rounded-xl border bg-slate-800/50 overflow-hidden ${
      !entry.enabled ? 'border-slate-700/50 opacity-50' :
      entry.constant ? 'border-amber-700/60' : 'border-slate-700'
    }`}>
      {/* ── Header (always visible, clickable to cycle expand) ──────── */}
      <div
        className={`flex items-center justify-between gap-2 px-4 py-2.5 ${hasExpandControl ? 'cursor-pointer hover:bg-slate-700/30' : ''}`}
        onClick={hasExpandControl ? onCycleExpand : undefined}
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasExpandControl && (
            <span className="text-xs text-slate-500 shrink-0 transition-transform duration-200" style={{
              transform: isCollapsed ? 'rotate(-90deg)' : isPreview ? 'rotate(0deg)' : 'rotate(90deg)'
            }}>▼</span>
          )}
          <span className="text-base">{badge.icon}</span>
          <h3 className="text-sm font-semibold text-white truncate">
            {entry.name || t('lorebook.entryFallback', { index: String(index + 1) })}
          </h3>
          <span className="text-[10px] text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded shrink-0">
            {badge.label}
          </span>
          <span className="text-[10px] text-slate-600 font-mono shrink-0">
            {entry.position}
          </span>
          {isCollapsed && entry.keys.length > 0 && (
            <span className="text-[10px] text-slate-500 truncate max-w-[120px] shrink-0">
              {entry.keys.slice(0, 3).join(', ')}{entry.keys.length > 3 ? '...' : ''}
            </span>
          )}
          {isCollapsed && entry.content && (
            <span className="text-[10px] text-slate-600 shrink-0">
              {entry.content.length}{t('common.words')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          {isPreview && (
            <span className="text-[10px] text-slate-500">{t('lorebook.clickExpand')}</span>
          )}
          {isEdit && (
            <span className="text-[10px] text-slate-500">{t('lorebook.clickCollapse')}</span>
          )}
          {/* AI Expand button */}
          {onAiExpand && isCollapsed && entry.content.length > 0 && (
            <button
              onClick={onAiExpand}
              disabled={expanding}
              className="text-[10px] px-2 py-0.5 rounded bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {expanding ? '⏳' : `🦴→📖 ${t('lorebook.aiExpand')}`}
            </button>
          )}
          {/* Per-entry NSFW toggle for AI expansion */}
          {onAiExpand && isCollapsed && (
            <button
              onClick={() => onUpdate(index, { expandNsfw: !entry.expandNsfw })}
              className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 transition-colors ${
                entry.expandNsfw
                  ? 'bg-rose-900/40 text-rose-300 border border-rose-700/50'
                  : 'bg-slate-700/50 text-slate-500 border border-slate-600/50 hover:border-slate-500'
              }`}
              title={entry.expandNsfw ? t('lorebook.nsfwToggleOn') : t('lorebook.nsfwToggleOff')}
            >
              {entry.expandNsfw ? `🔞 ${t('common.nsfw')}` : `🛡️ ${t('common.safe')}`}
            </button>
          )}
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <input type="checkbox" checked={entry.enabled}
              onChange={(e) => onUpdate(index, { enabled: e.target.checked })}
              className="rounded border-slate-600 bg-slate-800 text-indigo-600" />
            {t('lorebook.enable')}
          </label>
          <Button variant="danger" size="sm" onClick={() => onRemove(index)}>×</Button>
        </div>
      </div>

      {/* ── Level 1: Preview (title + content read-only) ────────────── */}
      {isPreview && (
        <div className="px-4 pb-3 border-t border-slate-700/30 pt-2.5 space-y-2">
          {/* Title display */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 shrink-0">{t('lorebook.titleLabel')}：</span>
            <span className="text-sm text-slate-200">{entry.name || `(${t('common.empty')})`}</span>
          </div>

          {/* Keys display */}
          {entry.keys.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-xs text-slate-500 shrink-0 pt-0.5">{t('lorebook.keysLabel')}：</span>
              <div className="flex flex-wrap gap-1">
                {entry.keys.map((key, ki) => (
                  <span key={ki} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 font-mono">
                    {key}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Content preview */}
          {entry.content && (
            <div>
              <span className="text-xs text-slate-500">{t('lorebook.contentLabel')}：</span>
              <pre className="mt-1 text-xs text-slate-300 whitespace-pre-wrap leading-relaxed max-h-[200px] overflow-y-auto rounded-lg bg-slate-900/50 p-2.5 border border-slate-700/30">
                {entry.content}
              </pre>
              <p className="text-[10px] text-slate-500 mt-1">
                {t('lorebook.charTokenEstimate', { chars: String(entry.content.length), tokens: String(estimateTokens(entry.content)) })}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Level 2: Full Edit Form ────────────────────────────────── */}
      {isEdit && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-700/30 pt-3">

          {/* Title + constant toggle */}
          <div className="grid grid-cols-[1fr,auto] gap-3">
            <TextInput
              label={t('lorebook.titleLabel')}
              value={entry.name}
              onChange={(e) => onUpdate(index, { name: e.target.value })}
              placeholder={t('lorebook.titlePlaceholder')}
            />
            <div className="flex flex-col gap-1 pt-5">
              <label className="flex items-center gap-1 text-xs text-slate-300">
                <input type="checkbox" checked={entry.constant}
                  onChange={(e) => onUpdate(index, { constant: e.target.checked })}
                  className="rounded border-slate-600 bg-slate-800 text-indigo-600" />
                🔵 {t('lorebook.constantLabel')}
              </label>
            </div>
          </div>

          {/* Keys */}
          {!entry.constant && (
            <div className="grid grid-cols-[1fr,auto] gap-3">
              <TagInput
                label={t('lorebook.keysLabel')}
                tags={entry.keys}
                onChange={(keys) => onUpdate(index, { keys })}
                placeholder={t('lorebook.keysPlaceholder')}
              />
              <div className="flex flex-col gap-1 pt-5 text-[10px] text-slate-500">
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={entry.use_regex}
                    onChange={(e) => onUpdate(index, { use_regex: e.target.checked })}
                    className="rounded border-slate-600 bg-slate-800 text-indigo-600" />
                  {t('lorebook.regexLabel')}
                </label>
              </div>
            </div>
          )}

          {/* Content editor */}
          <TextArea
            label={t('lorebook.contentLabel')}
            value={entry.content}
            onChange={(e) => onUpdate(index, { content: e.target.value })}
            placeholder={t('lorebook.contentPlaceholder')}
            rows={3}
          />
          <p className="text-[10px] text-slate-500 -mt-2">
            {t('lorebook.charTokenEstimate', { chars: String((entry.content || '').length), tokens: String(estimateTokens(entry.content)) })}
          </p>

          {/* Trigger & Insertion parameters */}
          <div className="border-t border-slate-700/50 pt-3">
            <p className="text-[11px] font-medium text-slate-400 mb-2">{t('lorebook.triggerParams')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className={labelCls}>{t('lorebook.positionLabel')}</label>
                <select value={entry.position}
                  onChange={(e) => onUpdate(index, { position: e.target.value as LorebookPosition })}
                  className={fieldCls}>
                  {LOREBOOK_POSITION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>{t('lorebook.orderLabel')}</label>
                <input type="number" value={entry.insertion_order}
                  onChange={(e) => onUpdate(index, { insertion_order: parseInt(e.target.value) || 0 })}
                  className={fieldCls} />
                <p className={hintCls}>{t('lorebook.orderHint')}</p>
              </div>
              <div>
                <label className={labelCls}>{t('lorebook.priorityLabel')}</label>
                <input type="number" value={entry.priority}
                  onChange={(e) => onUpdate(index, { priority: parseInt(e.target.value) || 0 })}
                  className={fieldCls} />
                <p className={hintCls}>{t('lorebook.priorityHint')}</p>
              </div>
              <div>
                <label className={labelCls}>{t('lorebook.probabilityLabel')}</label>
                <div className="flex items-center gap-1.5">
                  <input type="range" min={0} max={100} step={5} value={entry.probability}
                    onChange={(e) => onUpdate(index, { probability: parseInt(e.target.value) })}
                    className="flex-1 accent-indigo-600" />
                  <span className="text-xs text-indigo-400 w-8 text-right">{entry.probability}%</span>
                </div>
              </div>
              <div>
                <label className={labelCls}>{t('lorebook.depthLabel')}</label>
                <input type="number" min={0} value={entry.depth}
                  onChange={(e) => onUpdate(index, { depth: parseInt(e.target.value) || 0 })}
                  className={fieldCls} />
                <p className={hintCls}>{t('lorebook.depthHint')}</p>
              </div>
              <div>
                <label className={labelCls}>{t('lorebook.roleLabel')}</label>
                <select value={entry.role}
                  onChange={(e) => onUpdate(index, { role: parseInt(e.target.value) || 0 })}
                  className={fieldCls}>
                  {LOREBOOK_ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Advanced options */}
          <details className="text-sm">
            <summary className="text-slate-500 cursor-pointer hover:text-slate-300">
              {t('lorebook.advancedOptions')}
            </summary>
            <div className="mt-2 space-y-3">
              <div className="grid grid-cols-[auto,1fr] gap-3 items-start">
                <label className="flex items-center gap-1.5 text-xs text-slate-400 pt-2">
                  <input type="checkbox" checked={entry.selective}
                    onChange={(e) => onUpdate(index, { selective: e.target.checked })}
                    className="rounded border-slate-600 bg-slate-800 text-indigo-600" />
                  {t('lorebook.selectiveLabel')}
                </label>
                {entry.selective && (
                  <div className="space-y-2">
                    <select value={entry.selectiveLogic}
                      onChange={(e) => onUpdate(index, { selectiveLogic: parseInt(e.target.value) || 0 })}
                      className={fieldCls}>
                      {SELECTIVE_LOGIC_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label} — {opt.desc}</option>
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
                  <label className={labelCls}>{t('lorebook.groupLabel')}</label>
                  <input type="text" value={entry.group || ''}
                    onChange={(e) => onUpdate(index, { group: e.target.value })}
                    className={fieldCls}
                    placeholder={t('lorebook.groupPlaceholder')} />
                  <p className={hintCls}>{t('lorebook.groupHint')}</p>
                </div>
                <div>
                  <label className={labelCls}>{t('lorebook.groupWeightLabel')}</label>
                  <input type="number" value={entry.group_weight}
                    onChange={(e) => onUpdate(index, { group_weight: parseInt(e.target.value) || 100 })}
                    className={fieldCls} />
                  <p className={hintCls}>{t('lorebook.groupWeightHint')}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>{t('lorebook.stickyLabel')}</label>
                  <input type="number" min={0} value={entry.sticky}
                    onChange={(e) => onUpdate(index, { sticky: parseInt(e.target.value) || 0 })}
                    className={fieldCls} />
                  <p className={hintCls}>{t('lorebook.stickyHint')}</p>
                </div>
                <div>
                  <label className={labelCls}>{t('lorebook.cooldownLabel')}</label>
                  <input type="number" min={0} value={entry.cooldown}
                    onChange={(e) => onUpdate(index, { cooldown: parseInt(e.target.value) || 0 })}
                    className={fieldCls} />
                  <p className={hintCls}>{t('lorebook.cooldownHint')}</p>
                </div>
                <div>
                  <label className={labelCls}>{t('lorebook.delayLabel')}</label>
                  <input type="number" min={0} value={entry.delay}
                    onChange={(e) => onUpdate(index, { delay: parseInt(e.target.value) || 0 })}
                    className={fieldCls} />
                  <p className={hintCls}>{t('lorebook.delayHint')}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={entry.exclude_recursion}
                    onChange={(e) => onUpdate(index, { exclude_recursion: e.target.checked })}
                    className="rounded border-slate-600 bg-slate-800 text-indigo-600" />
                  {t('lorebook.excludeRecursion')}
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={entry.prevent_recursion}
                    onChange={(e) => onUpdate(index, { prevent_recursion: e.target.checked })}
                    className="rounded border-slate-600 bg-slate-800 text-indigo-600" />
                  {t('lorebook.preventRecursion')}
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={entry.match_whole_words}
                    onChange={(e) => onUpdate(index, { match_whole_words: e.target.checked })}
                    className="rounded border-slate-600 bg-slate-800 text-indigo-600" />
                  {t('lorebook.matchWholeWords')}
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={entry.case_sensitive}
                    onChange={(e) => onUpdate(index, { case_sensitive: e.target.checked })}
                    className="rounded border-slate-600 bg-slate-800 text-indigo-600" />
                  {t('lorebook.caseSensitive')}
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={entry.ignore_budget}
                    onChange={(e) => onUpdate(index, { ignore_budget: e.target.checked })}
                    className="rounded border-slate-600 bg-slate-800 text-indigo-600" />
                  {t('lorebook.ignoreBudget')}
                </label>
              </div>
              <div>
                <label className={labelCls}>{t('lorebook.commentLabel')}</label>
                <input type="text" value={entry.comment || ''}
                  onChange={(e) => onUpdate(index, { comment: e.target.value })}
                  className={fieldCls}
                  placeholder={t('lorebook.commentPlaceholder')} />
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
