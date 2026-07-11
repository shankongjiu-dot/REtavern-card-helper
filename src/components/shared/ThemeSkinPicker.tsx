/**
 * ThemeSkinPicker - standalone preset theme selector.
 */
import { useState, useEffect } from 'react';
import { THEME_PRESETS, saveThemeSettings } from '../../services/theme-service';
import { setBackground } from '../../services/background-service';
import { useTranslation } from '../../i18n/I18nContext';

export function ThemeSkinPicker({ sidebarOpen, compact = false }: { sidebarOpen?: boolean; compact?: boolean }) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const effectiveExpanded = isMobile && sidebarOpen === false ? false : isExpanded;

  const handleApplyPreset = (preset: typeof THEME_PRESETS[number]) => {
    saveThemeSettings(preset.settings);
    setBackground(preset.background);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={compact
          ? 'w-full h-10 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--text-color)] hover:bg-[color-mix(in_srgb,var(--text-color)_5%,transparent)] transition-colors'
          : 'w-full flex items-center justify-between px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--text-color)] transition-colors'}
        title={t('themeSkin.toggleTitle')}
        aria-label={t('themeSkin.toggleTitle')}
      >
        {compact ? (
          <span className="text-base leading-none">🧩</span>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              🧩 {t('themeSkin.toggleTitle')}
            </span>
            <span className={`transition-transform ${effectiveExpanded ? 'rotate-180' : ''}`}>
              ▾
            </span>
          </>
        )}
      </button>

      {effectiveExpanded && (
        <div className={`absolute p-3 backdrop-blur-sm border rounded-lg shadow-lg w-64 max-h-[70vh] overflow-y-auto ${compact ? 'bottom-0 left-full ml-2' : 'bottom-full left-0 right-0 mb-1'}`}
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-surface-raised) 95%, transparent)', borderColor: 'var(--color-border-default)' }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium" style={{ color: 'var(--text-color)' }}>{t('themeSkin.title')}</span>
            <button
              onClick={() => setIsExpanded(false)}
              className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--text-color)] hover:bg-[color-mix(in_srgb,var(--text-color)_8%,transparent)] transition-colors"
              title={t('theme.close')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {THEME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleApplyPreset(preset)}
                className="group relative rounded-lg overflow-hidden border border-[var(--color-border-default)] hover:border-[var(--color-text-secondary)] transition-all hover:scale-[1.02] active:scale-[0.98]"
                title={preset.name}
              >
                <img
                  src={preset.background}
                  alt={preset.name}
                  className="w-full h-20 object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                <div
                  className="absolute bottom-1.5 left-1.5 right-1.5 text-[10px] font-medium truncate text-center"
                  style={{ color: 'var(--text-color)', textShadow: '0 1px 2px color-mix(in srgb, black 80%, transparent)' }}
                >
                  {preset.name}
                </div>
                <div className="absolute top-1.5 right-1.5 flex gap-0.5">
                  <span className="w-2.5 h-2.5 rounded-full border border-[color-mix(in_srgb,var(--color-text-inverse)_30%,transparent)]" style={{ backgroundColor: preset.settings.primaryColor }} />
                  <span className="w-2.5 h-2.5 rounded-full border border-[color-mix(in_srgb,var(--color-text-inverse)_30%,transparent)]" style={{ backgroundColor: preset.settings.cardBgColor }} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
