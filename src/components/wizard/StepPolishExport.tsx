/**
 * StepPolishExport - Polish & Export step.
 *
 * Final step of the wizard. Provides:
 *   1. Consistency validation (MVU ↔ EJS ↔ World Book ↔ First Message)
 *   2. Card preview summary
 *   3. PNG/JSON export with MVU embedding
 *   4. Token usage estimation
 *
 * Follows tavern-cards polish/export conventions:
 *   - MVU一致性检查: schema vs 条目, initvar vs 开场白, 更新规则 vs schema
 *   - EJS收尾检查: 变量定义完整性, 预处理覆盖, 条件语法正确
 *   - 导出: 嵌入 Zod.txt, MVU脚本, 正则脚本
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Button } from '../shared/Button';
import { useToast } from '../shared/Toast';
import { exportAsJson, exportAsPng, assembleCard, findStagedLorebookEntryIndices } from '../../services/card-exporter';
import { validateCard } from '../../services/card-validator';
import { validateMvuConsistency } from '../../services/mvu-builder';
import { autoFixEntries } from '../../services/card-fixers';
import { createEmptyLorebookEntry, MVU_LOREBOOK_ENTRY_NAMES } from '../../constants/defaults';
import type { WizardDraft, LorebookEntry } from '../../constants/defaults';
import { useAIGenerate } from '../../hooks/useAIGenerate';
import type { MvuConsistencyIssue } from '../../services/mvu-builder';
import { resizeImageToPngBuffer } from '../../services/image-processing';
import { Upload, Image as ImageIcon, Check, Trash2 } from 'lucide-react';
import { QualityCheckPanel } from './QualityCheckPanel';
import { OptimizeCompareModal } from './OptimizeCompareModal';
import type { OptimizeFieldKey } from '../../services/card-optimizer';

function isSpecialLorebookEntry(entry: LorebookEntry, idx: number, stagedIndices: Set<number>): boolean {
  const name = (entry.name || '').trim();
  const comment = (entry.comment || '').trim();
  return MVU_LOREBOOK_ENTRY_NAMES.includes(name) || MVU_LOREBOOK_ENTRY_NAMES.includes(comment) || stagedIndices.has(idx);
}

interface StepPolishExportProps {
  draft: WizardDraft;
  cardName: string;
  characterDescriptions: string;
  worldbookContext: string;
  /** PNG buffer for embedding in export */
  pngBuffer?: ArrayBuffer | null;
  onPngFileSelect?: (buffer: ArrayBuffer | null) => void;
  /** Callback when auto-fix modifies entries */
  onFixEntries?: (entries: LorebookEntry[]) => void;
  /** Callback for AI-driven draft patch (e.g. first message rewrite) */
  onUpdateDraft?: (patch: Partial<WizardDraft>) => void;
  /** Jump to a wizard step (1-based) for manual fix from quality check. */
  onJumpToStep?: (step: number) => void;
}

interface ConsistencyIssue {
  type: 'error' | 'warning';
  source: string;
  message: string;
  fix?: MvuConsistencyIssue['fix'];
}

export function StepPolishExport({ draft, cardName, characterDescriptions, worldbookContext, pngBuffer, onPngFileSelect, onFixEntries, onUpdateDraft, onJumpToStep }: StepPolishExportProps) {
  const { addToast } = useToast();
  const { generateText } = useAIGenerate();
  const [validating, setValidating] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [aiFixingIndex, setAiFixingIndex] = useState<number | null>(null);
  const [appliedFixes, setAppliedFixes] = useState<string[]>([]);
  const [issues, setIssues] = useState<ConsistencyIssue[]>([]);
  const [showExportPreview, setShowExportPreview] = useState(false);
  const [cardPreview, setCardPreview] = useState<string>('');
  const [exportingFormat, setExportingFormat] = useState<'json' | 'png' | null>(null);
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [optimizePreselect, setOptimizePreselect] = useState<OptimizeFieldKey[]>([]);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const coverUrlRef = useRef<string | null>(null);

  // Sync preview URL whenever pngBuffer changes (from parent or upload).
  // Uses a ref to reliably revoke the old URL in cleanup (setState in cleanup
  // is unreliable on unmount in React 18 — the updater may not run).
  useEffect(() => {
    if (coverUrlRef.current) {
      URL.revokeObjectURL(coverUrlRef.current);
      coverUrlRef.current = null;
    }
    if (pngBuffer) {
      const url = URL.createObjectURL(new Blob([pngBuffer], { type: 'image/png' }));
      coverUrlRef.current = url;
      setCoverPreviewUrl(url);
    } else {
      setCoverPreviewUrl(null);
    }
    return () => {
      if (coverUrlRef.current) {
        URL.revokeObjectURL(coverUrlRef.current);
        coverUrlRef.current = null;
      }
    };
  }, [pngBuffer]);

  const VALID_OPTIMIZE_FIELDS: OptimizeFieldKey[] = [
    'cardName', 'tags', 'firstMessage', 'lorebookEntries', 'mvu.statusBarHtml', 'mvu.schemaSections',
  ];

  const handleOpenOptimize = useCallback((fields: string[]) => {
    const validSet = new Set(VALID_OPTIMIZE_FIELDS as string[]);
    const valid = (fields || []).filter((f): f is OptimizeFieldKey => Boolean(f) && validSet.has(f));
    setOptimizePreselect(valid.length > 0 ? valid : ['firstMessage', 'lorebookEntries']);
    setOptimizeOpen(true);
  }, []);

  // ── Stats ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const entryCount = draft.lorebookEntries.length;
    const enabledCount = draft.lorebookEntries.filter(e => e.enabled).length;
    const constantCount = draft.lorebookEntries.filter(e => e.constant && e.enabled).length;
    const totalContentChars = draft.lorebookEntries.reduce((sum, e) => sum + (e.content?.length || 0), 0);
    const estimatedTokens = Math.round(
      (draft.firstMessage?.length || 0) * 1.3 +
      characterDescriptions.length * 1.3 +
      totalContentChars * 1.3
    );
    const mvuVarCount = draft.mvu?.schemaSections?.reduce((sum, s) => sum + s.variables.length, 0) || 0;
    const ejsEntryCount = draft.mvu?.ejsConfigs?.length || 0;

    return { entryCount, enabledCount, constantCount, totalContentChars, estimatedTokens, mvuVarCount, ejsEntryCount };
  }, [draft]);

  // ── Validation ───────────────────────────────────────────────────────────
  const runValidation = useCallback(() => {
    setValidating(true);
    const allIssues: ConsistencyIssue[] = [];

    let stagedIndices = new Set<number>();
    if (draft.stagedMode?.enabled) {
      try {
        stagedIndices = findStagedLorebookEntryIndices(draft.lorebookEntries);
      } catch {
        stagedIndices = new Set();
      }
    }

    // 1. Card V2 spec validation
    try {
      const card = assembleCard(draft);
      const cardValidation = validateCard(card as unknown as Record<string, unknown>, { stagedLorebookEntryIndices: stagedIndices });
      for (const err of cardValidation.errors) {
        allIssues.push({ type: 'error', source: 'V2规范', message: err });
      }
      for (const warn of cardValidation.warnings) {
        allIssues.push({ type: 'warning', source: 'V2规范', message: warn });
      }
    } catch {
      allIssues.push({ type: 'error', source: 'V2规范', message: '卡片数据异常，无法完成 V2 规范校验' });
    }

    // 2. MVU consistency check
    if (draft.mvu?.enabled) {
      const entryNames = draft.lorebookEntries.map(e => e.name || e.comment || `条目${e.id}`);
      const mvuIssues = validateMvuConsistency(draft.mvu, entryNames, draft.firstMessage);
      for (const issue of mvuIssues) {
        allIssues.push({ type: issue.type, source: 'MVU一致性', message: issue.message, fix: issue.fix });
      }

      // 3. EJS variable check
      if (draft.mvu.ejsConfigs.length > 0 && !draft.mvu.ejsPreprocessContent) {
        allIssues.push({
          type: 'warning',
          source: 'EJS',
          message: 'EJS 条目已配置但尚未生成预处理内容，请回到 MVU 步骤点击"重新生成"',
        });
      }

      // 4. initvar ↔ first message consistency
      if (draft.mvu.schemaSections.length > 0 && draft.firstMessage) {
        const locationVars = draft.mvu.schemaSections
          .flatMap(s => s.variables)
          .filter(v => v.path.includes('场景') || v.path.includes('区域') || v.path.includes('地点') || v.path.includes('当前'));
        if (locationVars.length > 0) {
          const hasSceneInFirstMsg = locationVars.some(v => {
            const val = String(v.initialValue ?? '');
            return val.length > 0 && draft.firstMessage.includes(val);
          });
          if (!hasSceneInFirstMsg) {
            allIssues.push({
              type: 'warning',
              source: 'initvar↔开场白',
              message: `场景变量 [${locationVars.map(v => v.path).join(', ')}] 的初始值在开场白中未体现，建议确认一致性`,
              fix: {
                type: 'scene_first_message',
                vars: locationVars.map(v => ({ path: v.path, initialValue: String(v.initialValue ?? '') })),
              },
            });
          }
        }
      }
    }

    // 5. World book entry checks
    const userEntries = draft.lorebookEntries.filter((entry, idx) => !isSpecialLorebookEntry(entry, idx, stagedIndices));

    const emptyContentEntries = userEntries.filter(e => e.enabled && !e.content?.trim());
    if (emptyContentEntries.length > 0) {
      allIssues.push({
        type: 'warning',
        source: '世界书',
        message: `${emptyContentEntries.length} 个启用的用户条目内容为空`,
      });
    }

    const noKeyEntries = userEntries.filter(e => !e.constant && e.enabled && e.keys.length === 0);
    if (noKeyEntries.length > 0) {
      allIssues.push({
        type: 'warning',
        source: '世界书',
        message: `${noKeyEntries.length} 个非蓝灯用户条目没有触发关键词`,
      });
    }

    // 6. First message check
    if (!draft.firstMessage?.trim()) {
      allIssues.push({
        type: 'warning',
        source: '开场白',
        message: '开场白为空，对话将没有开场',
      });
    }

    setIssues(allIssues);
    setValidating(false);

    if (allIssues.filter(i => i.type === 'error').length === 0) {
      addToast('success', `校验完成：${allIssues.filter(i => i.type === 'warning').length} 个警告，0 个错误`);
    } else {
      addToast('error', `校验完成：${allIssues.filter(i => i.type === 'error').length} 个错误，${allIssues.filter(i => i.type === 'warning').length} 个警告`);
    }
  }, [draft, stats, addToast]);

  // ── Auto-fix ─────────────────────────────────────────────────────────────
  const handleAutoFix = useCallback(() => {
    if (!onFixEntries) return;
    setFixing(true);
    try {
      const result = autoFixEntries(draft.lorebookEntries);
      if (result.fixes.length > 0) {
        onFixEntries(result.entries);
        setAppliedFixes(result.fixes);
        addToast('success', `已修复 ${result.fixes.length} 个问题`);
        // Re-run validation after fix
        setTimeout(() => runValidation(), 100);
      } else {
        addToast('info', '没有发现可自动修复的问题');
      }
    } catch (err) {
      addToast('error', `修复失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setFixing(false);
    }
  }, [draft.lorebookEntries, onFixEntries, addToast, runValidation]);

  // ── AI fix per issue ─────────────────────────────────────────────────────
  const handleAiFix = useCallback(async (issue: ConsistencyIssue, index: number) => {
    if (!issue.fix) return;
    setAiFixingIndex(index);
    try {
      if (issue.fix.type === 'enum_missing') {
        const fix = issue.fix;
        const system = `你是角色卡世界书生成助手。根据变量路径和枚举值生成对应的世界书条目。输出必须是 JSON 数组，格式：\n[{ "key": "枚举值", "name": "条目名称", "content": "条目内容" }]\n不要添加任何解释文字，不要包裹在代码块中。`;
        const user = `变量路径：${fix.varPath}\n枚举值：${fix.enumValues.join(', ')}\n\n角色描述：\n${characterDescriptions}\n\n世界书背景：\n${worldbookContext}\n\n请为每个枚举值生成一个世界书条目，key 作为触发关键词。`;
        const result = await generateText(system, user);
        const jsonMatch = result.match(/\[[\s\S]*\]/);
        const parsedRaw = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
        const parsed = Array.isArray(parsedRaw) ? parsedRaw as Array<{ key?: string; name?: string; content?: string }> : [];
        const newEntries = parsed
          .filter(item => item.key && item.content)
          .map(item => {
            const entry = createEmptyLorebookEntry();
            entry.name = item.name || `${fix.varPath} - ${item.key}`;
            entry.keys = [item.key!];
            entry.content = item.content!;
            entry.comment = `AI 修复：${fix.varPath} 枚举值 ${item.key}`;
            return entry;
          });
        if (newEntries.length > 0) {
          onFixEntries?.([...draft.lorebookEntries, ...newEntries]);
          setAppliedFixes(prev => [...prev, `为 ${fix.varPath} 生成 ${newEntries.length} 个世界书条目`]);
          addToast('success', `已生成 ${newEntries.length} 个世界书条目`);
          setTimeout(() => runValidation(), 100);
        } else {
          addToast('info', 'AI 未返回有效的世界书条目');
        }
      } else if (issue.fix.type === 'scene_first_message') {
        const fix = issue.fix;
        const varsText = fix.vars.map(v => `${v.path}: ${v.initialValue}`).join('\n');
        const system = `你是角色扮演开场白改写助手。请把用户的开场白改写一遍，使其自然体现以下场景/地点变量的初始值。保持原有叙事风格和角色视角，只输出改写后的开场白，不要解释，不要加代码块。`;
        const user = `场景变量初始值：\n${varsText}\n\n角色描述：\n${characterDescriptions}\n\n世界书背景：\n${worldbookContext}\n\n当前开场白：\n${draft.firstMessage}\n\n请改写开场白，使其自然包含上述场景/地点信息。`;
        const result = await generateText(system, user);
        const newFirstMessage = result.trim();
        if (newFirstMessage) {
          onUpdateDraft?.({ firstMessage: newFirstMessage });
          setAppliedFixes(prev => [...prev, '已用 AI 改写开场白以体现场景变量']);
          addToast('success', '开场白已改写');
          setTimeout(() => runValidation(), 100);
        } else {
          addToast('info', 'AI 未返回有效开场白');
        }
      }
    } catch (err) {
      addToast('error', `AI 修复失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setAiFixingIndex(null);
    }
  }, [draft, characterDescriptions, worldbookContext, generateText, onFixEntries, onUpdateDraft, addToast, runValidation]);

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = useCallback(async (format: 'json' | 'png') => {
    setExportingFormat(format);
    try {
      const card = assembleCard(draft);

      if (format === 'json') {
        exportAsJson(card);
        addToast('success', 'JSON 卡片已导出！');
      } else {
        await exportAsPng(card, pngBuffer ?? undefined);
        addToast('success', 'PNG 卡片已导出！');
      }
    } catch (err: unknown) {
      addToast('error', `导出失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setExportingFormat(null);
    }
  }, [draft, pngBuffer, addToast]);

  // ── Preview ───────────────────────────────────────────────────────────────
  const generatePreview = useCallback(() => {
    const card = assembleCard(draft);
    const d = card.data;

    // Build preview JSON (with MVU bundle if enabled)
    const preview: Record<string, unknown> = {
      '卡片名称': d.name,
      '角色数': draft.characters.filter(c => c.name?.trim()).length,
      '世界书条目': d.character_book?.entries?.length || 0,
      '蓝灯条目': d.character_book?.entries?.filter((e: Record<string, unknown>) => e.constant).length || 0,
      '开场白长度': d.first_mes?.length || 0,
      '预估Token': stats.estimatedTokens,
    };

    if (draft.mvu?.enabled) {
      preview['MVU变量数'] = stats.mvuVarCount;
      preview['EJS条目数'] = stats.ejsEntryCount;
      preview['MVU脚本'] = 'Zod.txt + 变量列表 + 输出格式';
    }

    setCardPreview(JSON.stringify(preview, null, 2));
    setShowExportPreview(true);
  }, [draft, stats]);

  // ── PNG upload ────────────────────────────────────────────────────────────
  const handlePngUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const processed = await resizeImageToPngBuffer(file);
      onPngFileSelect?.(processed);
      addToast('success', '头像图片已加载');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : '图片处理失败');
    }
  }, [onPngFileSelect, addToast]);

  const errorCount = issues.filter(i => i.type === 'error').length;
  const warningCount = issues.filter(i => i.type === 'warning').length;
  const cardTagLabel = draft.tags.filter(tag => tag.trim()).join('、') || '未设置标签';

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-white">美化 & 导出</h2>
        </div>
      </div>

      {/* ── Export Section ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-emerald-300">📦 导出卡片</h3>
        </div>

        <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)] items-stretch">
          <div
            className="relative group min-h-[320px] aspect-[2/3] w-full max-w-[240px] mx-auto sm:mx-0 overflow-hidden rounded-2xl border border-emerald-500/30 bg-slate-950/50 cursor-pointer"
            onClick={() => document.getElementById('step-polish-cover-input')?.click()}
            title="点击上传或更换封面"
          >
            {coverPreviewUrl ? (
              <>
                <img
                  src={coverPreviewUrl}
                  alt="封面预览"
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-transparent to-transparent" />
                <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-sm text-white">
                  <Upload size={16} />
                  更换封面
                </div>
                <span className="absolute right-3 top-3 w-6 h-6 rounded-full bg-emerald-500 border border-white/30 flex items-center justify-center shadow-lg">
                  <Check size={13} className="text-white" />
                </span>
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,rgba(16,185,129,.18),transparent_45%),linear-gradient(135deg,rgba(15,23,42,.95),rgba(30,41,59,.82))]">
                <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-400/25 flex items-center justify-center">
                  <ImageIcon size={24} className="text-emerald-300" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-200">卡片封面</p>
                  <p className="text-xs text-slate-500 mt-1">点击上传长图封面</p>
                </div>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-8 flex justify-center px-4 pointer-events-none">
              <div className="rounded-full border border-white/10 bg-slate-950/75 px-3 py-1 text-[11px] text-slate-300 shadow-lg backdrop-blur">
                导入封面
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700/50 bg-slate-950/35 p-4 flex flex-col justify-between gap-4">
            <div className="rounded-xl border border-emerald-500/20 bg-slate-900/60 p-3">
              <p className="text-[10px] text-slate-500 mb-1">作品名</p>
              <p className="text-sm font-semibold text-slate-100 truncate" title={cardName || '未命名卡片'}>{cardName || '未命名卡片'}</p>
              <div className="mt-2 flex items-center gap-2 min-w-0">
                <span className="shrink-0 text-[10px] text-slate-500">卡片标签</span>
                <span className="min-w-0 truncate rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300" title={cardTagLabel}>
                  {cardTagLabel}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3">
                <p className="text-lg font-bold text-emerald-300 leading-none">{stats.entryCount}</p>
                <p className="text-[10px] text-slate-500 mt-1">世界书</p>
              </div>
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3">
                <p className="text-lg font-bold text-sky-300 leading-none">{stats.constantCount}</p>
                <p className="text-[10px] text-slate-500 mt-1">蓝灯</p>
              </div>
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3">
                <p className="text-lg font-bold text-amber-300 leading-none">{stats.mvuVarCount}</p>
                <p className="text-[10px] text-slate-500 mt-1">变量</p>
              </div>
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3">
                <p className="text-lg font-bold text-purple-300 leading-none">{stats.estimatedTokens}</p>
                <p className="text-[10px] text-slate-500 mt-1">Token</p>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-200">封面状态</p>
                <p className="text-[11px] text-slate-500 truncate">{coverPreviewUrl ? '已选择 PNG 封面图片' : '未上传封面，PNG 会使用默认图'}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${coverPreviewUrl ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700/60 text-slate-400'}`}>
                {coverPreviewUrl ? '已就绪' : '可选'}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => document.getElementById('step-polish-cover-input')?.click()}
                  className="gap-1.5"
                >
                  <Upload size={13} />
                  {coverPreviewUrl ? '更换封面' : '上传封面'}
                </Button>
                {coverPreviewUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onPngFileSelect?.(null)}
                    className="text-slate-400"
                  >
                    <Trash2 size={13} />
                    移除
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={generatePreview}>
                  📋 预览摘要
                </Button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  onClick={() => handleExport('json')}
                  disabled={exportingFormat !== null || errorCount > 0}
                  className="justify-center"
                >
                  {exportingFormat === 'json' ? '⏳ 导出中...' : '📥 导出 JSON'}
                </Button>
                <Button
                  onClick={() => handleExport('png')}
                  disabled={exportingFormat !== null || errorCount > 0}
                  className="justify-center"
                >
                  {exportingFormat === 'png' ? '⏳ 导出中...' : '🖼️ 导出 PNG'}
                </Button>
              </div>
            </div>

            <input
              id="step-polish-cover-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/*"
              onChange={handlePngUpload}
              className="hidden"
            />
          </div>
        </div>

        {showExportPreview && cardPreview && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400">导出预览</span>
              <Button variant="ghost" size="sm" onClick={() => setShowExportPreview(false)}>
                关闭
              </Button>
            </div>
            <pre className="text-xs text-slate-300 whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto font-mono">
              {cardPreview}
            </pre>
          </div>
        )}
      </div>

      {/* ── Stats Grid ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl bg-primary-tint-light border border-primary-tint-light p-3 text-center">
          <p className="text-2xl font-bold text-primary-bright">{stats.entryCount}</p>
          <p className="text-[10px] text-primary-muted">世界书条目</p>
        </div>
        <div className="rounded-xl bg-emerald-900/20 border border-emerald-700/40 p-3 text-center">
          <p className="text-2xl font-bold text-emerald-300">{stats.constantCount}</p>
          <p className="text-[10px] text-emerald-400/60">蓝灯条目</p>
        </div>
        <div className="rounded-xl bg-amber-900/20 border border-amber-700/40 p-3 text-center">
          <p className="text-2xl font-bold text-amber-300">{stats.mvuVarCount}</p>
          <p className="text-[10px] text-amber-400/60">MVU 变量</p>
        </div>
        <div className="rounded-xl bg-purple-900/20 border border-purple-700/40 p-3 text-center">
          <p className="text-2xl font-bold text-purple-300">{stats.estimatedTokens}</p>
          <p className="text-[10px] text-purple-400/60">预估 Token</p>
        </div>
      </div>

      {/* ── Quality Check ────────────────────────────────────────────────── */}
      <div className="mb-4">
        <QualityCheckPanel
          draft={draft}
          onJumpToStep={onJumpToStep}
          onOpenOptimize={handleOpenOptimize}
        />
      </div>

      {/* ── Validation Section ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-amber-300">🔍 一致性校验</h3>
            <p className="text-[11px] text-amber-400/60">
              检查 MVU 变量、EJS 配置、世界书条目、开场白之间的逻辑一致性
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={runValidation} disabled={validating}>
              {validating ? '⏳ 校验中...' : '🔄 运行校验'}
            </Button>
            {issues.length > 0 && onFixEntries && (
              <Button variant="ghost" size="sm" onClick={handleAutoFix} disabled={fixing}>
                {fixing ? '⏳ 修复中...' : '🔧 一键修复'}
              </Button>
            )}
          </div>
        </div>

        {/* Applied fixes display */}
        {appliedFixes.length > 0 && (
          <div className="mb-3 p-2 rounded-lg bg-emerald-900/20 border border-emerald-700/30 max-h-[120px] overflow-y-auto">
            <p className="text-[10px] text-emerald-400 font-medium mb-1">✅ 已应用的修复：</p>
            {appliedFixes.map((fix, i) => (
              <p key={i} className="text-[11px] text-emerald-300/80 pl-2">• {fix}</p>
            ))}
          </div>
        )}

        {issues.length > 0 && (
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {issues.map((issue, i) => (
              <div
                key={i}
                className={`flex items-start justify-between gap-2 text-xs px-3 py-2 rounded-lg ${
                  issue.type === 'error'
                    ? 'bg-red-900/20 border border-red-700/30 text-red-300'
                    : 'bg-amber-900/20 border border-amber-700/30 text-amber-300'
                }`}
              >
                <div className="flex items-start gap-2 min-w-0">
                  <span className="shrink-0 mt-0.5">{issue.type === 'error' ? '❌' : '⚠️'}</span>
                  <div className="min-w-0">
                    <span className="text-[10px] opacity-60">[{issue.source}]</span>{' '}
                    <span>{issue.message}</span>
                  </div>
                </div>
                {issue.fix && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-[10px] py-0.5 h-auto"
                    onClick={() => handleAiFix(issue, i)}
                    disabled={aiFixingIndex !== null}
                  >
                    {aiFixingIndex === i ? '⏳ 修复中...' : '✨ AI 修复'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {issues.length > 0 && (
          <div className="flex items-center gap-3 mt-3 pt-2 border-t border-amber-700/30">
            <span className="text-xs text-red-300">❌ {errorCount} 错误</span>
            <span className="text-xs text-amber-300">⚠️ {warningCount} 警告</span>
            {errorCount === 0 && (
              <span className="text-xs text-emerald-400 ml-auto">✅ 可以导出</span>
            )}
          </div>
        )}
      </div>


      {/* ── AI Optimize Compare Modal ──────────────────────────────────── */}
      <OptimizeCompareModal
        isOpen={optimizeOpen}
        onClose={() => setOptimizeOpen(false)}
        draft={draft}
        onUpdateDraft={(patch) => onUpdateDraft?.(patch)}
        initialSelected={optimizePreselect}
      />
    </div>
  );
}