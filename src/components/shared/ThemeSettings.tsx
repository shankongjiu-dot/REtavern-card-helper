/**
 * ThemeSettings - UI customization panel for theme options.
 * Allows adjusting opacity, colors, blur, text color, shadows, etc.
 */
import { useState, useEffect } from 'react';
import {
  getThemeSettings,
  saveThemeSettings,
  resetTheme,
  COLOR_PRESETS,
  TEXT_COLOR_PRESETS,
  TEXT_SHADOW_COLOR_PRESETS,
  INPUT_BG_PRESETS,
  INPUT_BORDER_PRESETS,
  CARD_BG_PRESETS,
  type ThemeSettings as ThemeSettingsType,
} from '../../services/theme-service';
import { getStoredBackground, applyBackground } from '../../services/background-service';
import { useTranslation } from '../../i18n/I18nContext';

export function ThemeSettings({ sidebarOpen }: { sidebarOpen?: boolean }) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [sectionAppearance, setSectionAppearance] = useState(true);
  const [sectionText, setSectionText] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const effectiveExpanded = isMobile && sidebarOpen === false ? false : isExpanded;
  const [settings, setSettings] = useState<ThemeSettingsType>(() => getThemeSettings());

  const handleUpdate = (patch: Partial<ThemeSettingsType>) => {
    const updated = saveThemeSettings(patch);
    setSettings(updated);
    if ('bgOverlayOpacity' in patch) {
      applyBackground(getStoredBackground());
    }
  };

  const handleReset = () => {
    const reset = resetTheme();
    setSettings(reset);
    applyBackground(getStoredBackground());
  };

  return (
    <div className="relative">
      {/* Toggle button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--text-color)] transition-colors"
        title={t('theme.toggleTitle')}
      >
        <span className="flex items-center gap-1.5">
          ⚙️ {t('theme.toggleTitle')}
        </span>
        <span className={`transition-transform ${effectiveExpanded ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {/* Expanded settings panel */}
      {effectiveExpanded && (
        <div className="absolute bottom-full left-0 right-0 mb-1 p-3 backdrop-blur-sm border rounded-lg shadow-lg w-64 max-h-[70vh] overflow-y-auto"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-surface-raised) 95%, transparent)', borderColor: 'var(--color-border-default)' }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium" style={{ color: 'var(--text-color)' }}>{t('theme.title')}</span>
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
          <div className="space-y-3">
            {/* Section 1: Appearance */}
            <div>
              <button
                onClick={() => setSectionAppearance(!sectionAppearance)}
                className="w-full flex items-center justify-between text-xs text-[var(--text-color)] hover:text-[var(--text-color)] transition-colors mb-2"
              >
                <span className="font-medium">🎨 {t('theme.appearanceSection')}</span>
                <span className={`text-[10px] transition-transform ${sectionAppearance ? 'rotate-180' : ''}`}>▾</span>
              </button>
              {sectionAppearance && (
                <div className="space-y-3">
                  {/* Primary Color */}
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5">{t('theme.primaryColor')}</label>
                    <div className="flex flex-wrap gap-1.5">
                      {COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          onClick={() => handleUpdate({ primaryColor: preset.value })}
                          className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                            settings.primaryColor === preset.value
                              ? 'border-[var(--color-text-inverse)] scale-110'
                              : 'border-transparent'
                          }`}
                          style={{ backgroundColor: preset.value }}
                          title={preset.name}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Background Overlay Opacity */}
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                      {t('theme.bgOverlay')}: {settings.bgOverlayOpacity}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={settings.bgOverlayOpacity}
                      onChange={(e) => handleUpdate({ bgOverlayOpacity: parseInt(e.target.value) })}
                      className="w-full"
                    />
                  </div>

                  {/* Surface Opacity */}
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                      {t('theme.cardOpacity')}: {settings.surfaceOpacity}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={settings.surfaceOpacity}
                      onChange={(e) => handleUpdate({ surfaceOpacity: parseInt(e.target.value) })}
                      className="w-full"
                    />
                  </div>

                  {/* Blur Intensity */}
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                      {t('theme.blurIntensity')}: {settings.blurIntensity}px
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="20"
                      value={settings.blurIntensity}
                      onChange={(e) => handleUpdate({ blurIntensity: parseInt(e.target.value) })}
                      className="w-full"
                    />
                  </div>

                  {/* Card Shadow */}
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                      {t('theme.cardShadow')}: {settings.cardShadow}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="20"
                      value={settings.cardShadow}
                      onChange={(e) => handleUpdate({ cardShadow: parseInt(e.target.value) })}
                      className="w-full"
                    />
                  </div>

                  {/* Card Background Color */}
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5">{t('theme.cardBgColor')}</label>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {CARD_BG_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          onClick={() => handleUpdate({ cardBgColor: preset.value })}
                          className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                            settings.cardBgColor === preset.value
                              ? 'border-[var(--color-text-inverse)] scale-110'
                              : 'border-[var(--color-border-default)]'
                          }`}
                          style={{ backgroundColor: preset.value }}
                          title={preset.name}
                        />
                      ))}
                      <input
                        type="color"
                        value={settings.cardBgColor}
                        onChange={(e) => handleUpdate({ cardBgColor: e.target.value })}
                        className="w-7 h-7 rounded-full overflow-hidden border-2 border-[var(--color-border-default)] cursor-pointer bg-transparent p-0"
                        title={t('theme.customColor')}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-t" style={{ borderColor: 'color-mix(in srgb, var(--color-border-default) 50%, transparent)' }} />

            {/* Section 2: Text & Input */}
            <div>
              <button
                onClick={() => setSectionText(!sectionText)}
                className="w-full flex items-center justify-between text-xs text-[var(--text-color)] hover:text-[var(--text-color)] transition-colors mb-2"
              >
                <span className="font-medium">✏️ {t('theme.textSection')}</span>
                <span className={`text-[10px] transition-transform ${sectionText ? 'rotate-180' : ''}`}>▾</span>
              </button>
              {sectionText && (
                <div className="space-y-3">
                  {/* Text Color */}
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5">{t('theme.textColor')}</label>
                    <div className="flex flex-wrap gap-1.5">
                      {TEXT_COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          onClick={() => handleUpdate({ textColor: preset.value })}
                          className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                            settings.textColor === preset.value
                              ? 'border-primary-tint scale-110'
                              : 'border-[var(--color-border-default)]'
                          }`}
                          style={{ backgroundColor: preset.value }}
                          title={preset.name}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Text Shadow */}
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">
                      {t('theme.textShadow')}: {settings.textShadow}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      value={settings.textShadow}
                      onChange={(e) => handleUpdate({ textShadow: parseInt(e.target.value) })}
                      className="w-full"
                    />
                  </div>

                  {/* Text Shadow Color */}
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5">{t('theme.textShadowColor')}</label>
                    <div className="flex flex-wrap gap-1.5">
                      {TEXT_SHADOW_COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          onClick={() => handleUpdate({ textShadowColor: preset.value })}
                          className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                            settings.textShadowColor === preset.value
                              ? 'border-[var(--color-text-inverse)] scale-110'
                              : 'border-[var(--color-border-default)]'
                          }`}
                          style={{ backgroundColor: preset.value }}
                          title={preset.name}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Input Background Color */}
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5">{t('theme.inputBgColor')}</label>
                    <div className="flex flex-wrap gap-1.5">
                      {INPUT_BG_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          onClick={() => handleUpdate({ inputBgColor: preset.value })}
                          className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                            settings.inputBgColor === preset.value
                              ? 'border-primary-tint scale-110'
                              : 'border-[var(--color-border-default)]'
                          }`}
                          style={{ 
                            backgroundColor: preset.value === 'transparent' ? undefined : preset.value,
                            backgroundImage: preset.value === 'transparent' 
                              ? 'linear-gradient(45deg, var(--color-text-muted) 25%, transparent 25%), linear-gradient(-45deg, var(--color-text-muted) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-text-muted) 75%), linear-gradient(-45deg, transparent 75%, var(--color-text-muted) 75%)'
                              : undefined,
                            backgroundSize: preset.value === 'transparent' ? '4px 4px' : undefined,
                            backgroundPosition: preset.value === 'transparent' ? '0 0, 0 2px, 2px -2px, -2px 0px' : undefined,
                          }}
                          title={preset.name}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Input Border Color */}
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1.5">{t('theme.inputBorderColor')}</label>
                    <div className="flex flex-wrap gap-1.5">
                      {INPUT_BORDER_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          onClick={() => handleUpdate({ inputBorderColor: preset.value })}
                          className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                            settings.inputBorderColor === preset.value
                              ? 'border-[var(--color-text-inverse)] scale-110'
                              : 'border-[var(--color-border-default)]'
                          }`}
                          style={{ backgroundColor: preset.value === 'auto' ? 'linear-gradient(135deg, var(--color-primary), var(--color-accent))' : preset.value }}
                          title={preset.name}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Reset button */}
            <button
              onClick={handleReset}
              className="w-full px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--text-color)] bg-[color-mix(in_srgb,var(--color-surface-elevated)_50%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-surface-elevated)_70%,transparent)] rounded transition-colors"
            >
              🔄 {t('theme.reset')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
