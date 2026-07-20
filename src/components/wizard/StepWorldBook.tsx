/**
 * Step World Book / Lorebook entries — shared between Step 2 (skeleton) and Step 4 (detail).
 * Full SillyTavern V2 + runtime parameter support (CardForge reference).
 */
import { useMemo, useState } from 'react';
import { Button } from '../shared/Button';
import { useToast } from '../shared/Toast';
import { AIProgressPanel, type AIProgressStatus } from '../shared/AIProgressPanel';
import { LorebookEntryEditor, type EntryExpandLevel } from './LorebookEntryEditor';
import { useTranslation } from '../../i18n/I18nContext';
import { AIGeneratePanel } from './AIGeneratePanel';
import { WorldAnchorPanel } from './WorldAnchorPanel';
import { OrganizePreviewTable } from './OrganizePreviewTable';
import { useAIGenerate } from '../../hooks/useAIGenerate';
import { themeAlpha } from '../../constants/theme';
import { createEmptyLorebookEntry, MVU_LOREBOOK_ENTRY_NAMES } from '../../constants/defaults';
import type { LorebookEntry, LorebookPosition, AIOrganizeSuggestion, MvuConfig, WorldAnchor } from '../../constants/defaults';
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
  onEntriesChange: (entries: LorebookEntry[]) => void;
  /** Controlled world rules text — persisted in draft */
  worldRules?: string;
  onWorldRulesChange?: (worldRules: string) => void;
  /** Character context for detail mode (full descriptions after characters are generated) */
  characterContext?: string;
  /** Mode: skeleton = step 2 (before characters), detail = step 4 (after characters) */
  mode?: 'skeleton' | 'detail';
  /** Whether NSFW content generation is allowed for world book entries */
  nsfw?: boolean;
  onNsfwChange?: (nsfw: boolean) => void;
  /** 世界观锚定 — 结构化约束 */
  worldAnchor?: WorldAnchor;
  onWorldAnchorChange?: (anchor: WorldAnchor) => void;
  /** MVU config — used to show EJS indicators on entries (detail mode only) */
  mvu?: MvuConfig;
  // ── Shared UI state between Step 2 (skeleton) & Step 4 (detail) ──
  // When provided, these controlled values are persisted to the draft so that
  // navigating back & forth between step 2 and step 4 preserves the user's
  // topic, counts and mode toggle. Falls back to local state when not provided
  // (e.g. legacy callers).
  /** Controlled topic input — shared between step 2 & step 4 */
  topicValue?: string;
  onTopicChangePersist?: (topic: string) => void;
  /** Controlled skeleton entry count — shared between step 2 & step 4 */
  skeletonCountValue?: number;
  onSkeletonCountPersist?: (count: number) => void;
  /** Controlled full-mode batch count — shared between step 2 & step 4 */
  batchCountValue?: number;
  onBatchCountPersist?: (count: number) => void;
  /** Controlled skeleton-mode toggle (step 4 only — step 2 is always skeleton) */
  skeletonModeValue?: boolean;
  onSkeletonModePersist?: (mode: boolean) => void;
  /** Cross-step navigation callback — wired from WizardPage's setCurrentStep.
   *  Lets the skeleton/detail banner jump directly to the linked step so users
   *  can quickly flip back & forth without losing context. */
  onJumpToStep?: (step: number) => void;
  // Legacy props kept for backward compat during transition
  cardName?: string;
  characterSummaries?: string;
  existingWorldbookContext?: string;
  onUpdate?: (entries: LorebookEntry[]) => void;
}

export function StepWorldBook({
  entries,
  onEntriesChange,
  worldRules: externalWorldRules = '',
  onWorldRulesChange,
  characterContext,
  mode = 'detail',
  nsfw,
  onNsfwChange,
  worldAnchor,
  onWorldAnchorChange,
  mvu,
  // Shared controlled UI state (step 2 ↔ step 4)
  topicValue: externalTopic,
  onTopicChangePersist,
  skeletonCountValue: externalSkeletonCount,
  onSkeletonCountPersist,
  batchCountValue: externalBatchCount,
  onBatchCountPersist,
  skeletonModeValue: externalSkeletonMode,
  onSkeletonModePersist,
  onJumpToStep,
  // Legacy
  cardName: legacyCardName,
  characterSummaries: legacyCharacterSummaries,
  existingWorldbookContext: legacyExistingContext,
  onUpdate: legacyOnUpdate,
}: StepWorldBookProps) {
  const { t } = useTranslation();
  const [generating, setGenerating] = useState(false);
  // topic: prefer external controlled value, fallback to local state
  const [localTopic, setLocalTopic] = useState('');
  const topic = externalTopic !== undefined ? externalTopic : localTopic;
  const setTopic = onTopicChangePersist || setLocalTopic;
  // worldRules: prefer external controlled value, fallback to local state
  const [localWorldRules, setLocalWorldRules] = useState('');
  const effectiveWorldRules = onWorldRulesChange ? externalWorldRules : localWorldRules;
  const setWorldRules = onWorldRulesChange || setLocalWorldRules;
  // Skeleton mode: default true in skeleton mode step.
  // When controlled (step 4), use external value; otherwise local state.
  const [localSkeletonMode, setLocalSkeletonMode] = useState(mode === 'skeleton');
  const skeletonMode = externalSkeletonMode !== undefined ? externalSkeletonMode : localSkeletonMode;
  const setSkeletonMode = onSkeletonModePersist || setLocalSkeletonMode;
  // Skeleton count: shared between step 2 & step 4
  const [localSkeletonCount, setLocalSkeletonCount] = useState(mode === 'skeleton' ? 8 : 6);
  const skeletonCount = externalSkeletonCount !== undefined ? externalSkeletonCount : localSkeletonCount;
  const setSkeletonCount = onSkeletonCountPersist || setLocalSkeletonCount;
  // Full mode batch count: shared between step 2 & step 4
  const [localBatchCount, setLocalBatchCount] = useState(8);
  const batchCount = externalBatchCount !== undefined ? externalBatchCount : localBatchCount;
  const setBatchCount = onBatchCountPersist || setLocalBatchCount;
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

  // Unified entry update handler (supports both new and legacy APIs)
  const handleUpdateEntries = onEntriesChange || legacyOnUpdate || (() => {});
  // Unified character context (prefer new API)
  const effectiveCharacterContext = characterContext ?? legacyCharacterSummaries ?? '';
  // Effective card name
  const effectiveCardName = legacyCardName ?? '';
  // Effective existing context
  const effectiveExistingContext = legacyExistingContext ?? '';
  const C = {
    text: 'var(--text-color)',
    secondary: 'var(--color-text-secondary)',
    muted: 'var(--color-text-muted)',
    border: 'var(--color-border-default)',
    inputBg: 'var(--input-bg)',
    inputBorder: 'var(--input-border)',
    surface: 'var(--color-surface-raised)',
    primary: 'var(--color-primary)',
    info: 'var(--color-info)',
    success: 'var(--color-status-success)',
    warning: 'var(--color-status-warning)',
  } as const;
  const surfaceA = (n: number) => `color-mix(in srgb, ${C.surface} ${n}%, transparent)`;
  const borderA = (n: number) => `color-mix(in srgb, ${C.border} ${n}%, transparent)`;
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
    handleUpdateEntries([...entries, createEmptyLorebookEntry()]);
  };

  const removeEntry = (index: number) => {
    handleUpdateEntries(entries.filter((_, i) => i !== index));
  };

  const updateEntry = (index: number, updates: Partial<LorebookEntry>) => {
    handleUpdateEntries(entries.map((e, i) => (i === index ? { ...e, ...updates } : e)));
  };

  const handleBatchGenerate = async () => {
    setGenerating(true);
    setAiStatus('generating');
    setStreamText('');
    const consistencyRules = [
      effectiveWorldRules,
      effectiveExistingContext ? `${t('worldBook.existingWorldbookHeader')}\n${effectiveExistingContext}` : '',
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
            effectiveCardName, effectiveCharacterContext, topic, batchSize, existingTitles,
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
          // Mark as skeleton-origin so Step 4 can show a 🦴 badge and track
          // expansion progress. Cleared on AI-expand success.
          fromSkeleton: true,
          skeletonExpanded: false,
        })) as LorebookEntry[];

        handleUpdateEntries(sortLorebookEntries([...entries, ...newEntries]));
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
          effectiveCardName, effectiveCharacterContext, topic, batchCount,
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
          handleUpdateEntries(sortLorebookEntries([...entries, ...newEntries]));
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
        effectiveExistingContext
          ? `${effectiveCharacterContext}\n\n${t('worldBook.existingWorldbookHeaderBrief')}\n${effectiveExistingContext}`
          : effectiveCharacterContext,
        undefined,
        entry.expandNsfw,
      );
      updateEntry(index, {
        comment: result.comment,
        content: result.content,
        keys: result.keys,
        constant: result.strategy === 'constant',
        // Mark skeleton as expanded so the badge flips from 🦴 → ✅.
        skeletonExpanded: true,
      });
      addToast('success', t('worldBook.expandDone', { name: result.comment || entry.name }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknownError');
      addToast('error', t('worldBook.expandFailed', { message: msg }));
    } finally {
      setExpandingIndex(null);
    }
  };

  // ── Batch AI Expand: expand every un-expanded skeleton entry sequentially ──
  // Used by the "一键展开所有未展开骨架" button in step 4's skeleton progress row.
  // Runs expansions one-by-one to avoid API rate limits and so each result feeds
  // into the next call's `effectiveExistingContext` for cross-entry consistency.
  const [batchExpanding, setBatchExpanding] = useState(false);
  const [batchExpandProgress, setBatchExpandProgress] = useState({ current: 0, total: 0 });
  const handleBatchExpandSkeletons = async () => {
    // Snapshot the targets — only entries flagged as skeleton-origin AND not yet expanded.
    const targets: number[] = [];
    entries.forEach((e, i) => {
      if (e.fromSkeleton && !e.skeletonExpanded && e.content?.trim()) targets.push(i);
    });
    if (targets.length === 0) return;

    setBatchExpanding(true);
    setBatchExpandProgress({ current: 0, total: targets.length });
    let successCount = 0;
    let failCount = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        const idx = targets[i];
        setBatchExpandProgress({ current: i + 1, total: targets.length });
        setExpandingIndex(idx);
        try {
          const entry = entries[idx];
          if (!entry) continue;
          const result = await expandLorebookEntry(
            {
              comment: entry.comment || entry.name || '',
              content: entry.content,
              keys: entry.keys,
              strategy: entry.constant ? 'constant' : 'selective',
              position: entry.insertion_order,
            },
            effectiveExistingContext
              ? `${effectiveCharacterContext}\n\n${t('worldBook.existingWorldbookHeaderBrief')}\n${effectiveExistingContext}`
              : effectiveCharacterContext,
            undefined,
            entry.expandNsfw,
          );
          updateEntry(idx, {
            comment: result.comment,
            content: result.content,
            keys: result.keys,
            constant: result.strategy === 'constant',
            skeletonExpanded: true,
          });
          successCount++;
        } catch {
          failCount++;
        }
        // Small delay between API calls to avoid rate limiting
        if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 300));
      }
      if (successCount > 0 && failCount > 0) {
        addToast('success', t('worldBook.batchExpandPartial', { success: String(successCount), fail: String(failCount) }));
      } else if (successCount > 0) {
        addToast('success', t('worldBook.batchExpandDone', { count: String(successCount) }));
      } else if (failCount > 0) {
        addToast('error', t('worldBook.batchExpandAllFailed', { count: String(failCount) }));
      }
    } finally {
      setExpandingIndex(null);
      setBatchExpanding(false);
      setBatchExpandProgress({ current: 0, total: 0 });
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
    handleUpdateEntries(sortLorebookEntries(updated));
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
        handleUpdateEntries(updated);
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
    handleUpdateEntries(updated);
    addToast('success', t('worldBook.cleanupDone', { count: String(entries.length - updated.length) }));
  };

  const sortEntries = () => {
    handleUpdateEntries(sortLorebookEntries(entries));
    addToast('success', t('worldBook.sortDone'));
  };

  const disableEmptyKeyEntries = () => {
    const updated = entries.map(e => (!e.constant && e.keys.length === 0 ? { ...e, enabled: false } : e));
    const count = entries.filter(e => !e.constant && e.keys.length === 0 && e.enabled).length;
    handleUpdateEntries(updated);
    addToast('success', t('worldBook.disabledCount', { count: String(count) }));
  };

  const enableAllEntries = () => {
    handleUpdateEntries(entries.map(e => ({ ...e, enabled: true })));
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
    const ejsConfig = mvu?.enabled ? mvu.ejsConfigs.find(c => c.entryId === entry.id) : undefined;
    const isUnexpandedSkeleton = entry.fromSkeleton === true && entry.skeletonExpanded !== true;
    const isExpandedSkeleton = entry.fromSkeleton === true && entry.skeletonExpanded === true;
    const showBadges = !!(protectedLabel || ejsConfig || isUnexpandedSkeleton || isExpandedSkeleton);
    return (
      <div key={entry.id} className="relative">
        {showBadges && (
          <div className="mb-1 flex items-center gap-1.5 text-[10px]" style={{ color: C.secondary }}>
            {protectedLabel && (
              <span className="rounded border px-1.5 py-0.5" style={{ borderColor: themeAlpha('primary', 30), backgroundColor: themeAlpha('primary', 10), color: C.primary }}>{protectedLabel}</span>
            )}
            {isUnexpandedSkeleton && (
              <span
                className="rounded border px-1.5 py-0.5"
                style={{ borderColor: themeAlpha('warning', 40), backgroundColor: themeAlpha('warning', 12), color: C.warning }}
                title={t('worldBook.skeletonBadgeTooltip')}
              >
                🦴 {t('worldBook.skeletonBadge')}
              </span>
            )}
            {isExpandedSkeleton && (
              <span
                className="rounded border px-1.5 py-0.5"
                style={{ borderColor: themeAlpha('success', 35), backgroundColor: themeAlpha('success', 10), color: C.success }}
                title={t('worldBook.expandedBadgeTooltip')}
              >
                ✅ {t('worldBook.expandedBadge')}
              </span>
            )}
            {ejsConfig && (
              <span className="rounded border px-1.5 py-0.5" style={{ borderColor: themeAlpha('info', 30), backgroundColor: themeAlpha('info', 10), color: C.info }}>EJS · {ejsConfig.complexity}</span>
            )}
            {protectedLabel && <span>{t('worldBook.protectedEntryHint')}</span>}
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
      {/* ── Skeleton ↔ Detail continuity banner ──────────────────────────
          In skeleton mode: tell the user their setup flows to step 4.
          In detail mode: summarize what was set up in step 2, or warn if empty. */}
      {mode === 'skeleton' ? (
        <div
          className="mb-4 rounded-xl border p-3 flex items-start gap-3"
          style={{ backgroundColor: themeAlpha('success', 8), borderColor: themeAlpha('success', 25) }}
        >
          <span className="text-base shrink-0" aria-hidden>🦴</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold" style={{ color: C.success }}>{t('worldBook.skeletonFlowTitle')}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'color-mix(in srgb, var(--color-status-success) 70%, transparent)' }}>
                  {t('worldBook.skeletonFlowHint')}
                </p>
              </div>
              {onJumpToStep && (entries.length > 0 || effectiveWorldRules.trim()) && (
                <button
                  type="button"
                  onClick={() => onJumpToStep(4)}
                  className="shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors"
                  style={{ borderColor: themeAlpha('success', 40), backgroundColor: themeAlpha('success', 12), color: C.success }}
                  title={t('worldBook.jumpToDetailTooltip')}
                >
                  {t('worldBook.jumpToDetail')} →
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="mb-4 rounded-xl border p-3 flex items-start gap-3"
          style={
            entries.length === 0 && !effectiveWorldRules.trim() && !topic.trim()
              ? { backgroundColor: themeAlpha('warning', 10), borderColor: themeAlpha('warning', 35) }
              : { backgroundColor: themeAlpha('info', 8), borderColor: themeAlpha('info', 25) }
          }
        >
          <span className="text-base shrink-0" aria-hidden>{entries.length === 0 && !effectiveWorldRules.trim() ? '⚠️' : '🔗'}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p
                  className="text-xs font-semibold"
                  style={{ color: entries.length === 0 && !effectiveWorldRules.trim() ? C.warning : C.info }}
                >
                  {t('worldBook.skeletonContinuityTitle')}
                </p>
                {entries.length === 0 && !effectiveWorldRules.trim() ? (
                  <p className="text-[11px] mt-0.5" style={{ color: 'color-mix(in srgb, var(--color-status-warning) 80%, transparent)' }}>
                    {t('worldBook.skeletonMissingHint')}
                  </p>
                ) : (
                  <>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span
                        className="rounded-full border px-2 py-0.5"
                        style={{ borderColor: themeAlpha('info', 30), backgroundColor: themeAlpha('info', 10), color: C.info }}
                      >
                        {t('worldBook.skeletonStatEntries', { count: String(entries.length) })}
                      </span>
                      {topic.trim() && (
                        <span
                          className="rounded-full border px-2 py-0.5 max-w-[260px] truncate"
                          style={{ borderColor: themeAlpha('info', 30), backgroundColor: themeAlpha('info', 10), color: C.info }}
                          title={topic}
                        >
                          {t('worldBook.skeletonStatTopic', { topic: topic.trim().slice(0, 40) })}
                        </span>
                      )}
                      {effectiveWorldRules.trim() && (
                        <span
                          className="rounded-full border px-2 py-0.5"
                          style={{ borderColor: themeAlpha('info', 30), backgroundColor: themeAlpha('info', 10), color: C.info }}
                        >
                          {t('worldBook.skeletonStatRules', { count: String(effectiveWorldRules.length) })}
                        </span>
                      )}
                      {characterContext?.trim() && (
                        <span
                          className="rounded-full border px-2 py-0.5"
                          style={{ borderColor: themeAlpha('success', 30), backgroundColor: themeAlpha('success', 10), color: C.success }}
                        >
                          {t('worldBook.skeletonStatChars')}
                        </span>
                      )}
                    </div>
                    {/* Skeleton expand progress — count entries flagged fromSkeleton and
                        show how many have been expanded by AI. Includes a one-click
                        batch-expand button for the remaining un-expanded skeletons. */}
                    {(() => {
                      const skeletonTotal = entries.filter(e => e.fromSkeleton === true).length;
                      if (skeletonTotal === 0) return null;
                      const expanded = entries.filter(e => e.fromSkeleton === true && e.skeletonExpanded === true).length;
                      const remaining = skeletonTotal - expanded;
                      const allExpanded = remaining === 0;
                      return (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span
                            className="rounded-full border px-2 py-0.5"
                            style={
                              allExpanded
                                ? { borderColor: themeAlpha('success', 35), backgroundColor: themeAlpha('success', 10), color: C.success }
                                : { borderColor: themeAlpha('warning', 40), backgroundColor: themeAlpha('warning', 12), color: C.warning }
                            }
                          >
                            {allExpanded
                              ? t('worldBook.skeletonProgressAllDone', { count: String(skeletonTotal) })
                              : t('worldBook.skeletonProgress', { expanded: String(expanded), total: String(skeletonTotal) })}
                          </span>
                          {!allExpanded && (
                            <button
                              type="button"
                              onClick={handleBatchExpandSkeletons}
                              disabled={batchExpanding || generating}
                              className="rounded-lg border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              style={{ borderColor: themeAlpha('success', 40), backgroundColor: themeAlpha('success', 12), color: C.success }}
                              title={t('worldBook.batchExpandTooltip')}
                            >
                              {batchExpanding
                                ? t('worldBook.batchExpanding', { current: String(batchExpandProgress.current), total: String(batchExpandProgress.total) })
                                : `🚀 ${t('worldBook.batchExpand')}`}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                    {/* Data quality warnings — surface integrity issues from skeleton so
                        users can fix them before exporting. */}
                    {(() => {
                      const emptyContent = entries.filter(e => !e.content?.trim()).length;
                      const missingKeys = entries.filter(e => !e.constant && e.keys.length === 0).length;
                      if (emptyContent === 0 && missingKeys === 0) return null;
                      return (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                          {emptyContent > 0 && (
                            <span
                              className="rounded-full border px-2 py-0.5"
                              style={{ borderColor: themeAlpha('warning', 40), backgroundColor: themeAlpha('warning', 12), color: C.warning }}
                            >
                              {t('worldBook.skeletonQualityEmpty', { count: String(emptyContent) })}
                            </span>
                          )}
                          {missingKeys > 0 && (
                            <span
                              className="rounded-full border px-2 py-0.5"
                              style={{ borderColor: themeAlpha('warning', 40), backgroundColor: themeAlpha('warning', 12), color: C.warning }}
                            >
                              {t('worldBook.skeletonQualityMissingKeys', { count: String(missingKeys) })}
                            </span>
                          )}
                          <span className="text-[10px]" style={{ color: 'color-mix(in srgb, var(--color-status-warning) 70%, transparent)' }}>
                            {t('worldBook.skeletonQualityHint')}
                          </span>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
              {onJumpToStep && (
                <button
                  type="button"
                  onClick={() => onJumpToStep(2)}
                  className="shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors"
                  style={{ borderColor: themeAlpha('info', 40), backgroundColor: themeAlpha('info', 12), color: C.info }}
                  title={t('worldBook.jumpToSkeletonTooltip')}
                >
                  ← {t('worldBook.jumpToSkeleton')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Batch tools bar — hidden in skeleton mode */}
      {mode !== 'skeleton' && entries.length > 0 && (
        <div className="space-y-3 mb-4">
          <div className="flex flex-col gap-2 p-3 rounded-lg border sm:flex-row sm:flex-wrap sm:items-center" style={{ backgroundColor: surfaceA(40), borderColor: borderA(50) }}>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('worldBook.searchPlaceholder')}
              className="w-full min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs placeholder-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none sm:min-w-[220px]"
              style={{ borderColor: C.inputBorder, backgroundColor: C.inputBg, color: C.text }}
            />
            <Button variant="ghost" size="sm" onClick={sortEntries}>{t('worldBook.sortByOrder')}</Button>
            <Button variant="ghost" size="sm" onClick={enableAllEntries}>{t('worldBook.enableAll')}</Button>
            <Button variant="ghost" size="sm" onClick={disableEmptyKeyEntries}>{t('worldBook.disableEmptyKeys')}</Button>
            <Button variant="ghost" size="sm" onClick={cleanupEmptyEntries}>{t('worldBook.cleanupEmpty')}</Button>
            <div className="flex items-center gap-1 rounded-lg border p-1" style={{ borderColor: borderA(60), backgroundColor: surfaceA(35) }}>
              <button type="button" onClick={() => applyEntryView('collapsed')} className="rounded px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[color-mix(in_srgb,var(--color-surface-raised)_80%,transparent)] hover:text-[var(--text-color)]">紧凑</button>
              <button type="button" onClick={() => applyEntryView('preview')} className="rounded px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[color-mix(in_srgb,var(--color-surface-raised)_80%,transparent)] hover:text-[var(--text-color)]">摘要</button>
              <button type="button" onClick={() => applyEntryView('edit')} className="rounded px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[color-mix(in_srgb,var(--color-surface-raised)_80%,transparent)] hover:text-[var(--text-color)]">编辑</button>
            </div>
          </div>
          {searchQuery && (
            <p className="text-[11px]" style={{ color: C.muted }}>{t('worldBook.searchResults', { visible: String(visibleEntries.length), total: String(entries.length) })}</p>
          )}
        </div>
      )}

      {/* AI Tools bar — hidden in skeleton mode */}
      {mode !== 'skeleton' && entries.length > 0 && (
        <div className="flex flex-col gap-2 mb-4 p-3 rounded-lg border sm:flex-row sm:flex-wrap sm:items-center" style={{ backgroundColor: themeAlpha('warning', 10), borderColor: themeAlpha('warning', 30) }}>
          <span className="text-xs font-medium shrink-0" style={{ color: C.warning }}>🧹 {t('worldBook.aiToolsLabel')}</span>
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
          <span className="text-[10px] ml-auto" style={{ color: C.muted }}>
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
        <div className="min-w-0">
          <h2 className="text-xl font-bold" style={{ color: C.text }}>{mode === 'skeleton' ? t('worldBook.skeletonTitle') : t('worldBook.title')}</h2>
          <p className="text-sm mt-1" style={{ color: C.secondary }}>
            {t('worldBook.headerCount', { count: String(entries.length) })}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {mode !== 'skeleton' && (
            <Button variant="secondary" onClick={addEntry}>+ {t('worldBook.addEntry')}</Button>
          )}
        </div>
      </div>

      {/* World Anchor Panel - skeleton mode only */}
      {mode === 'skeleton' && onWorldAnchorChange && (
        <WorldAnchorPanel
          anchor={worldAnchor ?? { era: '', coreRules: '', hardConstraints: '', tone: '' }}
          onChange={onWorldAnchorChange}
          defaultExpanded={true}
        />
      )}

      {/* AI Generate Panel - always visible */}
      <AIGeneratePanel
        topic={topic}
        worldRules={effectiveWorldRules}
        generating={generating}
        onTopicChange={setTopic}
        onWorldRulesChange={(val) => setWorldRules(val)}
        cardName={effectiveCardName}
        characterSummaries={effectiveCharacterContext}
        existingWorldbookContext={effectiveExistingContext}
        skeletonMode={mode === 'skeleton' ? true : skeletonMode}
        skeletonCount={skeletonCount}
        batchCount={batchCount}
        onSkeletonModeChange={mode === 'skeleton' ? () => {} : setSkeletonMode}
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
        <div className="text-center py-12 border border-dashed rounded-xl" style={{ color: C.muted, borderColor: C.border }}>
          <p>{t('worldBook.emptyEntriesTitle')}</p>
          <p className="text-sm mt-1">{t('worldBook.emptyEntriesHint')}</p>
        </div>
      )}

      <div className="space-y-2 sm:space-y-3">
        {regularVisibleEntries.map(renderEntry)}

        {stagedVisibleEntries.length > 0 && (
          <section className="rounded-xl border" style={{ borderColor: themeAlpha('primary', 25), backgroundColor: themeAlpha('primary', 5) }}>
            <button
              type="button"
              onClick={() => setStagedGroupOpen(open => !open)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] transition-transform ${stagedGroupOpen ? 'rotate-90' : ''}`} style={{ color: C.primary }}>&#x25B6;</span>
                  <h3 className="text-sm font-semibold" style={{ color: C.text }}>阶段性世界书</h3>
                  <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: themeAlpha('primary', 25), backgroundColor: themeAlpha('primary', 10), color: C.primary }}>
                    {stagedVisibleEntries.length} 条
                  </span>
                </div>
                <p className="mt-1 text-[11px]" style={{ color: C.muted }}>分阶段模式生成的世界书条目，默认折叠以减少页面长度</p>
              </div>
              <span className="shrink-0 rounded-lg border px-2 py-1 text-[11px]" style={{ borderColor: themeAlpha('primary', 20), color: C.primary }}>
                {stagedGroupOpen ? '收起' : '展开'}
              </span>
            </button>
            {stagedGroupOpen && (
              <div className="space-y-2 border-t p-3 sm:space-y-3" style={{ borderColor: themeAlpha('primary', 20) }}>
                {stagedVisibleEntries.map(renderEntry)}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}