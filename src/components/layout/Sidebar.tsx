/**
 * Sidebar navigation component with SVG icons and polished interactions.
 * Mobile: slides in from left with overlay, closes on navigation.
 */
import { NavLink } from 'react-router-dom';
import { Home, Settings, Wand2, BookOpen, MessageCircle, PenTool, X, ScrollText, FileSearch } from 'lucide-react';
import { BackgroundChanger } from '../shared/BackgroundChanger';
import { ThemeSettings } from '../shared/ThemeSettings';
import { useTranslation } from '../../i18n/I18nContext';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const navItems = (t: (key: string) => string) => [
  { to: '/', label: t('sidebar.home'), icon: Home, end: true },
  { to: '/preset', label: t('sidebar.presets'), icon: ScrollText },
  { to: '/wizard', label: t('sidebar.wizard'), icon: Wand2 },
  { to: '/library', label: t('sidebar.library'), icon: BookOpen },
  { to: '/chat', label: t('sidebar.chat'), icon: MessageCircle },
  { to: '/dialogue', label: t('sidebar.dialogueCreator'), icon: PenTool },
  { to: '/novel-analysis', label: t('sidebar.novelAnalysis'), icon: FileSearch },
  { to: '/settings', label: t('sidebar.settings'), icon: Settings },
];

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { t } = useTranslation();
  return (
    <aside
      className={`
        w-60 h-dvh sticky top-0 glass-sidebar flex flex-col shrink-0 z-50
        /* Mobile: fixed overlay sidebar */
        max-md:fixed max-md:inset-y-0 max-md:left-0
        max-md:transition-transform max-md:duration-300 max-md:ease-in-out
        ${isOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}
        /* Desktop: always visible */
        md:translate-x-0 md:sticky
      `}
    >
      {/* App title + close button (mobile) */}
      <div className="px-5 py-6 border-b border-white/5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-themed tracking-wide" style={{ color: 'var(--color-primary)' }}>
            {t('common.appName')}
          </h1>
          <p className="text-xs text-slate-500 mt-1">{t('home.subtitle')}</p>
        </div>
        {/* Mobile close button */}
        <button
          onClick={onClose}
          className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          aria-label={t('common.close')}
        >
          <X size={20} />
        </button>
      </div>

      {/* Navigation links */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems(t).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200
              ${isActive
                ? 'text-themed'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`
            }
            style={({ isActive }) => isActive ? {
              backgroundColor: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
              color: 'var(--color-primary)',
              textShadow: 'var(--text-shadow)'
            } : undefined}
          >
            <item.icon size={18} strokeWidth={1.8} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-white/5 space-y-1">
        <BackgroundChanger sidebarOpen={isOpen} />
        <ThemeSettings sidebarOpen={isOpen} />
        <p className="text-[10px] text-slate-600 px-2 pt-2 pb-1">{t('common.appName')} v1.0</p>
      </div>
    </aside>
  );
}
