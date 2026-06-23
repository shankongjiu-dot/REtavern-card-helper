import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { I18nProvider } from './i18n/I18nContext';

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
    console.warn('[GlobalErrorHandler] DOM reconciliation error detected, auto-reloading in 500ms');
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