import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { I18nProvider } from './i18n/I18nContext';
import { logger } from './services/logger';

// ── One-shot Service Worker cache cleanup ────────────────────────────────
// Fixes "Failed to fetch dynamically imported module" caused by stale SW
// caches referencing old build chunk hashes. Runs once per session, then
// reloads so the new SW + fresh chunks take over.
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const SW_CLEANUP_KEY = '__sw_cleanup_done__';
  if (!sessionStorage.getItem(SW_CLEANUP_KEY)) {
    sessionStorage.setItem(SW_CLEANUP_KEY, '1');
    (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        // Only reload if we actually cleaned something up
        if (regs.length > 0) {
          window.location.reload();
          return;
        }
      } catch {
        // swallow — don't block app boot
      }
    })();
  }
}

// Global handler for uncaught DOM reconciliation errors.
// These errors (removeChild, insertBefore) are typically caused by
// browser extensions modifying the DOM (Google Translate, autofill, etc.)
// and cannot be prevented at the code level. Auto-reload resolves them.
window.addEventListener('error', (event) => {
  const msg = event.error?.message || event.message || '';
  if (
    msg.includes('removeChild') ||
    msg.includes('insertBefore') ||
    msg.includes('not a child of this node')
  ) {
    logger.warn('[GlobalErrorHandler] DOM reconciliation error detected, auto-reloading in 500ms');
    event.preventDefault(); // prevent default error handling
    setTimeout(() => window.location.reload(), 500);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>
);