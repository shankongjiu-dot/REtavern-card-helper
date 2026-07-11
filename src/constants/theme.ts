/**
 * Semantic theme tokens for inline status colors in TSX.
 * Use these instead of hard-coded hex values so theme switches apply consistently.
 */

export const THEME_TOKENS = {
  danger: 'var(--color-status-danger)',
  warning: 'var(--color-status-warning)',
  success: 'var(--color-status-success)',
  info: 'var(--color-info)',
  purple: 'var(--color-purple)',
} as const;

export type StatusColor = keyof typeof THEME_TOKENS;

/**
 * Build a translucent color from a theme token.
 * Useful for backgrounds, borders, and glows in inline styles.
 */
export function themeAlpha(token: StatusColor | 'primary', percent: number): string {
  const map: Record<StatusColor | 'primary', string> = {
    primary: 'var(--color-primary)',
    danger: THEME_TOKENS.danger,
    warning: THEME_TOKENS.warning,
    success: THEME_TOKENS.success,
    info: THEME_TOKENS.info,
    purple: THEME_TOKENS.purple,
  };
  return `color-mix(in srgb, ${map[token]} ${percent}%, transparent)`;
}
