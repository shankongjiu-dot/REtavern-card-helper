/**
 * Theme Service - manages UI theme customization.
 * Stores settings in localStorage and applies them via CSS custom properties.
 */

const STORAGE_KEY = 'tavern-ui-theme';

export interface ThemeSettings {
  /** Background overlay opacity (0-100) */
  bgOverlayOpacity: number;
  /** Primary accent color (hex) */
  primaryColor: string;
  /** Surface/card background opacity (0-100) */
  surfaceOpacity: number;
  /** Blur intensity (0-20px) */
  blurIntensity: number;
  /** Text color (hex) */
  textColor: string;
  /** Text shadow intensity (0-10) */
  textShadow: number;
  /** Text shadow color (hex) */
  textShadowColor: string;
  /** Card shadow intensity (0-20) */
  cardShadow: number;
  /** Input field background color (hex) */
  inputBgColor: string;
  /** Input field border color (hex) */
  inputBorderColor: string;
  /** Card/content surface background color (hex) */
  cardBgColor: string;
}

export const DEFAULT_THEME: ThemeSettings = {
  bgOverlayOpacity: 23,
  primaryColor: '#10b981', // emerald-500
  surfaceOpacity: 27,
  blurIntensity: 3,
  textColor: '#f1f5f9', // slate-100
  textShadow: 0,
  textShadowColor: '#000000', // black
  cardShadow: 4,
  inputBgColor: '#0f172a', // slate-900
  inputBorderColor: '#475569', // slate-600
  cardBgColor: '#1e293b', // slate-800
};

/**
 * Predefined accent color presets
 */
export const COLOR_PRESETS = [
  { name: '靛蓝', value: '#6366f1' },
  { name: '紫罗兰', value: '#8b5cf6' },
  { name: '玫红', value: '#ec4899' },
  { name: '翠绿', value: '#10b981' },
  { name: '琥珀', value: '#f59e0b' },
  { name: '天蓝', value: '#06b6d4' },
  { name: '珊瑚', value: '#f97316' },
  { name: '石板', value: '#64748b' },
];

/**
 * Text color presets — designed to be visually distinct on dark backgrounds
 */
export const TEXT_COLOR_PRESETS = [
  { name: '银白', value: '#e2e8f0' },
  { name: '纯白', value: '#ffffff' },
  { name: '暖金', value: '#fde68a' },
  { name: '天蓝', value: '#7dd3fc' },
  { name: '紫罗兰', value: '#c4b5fd' },
  { name: '薄荷', value: '#6ee7b7' },
  { name: '珊瑚粉', value: '#fda4af' },
  { name: '琥珀', value: '#fcd34d' },
];

/**
 * Text shadow color presets
 */
export const TEXT_SHADOW_COLOR_PRESETS = [
  { name: '黑色', value: '#000000' },
  { name: '深灰', value: '#1e293b' },
  { name: '靛蓝', value: '#312e81' },
  { name: '紫罗兰', value: '#4c1d95' },
  { name: '深红', value: '#7f1d1d' },
  { name: '深绿', value: '#14532d' },
];

/**
 * Input background color presets - diverse color options
 */
export const INPUT_BG_PRESETS = [
  { name: '深黑', value: '#0f172a' },
  { name: '深灰', value: '#1e293b' },
  { name: '石板', value: '#475569' },
  { name: '纯白', value: '#ffffff' },
  { name: '米白', value: '#fef3c7' },
  { name: '天蓝', value: '#dbeafe' },
  { name: '青色', value: '#cffafe' },
  { name: '薄荷', value: '#d1fae5' },
  { name: '透明', value: 'transparent' },
];

/**
 * Input border color presets
 */
export const INPUT_BORDER_PRESETS = [
  { name: '跟随主题', value: 'auto' },
  { name: '石板灰', value: '#475569' },
  { name: '深灰', value: '#334155' },
  { name: '靛蓝', value: '#6366f1' },
  { name: '紫罗兰', value: '#8b5cf6' },
  { name: '翠绿', value: '#10b981' },
  { name: '天蓝', value: '#0ea5e9' },
  { name: '琥珀', value: '#f59e0b' },
];

/**
 * Card/content surface background color presets
 */
export const CARD_BG_PRESETS = [
  { name: '石板灰', value: '#1e293b' },
  { name: '深夜蓝', value: '#0f172a' },
  { name: '墨蓝', value: '#172554' },
  { name: '深紫', value: '#2e1065' },
  { name: '深绿', value: '#064e3b' },
  { name: '深红', value: '#4c0519' },
  { name: '暖棕', value: '#451a03' },
  { name: '纯黑', value: '#000000' },
];

/**
 * Get current theme settings from localStorage.
 */
export function getThemeSettings(): ThemeSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_THEME, ...JSON.parse(stored) };
    }
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULT_THEME };
}

/**
 * Save theme settings to localStorage and apply them.
 */
export function saveThemeSettings(settings: Partial<ThemeSettings>): ThemeSettings {
  const current = getThemeSettings();
  const updated = { ...current, ...settings };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  applyTheme(updated);
  return updated;
}

/**
 * Reset theme to defaults.
 */
export function resetTheme(): ThemeSettings {
  localStorage.removeItem(STORAGE_KEY);
  applyTheme(DEFAULT_THEME);
  return { ...DEFAULT_THEME };
}

/**
 * Convert hex color to RGB components.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * Convert hex color to rgba with alpha.
 */
function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Apply theme settings to the document.
 */
export function applyTheme(settings: ThemeSettings): void {
  const root = document.documentElement;

  // Apply primary color
  root.style.setProperty('--color-primary', settings.primaryColor);

  // Apply surface opacity
  const surfaceOpacity = settings.surfaceOpacity / 100;
  root.style.setProperty('--surface-opacity', surfaceOpacity.toString());

  // Apply blur intensity
  root.style.setProperty('--blur-intensity', `${settings.blurIntensity}px`);

  // Apply background overlay opacity
  const overlayOpacity = settings.bgOverlayOpacity / 100;
  root.style.setProperty('--bg-overlay-opacity', overlayOpacity.toString());

  // Apply text color
  root.style.setProperty('--color-text', settings.textColor);
  root.style.setProperty('--text-color', settings.textColor);

  // Apply text shadow
  if (settings.textShadow > 0) {
    root.style.setProperty('--text-shadow', `0 1px ${settings.textShadow}px ${settings.textShadowColor}`);
  } else {
    root.style.setProperty('--text-shadow', 'none');
  }

  // Apply card shadow
  if (settings.cardShadow > 0) {
    const shadowColor = hexToRgba(settings.primaryColor, 0.15);
    root.style.setProperty('--card-shadow', `0 4px ${settings.cardShadow * 2}px rgba(0,0,0,0.3), 0 0 ${settings.cardShadow}px ${shadowColor}`);
  } else {
    root.style.setProperty('--card-shadow', 'none');
  }

  // Apply input background color
  root.style.setProperty('--input-bg', settings.inputBgColor);

  // Apply input border color (auto = use primary color)
  if (settings.inputBorderColor === 'auto') {
    root.style.setProperty('--input-border', settings.primaryColor);
  } else {
    root.style.setProperty('--input-border', settings.inputBorderColor);
  }

  // Apply card background color as RGB channels so opacity can be layered
  const { r, g, b } = hexToRgb(settings.cardBgColor);
  root.style.setProperty('--card-bg-r', r.toString());
  root.style.setProperty('--card-bg-g', g.toString());
  root.style.setProperty('--card-bg-b', b.toString());
}

/**
 * Initialize theme on app load.
 */
export function initTheme(): void {
  const settings = getThemeSettings();
  applyTheme(settings);
}
