/**
 * QualityCheckPanel - rule-based card quality assessment with weighted scoring.
 *
 * Shows a 0-100 score ring, grouped check items with pass/fail, and an optional
 * AI deep diagnosis section. Failed items offer "go fix" (jump to wizard step)
 * and "AI optimize" (open the compare modal with preselected fields) actions.
 *
 * Reuses the collapse pattern from AIProgressPanel and validateCard/diagnoseCard
 * from existing services.
 */
import { useMemo, useState, useCallback } from 'react';
import { Check, X, AlertTriangle, ChevronDown, Sparkles, Wrench, RefreshCw } from 'lucide-react';
import { useTranslation } from '../../i18n/I18nContext';
import { useAIGenerate } from '../../hooks/useAIGenerate';
import { Button } from '../shared/Button';
import { assembleCard } from '../../services/card-exporter';
import {
  runQualityCheck,
  groupByCategory,
  scoreColor,
  buildQualityGuidance,
  type CheckCategory,
  type CheckSeverity,
  type QualityReport,
} from '../../services/quality-checker';
import type { WizardDraft } from '../../constants/defaults';

interface DiagnosisResult {
  overall_score: number;
  summary: string;
  categories: Array<{
    name: string;
    score: number;
    issues: string[];
    suggestions: string[];
  }>;
  highlights: string[];
}

interface QualityCheckPanelProps {
  draft: WizardDraft;
  onJumpToStep?: (step: number) => void;
  onOpenOptimize?: (preselectFields: string[]) => void;
}

export function QualityCheckPanel({ draft, onJumpToStep, onOpenOptimize }: QualityCheckPanelProps) {
  const { t } = useTranslation();
  const { diagnoseCard } = useAIGenerate();

  const report: QualityReport = useMemo(() => runQualityCheck(draft), [draft]);
  const grouped = useMemo(() => groupByCategory(report.results), [report]);
  const guidance = useMemo(() => buildQualityGuidance(report), [report]);

  const [collapsed, setCollapsed] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);

  const color = scoreColor(report.score);
  const colorHex = color === 'success' ? '#4ade80' : color === 'warning' ? '#fbbf24' : '#f87171';

  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (report.score / 100) * circumference;

  const categoryLabels: Record<CheckCategory, string> = {
    basic: t('qualityCheck.categoryBasic'),
    character: t('qualityCheck.categoryCharacter'),
    firstMessage: t('qualityCheck.categoryFirstMessage'),
    lorebook: t('qualityCheck.categoryLorebook'),
    mvu: t('qualityCheck.categoryMvu'),
    stagedMode: t('qualityCheck.categoryStagedMode'),
    spec: t('qualityCheck.categorySpec'),
  };

  const severityLabels: Record<CheckSeverity, string> = {
    critical: t('qualityCheck.severityCritical'),
    suggestion: t('qualityCheck.severitySuggestion'),
    optional: t('qualityCheck.severityOptional'),
  };

  const severityColors: Record<CheckSeverity, string> = {
    critical: '#f87171',
    suggestion: '#fbbf24',
    optional: '#a78bfa',
  };

  const toggleCategory = useCallback((cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const runDiagnosis = useCallback(async () => {
    setDiagnosing(true);
    setDiagnosisError(null);
    setDiagnosisOpen(true);
    setDiagnosis(null);
    try {
      const card = assembleCard(draft) as { data?: Record<string, unknown> } & Record<string, unknown>;
      const cardData = card.data ?? card;
      const result = (await diagnoseCard(cardData)) as DiagnosisResult | null;
      if (result) {
        setDiagnosis(result);
      } else {
        setDiagnosisError(t('qualityCheck.aiDiagnosisFailed'));
      }
    } catch (e) {
      setDiagnosisError(e instanceof Error ? e.message : t('qualityCheck.aiDiagnosisFailed'));
    } finally {
      setDiagnosing(false);
    }
  }, [draft, diagnoseCard, t]);

  const handleFix = useCallback(
    (step?: number) => {
      if (step && onJumpToStep) onJumpToStep(step);
    },
    [onJumpToStep],
  );

  const handleOptimize = useCallback(
    (fields?: string[]) => {
      if (onOpenOptimize) onOpenOptimize(fields || []);
    },
    [onOpenOptimize],
  );

  const borderColor = 'var(--color-border-default)';
  const mutedText = 'color-mix(in srgb, var(--text-color) 60%, transparent)';
  const faintText = 'color-mix(in srgb, var(--text-color) 40%, transparent)';

  return (
    <div className="rounded-xl border" style={{ borderColor, backgroundColor: 'rgba(15, 23, 42, 0.6)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none transition-colors hover:bg-white/5"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-3">
          {/* Score ring */}
          <svg width="56" height="56" viewBox="0 0 64 64" className="shrink-0">
            <circle cx="32" cy="32" r={radius} fill="none" stroke={borderColor} strokeWidth="6" />
            <circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              stroke={colorHex}
              strokeWidth="6"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform="rotate(-90 32 32)"
              style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease' }}
            />
            <text x="32" y="37" textAnchor="middle" fontSize="15" fontWeight="700" fill={colorHex}>
              {report.score}
            </text>
          </svg>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--text-color)' }}>
              {t('qualityCheck.title')}
            </div>
            <div className="text-xs" style={{ color: mutedText }}>
              {t('qualityCheck.scoreLabel')} · {report.passedCount}/{report.applicableCount} {t('qualityCheck.passed')} · {report.failedCount} {t('qualityCheck.failed')}
            </div>
          </div>
        </div>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          style={{ color: mutedText }}
        />
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="px-4 pb-4 space-y-3" style={{ borderTop: `1px solid ${borderColor}` }}>
          <div
            className="rounded-lg border px-3 py-2 mt-3 text-xs"
            style={{
              borderColor: guidance.status === 'blocked' ? 'rgba(248,113,113,.35)' : guidance.status === 'improvable' ? 'rgba(251,191,36,.35)' : 'rgba(74,222,128,.35)',
              background: guidance.status === 'blocked' ? 'rgba(248,113,113,.08)' : guidance.status === 'improvable' ? 'rgba(251,191,36,.08)' : 'rgba(74,222,128,.08)',
            }}
          >
            <div className="font-medium mb-1" style={{ color: guidance.status === 'blocked' ? '#f87171' : guidance.status === 'improvable' ? '#fbbf24' : '#4ade80' }}>
              {guidance.headline}
            </div>
            <div className="flex flex-wrap gap-1.5" style={{ color: mutedText }}>
              <span>{t('qualityCheck.severityCritical')}: {guidance.criticalCount}</span>
              <span>·</span>
              <span>{t('qualityCheck.severitySuggestion')}: {guidance.suggestionCount}</span>
              <span>·</span>
              <span>{t('qualityCheck.severityOptional')}: {guidance.optionalCount}</span>
            </div>
            {guidance.nextActions.length > 0 && (
              <div className="mt-2 space-y-1">
                <div className="text-[11px] font-medium" style={{ color: 'var(--text-color)' }}>
                  {t('qualityCheck.recommendedPath')}
                </div>
                {guidance.nextActions.map((action, i) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => action.jumpStep && handleFix(action.jumpStep)}
                    className="block w-full text-left rounded px-2 py-1 hover:bg-white/5"
                    style={{ color: mutedText }}
                  >
                    {i + 1}. {action.label} · {action.fixHint || action.threshold}
                  </button>
                ))}
              </div>
            )}
          </div>

          {report.failedCount === 0 ? (
            <div className="flex items-center gap-2 py-3 text-sm" style={{ color: '#4ade80' }}>
              <Check className="w-4 h-4" />
              {t('qualityCheck.noIssues')}
            </div>
          ) : (
            grouped.map((group) => {
              const isCollapsed = collapsedCategories.has(group.category);
              const hasFailed = group.items.some((r) => !r.passed);
              return (
                <div key={group.category} className="rounded-lg border" style={{ borderColor }}>
                  <div
                    className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
                    onClick={() => toggleCategory(group.category)}
                  >
                    <div className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--text-color)' }}>
                      <span>{categoryLabels[group.category]}</span>
                      <span style={{ color: hasFailed ? '#f87171' : '#4ade80' }}>
                        {group.items.filter((r) => r.passed).length}/{group.items.length}
                      </span>
                    </div>
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                      style={{ color: faintText }}
                    />
                  </div>
                  {!isCollapsed && (
                    <div className="px-3 pb-2 space-y-1.5">
                      {group.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-start gap-2 py-1.5 text-xs"
                          style={{ borderTop: `1px solid ${borderColor}` }}
                        >
                          <span className="shrink-0 mt-0.5">
                            {item.passed ? (
                              <Check className="w-3.5 h-3.5" style={{ color: '#4ade80' }} />
                            ) : (
                              <X className="w-3.5 h-3.5" style={{ color: '#f87171' }} />
                            )}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium" style={{ color: 'var(--text-color)' }}>
                                {item.label}
                              </span>
                              {!item.passed && (
                                <span
                                  className="rounded px-1.5 py-0.5 text-[10px]"
                                  style={{ color: severityColors[item.severity], background: `${severityColors[item.severity]}1a` }}
                                >
                                  {severityLabels[item.severity]}
                                </span>
                              )}
                              <span style={{ color: faintText }}>
                                {item.actual} / {item.threshold}
                              </span>
                            </div>
                            {!item.passed && item.fixHint && (
                              <div className="mt-1 flex items-start gap-1.5">
                                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" style={{ color: '#fbbf24' }} />
                                <span style={{ color: mutedText }}>{item.fixHint}</span>
                              </div>
                            )}
                            {!item.passed && (
                              <div className="flex items-center gap-1.5 mt-1.5">
                                {item.jumpStep && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleFix(item.jumpStep)}
                                    className="!px-2 !py-0.5 !text-[10px]"
                                  >
                                    <Wrench className="w-3 h-3" />
                                    {t('qualityCheck.fixButton')}
                                  </Button>
                                )}
                                {item.optimizeFields && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleOptimize(item.optimizeFields)}
                                    className="!px-2 !py-0.5 !text-[10px]"
                                  >
                                    <Sparkles className="w-3 h-3" />
                                    {t('qualityCheck.optimizeButton')}
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* AI Deep Diagnosis */}
          <div className="rounded-lg border" style={{ borderColor, backgroundColor: 'rgba(15, 23, 42, 0.4)' }}>
            <div
              className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
              onClick={() => setDiagnosisOpen(!diagnosisOpen)}
            >
              <div className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--text-color)' }}>
                <Sparkles className="w-3.5 h-3.5" style={{ color: '#a78bfa' }} />
                {t('qualityCheck.aiDiagnosis')}
              </div>
              <div className="flex items-center gap-2">
                {!diagnosisOpen && !diagnosing && !diagnosis && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      runDiagnosis();
                    }}
                    className="!px-2 !py-0.5 !text-[10px]"
                  >
                    <RefreshCw className="w-3 h-3" />
                    {t('qualityCheck.aiDiagnosis')}
                  </Button>
                )}
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${diagnosisOpen ? '' : 'rotate-180'}`}
                  style={{ color: faintText }}
                />
              </div>
            </div>
            {diagnosisOpen && (
              <div className="px-3 pb-3 space-y-2" style={{ borderTop: `1px solid ${borderColor}` }}>
                <p className="text-[11px] py-2" style={{ color: faintText }}>
                  {t('qualityCheck.aiDiagnosisHint')}
                </p>
                {diagnosing && (
                  <div className="flex items-center gap-2 py-3 text-xs" style={{ color: '#a78bfa' }}>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    {t('qualityCheck.aiDiagnosing')}
                  </div>
                )}
                {diagnosisError && !diagnosing && (
                  <div className="py-2 text-xs" style={{ color: '#f87171' }}>
                    {t('qualityCheck.aiDiagnosisFailed')}: {diagnosisError}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={runDiagnosis}
                      className="!ml-2 !px-2 !py-0.5 !text-[10px]"
                    >
                      <RefreshCw className="w-3 h-3" />
                      {t('common.regenerate')}
                    </Button>
                  </div>
                )}
                {diagnosis && !diagnosing && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs py-1">
                      <span style={{ color: mutedText }}>{t('qualityCheck.aiDiagnosisScore')}:</span>
                      <span className="font-bold text-base" style={{ color: colorHex }}>
                        {diagnosis.overall_score}
                      </span>
                      <span style={{ color: faintText }}>/ 100</span>
                    </div>
                    {diagnosis.summary && (
                      <p className="text-[11px] leading-relaxed" style={{ color: mutedText }}>
                        {diagnosis.summary}
                      </p>
                    )}
                    {diagnosis.categories.map((cat, i) => (
                      <div key={i} className="rounded border p-2" style={{ borderColor }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium" style={{ color: 'var(--text-color)' }}>
                            {cat.name}
                          </span>
                          <span
                            className="text-xs font-bold"
                            style={{
                              color: cat.score >= 80 ? '#4ade80' : cat.score >= 50 ? '#fbbf24' : '#f87171',
                            }}
                          >
                            {cat.score}
                          </span>
                        </div>
                        {cat.issues.length > 0 && (
                          <ul className="text-[11px] space-y-0.5 mb-1" style={{ color: '#f87171' }}>
                            {cat.issues.map((issue, j) => (
                              <li key={j} className="flex items-start gap-1">
                                <span>·</span>
                                <span>{issue}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {cat.suggestions.length > 0 && (
                          <div className="text-[11px] space-y-1" style={{ color: mutedText }}>
                            <div className="font-medium" style={{ color: '#a78bfa' }}>
                              {t('qualityCheck.suggestions')}:
                            </div>
                            {cat.suggestions.map((sug, j) => (
                              <div key={j} className="flex items-start gap-1.5">
                                <span className="shrink-0">·</span>
                                <span className="flex-1">{sug}</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleOptimize(['firstMessage', 'lorebookEntries'])}
                                  className="!px-1.5 !py-0 !text-[10px] shrink-0"
                                >
                                  <Sparkles className="w-2.5 h-2.5" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
