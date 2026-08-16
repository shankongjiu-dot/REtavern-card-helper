/**
 * AppShell - Main layout component with sidebar navigation and content area.
 * Features glassmorphism design with subtle background blur.
 * Mobile: collapsible sidebar with hamburger menu, overlay, and swipe gestures.
 */
import { Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useTranslation } from '../../i18n/I18nContext';
import { Skeleton, SkeletonList } from '../shared/Skeleton';

export function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

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

  // 创建/编辑卡片（/wizard、/wizard/:id）时隐藏移动端顶部横栏，腾出纵向创作空间；
  // 离开向导页自动恢复。向导页仍可从屏幕左缘右滑唤出侧栏，不影响导航。
  const isWizardRoute = location.pathname.startsWith('/wizard');

  // Swipe gestures: left-edge swipe to open, left swipe on overlay to close
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    // Only trigger if horizontal swipe is dominant
    if (Math.abs(deltaX) < 60 || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;

    if (deltaX > 0 && touchStartX.current < 30) {
      // Swipe right from left edge → open sidebar
      setSidebarOpen(true);
    } else if (deltaX < 0 && sidebarOpen) {
      // Swipe left while sidebar open → close
      setSidebarOpen(false);
    }
  }, [sidebarOpen]);

  return (
    <div className="flex w-full h-full" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden animate-fade-in"
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
      <main className="flex-1 h-full min-h-0 overflow-hidden flex flex-col" {...(sidebarOpen ? { inert: true } : {})}>
        {/* Mobile header bar — 向导页隐藏以腾出纵向空间 */}
        {!isWizardRoute && (
          <div className="md:hidden shrink-0 z-30 flex items-center gap-3 px-4 py-3 glass-header">
            <button
              onClick={toggleSidebar}
              className="p-1.5 -ml-1 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--text-color)] hover:bg-[color-mix(in_srgb,var(--color-text-color)_5%,transparent)] transition-colors"
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
        )}

        <div className="w-full px-3 sm:px-5 lg:px-8 py-4 sm:py-7 flex-1 min-h-0 flex flex-col overflow-y-auto">
          <div key={location.pathname} className="route-transition flex-1 flex flex-col min-h-0">
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
