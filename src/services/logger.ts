/**
 * Dev-only logger.
 *
 * `log` / `info` / `warn` / `debug` calls are no-ops in production builds
 * (guarded by `import.meta.env.DEV`, which Vite statically replaces).
 * `error` is always emitted — production error tracking relies on it.
 */
export const logger = {
  log(...args: unknown[]): void {
    if (import.meta.env.DEV) console.log(...args);
  },
  info(...args: unknown[]): void {
    if (import.meta.env.DEV) console.info(...args);
  },
  warn(...args: unknown[]): void {
    if (import.meta.env.DEV) console.warn(...args);
  },
  debug(...args: unknown[]): void {
    if (import.meta.env.DEV) console.debug(...args);
  },
  /** Always emitted, even in production. Use for genuine errors. */
  error(...args: unknown[]): void {
    console.error(...args);
  },
};
