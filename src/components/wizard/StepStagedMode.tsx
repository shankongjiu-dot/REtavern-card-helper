/**
 * StepStagedMode - 分阶段模式（步骤5，可选启用）
 *
 * 参考卡「高考冲刺100天」的写卡流程：
 *   1. 选剧情标签（纯爱 / NTR / 双路线）
 *   2. AI 读已有世界书 + MVU 变量 + 用户要求，为每个适合的角色剖析阶段框架
 *      （选阶段轴变量、划阈值区间、给每个阶段写人设/剧情注解）
 *   3. 用户可修改阈值、对单个阶段重 roll 注解
 *   4. AI 为每个阶段生成详细人设/剧情子条目内容
 *   5. 应用 → 生成参考卡风格的 EJS 调度条目 + N 个 disabled 子条目，合并到世界书
 *
 * 调度条目用 if/else if + getWorldInfo() 互斥拉取子条目，
 * 变量达到阈值开启对应阶段世界书，关闭过去阶段的世界书。
 */
import { useState, useMemo, useCallback } from 'react';
import { Button } from '../shared/Button';
import { TextInput } from '../shared/TextInput';
import { TextArea } from '../shared/TextArea';
import { useToast } from '../shared/Toast';
import { useTranslation } from '../../i18n/I18nContext';
import { useAIGenerate } from '../../hooks/useAIGenerate';
import { AIProgressPanel, type AIProgressStatus } from '../shared/AIProgressPanel';
import {
  buildStagedLorebookEntries,
  sortStagesByDirection,
  type StagedLorebookConfig,
  type StageDefinition,
} from '../../services/staged-lorebook-builder';
import type {
  StagedModeConfig,
  StagedModeCharacter,
  StagedModeStage,
  MvuConfig,
  LorebookEntry,
} from '../../constants/defaults';
import { STAGED_COMPATIBLE_TEMPLATE_IDS } from './StepMvuVariables';

interface StepStagedModeProps {
  stagedMode: StagedModeConfig;
  onChange: (config: StagedModeConfig) => void;
  cardName: string;
  mvu?: MvuConfig;
  lorebookEntries: LorebookEntry[];
  onApplyEntries: (entries: LorebookEntry[]) => void;
  nsfw?: boolean;
  onNsfwChange?: (nsfw: boolean) => void;
}

const TEMPLATE_OPTIONS = [
  { id: 'pure-love' as const, name: '甜宠纯爱', icon: '💕', desc: '情感天平 0~100 单向递增' },
  { id: 'ntr' as const, name: '虐恋NTR', icon: '🖤', desc: '情感天平 0~100 单向递增' },
  { id: 'dual-route' as const, name: '可纯爱可NTR', icon: '🔀', desc: '情感天平 -100~100 双向' },
];

export function StepStagedMode({
  stagedMode, onChange, cardName, mvu, lorebookEntries, onApplyEntries, nsfw = false, onNsfwChange,
}: StepStagedModeProps) {
  const { t } = useTranslation();
  const { analyzeStages, rerollStageAnnotation, generateStageEntries, rerollStage } = useAIGenerate();
  const { addToast } = useToast();

  const [userRequirement, setUserRequirement] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState<AIProgressStatus>('idle');
  const [analyzingCharIdx, setAnalyzingCharIdx] = useState<number | null>(null);
  const [generatingEntries, setGeneratingEntries] = useState(false);
  const [genStatus, setGenStatus] = useState<AIProgressStatus>('idle');
  const [genProgress, setGenProgress] = useState('');
  const [rerollingAnnotationKey, setRerollingAnnotationKey] = useState<string | null>(null);
  const [rerollingContentKey, setRerollingContentKey] = useState<string | null>(null);
  const [rerollGuidance, setRerollGuidance] = useState<Record<string, string>>({});
  const [charGuidance, setCharGuidance] = useState<Record<number, string>>({});
  const [openCharacterGroups, setOpenCharacterGroups] = useState<Set<number>>(new Set());

  // ── 构造 MVU 变量上下文 ──────────────────────────────────
  const mvuVariablesContext = useMemo(() => {
    if (!mvu?.enabled || !mvu.schemaSections?.length) return '';
    return mvu.schemaSections
      .map((section) => {
        const vars = section.variables
          .map((v) => {
            const type = v.zodType.startsWith('z.enum(') ? 'enum' : v.zodType.includes('number') ? 'number' : 'string';
            const range = v.range ? ` [${v.range.min}~${v.range.max}]` : '';
            return `  - ${v.path} (${type}${range}): ${v.description}`;
          })
          .join('\n');
        return `[${section.name}]\n${vars}`;
      })
      .join('\n');
  }, [mvu]);

  // ── 构造已有世界书上下文 ──────────────────────────────────
  const existingWorldbookContext = useMemo(() => {
    if (!lorebookEntries?.length) return '';
    const lines = lorebookEntries
      .filter((e) => e.comment && e.content)
      .slice(0, 30)
      .map((e) => {
        const content = (e.content || '').slice(0, 200);
        return `【${e.comment}】\n${content}`;
      });
    return lines.join('\n---\n').slice(0, 4000);
  }, [lorebookEntries]);

  // ── 启用/禁用 ─────────────────────────────────────────────
  const toggleEnabled = () => onChange({ ...stagedMode, enabled: !stagedMode.enabled });

  const toggleCharacterGroup = (charIdx: number) => {
    setOpenCharacterGroups(prev => {
      const next = new Set(prev);
      if (next.has(charIdx)) next.delete(charIdx);
      else next.add(charIdx);
      return next;
    });
  };

  // ── Step 1: AI 剖析阶段框架 ────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    if (!mvuVariablesContext) {
      addToast('error', t('stagedMode.needMvu'));
      return;
    }
    if (!lorebookEntries?.length) {
      addToast('error', t('stagedMode.needWorldbook'));
      return;
    }
    setAnalyzing(true);
    setAnalyzeStatus('generating');
    try {
      const result = await analyzeStages(
        cardName, stagedMode.templateId, existingWorldbookContext, mvuVariablesContext, userRequirement.trim(),
      );
      if (!result || result.length === 0) {
        addToast('error', t('stagedMode.analyzeFailed'));
        setAnalyzeStatus('error');
        return;
      }
      const characters: StagedModeCharacter[] = result.map((c) => ({
        name: c.name,
        sourceComment: c.sourceComment,
        summary: c.summary,
        axisPath: c.axisPath,
        axisType: c.axisType,
        numericDirection: c.numericDirection,
        stages: c.stages.map((s) => ({ name: s.name, condition: s.condition, annotation: s.annotation })),
      }));
      onChange({ ...stagedMode, characters });
      setCharGuidance({});
      setAnalyzeStatus('done');
      addToast('success', t('stagedMode.analyzeDone', { count: String(characters.length) }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknownError');
      setAnalyzeStatus('error');
      addToast('error', t('stagedMode.analyzeFailed') + `: ${msg}`);
    } finally {
      setAnalyzing(false);
    }
  }, [analyzeStages, cardName, stagedMode, existingWorldbookContext, mvuVariablesContext, userRequirement, lorebookEntries, onChange, addToast, t]);

  // ── 修改阶段阈值/名称 ─────────────────────────────────────
  const updateStage = (charIdx: number, stageIdx: number, patch: Partial<StagedModeStage>) => {
    const characters = stagedMode.characters.map((c, ci) => {
      if (ci !== charIdx) return c;
      return { ...c, stages: c.stages.map((s, si) => (si === stageIdx ? { ...s, ...patch } : s)) };
    });
    onChange({ ...stagedMode, characters });
  };

  // ── 重 roll 单个阶段注解 ──────────────────────────────────
  const handleRerollAnnotation = async (charIdx: number, stageIdx: number) => {
    const character = stagedMode.characters[charIdx];
    const stage = character.stages[stageIdx];
    const key = `${charIdx}-${stageIdx}`;
    setRerollingAnnotationKey(key);
    try {
      const guidance = (rerollGuidance[key] || '').trim();
      const newAnnotation = await rerollStageAnnotation(
        cardName, stagedMode.templateId, character.name, character.summary,
        character.axisPath, stage.name, stage.condition, existingWorldbookContext, guidance,
      );
      if (!newAnnotation) {
        addToast('error', t('stagedMode.rerollFailed'));
        return;
      }
      updateStage(charIdx, stageIdx, { annotation: newAnnotation });
      addToast('success', t('stagedMode.rerollAnnotationDone'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknownError');
      addToast('error', t('stagedMode.rerollFailed') + `: ${msg}`);
    } finally {
      setRerollingAnnotationKey(null);
    }
  };

  // ── 重 roll 单个阶段世界书内容 ────────────────────────────
  const handleRerollContent = async (charIdx: number, stageIdx: number) => {
    const character = stagedMode.characters[charIdx];
    const stage = character.stages[stageIdx];
    const key = `${charIdx}-${stageIdx}`;
    setRerollingContentKey(key);
    try {
      const guidance = (rerollGuidance[key] || '').trim();
      const siblingStages = character.stages
        .filter((_, si) => si !== stageIdx)
        .map((s) => ({ name: s.name, content: s.content }));
      const newContent = await rerollStage(
        cardName, character.summary, character.axisPath, stage.name, stage.condition,
        siblingStages, existingWorldbookContext, guidance, nsfw,
      );
      if (!newContent) {
        addToast('error', t('stagedMode.rerollFailed'));
        return;
      }
      updateStage(charIdx, stageIdx, { content: newContent });
      addToast('success', t('stagedMode.rerollContentDone'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknownError');
      addToast('error', t('stagedMode.rerollFailed') + `: ${msg}`);
    } finally {
      setRerollingContentKey(null);
    }
  };

  // ── Step 2: 为单个角色生成所有阶段的子条目内容 ─────────────
  const handleGenerateEntriesForChar = useCallback(async (charIdx: number) => {
    const character = stagedMode.characters[charIdx];
    if (!character || !character.stages.length) {
      addToast('error', t('stagedMode.needAnalyze'));
      return;
    }
    setGeneratingEntries(true);
    setGenStatus('generating');
    setAnalyzingCharIdx(charIdx);
    setGenProgress(character.name);
    try {
      const results = await generateStageEntries(
        cardName, stagedMode.templateId, character.name, character.summary,
        character.axisPath, character.stages, existingWorldbookContext, nsfw, (charGuidance[charIdx] || '').trim(),
      );
      const newStages = character.stages.map((s) => {
        const found = results.find((r) => r.stageName === s.name);
        return { ...s, content: found?.content || s.content || '' };
      });
      const characters = stagedMode.characters.map((c, ci) =>
        ci === charIdx ? { ...c, stages: newStages } : c,
      );
      onChange({ ...stagedMode, characters });
      setGenStatus('done');
      addToast('success', t('stagedMode.generateDone'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknownError');
      setGenStatus('error');
      addToast('error', t('stagedMode.generateFailed') + `: ${msg}`);
    } finally {
      setGeneratingEntries(false);
      setAnalyzingCharIdx(null);
      setGenProgress('');
    }
  }, [generateStageEntries, cardName, stagedMode, existingWorldbookContext, nsfw, charGuidance, onChange, addToast, t]);

  // ── Step 3: 应用 → 构建世界书条目 ────────────────────────
  const handleApply = useCallback(() => {
    const emptyStages = stagedMode.characters
      .flatMap((c) => c.stages.map((s) => ({ char: c.name, stage: s.name, hasContent: !!(s.content && s.content.trim()) })))
      .filter((x) => !x.hasContent);
    if (emptyStages.length > 0) {
      addToast('error', t('stagedMode.applyEmptyContent', { name: emptyStages[0].char, stage: emptyStages[0].stage }));
      return;
    }
    const allEntries: LorebookEntry[] = [];
    for (const character of stagedMode.characters) {
      const stages: StageDefinition[] = sortStagesByDirection(
        character.stages.map((s) => ({
          name: s.name.trim(),
          condition: s.condition.trim(),
          content: s.content,
        })),
        character.axisType,
        character.numericDirection || '>=',
      );
      const dispatcherName = `${character.name.trim()}${stagedMode.dispatcherPrefix.trim()}`;
      const config: StagedLorebookConfig = {
        axisPath: character.axisPath,
        axisType: character.axisType,
        numericDirection: character.numericDirection,
        bookName: cardName,
        dispatcherName,
        stages,
      };
      allEntries.push(...buildStagedLorebookEntries(config));
    }
    onApplyEntries(allEntries);
    addToast('success', t('stagedMode.applyDone', { count: String(allEntries.length) }));
  }, [stagedMode, cardName, onApplyEntries, addToast, t]);

  // ── 渲染：未启用 ──────────────────────────────────────────
  if (!stagedMode.enabled) {
    const mvuDisabled = !mvu?.enabled;
    const templateId = mvu?.beginnerTemplateId;
    const templateCompatible = mvu?.mode === 'expert'
      ? true
      : !!templateId && (STAGED_COMPATIBLE_TEMPLATE_IDS as readonly string[]).includes(templateId);
    return (
      <div className="space-y-4">
        <div className="text-center py-16 border border-dashed border-slate-700 rounded-xl">
          <p className="text-slate-400 mb-4">{t('stagedMode.introDisabled')}</p>
          {mvuDisabled ? (
            <>
              <p className="text-sm text-amber-400 mb-6">{t('stagedMode.mvuDisabledHint')}</p>
              <Button disabled>✨ {t('stagedMode.enable')}</Button>
            </>
          ) : !templateCompatible ? (
            <>
              <p className="text-sm text-amber-400 mb-6">{t('stagedMode.templateMismatchHint')}</p>
              <Button disabled>✨ {t('stagedMode.enable')}</Button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-500 mb-6">{t('stagedMode.introHint')}</p>
              <Button onClick={toggleEnabled}>✨ {t('stagedMode.enable')}</Button>
            </>
          )}
        </div>
      </div>
    );
  }

  const hasAnalyzed = stagedMode.characters.length > 0;
  const allHaveContent = hasAnalyzed && stagedMode.characters.every((c) => c.stages.every((s) => s.content));

  const enabledTemplateId = mvu?.beginnerTemplateId;
  const enabledTemplateCompatible = mvu?.mode === 'expert'
    ? true
    : !enabledTemplateId || (STAGED_COMPATIBLE_TEMPLATE_IDS as readonly string[]).includes(enabledTemplateId);

  return (
    <div className="space-y-4">
      {!enabledTemplateCompatible && (
        <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 p-3 text-sm text-amber-300">
          {t('stagedMode.templateMismatchHint')}
        </div>
      )}
      {/* 头部：禁用按钮 + NSFW 开关 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">{t('stagedMode.title')}</h2>
          <p className="text-sm text-slate-400 mt-1">{t('stagedMode.intro')}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={nsfw}
              onChange={(e) => onNsfwChange?.(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-600" />
          </label>
          <span className="text-xs text-slate-300">{t('common.nsfw')}</span>
          <Button variant="ghost" size="sm" onClick={toggleEnabled}>{t('stagedMode.disable')}</Button>
        </div>
      </div>

      {/* Step 1: 标签选择 + 用户要求 + AI 剖析 */}
      <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-4">
        <h3 className="text-sm font-bold text-emerald-300 mb-3">📋 {t('stagedMode.step1Title')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
          {TEMPLATE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => onChange({ ...stagedMode, templateId: opt.id })}
              className={`rounded-xl border p-3 text-left transition-all hover:border-emerald-500/50 ${
                stagedMode.templateId === opt.id
                  ? 'border-emerald-500 bg-emerald-900/30'
                  : 'border-slate-700 bg-slate-800/50'
              }`}
            >
              <div className="text-2xl mb-1">{opt.icon}</div>
              <div className="text-sm font-medium text-slate-200">{opt.name}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>
        <TextArea
          value={userRequirement}
          onChange={(e) => setUserRequirement(e.target.value)}
          placeholder={t('stagedMode.requirementPlaceholder')}
          rows={2}
          className="mb-3"
        />
        <Button onClick={handleAnalyze} disabled={analyzing}>
          {analyzing ? t('stagedMode.analyzing') : `🔍 ${t('stagedMode.analyzeButton')}`}
        </Button>
        {analyzeStatus !== 'idle' && analyzeStatus !== 'done' && (
          <AIProgressPanel status={analyzeStatus} text="" />
        )}
      </div>

      {/* Step 2: 阶段框架展示与编辑 */}
      {hasAnalyzed && (
        <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 p-4">
          <h3 className="text-sm font-bold text-amber-300 mb-3">✏️ {t('stagedMode.step2Title')}</h3>
          <p className="text-xs text-amber-400/60 mb-3">{t('stagedMode.step2Hint')}</p>
          <div className="space-y-3">
            {stagedMode.characters.map((character, ci) => {
              const charGenerating = generatingEntries && analyzingCharIdx === ci;
              const charHasStages = character.stages.length > 0;
              const charAllReady = charHasStages && character.stages.every((s) => s.content && s.content.trim());
              const groupOpen = openCharacterGroups.has(ci);
              return (
              <div key={ci} className="rounded-lg border border-slate-700/50 p-3 bg-slate-900/30">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => toggleCharacterGroup(ci)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className={`text-[10px] text-violet-300 transition-transform ${groupOpen ? 'rotate-90' : ''}`}>&#x25B6;</span>
                    <span className="text-sm font-bold text-violet-300 shrink-0">{character.name}</span>
                    <code className="text-[11px] text-teal-200 bg-slate-800 px-1.5 py-0.5 rounded shrink-0">{character.axisPath}</code>
                    <span className="text-[10px] text-slate-500 min-w-0 truncate">{character.summary}</span>
                  </button>
                  {charHasStages && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      charAllReady
                        ? 'bg-emerald-900/50 text-emerald-300 border-emerald-700/40'
                        : 'bg-amber-900/40 text-amber-300 border-amber-700/40'
                    }`}>
                      {charAllReady
                        ? t('stagedMode.charAllReady', { count: String(character.stages.length) })
                        : t('stagedMode.charPartial', { ready: String(character.stages.filter((s) => s.content && s.content.trim()).length), total: String(character.stages.length) })}
                    </span>
                  )}
                  <Button
                    size="sm"
                    onClick={() => handleGenerateEntriesForChar(ci)}
                    disabled={!charHasStages || generatingEntries}
                    title={charHasStages ? t('stagedMode.generateForCharHint') : t('stagedMode.needAnalyze')}
                  >
                    {charGenerating
                      ? `${t('stagedMode.generating')} ${character.name}...`
                      : `✨ ${t('stagedMode.generateForChar')}`}
                  </Button>
                </div>
                {groupOpen && (
                  <div className="mt-2">
                    <TextArea
                      value={charGuidance[ci] || ''}
                      onChange={(e) => setCharGuidance({ ...charGuidance, [ci]: e.target.value })}
                      placeholder={t('stagedMode.charGuidancePlaceholder')}
                      rows={2}
                      className="mb-2 text-[11px]"
                    />
                    <div className="space-y-2">
                      {character.stages.map((stage, si) => {
                    const key = `${ci}-${si}`;
                    return (
                      <div key={si} className="rounded border border-slate-700/40 p-2 bg-slate-900/50">
                        <div className="flex items-center gap-2 mb-1">
                          <TextInput
                            value={stage.name}
                            onChange={(e) => updateStage(ci, si, { name: e.target.value })}
                            className="flex-1 text-xs"
                          />
                          <TextInput
                            value={stage.condition}
                            onChange={(e) => updateStage(ci, si, { condition: e.target.value })}
                            className="w-28 text-xs font-mono"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRerollAnnotation(ci, si)}
                            disabled={rerollingAnnotationKey === key}
                            title={t('stagedMode.rerollAnnotation')}
                          >
                            {rerollingAnnotationKey === key ? '...' : `📝 ${t('stagedMode.rerollAnnotation')}`}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRerollContent(ci, si)}
                            disabled={rerollingContentKey === key}
                            title={t('stagedMode.rerollContent')}
                          >
                            {rerollingContentKey === key ? '...' : `🎲 ${t('stagedMode.rerollContent')}`}
                          </Button>
                        </div>
                        <p className="text-[11px] text-slate-400">{stage.annotation}</p>
                        <TextInput
                          value={rerollGuidance[key] || ''}
                          onChange={(e) => setRerollGuidance({ ...rerollGuidance, [key]: e.target.value })}
                          placeholder={t('stagedMode.rerollGuidancePlaceholder')}
                          className="mt-1 text-[11px]"
                        />
                        {/* 阶段世界书内容：状态徽章 + 可编辑 TextArea */}
                        <div className="mt-2 pt-2 border-t border-slate-700/40">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-slate-500 font-medium">
                              {t('stagedMode.stageContent')}
                            </span>
                            {stage.content && stage.content.trim() ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 border border-emerald-700/40">
                                {t('stagedMode.contentReady', { count: String(stage.content.length) })}
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700/40">
                                {t('stagedMode.contentEmpty')}
                              </span>
                            )}
                          </div>
                          <TextArea
                            value={stage.content || ''}
                            onChange={(e) => updateStage(ci, si, { content: e.target.value })}
                            placeholder={t('stagedMode.contentPlaceholder')}
                            rows={5}
                            className="text-[11px] font-mono"
                          />
                        </div>
                      </div>
                    );
                      })}
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
          {genStatus !== 'idle' && genStatus !== 'done' && (
            <AIProgressPanel status={genStatus} text={genProgress} />
          )}
        </div>
      )}

      {/* Step 3: 应用到世界书 */}
      {allHaveContent && (
        <div className="rounded-xl border border-teal-700/40 bg-teal-950/20 p-4">
          <h3 className="text-sm font-bold text-teal-300 mb-2">📦 {t('stagedMode.step3Title')}</h3>
          <p className="text-xs text-teal-400/60 mb-3">{t('stagedMode.step3Hint')}</p>
          <Button variant="primary" onClick={handleApply}>📦 {t('stagedMode.applyButton')}</Button>
        </div>
      )}
    </div>
  );
}
