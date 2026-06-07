/**
 * Step 3: World Book / Lorebook entries.
 * Full SillyTavern V2 + runtime parameter support (CardForge reference).
 */
import { useState } from 'react';
import { Button } from '../shared/Button';
import { useToast } from '../shared/Toast';
import { AIProgressPanel, type AIProgressStatus } from '../shared/AIProgressPanel';
import { LorebookEntryEditor } from './LorebookEntryEditor';
import { AIGeneratePanel } from './AIGeneratePanel';
import { OrganizePreviewTable } from './OrganizePreviewTable';
import { useAIGenerate } from '../../hooks/useAIGenerate';
import { createEmptyLorebookEntry } from '../../constants/defaults';
import type { LorebookEntry, LorebookPosition, AIOrganizeSuggestion } from '../../constants/defaults';

/** Rough token estimate (~1.3 tokens per char for CJK) */
function estimateTokens(text: string): number {
  return Math.round((text || '').length * 1.3);
}

interface StepWorldBookProps {
  entries: LorebookEntry[];
  cardName: string;
  characterSummaries: string;
  onUpdate: (entries: LorebookEntry[]) => void;
}

export function StepWorldBook({ entries, cardName, characterSummaries, onUpdate }: StepWorldBookProps) {
  const [generating, setGenerating] = useState(false);
  const [topic, setTopic] = useState('');
  const [worldRules, setWorldRules] = useState('');
  const [showAiPanel, setShowAiPanel] = useState(false);
  // Skeleton mode
  const [skeletonMode, setSkeletonMode] = useState(false);
  const [skeletonCount, setSkeletonCount] = useState(6);
  // AI streaming state
  const [aiStatus, setAiStatus] = useState<AIProgressStatus>('idle');
  const [aiText, setAiText] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  // AI organize state
  const [organizing, setOrganizing] = useState(false);
  const [organizeResults, setOrganizeResults] = useState<AIOrganizeSuggestion[] | null>(null);
  // AI key generation state
  const [generatingKeys, setGeneratingKeys] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // AI expand state
  const [expandingIndex, setExpandingIndex] = useState<number | null>(null);
  const { generateLorebookParsed, generateLorebookSkeleton, organizeEntries, generateEntryKeys, expandLorebookEntry } = useAIGenerate();
  const { addToast } = useToast();

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
    setAiError(null);
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
          const skeletons = await generateLorebookSkeleton(
            cardName, characterSummaries, topic, batchSize, existingTitles, worldRules || undefined,
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

        onUpdate([...entries, ...newEntries]);
        addToast('success', `已生成 ${newEntries.length} 条骨架，点击「✨ AI 展开」逐条扩展`);
      } else {
        // ── Full mode: original behavior ──
        const result = await generateLorebookParsed(cardName, characterSummaries, topic, worldRules || undefined);
        if (Array.isArray(result) && result.length > 0) {
          const newEntries = result.map((item) => {
            const base = createEmptyLorebookEntry();
            return {
              ...base,
              name: item.name || '',
              keys: item.keys || [],
              secondary_keys: item.secondary_keys || [],
              content: item.content || '',
              comment: item.comment || item.name || '',
              constant: item.constant ?? false,
              selective: item.selective ?? false,
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
          onUpdate([...entries, ...newEntries]);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误';
      setAiError(msg);
      addToast('error', `世界书生成失败：${msg}`);
    } finally {
      setGenerating(false);
      setShowAiPanel(false);
      setTopic('');
      setWorldRules('');
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
        characterSummaries,
      );
      updateEntry(index, {
        comment: result.comment,
        content: result.content,
        keys: result.keys,
        constant: result.strategy === 'constant',
      });
      addToast('success', `「${result.comment || entry.name}」展开完成`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误';
      addToast('error', `展开失败：${msg}`);
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
        name: e.name || e.comment || `条目 ${i + 1}`,
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
      const msg = err instanceof Error ? err.message : '未知错误';
      setAiError(msg);
      addToast('error', `智能整理失败：${msg}`);
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
    onUpdate(updated);
    setOrganizeResults(null);
  };

  // ── AI Key Generation handler ──────────────────────────────────
  const handleGenerateKeys = async () => {
    const needsKeys = entries
      .map((e, i) => ({ entry: e, index: i }))
      .filter(({ entry }) => entry.content.trim() && entry.keys.length < 2);
    if (needsKeys.length === 0) return;

    setGeneratingKeys(true);
    try {
      const results = await generateEntryKeys(needsKeys.map(({ entry, index }) => ({
        index,
        name: entry.name || entry.comment || `条目 ${index + 1}`,
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
      const msg = err instanceof Error ? err.message : '未知错误';
      setAiError(msg);
      addToast('error', `触发词生成失败：${msg}`);
    } finally {
      setGeneratingKeys(false);
    }
  };

  const cleanupEmptyEntries = () => {
    const updated = entries.filter(e => e.content.trim() || e.name.trim() || e.keys.length > 0);
    onUpdate(updated);
    addToast('success', `已清理 ${entries.length - updated.length} 个空条目`);
  };

  const sortEntries = () => {
    onUpdate([...entries].sort((a, b) => a.insertion_order - b.insertion_order));
    addToast('success', '已按 order 排序');
  };

  const disableEmptyKeyEntries = () => {
    const updated = entries.map(e => (!e.constant && e.keys.length === 0 ? { ...e, enabled: false } : e));
    const count = entries.filter(e => !e.constant && e.keys.length === 0 && e.enabled).length;
    onUpdate(updated);
    addToast('success', `已禁用 ${count} 个无触发词条目`);
  };

  const enableAllEntries = () => {
    onUpdate(entries.map(e => ({ ...e, enabled: true })));
    addToast('success', '已启用全部条目');
  };

  const q = searchQuery.trim().toLowerCase();
  const visibleEntries = q
    ? entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => {
      const text = [entry.name, entry.comment, entry.content, entry.keys.join(' '), entry.secondary_keys.join(' ')].join(' ').toLowerCase();
      return text.includes(q);
    })
    : entries.map((entry, index) => ({ entry, index }));

  // Stats
  const totalEntries = entries.length;
  const enabledEntries = entries.filter(e => e.enabled).length;
  const constantEntries = entries.filter(e => e.constant && e.enabled).length;
  const totalTokens = entries.reduce((sum, e) => sum + estimateTokens(e.content), 0);

  return (
    <div>
      {/* Guidance banner */}
      <div className="rounded-lg bg-indigo-900/20 border border-indigo-700/40 px-4 py-3 mb-4">
        <p className="text-xs text-indigo-300 leading-relaxed">
          <span className="font-semibold">世界书 = 角色的详细设定库：</span>
          每个条目通过<strong>关键词</strong>触发，聊天中提到相关内容时自动注入 AI 上下文。
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-indigo-300/60">
          <p>✦ <strong>每句话过四问</strong>：删了AI会错吗？是信息还是装饰？列表能替代吗？不看原文能理解吗？</p>
          <p>✦ <strong>数据库格式</strong>：用键值对和列表，不用散文</p>
          <p>✦ <strong>不写AI已知信息</strong>：只写差异信息</p>
          <p>✦ <strong>严禁单汉字关键词</strong>：用2字以上名称</p>
          <p>✦ <strong>连接词用冒号/逗号替代</strong>：压缩信息量</p>
          <p>✦ <strong>order 建议</strong>：背景=100 · 能力=200 · 关系=300 · 地点=400</p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4 text-[11px]">
        <span className="bg-indigo-900/30 text-indigo-300 px-2 py-0.5 rounded">{totalEntries} 总计</span>
        <span className="bg-green-900/30 text-green-300 px-2 py-0.5 rounded">{enabledEntries} 启用</span>
        <span className="bg-amber-900/30 text-amber-300 px-2 py-0.5 rounded">{constantEntries} 常驻</span>
        <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded">~{totalTokens} Token</span>
      </div>

      {/* Batch tools bar */}
      {entries.length > 0 && (
        <div className="space-y-3 mb-4">
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-slate-900/40 border border-slate-700/50">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索名称、内容、关键词..."
              className="min-w-[220px] flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            />
            <Button variant="ghost" size="sm" onClick={sortEntries}>按 order 排序</Button>
            <Button variant="ghost" size="sm" onClick={enableAllEntries}>全部启用</Button>
            <Button variant="ghost" size="sm" onClick={disableEmptyKeyEntries}>禁用无触发词</Button>
            <Button variant="ghost" size="sm" onClick={cleanupEmptyEntries}>清理空条目</Button>
          </div>
          {searchQuery && (
            <p className="text-[11px] text-slate-500">搜索结果：{visibleEntries.length} / {entries.length}</p>
          )}
        </div>
      )}

      {/* AI Tools bar */}
      {entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-lg bg-amber-900/10 border border-amber-700/30">
          <span className="text-xs text-amber-300 font-medium shrink-0">🧹 AI 工具：</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleOrganize}
            disabled={organizing || generatingKeys}
          >
            {organizing ? '分析中...' : '⚡ 智能整理'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleGenerateKeys}
            disabled={generatingKeys || organizing}
          >
            {generatingKeys ? '生成中...' : '🗝️ 补触发词'}
          </Button>
          <span className="text-[10px] text-slate-500 ml-auto">
            智能整理优化 position/depth/order/prob · 补触发词为缺少关键词的条目生成 keys
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">世界书</h2>
          <p className="text-sm text-slate-400 mt-1">
            添加条目丰富角色设定。共 {entries.length} 个条目。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAiPanel(!showAiPanel)}
            disabled={generating}
            className="inline-flex items-center justify-center gap-2 rounded-lg font-medium px-4 py-2 text-sm
              bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500
              text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40
              transition-all duration-200 hover:scale-105 active:scale-95
              disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 cursor-pointer"
          >
            {showAiPanel ? '收起' : '✨ AI 生成'}
          </button>
          <Button variant="secondary" onClick={addEntry}>+ 添加条目</Button>
        </div>
      </div>

      {/* AI Generate Panel */}
      {showAiPanel && (
        <AIGeneratePanel
          topic={topic}
          worldRules={worldRules}
          generating={generating}
          onTopicChange={setTopic}
          onWorldRulesChange={setWorldRules}
          skeletonMode={skeletonMode}
          skeletonCount={skeletonCount}
          onSkeletonModeChange={setSkeletonMode}
          onSkeletonCountChange={setSkeletonCount}
          onGenerate={handleBatchGenerate}
          onCancel={() => { setShowAiPanel(false); setTopic(''); setWorldRules(''); }}
        />
      )}

      {entries.length === 0 && !showAiPanel && (
        <div className="text-center py-12 text-slate-500 border border-dashed border-slate-700 rounded-xl">
          <p>还没有世界书条目。</p>
          <p className="text-sm mt-1">手动添加条目或使用 AI 批量生成。</p>
        </div>
      )}

      <div className="space-y-3">
        {visibleEntries.map(({ entry, index }) => {
          const isSkeleton = (entry.content || '').length < 120;
          return (
            <div key={entry.id} className="relative">
              <LorebookEntryEditor
                entry={entry}
                index={index}
                onUpdate={updateEntry}
                onRemove={removeEntry}
              />
              {/* AI Expand button — shows on skeletons */}
              {isSkeleton && (
                <div className="absolute top-3 right-16 z-10">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleExpandEntry(index)}
                    disabled={expandingIndex === index}
                    className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs"
                  >
                    {expandingIndex === index ? '⏳ 展开中...' : '🦴→📖 AI 展开'}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}