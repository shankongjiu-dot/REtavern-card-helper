/**
 * IntroPage — cinematic brand opener for 吟游手册 / REtavern Card Helper.
 *
 * Plays a short, immersive animation that ties the brand to its purpose
 * (crafting SillyTavern character cards), then auto-transitions to the
 * main app. Users can skip at any time. Shows once per session.
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './IntroPage.css';

const BRAND_CN = '吟游手册';
const BRAND_EN = 'REtavern · Card Helper';
const TAGLINE = '为 SillyTavern 打造会演戏的专属角色卡';
const POETIC = '拆书成文 · 塑角成魂 · 落笔成卡';
const FEATURES = ['小说拆书', '角色塑造', '世界书', '变量蓝图', '一键导出'];

const INTRO_SEEN_KEY = 'introSeen';

function usePrefersReducedMotion(): boolean {
  return useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);
}

function useIsMobile(): boolean {
  return useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(max-width: 640px)').matches;
  }, []);
}

export function IntroPage() {
  const navigate = useNavigate();
  const reducedMotion = usePrefersReducedMotion();
  const isMobile = useIsMobile();
  const [leaving, setLeaving] = useState(false);

  // Transition-out duration after the user chooses to enter (shorter for
  // reduced-motion users). The intro itself never auto-advances — the user
  // must click / tap / press Enter to continue.
  const EXIT_MS = reducedMotion ? 320 : 820;
  // How long the progress bar takes to fill, signalling the intro finished.
  const INTRO_DURATION = reducedMotion ? 1200 : 4200;

  const handleEnter = useCallback(() => {
    setLeaving((prev) => {
      if (prev) return prev;
      window.setTimeout(() => {
        try { sessionStorage.setItem(INTRO_SEEN_KEY, '1'); } catch { /* ignore */ }
        navigate('/');
      }, EXIT_MS);
      return true;
    });
  }, [navigate, EXIT_MS]);

  // Decorative particles (skipped for reduced motion / mobile density).
  const particles = useMemo(() => {
    if (reducedMotion) return [];
    const count = isMobile ? 16 : 30;
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      size: 2 + Math.random() * 4,
      delay: Math.random() * 6,
      duration: 9 + Math.random() * 9,
      drift: (Math.random() * 2 - 1) * 50,
      violet: Math.random() > 0.5,
    }));
  }, [reducedMotion, isMobile]);

  const letters = useMemo(() => BRAND_CN.split(''), []);

  return (
    <div
      className={`intro${leaving ? ' intro--leaving' : ''}`}
      style={{ ['--intro-dur' as string]: `${INTRO_DURATION}ms` }}
      onClick={handleEnter}
      role="button"
      tabIndex={0}
      aria-label="进入吟游手册"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleEnter();
        }
      }}
    >
      <div className="intro-bg" aria-hidden />
      <div className="intro-vignette" aria-hidden />
      <div className="intro-particles" aria-hidden>
        {particles.map((p) => (
          <span
            key={p.id}
            className={`intro-particle ${p.violet ? 'is-violet' : 'is-primary'}`}
            style={{
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              ['--drift' as string]: `${p.drift}px`,
            }}
          />
        ))}
      </div>

      <button
        type="button"
        className="intro-skip"
        onClick={(e) => {
          e.stopPropagation();
          handleEnter();
        }}
      >
        跳过
      </button>

      <div className="intro-stage">
        <div className="intro-card-wrap">
          <div className="intro-deck" aria-hidden>
            {/* Cards fly in from alternating sides with varied vectors and stack into a deck */}
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="intro-deck-card"
                style={{
                  ['--from-x' as string]: `${i % 2 === 0 ? -1 : 1}`,
                  ['--from-y' as string]: `${[-0.6, 0.4, -0.3, 0.7, -0.5, 0.2][i]}`,
                  ['--stack-y' as string]: `${(5 - i) * 2.5}px`,
                  ['--stack-r' as string]: `${(i - 2.5) * 2.2}deg`,
                  ['--card-tint' as string]: ['#10b981', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#6366f1'][i],
                  ['--card-img' as string]: `url(/cards/${['card-emerald', 'card-violet', 'card-amber', 'card-sky', 'card-rose', 'card-indigo'][i]}.png)`,
                  animationDelay: `${[0, 90, 180, 300, 420, 560][i]}ms`,
                }}
              />
            ))}
            {/* Top card with emblem — dramatic pause, arrives last */}
            <div className="intro-deck-card intro-deck-top" style={{ animationDelay: '820ms' }}>
              <svg className="intro-emblem" viewBox="0 0 64 64" fill="none" aria-hidden>
                <rect x="8" y="6" width="48" height="52" rx="6" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
                <rect x="11" y="9" width="42" height="46" rx="4" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
                <path d="M14 12c2-2 5-2 7 0M50 12c-2-2-5-2-7 0M14 52c2 2 5 2 7 0M50 52c-2 2-5 2-7 0" stroke="currentColor" strokeWidth="0.8" opacity="0.5" strokeLinecap="round" />
                <path d="M32 16l3.2 8.8L44 28l-8.8 3.2L32 40l-3.2-8.8L20 28l8.8-3.2L32 16z" fill="currentColor" opacity="0.85" />
                <circle cx="32" cy="28" r="2.4" fill="#fff" opacity="0.95" />
                <path d="M40 18c-3 4-8 10-14 18l-2 6 1.5-0.5c6-5 12-11 15.5-16l-1-7.5z" fill="currentColor" opacity="0.55" />
                <path d="M24 42l-1.5 4.5 3-1.5" stroke="currentColor" strokeWidth="1" opacity="0.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M22 18l0.8 2 2 0.8-2 0.8-0.8 2-0.8-2-2-0.8 2-0.8 0.8-2z" fill="currentColor" opacity="0.6" />
                <path d="M44 38l0.6 1.5 1.5 0.6-1.5 0.6-0.6 1.5-0.6-1.5-1.5-0.6 1.5-0.6 0.6-1.5z" fill="currentColor" opacity="0.5" />
                <path d="M22 48h20" stroke="currentColor" strokeWidth="0.8" opacity="0.35" strokeLinecap="round" />
                <circle cx="32" cy="48" r="1.2" fill="currentColor" opacity="0.4" />
              </svg>
            </div>
          </div>
        </div>

        <h1 className="intro-title">
          {letters.map((ch, i) => (
            <span
              key={`${ch}-${i}`}
              className="intro-letter"
              style={{ animationDelay: `${1200 + i * 90}ms` }}
            >
              {ch}
            </span>
          ))}
        </h1>

        <div className="intro-en">{BRAND_EN}</div>
        <p className="intro-tagline">{TAGLINE}</p>
        <p className="intro-poetic">{POETIC}</p>

        <div className="intro-pills">
          {FEATURES.map((f, i) => (
            <span
              key={f}
              className="intro-pill"
              style={{ animationDelay: `${3000 + i * 130}ms` }}
            >
              {f}
            </span>
          ))}
        </div>

        <div className="intro-hint">轻触任意处进入 →</div>
      </div>

      <div className="intro-progress" aria-hidden>
        <div className="intro-progress-bar" />
      </div>
    </div>
  );
}
