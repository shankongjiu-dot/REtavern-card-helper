/**
 * OrganizePreviewTable - Preview table showing AI organize suggestions.
 * Displays parameter changes with strikethrough for old values and
 * green highlighting for suggested values.
 * Extracted from StepWorldBook for better component granularity.
 */
import { Button } from '../shared/Button';
import { useTranslation } from '../../i18n/I18nContext';
import { themeAlpha } from '../../constants/theme';
import type { LorebookEntry, AIOrganizeSuggestion } from '../../constants/defaults';

interface OrganizePreviewTableProps {
  entries: LorebookEntry[];
  suggestions: AIOrganizeSuggestion[];
  onApply: () => void;
  onDismiss: () => void;
}

const PARAM_FIELDS = ['position', 'insertion_order', 'depth', 'probability', 'constant'] as const;
type ParamField = typeof PARAM_FIELDS[number];
const PARAM_LABELS: Record<ParamField, string> = {
  position: '位置',
  insertion_order: '顺序',
  depth: '深度',
  probability: '概率',
  constant: '常驻',
};

export function OrganizePreviewTable({
  entries,
  suggestions,
  onApply,
  onDismiss,
}: OrganizePreviewTableProps) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 rounded-lg border" style={{ borderColor: themeAlpha('warning', 40), backgroundColor: 'color-mix(in srgb, var(--color-surface-base) 80%, transparent)' }}>
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b" style={{ backgroundColor: themeAlpha('warning', 20), borderColor: themeAlpha('warning', 30) }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--color-status-warning)' }}>
          {t('worldBook.organizeSuggestionsTitle', { count: String(suggestions.length) })}
        </span>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" onClick={onApply}>{t('common.applyAll')}</Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>{t('common.cancel')}</Button>
        </div>
      </div>

      {/* Phones (<640px): stacked cards, no horizontal scrolling. */}
      <div className="space-y-2 p-3 sm:hidden">
        {suggestions.map((r, i) => {
          const entry = entries[r.index];
          if (!entry) return null;
          const fields = PARAM_FIELDS.filter((f) => r[f] !== undefined && (entry as unknown as Record<string, unknown>)[f] !== r[f]);
          return (
            <div key={i} className="rounded-lg border p-3" style={{ borderColor: 'color-mix(in srgb, var(--color-surface-base) 50%, transparent)' }}>
              <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-color)' }}>
                {entry.name || t('lorebook.entryFallback', { index: String(r.index + 1) })}
              </div>
              <div className="mt-2 space-y-1">
                {fields.map((f) => (
                  <div key={f} className="flex flex-wrap items-center gap-2 text-xs">
                    <span style={{ color: 'var(--color-text-secondary)' }}>{PARAM_LABELS[f]}</span>
                    <span className="font-mono line-through" style={{ color: 'var(--color-text-muted)' }}>{String((entry as unknown as Record<string, unknown>)[f])}</span>
                    <span aria-hidden>→</span>
                    <span className="font-mono font-semibold" style={{ color: 'var(--color-status-success)' }}>{String(r[f])}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>理由：{r.reason || t('worldBook.noReason')}</div>
            </div>
          );
        })}
      </div>

      {/* Tablets / desktop: scrollable table. */}
      <div className="hidden max-h-[240px] overflow-y-auto overflow-x-auto sm:block">
        <table className="w-full text-xs min-w-[600px]">
          <thead>
            <tr className="border-b" style={{ color: 'var(--color-text-secondary)', borderColor: 'color-mix(in srgb, var(--color-border-default) 50%, transparent)' }}>
              <th className="text-left px-3 py-2 whitespace-nowrap">{t('worldBook.tableEntry')}</th>
              <th className="text-left px-3 py-2 whitespace-nowrap">{t('worldBook.tableParam')}</th>
              <th className="text-left px-3 py-2 whitespace-nowrap">{t('worldBook.tableCurrent')}</th>
              <th className="text-left px-3 py-2 whitespace-nowrap">{t('worldBook.tableSuggested')}</th>
              <th className="text-left px-3 py-2 whitespace-nowrap">{t('worldBook.tableReason')}</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((r, i) => {
              const entry = entries[r.index];
              if (!entry) return null;
              return (
                <tr key={i} className="border-b hover:bg-[var(--color-warning-bg)]" style={{ borderColor: 'color-mix(in srgb, var(--color-surface-base) 50%, transparent)' }}>
                  <td className="px-3 py-1.5 font-medium truncate max-w-[100px]" style={{ color: 'var(--text-color)' }}>
                    {entry.name || t('lorebook.entryFallback', { index: String(r.index + 1) })}
                  </td>
                  <td className="px-3 py-1.5 font-mono" style={{ color: 'var(--color-text-secondary)' }}>
                    {r.position !== undefined && entry.position !== r.position && <div>position</div>}
                    {r.insertion_order !== undefined && entry.insertion_order !== r.insertion_order && <div>order</div>}
                    {r.depth !== undefined && entry.depth !== r.depth && <div>depth</div>}
                    {r.probability !== undefined && entry.probability !== r.probability && <div>prob</div>}
                    {r.constant !== undefined && entry.constant !== r.constant && <div>constant</div>}
                  </td>
                  <td className="px-3 py-1.5 font-mono line-through" style={{ color: 'var(--color-text-muted)' }}>
                    {r.position !== undefined && entry.position !== r.position && <div>{entry.position}</div>}
                    {r.insertion_order !== undefined && entry.insertion_order !== r.insertion_order && <div>{entry.insertion_order}</div>}
                    {r.depth !== undefined && entry.depth !== r.depth && <div>{entry.depth}</div>}
                    {r.probability !== undefined && entry.probability !== r.probability && <div>{entry.probability}</div>}
                    {r.constant !== undefined && entry.constant !== r.constant && <div>{String(entry.constant)}</div>}
                  </td>
                  <td className="px-3 py-1.5 font-mono font-semibold" style={{ color: 'var(--color-status-success)' }}>
                    {r.position !== undefined && entry.position !== r.position && <div>{r.position}</div>}
                    {r.insertion_order !== undefined && entry.insertion_order !== r.insertion_order && <div>{r.insertion_order}</div>}
                    {r.depth !== undefined && entry.depth !== r.depth && <div>{r.depth}</div>}
                    {r.probability !== undefined && entry.probability !== r.probability && <div>{r.probability}</div>}
                    {r.constant !== undefined && entry.constant !== r.constant && <div>{String(r.constant)}</div>}
                  </td>
                  <td className="px-3 py-1.5 max-w-[150px] truncate" style={{ color: 'var(--color-text-muted)' }}>
                    {r.reason || t('worldBook.noReason')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}