/**
 * HomePage - Landing page with quick-action cards.
 */
import { useNavigate } from 'react-router-dom';
import { Wand2, BookOpen, MessageCircle, PenTool } from 'lucide-react';
import { useTranslation } from '../i18n/I18nContext';

export function HomePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const actions = [
    {
      icon: Wand2,
      title: t('home.actionCreateTitle'),
      description: t('home.actionCreateDesc'),
      action: () => navigate('/wizard'),
      gradient: 'from-indigo-500 to-purple-500',
      glow: 'group-hover:shadow-indigo-500/20',
    },
    {
      icon: BookOpen,
      title: t('home.actionLibraryTitle'),
      description: t('home.actionLibraryDesc'),
      action: () => navigate('/library'),
      gradient: 'from-emerald-500 to-teal-500',
      glow: 'group-hover:shadow-emerald-500/20',
    },
    {
      icon: MessageCircle,
      title: t('home.actionChatTitle'),
      description: t('home.actionChatDesc'),
      action: () => navigate('/chat'),
      gradient: 'from-amber-500 to-orange-500',
      glow: 'group-hover:shadow-amber-500/20',
    },
    {
      icon: PenTool,
      title: t('home.actionDialogueTitle'),
      description: t('home.actionDialogueDesc'),
      action: () => navigate('/dialogue'),
      gradient: 'from-rose-500 to-pink-500',
      glow: 'group-hover:shadow-rose-500/20',
    },
  ];

  return (
    <div className="animate-fade-in">
      <div className="mb-6 sm:mb-10">
        <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('home.title')}</h1>
        <p className="mt-2 text-sm sm:text-base text-slate-400">
          {t('home.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
        {actions.map((item) => (
          <button
            key={item.title}
            onClick={item.action}
            className={`group text-left rounded-2xl border border-white/5 bg-slate-800/40 p-4 sm:p-6
              hover:border-white/10 hover:bg-slate-800/60 hover:-translate-y-0.5
              transition-all duration-300 ease-out cursor-pointer
              shadow-lg shadow-black/10 hover:shadow-xl hover:shadow-black/20 ${item.glow}`}
          >
            <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl
              bg-gradient-to-br ${item.gradient} text-white mb-5
              shadow-lg shadow-black/20 group-hover:scale-105 transition-transform duration-300`}>
              <item.icon size={22} strokeWidth={1.8} />
            </div>
            <h3 className="text-base font-semibold text-white group-hover:text-indigo-300 transition-colors duration-200">
              {item.title}
            </h3>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">{item.description}</p>
          </button>
        ))}
      </div>

      {/* Quick info section */}
      <div className="mt-10 rounded-2xl border border-white/5 bg-slate-800/20 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">{t('home.quickStartTitle')}</h2>
        <ol className="space-y-3 text-sm text-slate-400">
          {t('home.quickStartSteps').split('|').map((text, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/15 text-indigo-400 text-xs font-bold flex items-center justify-center mt-0.5">
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
