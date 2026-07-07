/**
 * BackgroundChanger - allows users to upload/customize/reset the app background.
 */
import { useState, useEffect } from 'react';
import { setBackground, clearBackground, getStoredBackground } from '../../services/background-service';
import { resizeImageFileToDataUrl } from '../../services/image-processing';
import { useToast } from './Toast';
import { useTranslation } from '../../i18n/I18nContext';

export function BackgroundChanger({ sidebarOpen }: { sidebarOpen?: boolean }) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [hasCustomBg, setHasCustomBg] = useState(() => !!getStoredBackground());
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const effectiveExpanded = isMobile && sidebarOpen === false ? false : isExpanded;

  const handleUpload = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const dataUrl = await resizeImageFileToDataUrl(file, { maxDimension: 1920 });
        setBackground(dataUrl);
        setHasCustomBg(true);
        addToast('success', '背景图片已设置');
      } catch (err) {
        const message = err instanceof Error ? err.message : '背景图片设置失败';
        addToast('error', message);
      }
    };
    input.click();
  };

  const handleReset = () => {
    clearBackground();
    setHasCustomBg(false);
  };

  return (
    <div className="relative">
      {/* Toggle button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        title={t('theme.changeBackground')}
      >
        <span className="flex items-center gap-1.5">
          🎨 {t('theme.backgroundLabel')}
        </span>
        <span className={`transition-transform ${effectiveExpanded ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {/* Expanded options */}
      {effectiveExpanded && (
        <div className="absolute bottom-full left-0 right-0 mb-1 p-2 bg-slate-800/95 backdrop-blur-sm border border-slate-700 rounded-lg shadow-lg">
          <div className="space-y-1.5">
            <button
              onClick={handleUpload}
              className="w-full text-left px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 rounded transition-colors"
            >
              📤 {t('theme.uploadImage')}
            </button>
            {hasCustomBg && (
              <button
                onClick={handleReset}
                className="w-full text-left px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 rounded transition-colors"
              >
                🔄 {t('theme.resetDefault')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
