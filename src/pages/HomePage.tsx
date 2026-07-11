/**
 * HomePage - Landing page with quick-action cards.
 */
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wand2, BookOpen, MessageCircle, PenTool, Bot } from 'lucide-react';
import { useTranslation } from '../i18n/I18nContext';
import { themeAlpha } from '../constants/theme';

export function HomePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const actions = [
    {
      icon: Wand2,
      title: t('home.actionCreateTitle'),
      description: t('home.actionCreateDesc'),
      action: () => navigate('/wizard'),
      token: 'primary' as const,
    },
    {
      icon: BookOpen,
      title: t('home.actionLibraryTitle'),
      description: t('home.actionLibraryDesc'),
      action: () => navigate('/library'),
      token: 'info' as const,
    },
    {
      icon: MessageCircle,
      title: t('home.actionChatTitle'),
      description: t('home.actionChatDesc'),
      action: () => navigate('/chat'),
      token: 'success' as const,
    },
    {
      icon: Bot,
      title: t('home.actionCardEditorChatTitle'),
      description: t('home.actionCardEditorChatDesc'),
      action: () => navigate('/card-editor-chat'),
      token: 'warning' as const,
    },
    {
      icon: PenTool,
      title: t('home.actionDialogueTitle'),
      description: t('home.actionDialogueDesc'),
      action: () => navigate('/dialogue'),
      token: 'danger' as const,
    },
  ];

  return (
    <div className="animate-fade-in">
      <div className="mb-6 sm:mb-10">
        <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: 'var(--text-color)' }}>
          {t('home.title')}
        </h1>
        <p className="mt-2 text-base sm:text-lg" style={{ color: 'color-mix(in srgb, var(--text-color) 60%, transparent)' }}>
          {t('home.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-5">
        {actions.map((item) => (
          <button
            key={item.title}
            onClick={item.action}
            className="group text-left rounded-2xl border p-4 sm:p-6
              hover:-translate-y-0.5
              transition-all duration-300 ease-out cursor-pointer
              shadow-lg hover:shadow-xl hover:shadow-[0_4px_14px_var(--glow-color)]"
            style={{
              borderColor: 'var(--color-border-subtle)',
              backgroundColor: 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.4)',
              '--glow-color': themeAlpha(item.token, 25),
            } as CSSProperties}
          >
            <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl
              ${item.token === 'primary' ? 'bg-gradient-primary' : `bg-gradient-${item.token}`} text-inverse mb-5
              shadow-[0_4px_10px_color-mix(in_srgb,var(--color-surface-base)_40%,transparent)] group-hover:scale-105 transition-transform duration-300`}>
              <item.icon size={22} strokeWidth={1.8} />
            </div>
            <h3 className="text-base font-semibold transition-colors duration-200 group-hover:text-primary-bright" style={{ color: 'var(--text-color)' }}>
              {item.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'color-mix(in srgb, var(--text-color) 60%, transparent)' }}>
              {item.description}
            </p>
          </button>
        ))}
      </div>

      {/* Quick info section */}
      <div
        className="mt-10 rounded-2xl border p-6"
        style={{
          borderColor: 'var(--color-border-subtle)',
          backgroundColor: 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.2)',
        }}
      >
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-color)' }}>
          {t('home.quickStartTitle')}
        </h2>
        <ol className="space-y-3 text-sm" style={{ color: 'color-mix(in srgb, var(--text-color) 60%, transparent)' }}>
          {t('home.quickStartSteps').split('|').map((text, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-tint-light text-primary-muted text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span className="leading-relaxed">{text}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
