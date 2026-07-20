/**
 * FieldDiffCard — renders a single field's before/after diff inside the
 * OptimizeCompareModal. Dispatches rendering by field type:
 *   - string fields (cardName, firstMessage): side-by-side <pre>
 *   - tags: list diff (removed/added colored)
 *   - lorebookEntries: per-entry sub-cards matched by comment
 *   - mvu.statusBarHtml: toggle source compare / iframe render preview
 *   - mvu.schemaSections: table of path/description changes
 */
import { useState } from 'react';
import { Check, ChevronDown, Code2, Eye } from 'lucide-react';
import { useTranslation } from '../../i18n/I18nContext';
import { Button } from '../shared/Button';
import { getThemeSettings } from '../../services/theme-service';
import type { FieldDiff } from '../../services/card-optimizer';
import type { OptimizeFieldKey } from '../../services/card-optimizer';

interface FieldDiffCardProps {
  diff: FieldDiff;
  applied: boolean;
  onApply: () => void;
}

const FIELD_LABEL_KEYS: Record<OptimizeFieldKey, string> = {
  cardName: 'optimizeCompare.fieldCardName',
  tags: 'optimizeCompare.fieldTags',
  firstMessage: 'optimizeCompare.fieldFirstMessage',
  lorebookEntries: 'optimizeCompare.fieldLorebookEntries',
  'mvu.statusBarHtml': 'optimizeCompare.fieldMvuStatusBarHtml',
  'mvu.schemaSections': 'optimizeCompare.fieldMvuSchemaSections',
};

const borderColor = 'var(--color-border-default)';
const mutedText = 'color-mix(in srgb, var(--text-color) 60%, transparent)';
const faintText = 'color-mix(in srgb, var(--text-color) 40%, transparent)';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function countCharDelta(before: string, after: string): number {
  return after.length - before.length;
}

function buildPreviewSrcDoc(content: string): string {
  const theme = getThemeSettings();
  return `<!DOCTYPE html><html><body style="background:${theme.cardBgColor};color:${theme.textColor};font-family:sans-serif;padding:8px;margin:0;">${content}</body></html>`;
}

export function FieldDiffCard({ diff, applied, onApply }: FieldDiffCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [htmlMode, setHtmlMode] = useState<'source' | 'preview'>('source');

  const label = t(FIELD_LABEL_KEYS[diff.field]);
  const delta =
    typeof diff.before === 'string' && typeof diff.after === 'string'
      ? countCharDelta(diff.before, diff.after)
      : 0;
  const deltaText = delta !== 0 ? ` (${delta > 0 ? '+' : ''}${delta} ${t('optimizeCompare.charsChanged', { count: '' }).replace(' ', '')})` : '';

  return (
    <div className="rounded-lg border" style={{ borderColor, backgroundColor: 'color-mix(in srgb, var(--color-surface-base) 40%, transparent)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`}
            style={{ color: faintText }}
          />
          <span className="text-sm font-medium" style={{ color: 'var(--text-color)' }}>
            {label}
          </span>
          <span className="text-[10px]" style={{ color: delta > 0 ? 'var(--color-status-warning)' : delta < 0 ? 'var(--color-blue)' : faintText }}>
            {deltaText}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {applied ? (
            <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-status-success)' }}>
              <Check className="w-3 h-3" />
              {t('optimizeCompare.applied')}
            </span>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={(e) => {
                e.stopPropagation();
                onApply();
              }}
              className="!px-2 !py-0.5 !text-[10px]"
            >
              <Check className="w-3 h-3" />
              {t('optimizeCompare.applyItem')}
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      {open && (
        <div className="px-3 pb-3" style={{ borderTop: `1px solid ${borderColor}` }}>
          <FieldDiffContent diff={diff} htmlMode={htmlMode} setHtmlMode={setHtmlMode} />
        </div>
      )}
    </div>
  );
}

function FieldDiffContent({
  diff,
  htmlMode,
  setHtmlMode,
}: {
  diff: FieldDiff;
  htmlMode: 'source' | 'preview';
  setHtmlMode: (m: 'source' | 'preview') => void;
}) {
  const { t } = useTranslation();

  if (diff.field === 'tags') {
    const before = (diff.before as string[]) || [];
    const after = (diff.after as string[]) || [];
    const removed = before.filter((x) => !after.includes(x));
    const added = after.filter((x) => !before.includes(x));
    const common = before.filter((x) => after.includes(x));
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
        <div>
          <div className="text-[10px] mb-1" style={{ color: faintText }}>{t('optimizeCompare.before')}</div>
          <div className="flex flex-wrap gap-1">
            {common.map((x) => (
              <span key={x} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-base)', color: mutedText }}>{x}</span>
            ))}
            {removed.map((x) => (
              <span key={x} className="text-[10px] px-1.5 py-0.5 rounded line-through" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-status-danger)' }}>{x}</span>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] mb-1" style={{ color: faintText }}>{t('optimizeCompare.after')}</div>
          <div className="flex flex-wrap gap-1">
            {common.map((x) => (
              <span key={x} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-base)', color: mutedText }}>{x}</span>
            ))}
            {added.map((x) => (
              <span key={x} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-success-bg)', color: 'var(--color-status-success)' }}>{x}</span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (diff.field === 'lorebookEntries' && diff.entryDiffs) {
    const formatPatch = (value: unknown) => {
      if (Array.isArray(value)) return value.length ? value.join(', ') : '[]';
      if (typeof value === 'boolean') return value ? 'true' : 'false';
      return String(value ?? '');
    };

    return (
      <div className="space-y-2 mt-2">
        <div className="text-[10px]" style={{ color: faintText }}>
          世界书采用补丁式检修：只显示并应用有问题的字段，不会重写整条内容。
        </div>
        {diff.entryDiffs.map((ed, i) => {
          const fields = Array.from(new Set([
            ...Object.keys(ed.before || {}),
            ...Object.keys(ed.after || {}),
          ]));
          return (
            <div key={i} className="rounded border p-2" style={{ borderColor }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-medium" style={{ color: 'var(--text-color)' }}>
                  {ed.comment || `(条目 ${i + 1})`}
                </span>
              </div>
              <div className="space-y-1">
                {fields.map((field) => (
                  <div key={field} className="grid grid-cols-[120px_1fr_1fr] gap-2 items-start text-[10px]">
                    <div className="font-medium" style={{ color: faintText }}>{field}</div>
                    <div className="rounded px-2 py-1 break-words" style={{ background: 'var(--color-surface-base)', color: mutedText }}>
                      {formatPatch((ed.before as Record<string, unknown> | null)?.[field])}
                    </div>
                    <div className="rounded px-2 py-1 break-words" style={{ background: 'var(--color-success-bg)', color: 'var(--color-status-success)' }}>
                      {formatPatch((ed.after as Record<string, unknown> | null)?.[field])}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (diff.field === 'mvu.statusBarHtml') {
    const before = (diff.before as string) || '';
    const after = (diff.after as string) || '';
    return (
      <div className="mt-2">
        <div className="flex items-center gap-1 mb-2">
          <button
            onClick={() => setHtmlMode('source')}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{
              background: htmlMode === 'source' ? 'var(--color-primary)' : 'transparent',
              color: htmlMode === 'source' ? 'var(--text-color)' : mutedText,
            }}
          >
            <Code2 className="w-3 h-3" />
            {t('optimizeCompare.sourceMode')}
          </button>
          <button
            onClick={() => setHtmlMode('preview')}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{
              background: htmlMode === 'preview' ? 'var(--color-primary)' : 'transparent',
              color: htmlMode === 'preview' ? 'var(--text-color)' : mutedText,
            }}
          >
            <Eye className="w-3 h-3" />
            {t('optimizeCompare.previewMode')}
          </button>
        </div>
        {htmlMode === 'source' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] mb-1" style={{ color: faintText }}>{t('optimizeCompare.before')}</div>
              <pre className="text-[10px] p-2 rounded whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto font-mono" style={{ background: 'var(--color-surface-base)', color: mutedText }}>
                {before || t('optimizeCompare.emptyBefore')}
              </pre>
            </div>
            <div>
              <div className="text-[10px] mb-1" style={{ color: faintText }}>{t('optimizeCompare.after')}</div>
              <pre className="text-[10px] p-2 rounded whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto font-mono" style={{ background: 'var(--color-surface-base)', color: 'var(--color-status-success)' }}>
                {after || t('optimizeCompare.emptyBefore')}
              </pre>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] mb-1" style={{ color: faintText }}>{t('optimizeCompare.before')}</div>
              <iframe
                srcDoc={buildPreviewSrcDoc(before)}
                className="w-full h-[200px] rounded border"
                style={{ borderColor }}
                title="before-preview"
                sandbox="allow-same-origin"
              />
            </div>
            <div>
              <div className="text-[10px] mb-1" style={{ color: faintText }}>{t('optimizeCompare.after')}</div>
              <iframe
                srcDoc={buildPreviewSrcDoc(after)}
                className="w-full h-[200px] rounded border"
                style={{ borderColor }}
                title="after-preview"
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (diff.field === 'mvu.schemaSections') {
    const beforeSections = (diff.before as Array<{ name: string; variables: Array<{ path: string; description: string }> }>) || [];
    const afterSections = (diff.after as Array<{ sectionName?: string; variables?: Array<{ path: string; description?: string }> }>) || [];
    return (
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr style={{ color: faintText }}>
              <th className="text-left p-1">Section</th>
              <th className="text-left p-1">Path</th>
              <th className="text-left p-1">{t('optimizeCompare.before')}</th>
              <th className="text-left p-1">{t('optimizeCompare.after')}</th>
            </tr>
          </thead>
          <tbody>
            {afterSections.map((sec, si) =>
              (sec.variables || []).map((v, vi) => {
                const beforeSec = beforeSections.find((bs) => bs.name === sec.sectionName);
                const beforeVar = beforeSec?.variables.find((bv) => bv.path === v.path);
                const changed = beforeVar?.description !== v.description;
                return (
                  <tr key={`${si}-${vi}`} style={{ borderTop: `1px solid ${borderColor}` }}>
                    <td className="p-1" style={{ color: mutedText }}>{sec.sectionName || '-'}</td>
                    <td className="p-1 font-mono" style={{ color: 'var(--text-color)' }}>{v.path}</td>
                    <td className="p-1" style={{ color: mutedText }}>{beforeVar?.description || '-'}</td>
                    <td className="p-1" style={{ color: changed ? 'var(--color-status-success)' : mutedText }}>{v.description || '-'}</td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
    );
  }

  // Default: string fields (cardName, firstMessage)
  const before = typeof diff.before === 'string' ? diff.before : String(diff.before ?? '');
  const after = typeof diff.after === 'string' ? diff.after : String(diff.after ?? '');
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
      <div>
        <div className="text-[10px] mb-1" style={{ color: faintText }}>{t('optimizeCompare.before')}</div>
        <pre
          className="text-xs p-2 rounded whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto"
          style={{ background: 'var(--color-surface-base)', color: mutedText }}
          dangerouslySetInnerHTML={{ __html: escapeHtml(before) || t('optimizeCompare.emptyBefore') }}
        />
      </div>
      <div>
        <div className="text-[10px] mb-1" style={{ color: faintText }}>{t('optimizeCompare.after')}</div>
        <pre
          className="text-xs p-2 rounded whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto"
          style={{ background: 'var(--color-surface-base)', color: 'var(--color-status-success)' }}
          dangerouslySetInnerHTML={{ __html: escapeHtml(after) || t('optimizeCompare.emptyBefore') }}
        />
      </div>
    </div>
  );
}
