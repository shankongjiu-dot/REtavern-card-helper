/**
 * BackgroundChanger - allows users to upload/customize/reset the app background.
 */
import { useState } from 'react';
import { fileToDataUrl, setBackground, clearBackground, getStoredBackground } from '../../services/background-service';
import { useTranslation } from '../../i18n/I18nContext';

export function BackgroundChanger({ sidebarOpen }: { sidebarOpen?: boolean }) {
  const { t } = useTranslation();
  const [hasCustomBg, setHasCustomBg] = useState(() => !!getStoredBackground());
  const [isExpanded, setIsExpanded] = useState(false);

  // 移动端关闭侧栏时，自动收起背景面板
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
  const effectiveExpanded = isMobile && sidebarOpen === false ? false : isExpanded;

  const handleUpload = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        const dataUrl = await fileToDataUrl(file);
        setBackground(dataUrl);
        setHasCustomBg(true);
      } catch (err) {
        console.error('Failed to upload background:', err);
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
        <span className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
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
