/**
 * Sidebar navigation component with SVG icons and polished interactions.
 * Mobile: slides in from left with overlay, closes on navigation.
 */
import { NavLink } from 'react-router-dom';
import { Home, Settings, Wand2, BookOpen, MessageCircle, PenTool, X, ScrollText } from 'lucide-react';
import { BackgroundChanger } from '../shared/BackgroundChanger';
import { ThemeSettings } from '../shared/ThemeSettings';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const navItems = [
  { to: '/', label: '首页', icon: Home, end: true },
  { to: '/preset', label: '写卡预设', icon: ScrollText },
  { to: '/wizard', label: '创建卡片', icon: Wand2 },
  { to: '/library', label: '卡片库', icon: BookOpen },
  { to: '/chat', label: '测试对话', icon: MessageCircle },
  { to: '/dialogue', label: 'AI 创作助手', icon: PenTool },
  { to: '/settings', label: 'API 设置', icon: Settings },
];

export function Sidebar({ isOpen, onClose }: SidebarProps) {
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
            吟游手册
          </h1>
          <p className="text-xs text-slate-500 mt-1">AI 角色卡辅助工具</p>
        </div>
        {/* Mobile close button */}
        <button
          onClick={onClose}
          className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          aria-label="关闭菜单"
        >
          <X size={20} />
        </button>
      </div>

      {/* Navigation links */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => (
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
        <p className="text-[10px] text-slate-600 px-2 pt-2 pb-1">吟游手册 v1.0</p>
      </div>
    </aside>
  );
}
