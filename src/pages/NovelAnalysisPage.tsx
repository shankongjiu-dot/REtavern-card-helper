import { useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Download, Sparkles, BookMarked } from 'lucide-react';
import { Button } from '../components/shared/Button';
import { TextArea } from '../components/shared/TextArea';
import { useTranslation } from '../i18n/I18nContext';
import {
  DEFAULT_NOVEL_OUTPUT_MAX_TOKENS,
  analyzeNovelTextStreaming,
  exportAnalysisAsJson,
  saveAnalysisLorebookImport,
  splitNovelText,
  type NovelAnalysisResult,
  type NovelChunk,
} from '../services/novel-analysis-service';

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
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-100">{value}</div>
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
  const streamPanelRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    const nextChunks = chunks.length > 0 ? chunks : splitNovelText(text);
    setChunks(nextChunks);
    if (nextChunks.length === 0) {
      setError(t('novel.errorNoText'));
      return;
    }

    setLoading(true);
    try {
      const result = await analyzeNovelTextStreaming(
        title,
        nextChunks,
        outputMaxTokens,
        (_chunk, fullText) => {
          setStreamingText(fullText);
          // Estimate progress: roughly based on character count versus expected output
          const estimatedChars = outputMaxTokens * 2; // rough: ~2 chars per token
          const pct = Math.min(Math.round((fullText.length / estimatedChars) * 100), 99);
          setProgressPercent(pct);
        },
      );
      setProgressPercent(100);
      setStreamingText('');
      setAnalysis(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('novel.analysisFailed'));
    } finally {
      setLoading(false);
    }
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
    saveAnalysisLorebookImport(title, analysis);
    navigate('/wizard?fromNovelAnalysis=1');
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

      <div className="rounded-2xl border border-emerald-700/30 bg-emerald-950/20 p-5 shadow-lg shadow-emerald-950/20">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BookMarked className="text-status-success" size={22} />
              <h1 className="text-2xl font-bold text-slate-100">{t('novel.title')}</h1>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              {t('novel.subtitle')}
            </p>
          </div>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <FileText size={16} /> {t('novel.uploadTxt')}
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4 rounded-xl border border-slate-700/50 bg-slate-900/35 p-4 backdrop-blur-sm">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">{t('novel.novelTitleLabel')}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('novel.titlePlaceholder')}
              className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-slate-300">{t('novel.tokenModeLabel')}</label>
              <span className="text-xs text-status-success">{t('novel.currentTokens', { count: outputMaxTokens.toLocaleString() })}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              {TOKEN_MODE_OPTIONS(t).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTokenMode(option.value)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${tokenMode === option.value ? 'border-emerald-500 bg-emerald-950/40 text-emerald-100' : 'border-slate-700 bg-slate-900/40 text-slate-300 hover:border-slate-500'}`}
                >
                  <div className="text-sm font-semibold">{option.label}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{option.value === 'custom' ? t('novel.manualFill') : `${option.tokens.toLocaleString()} tokens`}</div>
                  <div className="mt-1 text-[10px] text-slate-500">{option.description}</div>
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
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-500">{t('novel.customRangeHint')}</p>
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
            <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Streaming Monitoring Panel — “创作者无法介入” read-only dashboard */}
          {loading && (
            <div className="rounded-xl border-2 border-amber-600/50 bg-gradient-to-b from-amber-950/30 to-slate-950/60 overflow-hidden animate-fade-in">
              {/* Header bar */}
              <div className="flex items-center justify-between px-4 py-3 bg-amber-900/30 border-b border-amber-700/40">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                  </span>
                  <span className="text-sm font-bold text-amber-200">
                    <Sparkles size={14} className="inline mr-1" />
                    {t('novel.analyzing')}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-status-warning/80 font-mono">
                    {t('novel.elapsedTime', { time: `${Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:${(elapsedSeconds % 60).toString().padStart(2, '0')}` })}
                  </span>
                  <span className="text-status-warning/80 font-mono">
                    {t('novel.charCount', { count: String(streamingText.length) })}
                  </span>
                  <span className="text-status-warning font-bold text-sm">
                    {t('novel.progressPercent', { percent: String(progressPercent) })}
                  </span>
                </div>
              </div>
          
              {/* Progress bar */}
              <div className="px-4 pt-3">
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800/80 shadow-inner">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 via-yellow-400 to-emerald-500 transition-all duration-500 ease-out relative"
                    style={{ width: `${Math.max(progressPercent, 2)}%` }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
                  </div>
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-slate-500">
                  <span>{t('novel.start')}</span>
                  <span>{t('novel.approxChars', { count: Math.round(outputMaxTokens * 2).toLocaleString() })}</span>
                  <span>{t('novel.complete')}</span>
                </div>
              </div>
          
              {/* Streaming text preview — auto-scrolling */}
              <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-medium text-slate-400">{t('novel.liveOutput')}</span>
                  <span className="text-[10px] text-slate-600">{t('novel.autoScrollReadonly')}</span>
                </div>
                <div
                  ref={streamPanelRef}
                  className="h-56 overflow-y-auto rounded-lg border border-slate-700/50 bg-slate-950/70 p-3 scrollbar-thin scrollbar-thumb-slate-700"
                >
                  <pre className="whitespace-pre-wrap text-xs text-slate-300 leading-relaxed font-mono selection:bg-amber-500/30">
                    {streamingText || t('novel.waitingResponse')}
                  </pre>
                  {streamingText && (
                    <span className="inline-block w-2 h-4 bg-amber-400/80 animate-pulse ml-0.5 align-middle" />
                  )}
                </div>
              </div>
          
              {/* Footer — “创作者无法介入” */}
              <div className="px-4 py-2.5 bg-slate-900/50 border-t border-slate-700/30 text-center">
                <p className="text-[11px] text-amber-500/80">
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

          <div className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-4 backdrop-blur-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">{t('novel.chunkPreview')}</h2>
            {chunks.length === 0 ? (
              <p className="text-sm text-slate-500">{t('novel.noChunks')}</p>
            ) : (
              <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {chunks.slice(0, 20).map((chunk) => (
                  <div key={chunk.id} className="rounded-lg bg-slate-800/60 px-3 py-2 text-xs">
                    <div className="font-medium text-slate-200">#{chunk.id} {chunk.title}</div>
                    <div className="mt-1 text-slate-500">{t('novel.chunkChars', { count: String(chunk.content.length) })}</div>
                  </div>
                ))}
                {chunks.length > 20 && <div className="text-xs text-slate-500">{t('novel.showingTop20')}</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {analysis && (
        <div className="space-y-4 rounded-xl border border-slate-700/50 bg-slate-900/35 p-4 backdrop-blur-sm animate-fade-in-up">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{t('novel.analysisResult')}</h2>
            <p className="mt-1 text-sm text-slate-400">{analysis.genre} · {analysis.tone}</p>
          </div>

          <section>
            <h3 className="mb-2 text-sm font-medium text-status-success">{t('novel.summary')}</h3>
            <p className="whitespace-pre-wrap rounded-lg bg-slate-800/50 p-3 text-sm text-slate-300">{analysis.summary}</p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium text-status-success">{t('novel.styleProfile')}</h3>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg bg-slate-800/50 p-3 text-sm text-slate-300">
                <div className="font-medium text-slate-100">{t('novel.narration')}</div>
                <p className="mt-1 text-slate-400">{analysis.styleProfile.narration || t('novel.none')}</p>
              </div>
              <div className="rounded-lg bg-slate-800/50 p-3 text-sm text-slate-300">
                <div className="font-medium text-slate-100">{t('novel.dialogue')}</div>
                <p className="mt-1 text-slate-400">{analysis.styleProfile.dialogue || t('novel.none')}</p>
              </div>
              <div className="rounded-lg bg-slate-800/50 p-3 text-sm text-slate-300">
                <div className="font-medium text-slate-100">{t('novel.pacing')}</div>
                <p className="mt-1 text-slate-400">{analysis.styleProfile.pacing || t('novel.none')}</p>
              </div>
              <div className="rounded-lg bg-slate-800/50 p-3 text-sm text-slate-300">
                <div className="font-medium text-slate-100">{t('novel.imagery')}</div>
                <p className="mt-1 text-slate-400">{analysis.styleProfile.imagery || t('novel.none')}</p>
              </div>
            </div>
            {analysis.styleProfile.taboos.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-sm text-amber-200">
                {t('novel.taboos', { list: analysis.styleProfile.taboos.join('、') })}
              </div>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium text-status-success">{t('novel.characterHub')}</h3>
              <div className="space-y-2">
                {analysis.characters.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="rounded-lg border border-slate-700/40 bg-slate-800/40 p-3 text-sm">
                    <div className="font-semibold text-slate-100">{item.name} <span className="text-xs text-slate-500">{item.role}</span></div>
                    <div className="mt-1 text-slate-400">{t('novel.logicHub', { value: item.logicHub || t('novel.none') })}</div>
                    <div className="mt-1 text-slate-500">{t('novel.appearance', { value: item.appearance || t('novel.none') })}</div>
                    {item.outfits?.length > 0 && <div className="mt-1 text-slate-500">{t('novel.outfits', { value: item.outfits.map((outfit) => `${outfit.scene}：${outfit.description}`).join('；') })}</div>}
                    <div className="mt-1 text-slate-500">{t('novel.evidence', { value: item.evidence })}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-status-success">{t('novel.relationshipNetwork')}</h3>
              <div className="space-y-2">
                {analysis.relationshipMap.map((item, index) => (
                  <div key={`${item.source}-${item.target}-${index}`} className="rounded-lg border border-slate-700/40 bg-slate-800/40 p-3 text-sm">
                    <div className="font-semibold text-slate-100">{item.source} → {item.target}</div>
                    <div className="mt-1 text-slate-400">{t('novel.relationBond', { relation: item.relation, value: item.conflictOrBond })}</div>
                    <div className="mt-1 text-slate-500">{t('novel.storyFunction', { value: item.storyFunction })}</div>
                  </div>
                ))}
                {analysis.relationshipMap.length === 0 && <p className="text-sm text-slate-500">{t('novel.noRelationshipNetwork')}</p>}
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium text-status-success">{t('novel.uniqueSettings')}</h3>
              <div className="space-y-2">
                {analysis.uniqueSettings.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="rounded-lg border border-slate-700/40 bg-slate-800/40 p-3 text-sm">
                    <div className="font-semibold text-slate-100">{item.name} <span className="text-xs text-status-success">{item.category}</span></div>
                    <div className="mt-1 text-slate-400">{item.description}</div>
                    <div className="mt-1 text-slate-500">{t('novel.difference', { value: item.difference })}</div>
                    <div className="mt-1 text-slate-500">{t('novel.usage', { value: item.usage })}</div>
                  </div>
                ))}
                {analysis.uniqueSettings.length === 0 && <p className="text-sm text-slate-500">{t('novel.noUniqueSettings')}</p>}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-status-success">{t('novel.timeline')}</h3>
              <div className="space-y-2">
                {analysis.timeline.map((item) => (
                  <div key={item.order} className="rounded-lg border border-slate-700/40 bg-slate-800/40 p-3 text-sm">
                    <div className="font-semibold text-slate-100">{item.order}. {item.event}</div>
                    <div className="mt-1 text-slate-500">{t('novel.impact', { value: item.impact })}</div>
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
                  <span key={category} className="rounded-full bg-emerald-900/30 px-2 py-0.5 text-[11px] text-emerald-200">
                    {t('novel.categoryCount', { category, count: String(count) })}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {analysis.lorebookEntries.map((entry, index) => (
                <div key={`${entry.name}-${index}`} className="rounded-lg border border-slate-700/40 bg-slate-800/40 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-100">{entry.name}</span>
                    <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-status-success">{entry.category}</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">{t('novel.triggerWords', { keys: entry.keys?.join('、') })}</div>
                  {(entry.parent || entry.purpose) && (
                    <div className="mt-1 text-xs text-slate-500">
                      {entry.parent && <span>{t('novel.belongs', { value: entry.parent })}</span>}
                      {entry.parent && entry.purpose && <span>{t('novel.separator')}</span>}
                      {entry.purpose && <span>{t('novel.purpose', { value: entry.purpose })}</span>}
                    </div>
                  )}
                  <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-950/40 p-2 text-xs text-slate-300">{entry.content}</pre>
                </div>
              ))}
            </div>
          </section>

          {analysis.cleaningNotes.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-medium text-status-warning">{t('novel.cleaningNotes')}</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-400">
                {analysis.cleaningNotes.map((note, index) => <li key={index}>{note}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
