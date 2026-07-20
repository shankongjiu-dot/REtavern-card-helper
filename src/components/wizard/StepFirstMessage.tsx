/**
 * Step 7: First Message - supports multiple greetings (primary + alternates).
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
  alternateGreetings: string[];
  cardName: string;
  characterDescriptions: string;
  worldbookContext: string;
  onChange: (message: string) => void;
  onAlternateGreetingsChange: (greetings: string[]) => void;
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

export function StepFirstMessage({
  firstMessage,
  alternateGreetings,
  cardName,
  characterDescriptions,
  worldbookContext,
  onChange,
  onAlternateGreetingsChange,
  mvu,
}: StepFirstMessageProps) {
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
  const [activeIndex, setActiveIndex] = useState(0);

  // Clean up pending retry timeout on unmount
  useEffect(() => () => {
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
  }, []);

  const greetings = [firstMessage, ...alternateGreetings];

  const getCurrentText = useCallback(() => {
    return greetings[activeIndex] ?? '';
  }, [greetings, activeIndex]);

  const setCurrentText = useCallback((text: string) => {
    if (activeIndex === 0) {
      onChange(text);
    } else {
      const idx = activeIndex - 1;
      const next = [...alternateGreetings];
      next[idx] = text;
      onAlternateGreetingsChange(next);
    }
  }, [activeIndex, alternateGreetings, onChange, onAlternateGreetingsChange]);

  const handleAddAlternate = useCallback(() => {
    onAlternateGreetingsChange([...alternateGreetings, '']);
    setActiveIndex(alternateGreetings.length + 1);
  }, [alternateGreetings, onAlternateGreetingsChange]);

  const handleDeleteAlternate = useCallback((index: number) => {
    if (!window.confirm(t('firstMessage.deleteAlternateConfirm'))) return;
    const next = alternateGreetings.filter((_, i) => i !== index - 1);
    onAlternateGreetingsChange(next);
    if (activeIndex >= index) {
      setActiveIndex(Math.max(0, activeIndex - 1));
    }
  }, [alternateGreetings, activeIndex, onAlternateGreetingsChange, t]);

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
  }, [cardName, characterDescriptions, generateFirstMessageStreaming, targetWordCount, worldbookContext, writingRequirements, t]);

  const handleAccept = useCallback(() => {
    if (pendingResult) {
      setCurrentText(pendingResult);
      setPendingResult(null);
    }
    setAiStatus('idle');
    setAiText('');
  }, [pendingResult, setCurrentText]);

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

  const currentText = getCurrentText();

  return (
    <div>
      <div className="flex flex-col gap-4 mb-4">
        <div className="mobile-stack-header flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-[var(--text-color)]">{t('firstMessage.title')}</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              {t('firstMessage.subtitle')}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
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

        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {greetings.map((_, index) => (
            <div key={index} className="flex items-center">
              <button
                onClick={() => setActiveIndex(index)}
                className={`px-3 py-1.5 text-xs rounded-l-lg border-y border-l transition-colors ${
                  activeIndex === index
                    ? 'bg-[color-mix(in_srgb,var(--color-primary)_30%,transparent)] border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] text-[color-mix(in_srgb,var(--color-primary)_80%,var(--text-color))]'
                    : 'border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--input-border)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                {index === 0 ? t('firstMessage.tabPrimary') : t('firstMessage.tabAlternate', { index: String(index + 1) })}
              </button>
              {index > 0 && (
                <button
                  onClick={() => handleDeleteAlternate(index)}
                  title={t('firstMessage.deleteAlternate')}
                  className={`px-2 py-1.5 text-xs rounded-r-lg border-y border-r transition-colors ${
                    activeIndex === index
                      ? 'bg-[color-mix(in_srgb,var(--color-primary)_30%,transparent)] border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] text-[color-mix(in_srgb,var(--color-primary)_80%,var(--text-color))] hover:text-[var(--color-status-danger)]'
                      : 'border-[var(--color-border-default)] text-[var(--color-text-muted)] hover:text-[var(--color-status-danger)] hover:border-[var(--input-border)]'
                  }`}
                >
                  ×
                </button>
              )}
              {index === 0 && (
                <span className={`px-2 py-1.5 text-xs rounded-r-lg border-y border-r ${
                  activeIndex === index
                    ? 'bg-[color-mix(in_srgb,var(--color-primary)_30%,transparent)] border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] text-[color-mix(in_srgb,var(--color-primary)_80%,var(--text-color))]'
                    : 'border-[var(--color-border-default)] text-[var(--color-text-muted)]'
                }`}>
                  主
                </span>
              )}
            </div>
          ))}
          <button
            onClick={handleAddAlternate}
            className="px-3 py-1.5 text-xs rounded-lg border border-dashed border-[var(--input-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
          >
            + {t('firstMessage.addAlternate')}
          </button>
        </div>
      </div>

      {/* Writing requirements panel */}
      {showRequirements && (
        <div className="mb-4 rounded-xl border-2 border-[color-mix(in_srgb,var(--color-status-warning)_50%,transparent)] bg-[color-mix(in_srgb,var(--color-status-warning)_20%,transparent)] p-4 space-y-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[var(--color-status-warning)]">⚠️ {t('firstMessage.writingReqTitle')}</h3>
            </div>
            {writingRequirements.trim() && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-[color-mix(in_srgb,var(--color-status-success)_40%,transparent)] text-[var(--color-status-success)]">✅ {t('firstMessage.reqFilled')}</span>
            )}
          </div>
          <div className="rounded-lg bg-[color-mix(in_srgb,var(--color-status-warning)_20%,transparent)] border border-[color-mix(in_srgb,var(--color-status-warning)_30%,transparent)] px-3 py-2">
            <p className="text-[11px] text-[var(--color-status-warning)] leading-relaxed">
              {t('firstMessage.writingReqHint')}
            </p>
          </div>
          <textarea
            value={writingRequirements}
            onChange={(e) => setWritingRequirements(e.target.value)}
            placeholder={t('firstMessage.writingReqPlaceholder')}
            className="w-full h-32 rounded-lg border border-[color-mix(in_srgb,var(--color-status-warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--input-bg)_80%,transparent)] px-3 py-2 text-xs text-[var(--text-color)] placeholder-[var(--color-text-muted)] resize-y focus:border-[var(--color-status-warning)] focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-[var(--color-text-muted)]">
              💡 {t('firstMessage.writingReqTip')}
            </p>
            {writingRequirements.trim() && (
              <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">{writingRequirements.length}{t('common.words')}</span>
            )}
          </div>
        </div>
      )}

      {/* Word count presets */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-[var(--color-text-secondary)] shrink-0">{t('firstMessage.wordCountLabel')}</span>
        <div className="flex flex-wrap gap-1.5">
          {WORD_COUNT_PRESETS(t).map((preset) => (
            <button
              key={preset.value}
              onClick={() => setTargetWordCount(preset.value)}
              className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                targetWordCount === preset.value
                  ? 'bg-[color-mix(in_srgb,var(--color-primary)_30%,transparent)] border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] text-[color-mix(in_srgb,var(--color-primary)_80%,var(--text-color))]'
                  : 'border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--input-border)] hover:text-[var(--color-text-secondary)]'
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
        <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-primary)_20%,transparent)] p-4">
          <details>
            <summary className="text-sm font-medium text-[var(--color-primary)] cursor-pointer">
              📐 MVU 变量初始状态参考
            </summary>
            <p className="text-[11px] text-[var(--color-primary)] mt-2 mb-2">
              开场白应体现以下变量的初始状态，确保与 initvar 一致：
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {mvu.schemaSections.flatMap(section =>
                section.variables
                  .filter(v => v.prefix !== '$')
                  .map(v => (
                    <div key={v.path} className="flex items-center justify-between text-xs">
                      <span className="text-[var(--color-text-secondary)] truncate">{v.path}</span>
                      <span className="text-[var(--color-primary)] font-mono ml-2">
                        {String(v.initialValue ?? '?')}
                      </span>
                    </div>
                  ))
              )}
            </div>
            {mvu.schemaSections.flatMap(s => s.variables).filter(v => v.prefix !== '$').length === 0 && (
              <p className="text-xs text-[var(--color-text-muted)]">暂无变量</p>
            )}
          </details>
        </div>
      )}

      <TextArea
        value={currentText}
        onChange={(e) => setCurrentText(e.target.value)}
        placeholder={t('firstMessage.placeholder')}
        rows={10}
        className="font-mono"
      />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mt-2 gap-2">
        <p className="text-xs text-[var(--color-text-muted)]">
          {t('firstMessage.tip')}
        </p>
        {currentText && (
          <span className="text-xs text-[var(--color-text-muted)] shrink-0">
            {t('firstMessage.currentLength', { count: String(currentText.length) })}
          </span>
        )}
      </div>
      {alternateGreetings.length > 0 && (
        <p className="text-xs text-[var(--color-text-muted)] mt-2">
          💡 {t('firstMessage.alternateTip')}
        </p>
      )}
    </div>
  );
}
