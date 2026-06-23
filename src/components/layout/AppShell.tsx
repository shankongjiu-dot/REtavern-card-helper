/**
 * AppShell - Main layout component with sidebar navigation and content area.
 * Features glassmorphism design with subtle background blur.
 * Mobile: collapsible sidebar with hamburger menu and overlay.
 */
import { Suspense, useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useTranslation } from '../../i18n/I18nContext';

export function AppShell() {
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  return (
    <div className="flex w-full min-h-dvh">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />

      {/* Main content */}
      <main className="flex-1 min-h-dvh overflow-auto">
        {/* Mobile header bar */}
        <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 glass-header">
          <button
            onClick={toggleSidebar}
            className="p-1.5 -ml-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label={t('sidebar.openMenu')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>{t('common.appName')}</span>
        </div>

        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="flex min-h-[320px] items-center justify-center">
      <div className="h-8 w-8 rounded-full border-2 border-slate-700 border-t-[var(--color-primary)] animate-spin" />
    </div>
  );
}
