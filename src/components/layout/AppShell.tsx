/**
 * AppShell - Main layout component with sidebar navigation and content area.
 * Features glassmorphism design with subtle background blur.
 * Mobile: collapsible sidebar with hamburger menu and overlay.
 */
import { Suspense, useState, useCallback, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useTranslation } from '../../i18n/I18nContext';
import { Skeleton, SkeletonList } from '../shared/Skeleton';

export function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 路由变化时，延迟一帧再更新侧栏收缩状态。
  // 让重的 WizardPage 先完成卸载/挂载，侧栏宽度动画在下一帧才开始，
  // 避免重页面卸载与侧栏宽度重排同时发生导致卡顿。
  useEffect(() => {
    const shouldCollapse = location.pathname.startsWith('/wizard');
    const raf = requestAnimationFrame(() => {
      setSidebarCollapsed(shouldCollapse);
    });
    return () => cancelAnimationFrame(raf);
  }, [location.pathname]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  return (
    <div className="flex w-full h-full">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ backgroundColor: 'var(--color-surface-overlay)' }}
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        onClose={closeSidebar}
        onToggleCollapsed={toggleSidebarCollapsed}
      />

      {/* Main content */}
      <main className="flex-1 h-full min-h-0 overflow-y-auto" {...(sidebarOpen ? { inert: true } : {})}>
        {/* Mobile header bar */}
        <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 glass-header">
          <button
            onClick={toggleSidebar}
            className="p-1.5 -ml-1 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--text-color)] hover:bg-[color-mix(in_srgb,var(--text-color)_5%,transparent)] transition-colors"
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

        <div className="w-full max-w-7xl mx-auto px-3 sm:px-5 lg:px-8 py-4 sm:py-7">
          <div key={location.key} className="route-transition">
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="space-y-6 py-4">
      <Skeleton variant="text" className="w-48 h-7" />
      <Skeleton variant="text" className="w-72 h-4" />
      <SkeletonList count={4} />
    </div>
  );
}
