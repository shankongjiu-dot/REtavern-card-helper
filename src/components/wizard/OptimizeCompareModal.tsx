/**
 * OptimizeCompareModal — AI-driven field-level optimization with before/after
 * diff review and selective application.
 *
 * Three phases:
 *   1. config  — pick fields + optional optimization direction, then call AI
 *   2. loading — spinner while AI generates optimized JSON
 *   3. diff    — per-field diff cards (via FieldDiffCard); apply single or all
 *
 * Key safety: when applying all, mvu.statusBarHtml and mvu.schemaSections both
 * return a `mvu` patch — we merge them via a workingDraft so the second patch
 * does not overwrite the first.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Sparkles, RefreshCw, Check, RotateCcw } from 'lucide-react';
import { useTranslation } from '../../i18n/I18nContext';
import { useToast } from '../shared/Toast';
import { useAIGenerate } from '../../hooks/useAIGenerate';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { FieldDiffCard } from './FieldDiffCard';
import {
  buildOptimizePrompt,
  buildLorebookBatches,
  parseOptimizeResult,
  computeFieldDiffs,
  buildApplyPatch,
  ALL_OPTIMIZE_FIELDS,
  type OptimizeFieldKey,
  type OptimizeResult,
  type FieldDiff,
} from '../../services/card-optimizer';
import type { WizardDraft } from '../../constants/defaults';

interface OptimizeCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  draft: WizardDraft;
  onUpdateDraft: (patch: Partial<WizardDraft>) => void;
  initialSelected: OptimizeFieldKey[];
}

type Phase = 'config' | 'loading' | 'diff';

const FIELD_LABEL_KEYS: Record<OptimizeFieldKey, string> = {
  cardName: 'optimizeCompare.fieldCardName',
  tags: 'optimizeCompare.fieldTags',
  firstMessage: 'optimizeCompare.fieldFirstMessage',
  lorebookEntries: 'optimizeCompare.fieldLorebookEntries',
  'mvu.statusBarHtml': 'optimizeCompare.fieldMvuStatusBarHtml',
  'mvu.schemaSections': 'optimizeCompare.fieldMvuSchemaSections',
};

const BORDER = 'var(--color-border-default)';
const MUTED = 'color-mix(in srgb, var(--text-color) 60%, transparent)';
const FAINT = 'color-mix(in srgb, var(--text-color) 40%, transparent)';

export function OptimizeCompareModal({
  isOpen,
  onClose,
  draft,
  onUpdateDraft,
  initialSelected,
}: OptimizeCompareModalProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const { generateTextWithoutPresetStreaming } = useAIGenerate();

  const [selectedFields, setSelectedFields] = useState<Set<OptimizeFieldKey>>(new Set());
  const [direction, setDirection] = useState('');
  const [phase, setPhase] = useState<Phase>('config');
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);
  const [fieldDiffs, setFieldDiffs] = useState<FieldDiff[]>([]);
  const [appliedFields, setAppliedFields] = useState<Set<OptimizeFieldKey>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [streamPreview, setStreamPreview] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [batchInfo, setBatchInfo] = useState<{ current: number; total: number } | null>(null);
  const [loadingMode, setLoadingMode] = useState<'normal' | 'lorebookBatch'>('normal');

  const mvuEnabled = !!draft.mvu?.enabled;
  const visibleFields = useMemo(
    () => ALL_OPTIMIZE_FIELDS.filter((f) =>
      f === 'mvu.statusBarHtml' || f === 'mvu.schemaSections' ? mvuEnabled : true,
    ),
    [mvuEnabled],
  );

  // Reset state whenever the modal opens (false → true).
  useEffect(() => {
    if (isOpen) {
      const visibleSet = new Set(visibleFields);
      setSelectedFields(new Set(initialSelected.filter((field) => visibleSet.has(field))));
      setDirection('');
      setPhase('config');
      setOptimizeResult(null);
      setFieldDiffs([]);
      setAppliedFields(new Set());
      setError(null);
      setStreamPreview('');
      setElapsedSeconds(0);
      setBatchInfo(null);
      setLoadingMode('normal');
    }
  }, [isOpen, initialSelected, visibleFields]);

  useEffect(() => {
    if (phase !== 'loading') return;
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const toggleField = useCallback((field: OptimizeFieldKey) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }, []);

  const handleStartOptimize = useCallback(async () => {
    if (selectedFields.size === 0) return;
    setPhase('loading');
    setError(null);
    setOptimizeResult(null);
    setFieldDiffs([]);
    setAppliedFields(new Set());
    setStreamPreview('');
    setBatchInfo(null);
    setLoadingMode('normal');
    try {
      const visibleSet = new Set(visibleFields);
      const fieldsArr = [...selectedFields].filter((field) => visibleSet.has(field));
      if (fieldsArr.length === 0) {
        setPhase('config');
        return;
      }
      const optimized: OptimizeResult = {};

      const optimizeField = async (
        fields: OptimizeFieldKey[],
        onChunk: (chunk: string) => void,
      ): Promise<void> => {
        const prompts = buildOptimizePrompt(
          draft,
          fields,
          direction.trim() || t('optimizeCompare.directionDefault'),
        );
        const text = await generateTextWithoutPresetStreaming(prompts.system, prompts.user, onChunk);
        const result = parseOptimizeResult(text);
        if (!result) {
          throw new Error('AI 返回了空结果，可能是模型未按 JSON 格式输出');
        }
        if (result.cardName !== undefined) optimized.cardName = result.cardName;
        if (result.tags !== undefined) optimized.tags = result.tags;
        if (result.firstMessage !== undefined) optimized.firstMessage = result.firstMessage;
        if (result.mvuStatusBarHtml !== undefined) optimized.mvuStatusBarHtml = result.mvuStatusBarHtml;
        if (result.mvuSchemaSections !== undefined) optimized.mvuSchemaSections = result.mvuSchemaSections;
        if (result.lorebookEntries && result.lorebookEntries.length > 0) {
          optimized.lorebookEntries = [...(optimized.lorebookEntries || []), ...result.lorebookEntries];
        }
      };

      const optimizeLorebookBatches = async (
        onChunk: (chunk: string) => void,
      ): Promise<void> => {
        const batches = buildLorebookBatches(draft, direction.trim() || t('optimizeCompare.directionDefault'));
        if (batches.length === 0) return;
        setLoadingMode('lorebookBatch');
        setBatchInfo({ current: 1, total: batches.length });
        let preview = '';
        for (let i = 0; i < batches.length; i++) {
          setBatchInfo({ current: i + 1, total: batches.length });
          const batch = batches[i];
          const text = await generateTextWithoutPresetStreaming(
            batch.system,
            batch.user,
            (chunk) => {
              preview = `${preview}${chunk}`;
              onChunk(`[批次 ${i + 1}/${batches.length}]\n${preview.slice(-600)}`);
            },
          );
          const result = parseOptimizeResult(text);
          if (result?.lorebookEntries?.length) {
            optimized.lorebookEntries = [...(optimized.lorebookEntries || []), ...result.lorebookEntries];
          }
        }
        setBatchInfo(null);
      };

      const nonLorebookFields = fieldsArr.filter((f) => f !== 'lorebookEntries');
      const hasLorebook = fieldsArr.includes('lorebookEntries');
      let preview = '';

      if (nonLorebookFields.length > 0) {
        await optimizeField(nonLorebookFields, (chunk) => {
          preview = `${preview}${chunk}`;
          setStreamPreview(preview.slice(-1200));
        });
      }

      if (hasLorebook) {
        await optimizeLorebookBatches((chunk) => {
          setStreamPreview(chunk);
        });
      }

      const diffs = computeFieldDiffs(draft, optimized, fieldsArr);
      setOptimizeResult(optimized);
      setFieldDiffs(diffs);
      setPhase('diff');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('optimizeCompare.optimizeFailed'));
      setBatchInfo(null);
      setPhase('config');
    }
  }, [selectedFields, visibleFields, draft, direction, generateTextWithoutPresetStreaming, t]);

  const handleApplySingle = useCallback(
    (field: OptimizeFieldKey) => {
      if (!optimizeResult || appliedFields.has(field)) return;
      const patch = buildApplyPatch(draft, field, optimizeResult);
      onUpdateDraft(patch);
      setAppliedFields((prev) => new Set(prev).add(field));
      addToast('success', t('optimizeCompare.appliedToast'));
    },
    [optimizeResult, appliedFields, draft, onUpdateDraft, addToast, t],
  );

  const handleApplyAll = useCallback(() => {
    if (!optimizeResult) return;
    // Build a merged patch. mvu.* fields both return { mvu: {...} } — merge them
    // via workingDraft so the second does not overwrite the first.
    const pendingFields = fieldDiffs
      .map((d) => d.field)
      .filter((f) => !appliedFields.has(f));
    if (pendingFields.length === 0) return;

    const mergedPatch: Partial<WizardDraft> = {};
    let workingDraft: WizardDraft = { ...draft, mvu: draft.mvu ? { ...draft.mvu } : undefined };

    for (const field of pendingFields) {
      const patch = buildApplyPatch(workingDraft, field, optimizeResult);
      if (patch.mvu) {
        patch.mvu = { ...(workingDraft.mvu || {}), ...patch.mvu } as WizardDraft['mvu'];
      }
      workingDraft = { ...workingDraft, ...patch };
      for (const key of Object.keys(patch) as Array<keyof WizardDraft>) {
        (mergedPatch as Record<string, unknown>)[key] = patch[key];
      }
    }

    onUpdateDraft(mergedPatch);
    setAppliedFields((prev) => {
      const next = new Set(prev);
      for (const f of pendingFields) next.add(f);
      return next;
    });
    addToast('success', t('optimizeCompare.allAppliedToast'));
  }, [optimizeResult, fieldDiffs, appliedFields, draft, onUpdateDraft, addToast, t]);

  const allApplied = fieldDiffs.length > 0 && appliedFields.size === fieldDiffs.length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('optimizeCompare.title')} maxWidth="max-w-6xl">
      {/* Subtitle */}
      <p className="text-xs mb-4" style={{ color: MUTED }}>
        {t('optimizeCompare.subtitle')}
      </p>

      {/* ── Phase: config ───────────────────────────────────────────── */}
      {phase === 'config' && (
        <div className="space-y-4">
          {error && (
            <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(248,113,113,.15)', color: '#f87171' }}>
              {t('optimizeCompare.optimizeFailed')}: {error}
            </div>
          )}

          <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: BORDER, background: 'rgba(15,23,42,.35)' }}>
            <div className="font-medium mb-1" style={{ color: 'var(--text-color)' }}>
              {t('optimizeCompare.scopeTitle')}
            </div>
            <div className="space-y-0.5" style={{ color: MUTED }}>
              <div>{t('optimizeCompare.scopeSelected')}</div>
              <div>{t('optimizeCompare.scopeProtected')}</div>
              <div>{t('optimizeCompare.scopeManualApply')}</div>
            </div>
          </div>

          {/* Field selection */}
          <div>
            <div className="text-sm font-medium mb-2" style={{ color: 'var(--text-color)' }}>
              {t('optimizeCompare.selectFields')}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {visibleFields.map((field) => {
                const checked = selectedFields.has(field);
                return (
                  <label
                    key={field}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors hover:bg-white/5"
                    style={{
                      borderColor: checked ? 'var(--color-primary)' : BORDER,
                      background: checked ? 'rgba(99,102,241,.1)' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleField(field)}
                      className="accent-[var(--color-primary)]"
                    />
                    <span className="text-sm" style={{ color: 'var(--text-color)' }}>
                      {t(FIELD_LABEL_KEYS[field])}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Direction */}
          <div>
            <div className="text-sm font-medium mb-2" style={{ color: 'var(--text-color)' }}>
              {t('optimizeCompare.direction')}
            </div>
            <textarea
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              placeholder={t('optimizeCompare.directionPlaceholder')}
              rows={2}
              className="w-full rounded-lg border p-2 text-sm resize-none"
              style={{
                borderColor: BORDER,
                backgroundColor: 'var(--color-surface-base)',
                color: 'var(--text-color)',
              }}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('optimizeCompare.close')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleStartOptimize}
              disabled={selectedFields.size === 0}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {t('optimizeCompare.startOptimize')}
            </Button>
          </div>
        </div>
      )}

      {/* ── Phase: loading ──────────────────────────────────────────── */}
      {phase === 'loading' && (
        <div className="flex flex-col items-center justify-center py-10 gap-4">
          <style>{`
            @keyframes optimize-spin { to { transform: rotate(360deg); } }
            @keyframes optimize-pulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
          `}</style>
          <RefreshCw
            className="w-9 h-9"
            style={{ color: '#a78bfa', animation: 'optimize-spin 0.8s linear infinite' }}
          />
          <div className="text-center space-y-2">
            <p className="text-sm font-medium" style={{ color: 'var(--text-color)' }}>
              {loadingMode === 'lorebookBatch' ? '世界书分批优化中' : t('optimizeCompare.optimizing')}
            </p>
            {batchInfo && (
              <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs" style={{ borderColor: BORDER, background: 'rgba(99,102,241,.12)', color: '#c4b5fd', animation: 'optimize-pulse 1.4s ease-in-out infinite' }}>
                <span>当前第 {batchInfo.current} 批 / 共 {batchInfo.total} 批</span>
                <span>每批最多 10 条</span>
              </div>
            )}
            <p className="text-xs" style={{ color: FAINT }}>
              已运行 {elapsedSeconds}s，正在等待模型返回内容，请不要关闭窗口
            </p>
          </div>
          <div className="w-full max-w-3xl rounded-lg border p-3 text-xs font-mono whitespace-pre-wrap max-h-56 overflow-y-auto" style={{ borderColor: BORDER, background: 'rgba(15,23,42,.45)', color: MUTED }}>
            {streamPreview || (loadingMode === 'lorebookBatch' ? '正在准备世界书分批任务...' : '等待首个输出片段...')}
          </div>
        </div>
      )}

      {/* ── Phase: diff ─────────────────────────────────────────────── */}
      {phase === 'diff' && (
        <div className="space-y-3">
          {fieldDiffs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Check className="w-8 h-8" style={{ color: '#4ade80' }} />
              <div className="text-center space-y-1 max-w-md">
                <p className="text-sm" style={{ color: MUTED }}>
                  AI 已完成检修，未发现需要修改的问题
                </p>
                <p className="text-xs" style={{ color: FAINT }}>
                  当前选中的世界书条目结构正常，无需调整。如果仍有 V2 警告，请检查是否选择了正确的检修字段。
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPhase('config');
                  setError(null);
                }}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t('optimizeCompare.startOptimize')}
              </Button>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div
                className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ background: 'rgba(15,23,42,.4)', borderBottom: `1px solid ${BORDER}` }}
              >
                <span className="text-xs" style={{ color: MUTED }}>
                  {appliedFields.size} / {fieldDiffs.length} · {t('optimizeCompare.applied')}
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleApplyAll}
                  disabled={allApplied}
                >
                  <Check className="w-3.5 h-3.5" />
                  {allApplied ? t('optimizeCompare.allApplied') : t('optimizeCompare.applyAll')}
                </Button>
              </div>

              {/* Diff cards */}
              <div className="max-h-[65vh] overflow-y-auto space-y-2 pr-1">
                {fieldDiffs.map((diff) => (
                  <FieldDiffCard
                    key={diff.field}
                    diff={diff}
                    applied={appliedFields.has(diff.field)}
                    onApply={() => handleApplySingle(diff.field)}
                  />
                ))}
              </div>

              {/* Footer */}
              <div className="flex justify-end pt-2">
                <Button variant="ghost" size="sm" onClick={onClose}>
                  {t('optimizeCompare.close')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
