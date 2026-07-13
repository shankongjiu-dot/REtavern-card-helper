import { useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Download, Sparkles, BookMarked } from 'lucide-react';
import { Button } from '../components/shared/Button';
import { TextArea } from '../components/shared/TextArea';
import { useTranslation } from '../i18n/I18nContext';
import {
  DEFAULT_NOVEL_OUTPUT_MAX_TOKENS,
  analyzeNovelTextStreaming,
  analyzeNovelText,
  exportAnalysisAsJson,
  saveAnalysisLorebookImport,
  splitNovelText,
  NOVEL_ANALYSIS_PARTIAL_KEY,
  type NovelAnalysisResult,
  type NovelChunk,
} from '../services/novel-analysis-service';
import { pushAnalysisToWorkshop } from '../services/novel-workshop-bridge';
import { themeAlpha } from '../constants/theme';

const mutedText = 'color-mix(in srgb, var(--text-color) 60%, transparent)';
const faintText = 'color-mix(in srgb, var(--text-color) 40%, transparent)';
const cardBgSemiTransparent = 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.35)';
const cardBgStrongerSemiTransparent = 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.5)';
const cardBgHeavySemiTransparent = 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.7)';
const cardBgAlmostOpaque = 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.8)';

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'color-mix(in srgb, var(--color-border-default) 50%, transparent)', backgroundColor: cardBgSemiTransparent }}>
      <div className="text-[11px]" style={{ color: faintText }}>{label}</div>
      <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--text-color)' }}>{value}</div>
    </div>
  );
}

type TokenMode = 'standard' | 'large' | 'extreme' | 'custom';

const TOKEN_MODE_OPTIONS = (t: (key: string) => string): Array<{ value: TokenMode; label: string; tokens: number; description: string }> => [
  { value: 'standard', label: t('novel.standard'), tokens: DEFAULT_NOVEL_OUTPUT_MAX_TOKENS, description: t('novel.standardDesc') },
  { value: 'large', label: t('novel.large'), tokens: 32000, description: t('novel.largeDesc') },
  { value: 'extreme', label: t('novel.extreme'), tokens: 128000, description: t('novel.extremeDesc') },
  { value: 'custom', label: t('novel.custom'), tokens: DEFAULT_NOVEL_OUTPUT_MAX_TOKENS, description: t('novel.custom') },
];

function getTokenModeValue(mode: TokenMode, customTokens: number, t: (key: string) => string): number {
  if (mode === 'custom') return customTokens;
  return TOKEN_MODE_OPTIONS(t).find((option) => option.value === mode)?.tokens ?? DEFAULT_NOVEL_OUTPUT_MAX_TOKENS;
}

export function NovelAnalysisPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [chunks, setChunks] = useState<NovelChunk[]>([]);
  const [analysis, setAnalysis] = useState<NovelAnalysisResult | null>(null);
  const [tokenMode, setTokenMode] = useState<TokenMode>('standard');
  const [customOutputTokens, setCustomOutputTokens] = useState(DEFAULT_NOVEL_OUTPUT_MAX_TOKENS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [stallWarning, setStallWarning] = useState(false);
  const [stallCritical, setStallCritical] = useState(false);
  const [showDownloadRaw, setShowDownloadRaw] = useState(false);
  const [partialRawText, setPartialRawText] = useState<string | null>(null);
  const streamPanelRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStreamUpdateRef = useRef<number>(Date.now());
  const shouldAbortRef = useRef(false);
  const streamingTextRef = useRef(streamingText);

  useEffect(() => {
    streamingTextRef.current = streamingText;
  }, [streamingText]);

  // Auto-scroll streaming text to bottom
  useEffect(() => {
    if (streamPanelRef.current) {
      streamPanelRef.current.scrollTop = streamPanelRef.current.scrollHeight;
    }
  }, [streamingText]);

  // Elapsed timer during analysis
  useEffect(() => {
    if (loading) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loading]);

  // Stall detection: warn if no new content for 60s, critical at 120s
  useEffect(() => {
    if (!loading) {
      setStallWarning(false);
      setStallCritical(false);
      return;
    }
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastStreamUpdateRef.current;
      if (elapsed > 120000) {
        setStallCritical(true);
      } else if (elapsed > 60000) {
        setStallWarning(true);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [loading]);

  const totalChars = useMemo(() => text.trim().length, [text]);
  const outputMaxTokens = useMemo(() => getTokenModeValue(tokenMode, customOutputTokens, t), [tokenMode, customOutputTokens, t]);
  const lorebookCategoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    analysis?.lorebookEntries.forEach((entry) => {
      const category = entry.category || t('novel.material');
      counts[category] = (counts[category] || 0) + 1;
    });
    return counts;
  }, [analysis, t]);

  const handleChunk = () => {
    setError('');
    setAnalysis(null);
    const nextChunks = splitNovelText(text);
    setChunks(nextChunks);
    if (nextChunks.length === 0) setError(t('novel.errorNoText'));
  };

  const handleAnalyze = async () => {
    setError('');
    setStreamingText('');
    setProgressPercent(0);
    setShowDownloadRaw(false);
    setPartialRawText(null);
    setStallWarning(false);
    setStallCritical(false);
    shouldAbortRef.current = false;
    lastStreamUpdateRef.current = Date.now();
    const nextChunks = chunks.length > 0 ? chunks : splitNovelText(text);
    setChunks(nextChunks);
    if (nextChunks.length === 0) {
      setError(t('novel.errorNoText'));
      return;
    }

    setLoading(true);
    let streamingSucceeded = false;
    try {
      const result = await analyzeNovelTextStreaming(
        title,
        nextChunks,
        outputMaxTokens,
        (_chunk, fullText) => {
          if (shouldAbortRef.current) {
            throw new Error('用户中止了分析');
          }
          lastStreamUpdateRef.current = Date.now();
          setStallWarning(false);
          setStallCritical(false);
          setStreamingText(fullText);
          streamingTextRef.current = fullText;
          const estimatedChars = outputMaxTokens * 2;
          const pct = Math.min(Math.round((fullText.length / estimatedChars) * 100), 99);
          setProgressPercent(pct);
        },
      );
      setProgressPercent(100);
      setStreamingText('');
      setAnalysis(result);
      streamingSucceeded = true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : t('novel.analysisFailed');
      const isAborted = errMsg.includes('用户中止');

      // Save partial streaming text if available. Use a ref so we always read the
      // latest accumulated text even when the error is thrown from an async callback
      // that saw a stale React state snapshot.
      const currentStreaming = streamingTextRef.current;
      if (currentStreaming && currentStreaming.length > 100) {
        try { sessionStorage.setItem(NOVEL_ANALYSIS_PARTIAL_KEY, currentStreaming); } catch {}
        setPartialRawText(currentStreaming);
      }

      if (isAborted) {
        setError('已中止分析。' + (currentStreaming ? '已保存已接收的内容，可点击下方按钮下载。' : ''));
        if (currentStreaming) setShowDownloadRaw(true);
      } else if (errMsg.includes('无法解析为 JSON')) {
        setError('AI 返回的内容格式不对，没法直接使用。你可以下载 AI 写的内容看看，或者重新分析一次。');
        setShowDownloadRaw(true);
      } else {
        // Try non-streaming fallback
        setError('AI 处理失败，正在换一种方式重试…');
        try {
          const fallbackResult = await analyzeNovelText(title, nextChunks, outputMaxTokens);
          setAnalysis(fallbackResult);
          setError('');
          streamingSucceeded = true;
        } catch (fallbackErr) {
          const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : '未知错误';
          const rawHint = currentStreaming ? '已保存部分内容，可点击下方按钮下载。' : '';
          const jsonHint = fallbackMsg.includes('无法解析为 JSON') ? ' AI 写的内容已保存，可点击下方按钮下载。' : '';
          if (fallbackMsg.includes('无法解析为 JSON') || currentStreaming) {
            setShowDownloadRaw(true);
          }
          const userFriendlyMsg = fallbackMsg.includes('无法解析为 JSON')
            ? 'AI 返回的内容格式不对'
            : fallbackMsg;
          setError(`分析失败：${userFriendlyMsg}${rawHint || jsonHint}`);
        }
      }
    } finally {
      setLoading(false);
      if (streamingSucceeded) {
        try { sessionStorage.removeItem(NOVEL_ANALYSIS_PARTIAL_KEY); } catch {}
      }
    }
  };

  const handleAbort = () => {
    shouldAbortRef.current = true;
  };

  const handleDownloadRaw = () => {
    const rawText = partialRawText || sessionStorage.getItem(NOVEL_ANALYSIS_PARTIAL_KEY) || '';
    if (!rawText) return;
    const blob = new Blob([rawText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'novel-analysis'}-raw.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = async (file: File) => {
    setError('');
    setAnalysis(null);
    try {
      const content = await file.text();
      setText(content);
      setTitle(file.name.replace(/\.[^.]+$/, ''));
      setChunks(splitNovelText(content));
    } catch (err) {
      setError(err instanceof Error ? `文件读取失败：${err.message}` : t('novel.analysisFailed'));
    }
  };

  const handleExport = () => {
    if (!analysis) return;
    downloadText(`${title || 'novel-analysis'}.json`, exportAnalysisAsJson(title, chunks, analysis));
  };

  const handleImportToWizard = () => {
    if (!analysis) return;
    try {
      saveAnalysisLorebookImport(title, analysis);
      navigate('/wizard?fromNovelAnalysis=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出到创建向导失败');
    }
  };

  const handlePushToWorkshop = () => {
    if (!analysis) return;
    try {
      pushAnalysisToWorkshop(title, text, analysis);
      navigate('/novel-workshop');
    } catch (err) {
      setError(err instanceof Error ? err.message : '推送到小说工坊失败');
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5 animate-fade-in">
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,text/plain,text/markdown"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <div className="rounded-2xl border p-5 shadow-lg" style={{ borderColor: themeAlpha('success', 30), backgroundColor: themeAlpha('success', 12), boxShadow: `0 10px 15px -3px ${themeAlpha('success', 12)}` }}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BookMarked className="text-status-success" size={22} />
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-color)' }}>{t('novel.title')}</h1>
            </div>
            <p className="mt-2 text-sm" style={{ color: mutedText }}>
              {t('novel.subtitle')}
            </p>
          </div>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <FileText size={16} /> {t('novel.uploadTxt')}
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4 rounded-xl border p-4 backdrop-blur-sm" style={{ borderColor: 'color-mix(in srgb, var(--color-border-default) 50%, transparent)', backgroundColor: cardBgSemiTransparent }}>
          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--text-color)' }}>{t('novel.novelTitleLabel')}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('novel.titlePlaceholder')}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--input-bg)', color: 'var(--text-color)' }}
            />
          </div>

          <div className="rounded-lg border p-3" style={{ borderColor: 'color-mix(in srgb, var(--color-border-default) 50%, transparent)', backgroundColor: cardBgSemiTransparent }}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="text-sm font-medium" style={{ color: 'var(--text-color)' }}>{t('novel.tokenModeLabel')}</label>
              <span className="text-xs text-status-success">{t('novel.currentTokens', { count: outputMaxTokens.toLocaleString() })}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              {TOKEN_MODE_OPTIONS(t).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTokenMode(option.value)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${tokenMode === option.value ? '' : ''}`}
                  style={tokenMode === option.value ? {
                    borderColor: 'var(--color-status-success)',
                    backgroundColor: themeAlpha('success', 12),
                    color: 'var(--text-color)',
                  } : {
                    borderColor: 'var(--color-border-default)',
                    backgroundColor: cardBgSemiTransparent,
                    color: 'var(--text-color)',
                  }}
                  onMouseEnter={(e) => {
                    if (tokenMode === option.value) return;
                    e.currentTarget.style.borderColor = 'var(--color-text-secondary)';
                  }}
                  onMouseLeave={(e) => {
                    if (tokenMode === option.value) return;
                    e.currentTarget.style.borderColor = 'var(--color-border-default)';
                  }}
                >
                  <div className="text-sm font-semibold">{option.label}</div>
                  <div className="mt-0.5 text-[11px]" style={{ color: faintText }}>{option.value === 'custom' ? t('novel.manualFill') : `${option.tokens.toLocaleString()} tokens`}</div>
                  <div className="mt-1 text-[10px]" style={{ color: faintText }}>{option.description}</div>
                </button>
              ))}
            </div>
            {tokenMode === 'custom' && (
              <div className="mt-3">
                <input
                  type="number"
                  min={4000}
                  max={300000}
                  step={1000}
                  value={customOutputTokens}
                  onChange={(e) => setCustomOutputTokens(parseInt(e.target.value) || DEFAULT_NOVEL_OUTPUT_MAX_TOKENS)}
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--input-bg)', color: 'var(--text-color)' }}
                />
                <p className="mt-1 text-[11px]" style={{ color: faintText }}>{t('novel.customRangeHint')}</p>
              </div>
            )}
          </div>

          <TextArea
            label={t('novel.textAreaLabel')}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setAnalysis(null);
              setChunks([]);
            }}
            placeholder={t('novel.textAreaPlaceholder')}
            className="min-h-[360px]"
          />

          {error && (
            <div className="rounded-lg border p-3 text-sm" style={{ borderColor: themeAlpha('danger', 35), backgroundColor: themeAlpha('danger', 12), color: 'var(--color-status-danger)' }}>
              {error}
            </div>
          )}

          {showDownloadRaw && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleDownloadRaw}>
                <Download size={16} /> 下载 AI 写的内容
              </Button>
            </div>
          )}

          {/* Streaming Monitoring Panel — “创作者无法介入” read-only dashboard */}
          {loading && (
            <div className="rounded-xl border-2 overflow-hidden animate-fade-in"
              style={{ borderColor: themeAlpha('warning', 50), background: `linear-gradient(to bottom, ${themeAlpha('warning', 12)}, rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.6))` }}>
              {/* Header bar */}
              <div className="flex items-center justify-between px-4 py-3 border-b"
                style={{ backgroundColor: themeAlpha('warning', 12), borderColor: themeAlpha('warning', 35) }}>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: 'var(--color-status-warning)' }}></span>
                    <span className="relative inline-flex rounded-full h-3 w-3" style={{ backgroundColor: 'var(--color-status-warning)' }}></span>
                  </span>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-color)' }}>
                    <Sparkles size={14} className="inline mr-1" />
                    {t('novel.analyzing')}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-mono" style={{ color: themeAlpha('warning', 80) }}>
                    {t('novel.elapsedTime', { time: `${Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:${(elapsedSeconds % 60).toString().padStart(2, '0')}` })}
                  </span>
                  <span className="font-mono" style={{ color: themeAlpha('warning', 80) }}>
                    {t('novel.charCount', { count: String(streamingText.length) })}
                  </span>
                  <span className="font-bold text-sm text-status-warning">
                    {t('novel.progressPercent', { percent: String(progressPercent) })}
                  </span>
                </div>
              </div>

              {/* Stall warning */}
              {stallWarning && !stallCritical && (
                <div className="px-4 py-2 text-sm flex items-center gap-2" style={{ backgroundColor: themeAlpha('warning', 15), color: 'var(--color-status-warning)' }}>
                  ⚠️ AI 已超过 60 秒没有新内容输出，可能卡住了。请耐心等待，或等到 120 秒后强制停止。
                </div>
              )}
              {stallCritical && (
                <div className="px-4 py-2 flex items-center justify-between gap-3" style={{ backgroundColor: themeAlpha('danger', 15) }}>
                  <span className="text-sm" style={{ color: 'var(--color-status-danger)' }}>
                    🔴 AI 已超过 120 秒没有新内容输出，建议强制停止以节省时间和费用。
                  </span>
                  <button
                    type="button"
                    onClick={handleAbort}
                    className="rounded-lg px-3 py-1.5 text-sm font-bold text-white"
                    style={{ backgroundColor: 'var(--color-status-danger)' }}
                  >
                    强制停止
                  </button>
                </div>
              )}

              {/* Progress bar */}
              <div className="px-4 pt-3">
                <div className="h-3 w-full overflow-hidden rounded-full shadow-inner" style={{ backgroundColor: cardBgAlmostOpaque }}>
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out relative"
                    style={{
                      width: `${Math.max(progressPercent, 2)}%`,
                      background: `linear-gradient(to right, var(--color-status-warning), color-mix(in srgb, var(--color-status-success) 50%, var(--color-status-warning) 50%), var(--color-status-success))`,
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent to-transparent animate-pulse"
                      style={{ backgroundImage: `linear-gradient(to right, transparent, color-mix(in srgb, var(--text-color) 20%, transparent), transparent)` }} />
                  </div>
                </div>
                <div className="flex justify-between mt-1 text-[10px]" style={{ color: faintText }}>
                  <span>{t('novel.start')}</span>
                  <span>{t('novel.approxChars', { count: Math.round(outputMaxTokens * 2).toLocaleString() })}</span>
                  <span>{t('novel.complete')}</span>
                </div>
              </div>

              {/* Streaming text preview — auto-scrolling */}
              <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-medium" style={{ color: mutedText }}>{t('novel.liveOutput')}</span>
                  <span className="text-[10px]" style={{ color: faintText }}>{t('novel.autoScrollReadonly')}</span>
                </div>
                <div
                  ref={streamPanelRef}
                  className="h-56 overflow-y-auto rounded-lg border p-3 scrollbar-thin"
                  style={{ borderColor: 'color-mix(in srgb, var(--color-border-default) 50%, transparent)', backgroundColor: cardBgHeavySemiTransparent }}
                >
                  <pre className="whitespace-pre-wrap text-xs leading-relaxed font-mono" style={{ color: 'var(--text-color)' }}>
                    {streamingText || t('novel.waitingResponse')}
                  </pre>
                  {streamingText && (
                    <span className="inline-block w-2 h-4 animate-pulse ml-0.5 align-middle" style={{ backgroundColor: themeAlpha('warning', 80) }} />
                  )}
                </div>
              </div>

              {/* Footer — “创作者无法介入” */}
              <div className="px-4 py-2.5 border-t text-center" style={{ backgroundColor: cardBgSemiTransparent, borderColor: 'color-mix(in srgb, var(--color-border-default) 30%, transparent)' }}>
                <p className="text-[11px]" style={{ color: themeAlpha('warning', 80) }}>
                  {t('novel.noIntervene')}
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleChunk} disabled={!text.trim()}>
              {t('novel.smartChunk')}
            </Button>
            <Button onClick={handleAnalyze} disabled={loading || !text.trim()}>
              <Sparkles size={16} /> {loading ? t('novel.analyzingButton') : t('novel.aiAnalyze')}
            </Button>
            <Button variant="ghost" onClick={handleExport} disabled={!analysis}>
              <Download size={16} /> {t('novel.exportResult')}
            </Button>
            <Button variant="secondary" onClick={handleImportToWizard} disabled={!analysis || (analysis?.lorebookEntries.length ?? 0) === 0}>
              {t('novel.importToWorldBook')}
            </Button>
            <Button variant="secondary" onClick={handlePushToWorkshop} disabled={!analysis}>
              {t('novel.pushToWorkshop')}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            <Stat label={t('novel.statTotalChars')} value={totalChars} />
            <Stat label={t('novel.statChunks')} value={chunks.length} />
            <Stat label={t('novel.statOutputLimit')} value={outputMaxTokens.toLocaleString()} />
            <Stat label={t('novel.statCharacters')} value={analysis?.characters.length ?? '-'} />
            <Stat label={t('novel.statLorebookEntries')} value={analysis?.lorebookEntries.length ?? '-'} />
            <Stat label={t('novel.statRelationships')} value={analysis?.relationshipMap.length ?? '-'} />
            <Stat label={t('novel.statUniqueSettings')} value={analysis?.uniqueSettings.length ?? '-'} />
          </div>

          <div className="rounded-xl border p-4 backdrop-blur-sm" style={{ borderColor: 'color-mix(in srgb, var(--color-border-default) 50%, transparent)', backgroundColor: cardBgSemiTransparent }}>
            <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-color)' }}>{t('novel.chunkPreview')}</h2>
            {chunks.length === 0 ? (
              <p className="text-sm" style={{ color: faintText }}>{t('novel.noChunks')}</p>
            ) : (
              <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {chunks.slice(0, 20).map((chunk) => (
                  <div key={chunk.id} className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: cardBgStrongerSemiTransparent }}>
                    <div className="font-medium" style={{ color: 'var(--text-color)' }}>#{chunk.id} {chunk.title}</div>
                    <div className="mt-1" style={{ color: faintText }}>{t('novel.chunkChars', { count: String(chunk.content.length) })}</div>
                  </div>
                ))}
                {chunks.length > 20 && <div className="text-xs" style={{ color: faintText }}>{t('novel.showingTop20')}</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {analysis && (
        <div className="space-y-4 rounded-xl border p-4 backdrop-blur-sm animate-fade-in-up" style={{ borderColor: 'color-mix(in srgb, var(--color-border-default) 50%, transparent)', backgroundColor: cardBgSemiTransparent }}>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-color)' }}>{t('novel.analysisResult')}</h2>
            <p className="mt-1 text-sm" style={{ color: mutedText }}>{analysis.genre} · {analysis.tone}</p>
          </div>

          <section>
            <h3 className="mb-2 text-sm font-medium text-status-success">{t('novel.summary')}</h3>
            <p className="whitespace-pre-wrap rounded-lg p-3 text-sm" style={{ backgroundColor: cardBgStrongerSemiTransparent, color: 'var(--color-text-secondary)' }}>{analysis.summary}</p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium text-status-success">{t('novel.styleProfile')}</h3>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg p-3 text-sm" style={{ backgroundColor: cardBgStrongerSemiTransparent, color: 'var(--color-text-secondary)' }}>
                <div className="font-medium" style={{ color: 'var(--text-color)' }}>{t('novel.narration')}</div>
                <p className="mt-1" style={{ color: mutedText }}>{analysis.styleProfile.narration || t('novel.none')}</p>
              </div>
              <div className="rounded-lg p-3 text-sm" style={{ backgroundColor: cardBgStrongerSemiTransparent, color: 'var(--color-text-secondary)' }}>
                <div className="font-medium" style={{ color: 'var(--text-color)' }}>{t('novel.dialogue')}</div>
                <p className="mt-1" style={{ color: mutedText }}>{analysis.styleProfile.dialogue || t('novel.none')}</p>
              </div>
              <div className="rounded-lg p-3 text-sm" style={{ backgroundColor: cardBgStrongerSemiTransparent, color: 'var(--color-text-secondary)' }}>
                <div className="font-medium" style={{ color: 'var(--text-color)' }}>{t('novel.pacing')}</div>
                <p className="mt-1" style={{ color: mutedText }}>{analysis.styleProfile.pacing || t('novel.none')}</p>
              </div>
              <div className="rounded-lg p-3 text-sm" style={{ backgroundColor: cardBgStrongerSemiTransparent, color: 'var(--color-text-secondary)' }}>
                <div className="font-medium" style={{ color: 'var(--text-color)' }}>{t('novel.imagery')}</div>
                <p className="mt-1" style={{ color: mutedText }}>{analysis.styleProfile.imagery || t('novel.none')}</p>
              </div>
            </div>
            {analysis.styleProfile.taboos.length > 0 && (
              <div className="mt-3 rounded-lg border p-3 text-sm" style={{ borderColor: themeAlpha('warning', 35), backgroundColor: themeAlpha('warning', 12), color: 'var(--color-status-warning)' }}>
                {t('novel.taboos', { list: analysis.styleProfile.taboos.join('、') })}
              </div>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium text-status-success">{t('novel.characterHub')}</h3>
              <div className="space-y-2">
                {analysis.characters.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="rounded-lg border p-3 text-sm" style={{ borderColor: 'color-mix(in srgb, var(--color-border-default) 40%, transparent)', backgroundColor: cardBgSemiTransparent }}>
                    <div className="font-semibold" style={{ color: 'var(--text-color)' }}>{item.name} <span className="text-xs" style={{ color: faintText }}>{item.role}</span></div>
                    <div className="mt-1" style={{ color: mutedText }}>{t('novel.logicHub', { value: item.logicHub || t('novel.none') })}</div>
                    <div className="mt-1" style={{ color: faintText }}>{t('novel.appearance', { value: item.appearance || t('novel.none') })}</div>
                    {item.outfits?.length > 0 && <div className="mt-1" style={{ color: faintText }}>{t('novel.outfits', { value: item.outfits.map((outfit) => `${outfit.scene}：${outfit.description}`).join('；') })}</div>}
                    <div className="mt-1" style={{ color: faintText }}>{t('novel.evidence', { value: item.evidence })}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-status-success">{t('novel.relationshipNetwork')}</h3>
              <div className="space-y-2">
                {analysis.relationshipMap.map((item, index) => (
                  <div key={`${item.source}-${item.target}-${index}`} className="rounded-lg border p-3 text-sm" style={{ borderColor: 'color-mix(in srgb, var(--color-border-default) 40%, transparent)', backgroundColor: cardBgSemiTransparent }}>
                    <div className="font-semibold" style={{ color: 'var(--text-color)' }}>{item.source} → {item.target}</div>
                    <div className="mt-1" style={{ color: mutedText }}>{t('novel.relationBond', { relation: item.relation, value: item.conflictOrBond })}</div>
                    <div className="mt-1" style={{ color: faintText }}>{t('novel.storyFunction', { value: item.storyFunction })}</div>
                  </div>
                ))}
                {analysis.relationshipMap.length === 0 && <p className="text-sm" style={{ color: faintText }}>{t('novel.noRelationshipNetwork')}</p>}
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium text-status-success">{t('novel.uniqueSettings')}</h3>
              <div className="space-y-2">
                {analysis.uniqueSettings.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="rounded-lg border p-3 text-sm" style={{ borderColor: 'color-mix(in srgb, var(--color-border-default) 40%, transparent)', backgroundColor: cardBgSemiTransparent }}>
                    <div className="font-semibold" style={{ color: 'var(--text-color)' }}>{item.name} <span className="text-xs text-status-success">{item.category}</span></div>
                    <div className="mt-1" style={{ color: mutedText }}>{item.description}</div>
                    <div className="mt-1" style={{ color: faintText }}>{t('novel.difference', { value: item.difference })}</div>
                    <div className="mt-1" style={{ color: faintText }}>{t('novel.usage', { value: item.usage })}</div>
                  </div>
                ))}
                {analysis.uniqueSettings.length === 0 && <p className="text-sm" style={{ color: faintText }}>{t('novel.noUniqueSettings')}</p>}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-status-success">{t('novel.timeline')}</h3>
              <div className="space-y-2">
                {analysis.timeline.map((item) => (
                  <div key={item.order} className="rounded-lg border p-3 text-sm" style={{ borderColor: 'color-mix(in srgb, var(--color-border-default) 40%, transparent)', backgroundColor: cardBgSemiTransparent }}>
                    <div className="font-semibold" style={{ color: 'var(--text-color)' }}>{item.order}. {item.event}</div>
                    <div className="mt-1" style={{ color: faintText }}>{t('novel.impact', { value: item.impact })}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-sm font-medium text-status-success">{t('novel.lorebookEntries')}</h3>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(lorebookCategoryCounts).map(([category, count]) => (
                  <span key={category} className="rounded-full px-2 py-0.5 text-[11px]" style={{ backgroundColor: themeAlpha('success', 12), color: 'var(--color-status-success)' }}>
                    {t('novel.categoryCount', { category, count: String(count) })}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {analysis.lorebookEntries.map((entry, index) => (
                <div key={`${entry.name}-${index}`} className="rounded-lg border p-3" style={{ borderColor: 'color-mix(in srgb, var(--color-border-default) 40%, transparent)', backgroundColor: cardBgSemiTransparent }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold" style={{ color: 'var(--text-color)' }}>{entry.name}</span>
                    <span className="rounded px-1.5 py-0.5 text-[10px] text-status-success" style={{ backgroundColor: themeAlpha('success', 12) }}>{entry.category}</span>
                  </div>
                  <div className="mt-2 text-xs" style={{ color: faintText }}>{t('novel.triggerWords', { keys: entry.keys?.join('、') })}</div>
                  {(entry.parent || entry.purpose) && (
                    <div className="mt-1 text-xs" style={{ color: faintText }}>
                      {entry.parent && <span>{t('novel.belongs', { value: entry.parent })}</span>}
                      {entry.parent && entry.purpose && <span>{t('novel.separator')}</span>}
                      {entry.purpose && <span>{t('novel.purpose', { value: entry.purpose })}</span>}
                    </div>
                  )}
                  <pre className="mt-2 whitespace-pre-wrap rounded p-2 text-xs" style={{ backgroundColor: 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.6)', color: 'var(--color-text-secondary)' }}>{entry.content}</pre>
                </div>
              ))}
            </div>
          </section>

          {analysis.cleaningNotes.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-medium text-status-warning">{t('novel.cleaningNotes')}</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm" style={{ color: mutedText }}>
                {analysis.cleaningNotes.map((note, index) => <li key={index}>{note}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
