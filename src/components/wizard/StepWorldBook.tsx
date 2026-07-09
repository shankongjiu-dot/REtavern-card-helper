/**
 * Step 3: World Book / Lorebook entries.
 * Full SillyTavern V2 + runtime parameter support (CardForge reference).
 */
import { useMemo, useState } from 'react';
import { Button } from '../shared/Button';
import { useToast } from '../shared/Toast';
import { AIProgressPanel, type AIProgressStatus } from '../shared/AIProgressPanel';
import { LorebookEntryEditor, type EntryExpandLevel } from './LorebookEntryEditor';
import { useTranslation } from '../../i18n/I18nContext';
import { AIGeneratePanel } from './AIGeneratePanel';
import { OrganizePreviewTable } from './OrganizePreviewTable';
import { useAIGenerate } from '../../hooks/useAIGenerate';
import { createEmptyLorebookEntry, MVU_LOREBOOK_ENTRY_NAMES } from '../../constants/defaults';
import type { LorebookEntry, LorebookPosition, AIOrganizeSuggestion, MvuConfig } from '../../constants/defaults';
import { findStagedLorebookEntryIndices } from '../../services/card-exporter';

const POSITION_ORDER: Record<LorebookPosition, number> = {
  before_char: 0,
  after_char: 1,
  before_example: 2,
  after_example: 3,
  before_author: 4,
  after_author: 5,
  at_depth: 6,
};

/** Sort lorebook entries by position group first, then insertion_order. */
function sortLorebookEntries(entries: LorebookEntry[]): LorebookEntry[] {
  return [...entries].sort((a, b) => {
    const posA = POSITION_ORDER[a.position ?? 'after_char'];
    const posB = POSITION_ORDER[b.position ?? 'after_char'];
    if (posA !== posB) return posA - posB;
    return (a.insertion_order ?? 100) - (b.insertion_order ?? 100);
  });
}

function getProtectedEntryLabel(entry: LorebookEntry, idx: number, stagedIndices: Set<number>): string | null {
  const name = (entry.name || '').trim();
  const comment = (entry.comment || '').trim();
  if (MVU_LOREBOOK_ENTRY_NAMES.includes(name) || MVU_LOREBOOK_ENTRY_NAMES.includes(comment)) return 'MVU 系统';
  if (stagedIndices.has(idx)) return '分阶段';
  return null;
}

interface StepWorldBookProps {
  entries: LorebookEntry[];
  cardName: string;
  characterSummaries: string;
  existingWorldbookContext: string;
  onUpdate: (entries: LorebookEntry[]) => void;
  /** Whether NSFW content generation is allowed for world book entries */
  nsfw?: boolean;
  onNsfwChange?: (nsfw: boolean) => void;
  /** MVU config — used to show EJS indicators on entries */
  mvu?: MvuConfig;
}

export function StepWorldBook({ entries, cardName, characterSummaries, existingWorldbookContext, onUpdate, nsfw, onNsfwChange }: StepWorldBookProps) {
  const { t } = useTranslation();
  const [generating, setGenerating] = useState(false);
  const [topic, setTopic] = useState('');
  const [worldRules, setWorldRules] = useState('');
  // Skeleton mode
  const [skeletonMode, setSkeletonMode] = useState(false);
  const [skeletonCount, setSkeletonCount] = useState(8);
  // Full mode batch count
  const [batchCount, setBatchCount] = useState(8);
  // AI organize state
  const [organizing, setOrganizing] = useState(false);
  const [organizeResults, setOrganizeResults] = useState<AIOrganizeSuggestion[] | null>(null);
  // AI key generation state
  const [generatingKeys, setGeneratingKeys] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [stagedGroupOpen, setStagedGroupOpen] = useState(false);
  // Streaming progress
  const [aiStatus, setAiStatus] = useState<AIProgressStatus>('idle');
  const [streamText, setStreamText] = useState('');
  // AI expand state
  const [expandingIndex, setExpandingIndex] = useState<number | null>(null);
  // Collapse state: Map of entry ID → expand level
  const [expandLevels, setExpandLevels] = useState<Map<string, EntryExpandLevel>>(new Map());
  const { generateLorebookParsedStreaming, generateLorebookSkeletonStreaming, organizeEntries, generateEntryKeys, expandLorebookEntry } = useAIGenerate();
  const { addToast } = useToast();
  const stagedIndices = useMemo(() => {
    try {
      return findStagedLorebookEntryIndices(entries);
    } catch {
      return new Set<number>();
    }
  }, [entries]);

  const setEntryLevel = (id: string, level: EntryExpandLevel) => {
    setExpandLevels(prev => {
      const next = new Map(prev);
      if (level === 'collapsed') {
        next.delete(id);
      } else {
        next.set(id, level);
      }
      return next;
    });
  };

  const applyEntryView = (level: EntryExpandLevel) => {
    setExpandLevels(level === 'collapsed' ? new Map() : new Map(entries.map(e => [e.id, level])));
  };

  const addEntry = () => {
    onUpdate([...entries, createEmptyLorebookEntry()]);
  };

  const removeEntry = (index: number) => {
    onUpdate(entries.filter((_, i) => i !== index));
  };

  const updateEntry = (index: number, updates: Partial<LorebookEntry>) => {
    onUpdate(entries.map((e, i) => (i === index ? { ...e, ...updates } : e)));
  };

  const handleBatchGenerate = async () => {
    setGenerating(true);
    setAiStatus('generating');
    setStreamText('');
    const consistencyRules = [
      worldRules,
      existingWorldbookContext ? `${t('worldBook.existingWorldbookHeader')}\n${existingWorldbookContext}` : '',
    ].filter(Boolean).join('\n\n');
    try {
      if (skeletonMode) {
        // ── Skeleton mode: batch generation in groups of 5 ──
        let allSkeletons: Array<{ comment: string; content: string; keys: string[]; strategy: string }> = [];
        let remaining = skeletonCount;
        let batchIndex = 0;

        while (remaining > 0) {
          const batchSize = Math.min(remaining, 5);
          batchIndex++;
          const existingTitles = allSkeletons.map((s) => s.comment).join('、');
          const batchMarker = t('worldBook.batchMarker', { index: String(batchIndex), count: String(remaining) });
          if (remaining < skeletonCount) {
            setStreamText(prev => prev + `\n\n── ${batchMarker} ──\n`);
          }
          const skeletons = await generateLorebookSkeletonStreaming(
            cardName, characterSummaries, topic, batchSize, existingTitles,
            (_chunk, fullText) => setStreamText(prev => {
              // Replace current batch's streaming portion
              const lastMarker = prev.lastIndexOf('── ');
              if (lastMarker >= 0) {
                const before = prev.slice(0, lastMarker);
                const markerLine = prev.slice(lastMarker).split('\n')[0];
                return before + markerLine + '\n' + fullText;
              }
              return fullText;
            }),
            consistencyRules || undefined,
          );
          allSkeletons = [...allSkeletons, ...skeletons];
          remaining -= batchSize;
          if (remaining > 0) await new Promise((r) => setTimeout(r, 300));
        }

        // Convert skeletons to lorebook entries
        const newEntries = allSkeletons.map((sk) => ({
          ...createEmptyLorebookEntry(),
          name: sk.comment.replace(/^=+|=+$/g, '').trim() || sk.comment,
          comment: sk.comment,
          content: sk.content,
          keys: sk.keys,
          constant: sk.strategy === 'constant',
          position: 'after_char' as LorebookPosition,
          insertion_order: 100,
          priority: 50,
          probability: 100,
          depth: 4,
        })) as LorebookEntry[];

        onUpdate(sortLorebookEntries([...entries, ...newEntries]));
        // Auto-collapse newly generated entries (show as collapsed)
        setExpandLevels(prev => {
          const next = new Map(prev);
          newEntries.forEach(e => next.set(e.id, 'collapsed'));
          return next;
        });
        addToast('success', t('worldBook.skeletonGeneratedToast', { count: String(newEntries.length) }));
      } else {
        // ── Full mode: streaming with live preview ──
        const result = await generateLorebookParsedStreaming(
          cardName, characterSummaries, topic, batchCount,
          (_chunk, fullText) => setStreamText(fullText),
          consistencyRules || undefined, nsfw,
        );
        if (Array.isArray(result) && result.length > 0) {
          const newEntries = result.map((item) => {
            const base = createEmptyLorebookEntry();
            const secondaryKeys = item.secondary_keys || [];
            return {
              ...base,
              name: item.name || '',
              keys: item.keys || [],
              secondary_keys: secondaryKeys,
              content: item.content || '',
              comment: item.comment || item.name || '',
              constant: item.constant ?? false,
              selective: secondaryKeys.length > 0 ? item.selective ?? false : false,
              insertion_order: item.insertion_order ?? 100,
              position: item.position ?? 'after_char',
              priority: item.priority ?? 50,
              probability: item.probability ?? 100,
              group: item.group || '',
              group_weight: item.group_weight ?? 100,
              selectiveLogic: item.selectiveLogic ?? 0,
              role: item.role ?? 0,
              depth: item.depth ?? 4,
              exclude_recursion: item.exclude_recursion ?? false,
              prevent_recursion: item.prevent_recursion ?? false,
              use_regex: item.use_regex ?? false,
              match_whole_words: item.match_whole_words ?? true,
              sticky: item.sticky ?? 0,
              cooldown: item.cooldown ?? 0,
              delay: item.delay ?? 0,
              ignore_budget: item.ignore_budget ?? false,
            } as LorebookEntry;
          });
          onUpdate(sortLorebookEntries([...entries, ...newEntries]));
          // Auto-collapse newly generated entries (show as collapsed)
          setExpandLevels(prev => {
            const next = new Map(prev);
            newEntries.forEach(e => next.set(e.id, 'collapsed'));
            return next;
          });
          addToast('success', t('worldBook.entriesGeneratedToast', { count: String(newEntries.length) }));
        } else {
          addToast('error', t('worldBook.parseFailedToast'));
        }
      }
      setAiStatus('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknownError');
      setAiStatus('error');
      setStreamText(msg);
      addToast('error', t('worldBook.generateFailedToast', { message: msg }));
    } finally {
      setGenerating(false);
    }
  };

  // ── AI Expand single entry ──────────────────────────────────────────
  const handleExpandEntry = async (index: number) => {
    const entry = entries[index];
    if (!entry) return;

    setExpandingIndex(index);
    try {
      const result = await expandLorebookEntry(
        {
          comment: entry.comment || entry.name || '',
          content: entry.content,
          keys: entry.keys,
          strategy: entry.constant ? 'constant' : 'selective',
          position: entry.insertion_order,
        },
        existingWorldbookContext
          ? `${characterSummaries}\n\n${t('worldBook.existingWorldbookHeaderBrief')}\n${existingWorldbookContext}`
          : characterSummaries,
        undefined,
        entry.expandNsfw,
      );
      updateEntry(index, {
        comment: result.comment,
        content: result.content,
        keys: result.keys,
        constant: result.strategy === 'constant',
      });
      addToast('success', t('worldBook.expandDone', { name: result.comment || entry.name }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknownError');
      addToast('error', t('worldBook.expandFailed', { message: msg }));
    } finally {
      setExpandingIndex(null);
    }
  };

  // ── AI Organize handler ────────────────────────────────────────
  const handleOrganize = async () => {
    if (entries.length === 0) return;
    setOrganizing(true);
    try {
      const results = await organizeEntries(entries.map((e, i) => ({
        index: i,
        name: e.name || e.comment || t('lorebook.entryFallback', { index: String(i + 1) }),
        content: e.content,
        keys: e.keys,
        position: e.position,
        insertion_order: e.insertion_order,
        depth: e.depth,
        probability: e.probability,
        constant: e.constant,
      })));
      setOrganizeResults(results.length > 0 ? results : null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknownError');
      addToast('error', t('worldBook.organizeFailed', { message: msg }));
    } finally {
      setOrganizing(false);
    }
  };

  const applyOrganize = () => {
    if (!organizeResults) return;
    const updated = [...entries];
    for (const r of organizeResults) {
      if (r.index >= 0 && r.index < updated.length) {
        const entry = { ...updated[r.index] };
        if (r.position !== undefined) entry.position = r.position as LorebookPosition;
        if (r.insertion_order !== undefined) entry.insertion_order = r.insertion_order;
        if (r.depth !== undefined) entry.depth = r.depth;
        if (r.probability !== undefined) entry.probability = r.probability;
        if (r.constant !== undefined) entry.constant = r.constant;
        updated[r.index] = entry;
      }
    }
    onUpdate(sortLorebookEntries(updated));
    setOrganizeResults(null);
  };

  // ── AI Key Generation handler ──────────────────────────────────
  const handleGenerateKeys = async () => {
    const needsKeys = entries
      .map((e, i) => ({ entry: e, index: i }))
      .filter(({ entry }) => entry.content?.trim() && entry.keys.length < 2);
    if (needsKeys.length === 0) return;

    setGeneratingKeys(true);
    try {
      const results = await generateEntryKeys(needsKeys.map(({ entry, index }) => ({
        index,
        name: entry.name || entry.comment || t('lorebook.entryFallback', { index: String(index + 1) }),
        content: entry.content,
        existingKeys: entry.keys,
      })));
      if (results.length > 0) {
        const updated = [...entries];
        for (const r of results) {
          if (r.index >= 0 && r.index < updated.length && Array.isArray(r.keys)) {
            const existing = new Set(updated[r.index].keys);
            const merged = [...updated[r.index].keys, ...r.keys.filter(k => !existing.has(k))];
            updated[r.index] = { ...updated[r.index], keys: merged };
          }
        }
        onUpdate(updated);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknownError');
      addToast('error', t('worldBook.keysFailed', { message: msg }));
    } finally {
      setGeneratingKeys(false);
    }
  };

  const cleanupEmptyEntries = () => {
    const updated = entries.filter(e => e.content?.trim() || e.name?.trim() || e.keys.length > 0);
    onUpdate(updated);
    addToast('success', t('worldBook.cleanupDone', { count: String(entries.length - updated.length) }));
  };

  const sortEntries = () => {
    onUpdate(sortLorebookEntries(entries));
    addToast('success', t('worldBook.sortDone'));
  };

  const disableEmptyKeyEntries = () => {
    const updated = entries.map(e => (!e.constant && e.keys.length === 0 ? { ...e, enabled: false } : e));
    const count = entries.filter(e => !e.constant && e.keys.length === 0 && e.enabled).length;
    onUpdate(updated);
    addToast('success', t('worldBook.disabledCount', { count: String(count) }));
  };

  const enableAllEntries = () => {
    onUpdate(entries.map(e => ({ ...e, enabled: true })));
    addToast('success', t('worldBook.enabledAll'));
  };

  const q = searchQuery.trim().toLowerCase();
  const visibleEntries = q
    ? entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => {
      const text = [entry.name, entry.comment, entry.content, entry.keys.join(' '), entry.secondary_keys.join(' ')].join(' ').toLowerCase();
      return text.includes(q);
    })
    : entries.map((entry, index) => ({ entry, index }));
  const regularVisibleEntries = visibleEntries.filter(({ index }) => !stagedIndices.has(index));
  const stagedVisibleEntries = visibleEntries.filter(({ index }) => stagedIndices.has(index));

  const renderEntry = ({ entry, index }: { entry: LorebookEntry; index: number }) => {
    const protectedLabel = getProtectedEntryLabel(entry, index, stagedIndices);
    return (
      <div key={entry.id} className="relative">
        {protectedLabel && (
          <div className="mb-1 flex items-center gap-1.5 text-[10px] text-slate-400">
            <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-violet-300">{protectedLabel}</span>
            <span>{t('worldBook.protectedEntryHint')}</span>
          </div>
        )}
        <LorebookEntryEditor
          entry={entry}
          index={index}
          onUpdate={updateEntry}
          onRemove={removeEntry}
          expandLevel={expandLevels.get(entry.id) ?? 'collapsed'}
          onSetLevel={(level) => setEntryLevel(entry.id, level)}
          expanding={expandingIndex === index}
          onAiExpand={() => handleExpandEntry(index)}
        />
      </div>
    );
  };

  return (
    <div>
      {/* Batch tools bar */}
      {entries.length > 0 && (
        <div className="space-y-3 mb-4">
          <div className="flex flex-col gap-2 p-3 rounded-lg bg-slate-900/40 border border-slate-700/50 sm:flex-row sm:flex-wrap sm:items-center">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('worldBook.searchPlaceholder')}
              className="w-full min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-[var(--color-primary)] focus:outline-none sm:min-w-[220px]"
            />
            <Button variant="ghost" size="sm" onClick={sortEntries}>{t('worldBook.sortByOrder')}</Button>
            <Button variant="ghost" size="sm" onClick={enableAllEntries}>{t('worldBook.enableAll')}</Button>
            <Button variant="ghost" size="sm" onClick={disableEmptyKeyEntries}>{t('worldBook.disableEmptyKeys')}</Button>
            <Button variant="ghost" size="sm" onClick={cleanupEmptyEntries}>{t('worldBook.cleanupEmpty')}</Button>
            <div className="flex items-center gap-1 rounded-lg border border-slate-700/60 bg-slate-950/35 p-1">
              <button type="button" onClick={() => applyEntryView('collapsed')} className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200">紧凑</button>
              <button type="button" onClick={() => applyEntryView('preview')} className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200">摘要</button>
              <button type="button" onClick={() => applyEntryView('edit')} className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200">编辑</button>
            </div>
          </div>
          {searchQuery && (
            <p className="text-[11px] text-slate-500">{t('worldBook.searchResults', { visible: String(visibleEntries.length), total: String(entries.length) })}</p>
          )}
        </div>
      )}

      {/* AI Tools bar */}
      {entries.length > 0 && (
        <div className="flex flex-col gap-2 mb-4 p-3 rounded-lg bg-amber-900/10 border border-amber-700/30 sm:flex-row sm:flex-wrap sm:items-center">
          <span className="text-xs text-amber-300 font-medium shrink-0">🧹 {t('worldBook.aiToolsLabel')}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleOrganize}
            disabled={organizing || generatingKeys}
          >
            {organizing ? t('worldBook.organizing') : `⚡ ${t('worldBook.smartOrganize')}`}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleGenerateKeys}
            disabled={generatingKeys || organizing}
          >
            {generatingKeys ? t('worldBook.generatingKeys') : `🗝️ ${t('worldBook.generateKeys')}`}
          </Button>
          <span className="text-[10px] text-slate-500 ml-auto">
            {t('worldBook.aiToolsHint')}
          </span>
        </div>
      )}

      {/* Organize preview table */}
      {organizeResults && organizeResults.length > 0 && (
        <OrganizePreviewTable
          entries={entries}
          suggestions={organizeResults}
          onApply={applyOrganize}
          onDismiss={() => setOrganizeResults(null)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">{t('worldBook.title')}</h2>
          <p className="text-sm text-slate-400 mt-1">
            {t('worldBook.headerCount', { count: String(entries.length) })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={addEntry}>+ {t('worldBook.addEntry')}</Button>
        </div>
      </div>

      {/* AI Generate Panel - always visible */}
      <AIGeneratePanel
        topic={topic}
        worldRules={worldRules}
        generating={generating}
        onTopicChange={setTopic}
        onWorldRulesChange={setWorldRules}
        cardName={cardName}
        characterSummaries={characterSummaries}
        existingWorldbookContext={existingWorldbookContext}
        skeletonMode={skeletonMode}
        skeletonCount={skeletonCount}
        batchCount={batchCount}
        onSkeletonModeChange={setSkeletonMode}
        onSkeletonCountChange={setSkeletonCount}
        onBatchCountChange={setBatchCount}
        onGenerate={handleBatchGenerate}
        nsfw={nsfw}
        onNsfwChange={onNsfwChange}
      />

      {/* Streaming progress panel */}
      {aiStatus !== 'idle' && (
        <div className="mb-6">
          <AIProgressPanel
            status={aiStatus}
            text={streamText}
            title={t(skeletonMode ? 'aiPanel.skeletonGenerationTitle' : 'aiPanel.worldBookGenerationTitle')}
            onClear={() => { setAiStatus('idle'); setStreamText(''); }}
          />
        </div>
      )}

      {entries.length === 0 && (
        <div className="text-center py-12 text-slate-500 border border-dashed border-slate-700 rounded-xl">
          <p>{t('worldBook.emptyEntriesTitle')}</p>
          <p className="text-sm mt-1">{t('worldBook.emptyEntriesHint')}</p>
        </div>
      )}

      <div className="space-y-2 sm:space-y-3">
        {regularVisibleEntries.map(renderEntry)}

        {stagedVisibleEntries.length > 0 && (
          <section className="rounded-xl border border-violet-500/25 bg-violet-500/5">
            <button
              type="button"
              onClick={() => setStagedGroupOpen(open => !open)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] text-violet-300 transition-transform ${stagedGroupOpen ? 'rotate-90' : ''}`}>&#x25B6;</span>
                  <h3 className="text-sm font-semibold text-violet-200">阶段性世界书</h3>
                  <span className="rounded-full border border-violet-400/25 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-300">
                    {stagedVisibleEntries.length} 条
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">分阶段模式生成的世界书条目，默认折叠以减少页面长度</p>
              </div>
              <span className="shrink-0 rounded-lg border border-violet-400/20 px-2 py-1 text-[11px] text-violet-300">
                {stagedGroupOpen ? '收起' : '展开'}
              </span>
            </button>
            {stagedGroupOpen && (
              <div className="space-y-2 border-t border-violet-500/20 p-3 sm:space-y-3">
                {stagedVisibleEntries.map(renderEntry)}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}