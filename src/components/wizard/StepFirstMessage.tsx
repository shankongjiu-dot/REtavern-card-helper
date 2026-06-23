/**
 * Step 4: First Message - the character's opening message.
 * Supports AI generation with real-time streaming progress, word count control,
 * custom writing requirements, and empty response detection with auto-retry.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { TextArea } from '../shared/TextArea';
import { Button } from '../shared/Button';
import { AIProgressPanel, type AIProgressStatus } from '../shared/AIProgressPanel';
import { useAIGenerate } from '../../hooks/useAIGenerate';
import { useTranslation } from '../../i18n/I18nContext';
import type { MvuConfig } from '../../constants/defaults';

interface StepFirstMessageProps {
  firstMessage: string;
  cardName: string;
  characterDescriptions: string;
  worldbookContext: string;
  onChange: (message: string) => void;
  /** MVU config — used to show initvar context for consistency */
  mvu?: MvuConfig;
}

const WORD_COUNT_PRESETS = (t: (key: string, vars?: Record<string, string>) => string) => [
  { label: t('firstMessage.unlimited'), value: 0 },
  { label: t('firstMessage.wordCountPreset', { count: String(200) }), value: 200 },
  { label: t('firstMessage.wordCountPreset', { count: String(500) }), value: 500 },
  { label: t('firstMessage.wordCountPreset', { count: String(800) }), value: 800 },
  { label: t('firstMessage.wordCountPreset', { count: String(1200) }), value: 1200 },
];

/** Minimum acceptable content length for a valid response */
const MIN_RESPONSE_LENGTH = 50;
/** Maximum number of auto-retries when AI returns empty/too-short content */
const MAX_AUTO_RETRIES = 2;

export function StepFirstMessage({ firstMessage, cardName, characterDescriptions, worldbookContext, onChange, mvu }: StepFirstMessageProps) {
  const { t } = useTranslation();
  const { generateFirstMessageStreaming } = useAIGenerate();
  const [aiStatus, setAiStatus] = useState<AIProgressStatus>('idle');
  const [aiText, setAiText] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [pendingResult, setPendingResult] = useState<string | null>(null);
  const [targetWordCount, setTargetWordCount] = useState(0);
  const [writingRequirements, setWritingRequirements] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showRequirements, setShowRequirements] = useState(false);

  // Clean up pending retry timeout on unmount
  useEffect(() => () => {
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
  }, []);

  const handleStreamGenerate = useCallback(async (isRetry = false) => {
    if (!isRetry) {
      retryCountRef.current = 0;
      setRetryCount(0);
    }
    setAiStatus('generating');
    setAiText('');
    setAiError(null);
    setPendingResult(null);

    try {
      const fullText = await generateFirstMessageStreaming(
        cardName,
        characterDescriptions,
        '', // no scene hint for quick generate
        (chunk) => {
          setAiText((prev) => prev + chunk);
        },
        targetWordCount || undefined,
        worldbookContext,
        writingRequirements || undefined,
      );

      // ── Empty response detection ──────────────────────────────────────
      const trimmed = fullText.trim();
      if (trimmed.length < MIN_RESPONSE_LENGTH) {
        retryCountRef.current = isRetry ? retryCountRef.current + 1 : 1;
        const currentRetry = retryCountRef.current;
        setRetryCount(currentRetry);
        if (currentRetry <= MAX_AUTO_RETRIES) {
          // Auto-retry
          setAiText(t('firstMessage.tooShortRetry', { length: String(trimmed.length), current: String(currentRetry), max: String(MAX_AUTO_RETRIES) }));
          retryTimeoutRef.current = setTimeout(() => handleStreamGenerate(true), 1000);
          return;
        } else {
          // Exhausted retries
          setAiStatus('error');
          setAiError(t('firstMessage.tooShortError', { count: String(MAX_AUTO_RETRIES + 1), length: String(trimmed.length) }));
          return;
        }
      }

      setAiStatus('done');
      setPendingResult(fullText);
    } catch (err: unknown) {
      setAiStatus('error');
      setAiError(err instanceof Error ? err.message : t('common.error'));
    }
  }, [cardName, characterDescriptions, generateFirstMessageStreaming, targetWordCount, worldbookContext, writingRequirements]);

  const handleAccept = useCallback(() => {
    if (pendingResult) {
      onChange(pendingResult);
      setPendingResult(null);
    }
    setAiStatus('idle');
    setAiText('');
  }, [pendingResult, onChange]);

  const handleReject = useCallback(() => {
    setPendingResult(null);
    setAiStatus('idle');
    setAiText('');
  }, []);

  const handleClear = useCallback(() => {
    setAiStatus('idle');
    setAiText('');
    setAiError(null);
    setPendingResult(null);
    setRetryCount(0);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-white">{t('firstMessage.title')}</h2>
          <p className="text-sm text-slate-400 mt-1">
            {t('firstMessage.subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowRequirements(!showRequirements)}
          >
            {showRequirements ? t('firstMessage.collapseRequirements') : (writingRequirements.trim() ? t('firstMessage.writingRequirementsActive') : t('firstMessage.writingRequirementsButton'))}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleStreamGenerate(false)}
            disabled={aiStatus === 'generating'}
          >
            {aiStatus === 'generating'
              ? (retryCount > 0 ? `⏳ ${t('firstMessage.retrying', { current: String(retryCount), max: String(MAX_AUTO_RETRIES) })}` : `⏳ ${t('common.generating')}`)
              : `✨ ${t('firstMessage.aiGenerate')}`
            }
          </Button>
          {pendingResult && (
            <>
              <Button size="sm" onClick={handleAccept}>✅ {t('firstMessage.accept')}</Button>
              <Button size="sm" variant="ghost" onClick={handleReject}>{t('firstMessage.reject')}</Button>
            </>
          )}
        </div>
      </div>

      {/* Writing requirements panel */}
      {showRequirements && (
        <div className="mb-4 rounded-xl border-2 border-amber-600/50 bg-amber-950/20 p-4 space-y-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-amber-300">⚠️ {t('firstMessage.writingReqTitle')}</h3>
            </div>
            {writingRequirements.trim() && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-800/40 text-emerald-300">✅ {t('firstMessage.reqFilled')}</span>
            )}
          </div>
          <div className="rounded-lg bg-amber-900/20 border border-amber-700/30 px-3 py-2">
            <p className="text-[11px] text-amber-200/80 leading-relaxed">
              {t('firstMessage.writingReqHint')}
            </p>
          </div>
          <textarea
            value={writingRequirements}
            onChange={(e) => setWritingRequirements(e.target.value)}
            placeholder={t('firstMessage.writingReqPlaceholder')}
            className="w-full h-32 rounded-lg border border-amber-600/40 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 resize-y focus:border-amber-500 focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-slate-500">
              💡 {t('firstMessage.writingReqTip')}
            </p>
            {writingRequirements.trim() && (
              <span className="text-[10px] text-slate-500 shrink-0">{writingRequirements.length}{t('common.words')}</span>
            )}
          </div>
        </div>
      )}

      {/* Word count presets */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-slate-400 shrink-0">{t('firstMessage.wordCountLabel')}</span>
        <div className="flex flex-wrap gap-1.5">
          {WORD_COUNT_PRESETS(t).map((preset) => (
            <button
              key={preset.value}
              onClick={() => setTargetWordCount(preset.value)}
              className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                targetWordCount === preset.value
                  ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-300'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* AI Progress Panel */}
      {aiStatus !== 'idle' && (
        <div className="mb-4">
          <AIProgressPanel
            status={aiStatus}
            text={aiText}
            error={aiError}
            title={retryCount > 0 ? t('firstMessage.aiProgressRetryTitle', { current: String(retryCount), max: String(MAX_AUTO_RETRIES) }) : t('firstMessage.aiProgressTitle')}
            onClear={handleClear}
          />
        </div>
      )}

      {/* MVU initvar context — ensures first message aligns with variable initial state */}
      {mvu?.enabled && mvu.schemaSections.length > 0 && (
        <div className="mb-4 rounded-xl border border-purple-700/40 bg-purple-950/20 p-4">
          <details open>
            <summary className="text-sm font-medium text-purple-300 cursor-pointer">
              📐 MVU 变量初始状态参考
            </summary>
            <p className="text-[11px] text-purple-400/60 mt-2 mb-2">
              开场白应体现以下变量的初始状态，确保与 initvar 一致：
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {mvu.schemaSections.flatMap(section =>
                section.variables
                  .filter(v => v.prefix !== '$')
                  .map(v => (
                    <div key={v.path} className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 truncate">{v.path}</span>
                      <span className="text-purple-300 font-mono ml-2">
                        {String(v.initialValue ?? '?')}
                      </span>
                    </div>
                  ))
              )}
            </div>
            {mvu.schemaSections.flatMap(s => s.variables).filter(v => v.prefix !== '$').length === 0 && (
              <p className="text-xs text-slate-500">暂无变量</p>
            )}
          </details>
        </div>
      )}

      <TextArea
        value={firstMessage}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('firstMessage.placeholder')}
        rows={10}
        className="font-mono"
      />
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-slate-500">
          {t('firstMessage.tip')}
        </p>
        {firstMessage && (
          <span className="text-xs text-slate-500 shrink-0 ml-4">
            {t('firstMessage.currentLength', { count: String(firstMessage.length) })}
          </span>
        )}
      </div>
    </div>
  );
}
