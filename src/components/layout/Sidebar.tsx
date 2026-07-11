/**
 * Sidebar navigation component with SVG icons and polished interactions.
 * Mobile: slides in from left with overlay, closes on navigation.
 * Includes focus trap and Escape key support for mobile accessibility.
 */
import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Settings, Wand2, BookOpen, MessageCircle, PenTool, X, ScrollText, FileSearch, Bot, ChevronLeft, ChevronRight, FileText, BookMarked } from 'lucide-react';
import { BackgroundChanger } from '../shared/BackgroundChanger';
import { ThemeSettings } from '../shared/ThemeSettings';
import { ThemeSkinPicker } from '../shared/ThemeSkinPicker';
import { useTranslation } from '../../i18n/I18nContext';

interface SidebarProps {
  isOpen: boolean;
  isCollapsed: boolean;
  onClose: () => void;
  onToggleCollapsed: () => void;
}

const navItems = (t: (key: string) => string) => [
  { to: '/', label: t('sidebar.home'), icon: Home, end: true },
  { to: '/preset', label: t('sidebar.presets'), icon: ScrollText },
  { to: '/wizard', label: t('sidebar.wizard'), icon: Wand2 },
  { to: '/drafts', label: t('sidebar.drafts'), icon: FileText },
  { to: '/library', label: t('sidebar.library'), icon: BookOpen },
  { to: '/chat', label: t('sidebar.chat'), icon: MessageCircle },
  { to: '/card-editor-chat', label: t('sidebar.cardEditorChat'), icon: Bot },
  { to: '/dialogue', label: t('sidebar.dialogueCreator'), icon: PenTool },
  { to: '/novel-analysis', label: t('sidebar.novelAnalysis'), icon: FileSearch },
  { to: '/novel-workshop', label: t('sidebar.novelWorkshop'), icon: BookMarked },
  { to: '/settings', label: t('sidebar.settings'), icon: Settings },
];

export function Sidebar({ isOpen, isCollapsed, onClose, onToggleCollapsed }: SidebarProps) {
  const { t } = useTranslation();
  const borderColor = 'color-mix(in srgb, var(--text-color) 5%, transparent)';
  const faintText = 'color-mix(in srgb, var(--text-color) 40%, transparent)';
  const sidebarRef = useRef<HTMLElement>(null);

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Focus trap: keep Tab within sidebar when open on mobile
  useEffect(() => {
    if (!isOpen || !sidebarRef.current) return;
    const sidebar = sidebarRef.current;
    const focusable = sidebar.querySelectorAll<HTMLElement>(
      'a, button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    focusable[0].focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [isOpen]);

  return (
    <aside
      ref={sidebarRef}
      role="dialog"
      aria-modal={isOpen}
      aria-label={t('common.appName')}
      className={`
        h-full sticky top-0 glass-sidebar flex flex-col shrink-0 z-50 transition-[width] duration-300 ease-out
        ${isCollapsed ? 'md:w-20' : 'md:w-60'} w-60
        max-md:fixed max-md:inset-y-0 max-md:left-0
        max-md:transition-transform max-md:duration-300 max-md:ease-in-out
        ${isOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}
        md:translate-x-0 md:sticky
      `}
    >
      {/* App title + close button (mobile) */}
      <div className={`${isCollapsed ? 'md:px-3 md:justify-center' : 'md:px-5'} px-5 py-6 flex items-center justify-between`} style={{ borderBottom: `1px solid ${borderColor}` }}>
        <div className={`md:transition-opacity md:duration-200 overflow-hidden min-w-0 ${isCollapsed ? 'md:hidden' : 'md:opacity-100'}`}>
          <h1
            className="text-lg font-bold tracking-wide whitespace-nowrap truncate"
            style={{ color: 'var(--color-primary)' }}
          >
            {t('common.appName')}
          </h1>
        </div>
        <button
          onClick={onToggleCollapsed}
          className="hidden md:flex p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--text-color)] hover:bg-[color-mix(in_srgb,var(--text-color)_5%,transparent)] transition-colors"
          aria-label={isCollapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
          title={isCollapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
        <button
          onClick={onClose}
          className="md:hidden p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--text-color)] hover:bg-[color-mix(in_srgb,var(--text-color)_5%,transparent)] transition-colors"
          aria-label={t('common.close')}
        >
          <X size={20} />
        </button>
      </div>

      {/* Navigation links */}
      <nav className={`${isCollapsed ? 'md:px-2' : 'md:px-3'} flex-1 px-3 py-4 space-y-0.5 overflow-y-auto`}>
        {navItems(t).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onClose}
            title={isCollapsed ? item.label : undefined}
            className={({ isActive }) =>
              `flex items-center rounded-lg py-2.5 text-sm font-medium transition-colors duration-200
              ${isCollapsed ? 'md:justify-center md:px-0 gap-3 px-3' : 'gap-3 px-3'}
              ${isActive
                ? 'text-themed'
                : 'hover:bg-[color-mix(in_srgb,var(--text-color)_5%,transparent)] hover:text-[var(--text-color)]'
              }`
            }
            style={({ isActive }) => isActive ? {
              backgroundColor: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
              color: 'var(--color-primary)',
              textShadow: 'var(--text-shadow)',
            } : { color: 'var(--color-text-muted)' }}
          >
            <item.icon size={18} strokeWidth={1.8} className="shrink-0" />
            <span className={`md:transition-opacity md:duration-200 md:whitespace-nowrap ${isCollapsed ? 'md:opacity-0 md:w-0 md:overflow-hidden' : 'md:opacity-100 md:w-auto'}`}>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-2 space-y-1" style={{ borderTop: `1px solid ${borderColor}` }}>
        <div className={isCollapsed ? 'md:hidden' : ''}>
          <BackgroundChanger sidebarOpen={isOpen} />
          <ThemeSkinPicker sidebarOpen={isOpen} />
          <ThemeSettings sidebarOpen={isOpen} />
          <p className="text-[10px] px-2 pt-2 pb-1" style={{ color: faintText }}>
            {t('common.appName')} v1.0
          </p>
        </div>
        <div className={isCollapsed ? 'hidden md:block' : 'hidden'}>
          <ThemeSkinPicker sidebarOpen={isOpen} compact />
        </div>
      </div>
    </aside>
  );
}
