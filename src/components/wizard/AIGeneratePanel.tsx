/**
 * AIGeneratePanel - Always-visible panel for AI batch world book generation.
 * Contains theme, skeleton mode, world rules, NSFW toggle, and generate button.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { TextInput } from '../shared/TextInput';
import { TextArea } from '../shared/TextArea';
import { Button } from '../shared/Button';
import { AIProgressPanel, type AIProgressStatus } from '../shared/AIProgressPanel';
import { useAIGenerate } from '../../hooks/useAIGenerate';
import { useTranslation } from '../../i18n/I18nContext';

interface AIGeneratePanelProps {
  topic: string;
  worldRules: string;
  generating: boolean;
  skeletonMode: boolean;
  skeletonCount: number;
  batchCount: number;
  onTopicChange: (topic: string) => void;
  onWorldRulesChange: (rules: string) => void;
  onSkeletonModeChange: (skeleton: boolean) => void;
  onSkeletonCountChange: (count: number) => void;
  onBatchCountChange: (count: number) => void;
  onGenerate: () => void;
  /** Whether NSFW content generation is allowed */
  nsfw?: boolean;
  onNsfwChange?: (nsfw: boolean) => void;
  /** Card name, used for AI rule generation */
  cardName?: string;
  /** Character summaries, used for AI rule generation */
  characterSummaries?: string;
  /** Existing world book entries context, used to keep rules consistent */
  existingWorldbookContext?: string;
}

export function AIGeneratePanel({
  topic,
  worldRules,
  generating,
  skeletonMode,
  skeletonCount,
  batchCount,
  onTopicChange,
  onWorldRulesChange,
  onSkeletonModeChange,
  onSkeletonCountChange,
  onBatchCountChange,
  onGenerate,
  nsfw,
  onNsfwChange,
  cardName,
  characterSummaries,
  existingWorldbookContext,
}: AIGeneratePanelProps) {
  const { t } = useTranslation();
  const { generateWorldRulesStreaming } = useAIGenerate();
  const [rulesStatus, setRulesStatus] = useState<AIProgressStatus>('idle');
  const [rulesText, setRulesText] = useState('');
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [pendingRules, setPendingRules] = useState<string | null>(null);
  const rulesRetryCountRef = useRef(0);
  const rulesRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up pending retry timeout on unmount
  useEffect(() => () => {
    if (rulesRetryTimeoutRef.current) clearTimeout(rulesRetryTimeoutRef.current);
  }, []);

  const canGenerateRules = !!cardName?.trim();

  const handleGenerateRules = useCallback(async (isRetry = false) => {
    if (!canGenerateRules) {
      setRulesError(t('aiPanel.cardNameRequired'));
      return;
    }
    if (!isRetry) {
      rulesRetryCountRef.current = 0;
    }
    setRulesStatus('generating');
    setRulesText('');
    setRulesError(null);
    setPendingRules(null);

    try {
      const fullText = await generateWorldRulesStreaming(
        cardName || '',
        characterSummaries || '',
        (chunk) => setRulesText((prev) => prev + chunk),
        topic || undefined,
        worldRules || undefined,
        existingWorldbookContext || undefined,
        nsfw,
      );

      // ── Empty/too-short response detection ─────────────────────────────
      const trimmed = fullText.trim();
      if (trimmed.length < 20) {
        rulesRetryCountRef.current = isRetry ? rulesRetryCountRef.current + 1 : 1;
        const currentRetry = rulesRetryCountRef.current;
        if (currentRetry <= 2) {
          setRulesText(t('aiPanel.rulesTooShortRetry', { length: String(trimmed.length), current: String(currentRetry) }));
          rulesRetryTimeoutRef.current = setTimeout(() => handleGenerateRules(true), 1000);
          return;
        } else {
          setRulesStatus('error');
          setRulesError(t('aiPanel.rulesTooShortError'));
          return;
        }
      }

      setRulesStatus('done');
      setPendingRules(fullText);
    } catch (err: unknown) {
      setRulesStatus('error');
      setRulesError(err instanceof Error ? err.message : t('common.error'));
    }
  }, [canGenerateRules, cardName, characterSummaries, topic, worldRules, existingWorldbookContext, nsfw, generateWorldRulesStreaming]);

  const handleAcceptRules = useCallback(() => {
    if (pendingRules) {
      onWorldRulesChange(pendingRules);
      setPendingRules(null);
    }
    setRulesStatus('idle');
    setRulesText('');
  }, [pendingRules, onWorldRulesChange]);

  const handleRejectRules = useCallback(() => {
    setPendingRules(null);
    setRulesStatus('idle');
    setRulesText('');
  }, []);

  const handleClearRules = useCallback(() => {
    setRulesStatus('idle');
    setRulesText('');
    setRulesError(null);
    setPendingRules(null);
    rulesRetryCountRef.current = 0;
  }, []);

  return (
    <div className="mb-6 rounded-xl border border-indigo-700/40 bg-indigo-950/30 p-4 space-y-3">
      {/* NSFW toggle */}
      <div className="flex items-center gap-3 pb-2 border-b border-indigo-700/30">
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={nsfw ?? false}
            onChange={(e) => onNsfwChange?.(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-600" />
        </label>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-300">{t('common.nsfw')}</span>
          <span className="text-[10px] text-slate-500">
            {nsfw ? t('aiPanel.nsfwAllowed') : t('aiPanel.nsfwDisabled')}
          </span>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-indigo-300">{t('aiPanel.topicLabel')}</label>
        <TextInput
          value={topic}
          onChange={(e) => onTopicChange(e.target.value)}
          placeholder={t('aiPanel.topicPlaceholder')}
        />
      </div>

      {/* ── Skeleton mode ──────────────────────────── */}
      <div className="p-3 rounded-lg bg-emerald-900/20 border border-emerald-700/30 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-emerald-300 flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={skeletonMode}
                onChange={(e) => onSkeletonModeChange(e.target.checked)}
                className="rounded border-emerald-600 bg-slate-800 text-emerald-500"
              />
              🦴 {t('aiPanel.skeletonMode')}
            </label>
            <p className="text-[10px] text-emerald-400/60 mt-0.5 ml-6">
              {t('aiPanel.skeletonHint')}
            </p>
          </div>
          {skeletonMode && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-emerald-400/70">{t('aiPanel.countLabel')}</span>
              <input
                type="number"
                value={skeletonCount}
                min={3}
                max={30}
                onChange={(e) => onSkeletonCountChange(Math.max(3, parseInt(e.target.value) || 6))}
                className="w-14 text-center rounded border border-emerald-600/40 bg-slate-800 px-2 py-1 text-sm font-semibold text-emerald-300"
              />
            </div>
          )}
        </div>
        {skeletonMode && (
          <div className="flex gap-1.5 ml-6">
            {[6, 10, 15, 20].map((n) => (
              <button
                key={n}
                onClick={() => onSkeletonCountChange(n)}
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                  skeletonCount === n
                    ? 'border-emerald-500 bg-emerald-900/40 text-emerald-300'
                    : 'border-slate-600 bg-slate-700/50 text-slate-400 hover:border-emerald-600 hover:text-emerald-400'
                }`}
              >
                {n}{t('common.countUnit')}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Full mode batch count ──────────────────── */}
      {!skeletonMode && (
        <div className="flex items-center gap-3">
          <span className="text-xs text-indigo-300 shrink-0">{t('aiPanel.batchCountLabel')}</span>
          <input
            type="number"
            value={batchCount}
            min={3}
            max={20}
            onChange={(e) => onBatchCountChange(Math.max(3, Math.min(20, parseInt(e.target.value) || 8)))}
            className="w-14 text-center rounded border border-indigo-600/40 bg-slate-800 px-2 py-1 text-sm font-semibold text-indigo-300"
          />
          <div className="flex gap-1.5">
            {[4, 8, 12, 16].map((n) => (
              <button
                key={n}
                onClick={() => onBatchCountChange(n)}
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                  batchCount === n
                    ? 'border-indigo-500 bg-indigo-900/40 text-indigo-300'
                    : 'border-slate-600 bg-slate-700/50 text-slate-400 hover:border-indigo-600 hover:text-indigo-400'
                }`}
              >
                {n}{t('common.countUnit')}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-indigo-300">
            {t('aiPanel.rulesLabel')}
            <span className="text-xs text-slate-500 font-normal ml-2">{t('aiPanel.rulesHint')}</span>
          </label>
          {canGenerateRules && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleGenerateRules(false)}
                disabled={rulesStatus === 'generating'}
              >
                {rulesStatus === 'generating'
                  ? `⏳ ${t('common.generating')}`
                  : (worldRules.trim() ? `🔄 ${t('aiPanel.extendRules')}` : `✨ ${t('aiPanel.generateRules')}`)
                }
              </Button>
              {pendingRules && (
                <>
                  <Button size="sm" onClick={handleAcceptRules}>✅ {t('aiPanel.accept')}</Button>
                  <Button size="sm" variant="ghost" onClick={handleRejectRules}>{t('aiPanel.reject')}</Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* AI Progress Panel for world rules generation */}
        {rulesStatus !== 'idle' && (
          <div className="mb-3">
            <AIProgressPanel
              status={rulesStatus}
              text={rulesText}
              error={rulesError}
              title={t('aiPanel.generatedRulesTitle')}
              onClear={handleClearRules}
            />
          </div>
        )}

        <TextArea
          value={worldRules}
          onChange={(e) => onWorldRulesChange(e.target.value)}
          placeholder={t('aiPanel.rulesPlaceholder')}
          rows={6}
        />
        <p className="text-[10px] text-slate-500 mt-1">
          {t('aiPanel.rulesHelp')}
        </p>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onGenerate}
          disabled={generating}
          className="inline-flex items-center justify-center gap-2 rounded-lg font-medium px-5 py-2 text-sm
            bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500
            text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40
            transition-all duration-200 hover:scale-105 active:scale-95
            disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 cursor-pointer"
        >
          {generating ? `⏳ ${t('common.generating')}` : `🚀 ${t('aiPanel.generateButton')}`}
        </button>
        {(topic || worldRules) && (
          <span className="text-[10px] text-slate-500 ml-auto">
            {topic && `${t('aiPanel.topicSummary')}: ${topic.slice(0, 30) + (topic.length > 30 ? '...' : '')}`}
            {topic && worldRules && ' · '}
            {worldRules && t('aiPanel.rulesSummary', { count: String(worldRules.length) })}
          </span>
        )}
      </div>
    </div>
  );
}