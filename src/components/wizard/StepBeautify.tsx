/**
 * Step 6: Beautification / MVU - optional step for adding MVU state tracking
 * and frontend beautification to the character card.
 *
 * Features:
 *   - AI-powered MVU variable suggestion based on card content
 *   - Manual variable editor
 *   - Live preview of generated MVU five-piece set
 *   - Status bar configuration (safe_macro / dynamic_js)
 *   - Story view beautification
 *   - Asset download for use with SillyTavern
 *
 * Based on world-book-mcp v5 MVU methodology:
 *   schema.js → initvar.yaml → update-rules.yaml → variable-list.md → output-format.md
 */
import { useState, useCallback, useMemo, useRef } from 'react';
import { generateId } from '../../constants/defaults';
import type { MvuConfig, MvuVariable, MvuVariableKind } from '../../constants/defaults';
import { useAIGenerate } from '../../hooks/useAIGenerate';
import { Button } from '../shared/Button';
import { MvuStatusBarTest } from './MvuStatusBarTest';
import { validateMvuConfig, autoFixMvuConfig, summarizeIssues, fixSingleIssue, applyAiCorrection, groupIssuesByCategory, type MvuIssue } from '../../services/mvu-validator';
import {
  generateAllMvuAssets,
  downloadMvuAssets,
  packageMvuAssets,
} from '../../services/mvu-generator';

interface StepBeautifyProps {
  mvu: MvuConfig;
  cardName: string;
  characterSummaries: string;
  worldbookSummary: string;
  firstMessageExcerpt: string;
  onChange: (mvu: MvuConfig) => void;
}

type PreviewTab = 'schema' | 'initvar' | 'update-rules' | 'variable-list' | 'output-format' | 'statusbar' | 'story';

const KIND_OPTIONS: { value: MvuVariableKind; label: string }[] = [
  { value: 'number', label: '数字' },
  { value: 'string', label: '文本' },
  { value: 'boolean', label: '布尔' },
  { value: 'enum', label: '枚举' },
  { value: 'record', label: '记录' },
  { value: 'object', label: '对象' },
];

export function StepBeautify({
  mvu,
  cardName,
  characterSummaries,
  worldbookSummary,
  firstMessageExcerpt,
  onChange,
}: StepBeautifyProps) {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<PreviewTab>('schema');
  const [showPreview, setShowPreview] = useState(false);
  const [editingVarId, setEditingVarId] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<MvuIssue[] | null>(null);
  const [aiCorrectionLoading, setAiCorrectionLoading] = useState(false);
  const [aiCorrections, setAiCorrections] = useState<Array<{ path: string; action: string; reason: string; suggestion: Record<string, unknown> }> | null>(null);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [appliedSet, setAppliedSet] = useState<Set<number>>(new Set());
  const [customBarLoading, setCustomBarLoading] = useState(false);
  const [customBarError, setCustomBarError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);
  const { generateMvuVariables, correctMvuConfig, generateCustomStatusBar } = useAIGenerate();

  // ── Toggle MVU on/off ───────────────────────────────────────────────────

  const toggleMvu = useCallback(() => {
    onChange({ ...mvu, enabled: !mvu.enabled });
  }, [mvu, onChange]);

  // ── AI variable suggestion ──────────────────────────────────────────────

  const handleAiSuggest = useCallback(async () => {
    if (!cardName?.trim()) {
      setAiError('请先填写卡片名称');
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const suggestions = await generateMvuVariables(
        cardName,
        characterSummaries,
        worldbookSummary,
        firstMessageExcerpt,
      );

      if (suggestions.length === 0) {
        setAiError('AI 未能生成变量建议，请手动添加');
        return;
      }

      // Merge with existing variables (avoid duplicates by path)
      const existingPaths = new Set(mvu.variables.map(v => v.path.join('.')));
      const newVars: MvuVariable[] = suggestions
        .filter(s => {
          const p = Array.isArray(s.path) ? s.path.join('.') : '';
          return p && !existingPaths.has(p);
        })
        .map(s => ({
          id: generateId(),
          path: Array.isArray(s.path) ? s.path : [],
          kind: s.kind || 'string',
          defaultValue: s.defaultValue ?? (s.kind === 'number' ? 0 : s.kind === 'boolean' ? false : ''),
          description: s.description || '',
          enumValues: s.enumValues,
          min: s.min,
          max: s.max,
          hidden: s.hidden || false,
          readonly: s.readonly || false,
        }));

      if (newVars.length > 0) {
        onChange({
          ...mvu,
          enabled: true,
          variables: [...mvu.variables, ...newVars],
        });
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI 生成失败');
    } finally {
      setAiLoading(false);
    }
  }, [cardName, characterSummaries, worldbookSummary, firstMessageExcerpt, mvu, onChange, generateMvuVariables]);

  // ── Variable CRUD ──────────────────────────────────────────────────────

  const addVariable = useCallback(() => {
    const newVar: MvuVariable = {
      id: generateId(),
      path: ['新变量'],
      kind: 'number',
      defaultValue: 0,
      description: '',
    };
    onChange({ ...mvu, variables: [...mvu.variables, newVar] });
    setEditingVarId(newVar.id);
  }, [mvu, onChange]);

  const addSeparator = useCallback(() => {
    const newVar: MvuVariable = {
      id: generateId(),
      path: ['分隔线'],
      kind: 'string',
      defaultValue: '',
      description: '',
      isSeparator: true,
    };
    onChange({ ...mvu, variables: [...mvu.variables, newVar] });
    setEditingVarId(newVar.id);
  }, [mvu, onChange]);

  const removeVariable = useCallback((id: string) => {
    onChange({ ...mvu, variables: mvu.variables.filter(v => v.id !== id) });
    if (editingVarId === id) setEditingVarId(null);
  }, [mvu, onChange, editingVarId]);

  const updateVariable = useCallback((id: string, updates: Partial<MvuVariable>) => {
    onChange({
      ...mvu,
      variables: mvu.variables.map(v => v.id === id ? { ...v, ...updates } : v),
    });
  }, [mvu, onChange]);

  // ── Drag-and-drop reorder ─────────────────────────────────────────────

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      const vars = [...mvu.variables];
      const [removed] = vars.splice(dragIndex, 1);
      vars.splice(dragOverIndex, 0, removed);
      onChange({ ...mvu, variables: vars });
    }
    setDragIndex(null);
    setDragOverIndex(null);
    dragNodeRef.current = null;
  }, [dragIndex, dragOverIndex, mvu, onChange]);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  // ── Generate preview ───────────────────────────────────────────────────

  const generatedConfig = useMemo(() => {
    if (!mvu.enabled || mvu.variables.length === 0) return null;
    return generateAllMvuAssets(mvu);
  }, [mvu]);

  const handleGeneratePreview = useCallback(() => {
    setShowPreview(true);
  }, []);

  const handleDownload = useCallback(() => {
    if (generatedConfig) {
      downloadMvuAssets(generatedConfig);
    }
  }, [generatedConfig]);

  // ── Status bar toggle ──────────────────────────────────────────────────

  const toggleStatusBar = useCallback(() => {
    onChange({ ...mvu, statusBarEnabled: !mvu.statusBarEnabled });
  }, [mvu, onChange]);

  const toggleStoryBeautify = useCallback(() => {
    onChange({ ...mvu, storyBeautifyEnabled: !mvu.storyBeautifyEnabled });
  }, [mvu, onChange]);

  // ── Validation & Correction ──────────────────────────────────────────

  const handleValidate = useCallback(() => {
    const issues = validateMvuConfig(mvu);
    setValidationIssues(issues);
    setAiCorrections(null);
    setAppliedSet(new Set());
    // Auto-expand all categories with errors
    const cats = new Set(issues.filter(i => i.severity === 'error').map(i => i.category));
    setExpandedCats(cats);
  }, [mvu]);

  const handleAutoFix = useCallback(() => {
    const result = autoFixMvuConfig(mvu);
    onChange(result.config);
    setValidationIssues(result.remaining);
  }, [mvu, onChange]);

  const handleFixSingle = useCallback((issue: MvuIssue) => {
    const fixed = fixSingleIssue(mvu, issue);
    onChange(fixed);
    // Re-validate
    setValidationIssues(validateMvuConfig(fixed));
  }, [mvu, onChange]);

  const handleApplyAiCorrection = useCallback((index: number) => {
    if (!aiCorrections || appliedSet.has(index)) return;
    const correction = aiCorrections[index];
    const fixed = applyAiCorrection(mvu, correction);
    onChange(fixed);
    setAppliedSet(prev => new Set([...prev, index]));
    // Re-validate after applying
    setValidationIssues(validateMvuConfig(fixed));
  }, [mvu, aiCorrections, appliedSet, onChange]);

  const handleApplyAllAiCorrections = useCallback(() => {
    if (!aiCorrections) return;
    let config = mvu;
    const newApplied = new Set<number>();
    aiCorrections.forEach((c, i) => {
      if (!appliedSet.has(i)) {
        config = applyAiCorrection(config, c);
        newApplied.add(i);
      }
    });
    onChange(config);
    setAppliedSet(prev => new Set([...prev, ...newApplied]));
    setValidationIssues(validateMvuConfig(config));
  }, [mvu, aiCorrections, appliedSet, onChange]);

  const toggleCategory = useCallback((cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);

  const handleAiCorrection = useCallback(async () => {
    if (!cardName?.trim()) return;
    setAiCorrectionLoading(true);
    try {
      const existingIssues = validationIssues
        ? validationIssues.map(i => `- [${i.severity}] ${i.category}: ${i.message}`).join('\n')
        : '';
      const variables = mvu.variables.map(v => ({
        path: v.path.join('.'),
        kind: v.kind,
        defaultValue: v.defaultValue,
        description: v.description,
      }));
      const corrections = await correctMvuConfig(cardName, variables, existingIssues);
      setAiCorrections(corrections);
    } catch {
      // Error handled by useAIGenerate
    } finally {
      setAiCorrectionLoading(false);
    }
  }, [cardName, mvu.variables, validationIssues, correctMvuConfig]);

  // ── Custom status bar generation ──────────────────────────────────────

  const handleGenerateCustomBar = useCallback(async () => {
    if (!mvu.statusBarStylePrompt.trim()) {
      setCustomBarError('请先输入美化需求描述');
      return;
    }
    if (mvu.variables.length === 0) {
      setCustomBarError('请先添加 MVU 变量');
      return;
    }
    setCustomBarLoading(true);
    setCustomBarError(null);
    try {
      const variables = mvu.variables
        .filter(v => !v.hidden && !v.path.some(s => s.startsWith('$')))
        .map(v => ({
          path: v.path.join('.'),
          kind: v.kind,
          label: v.path.at(-1) ?? v.path.join('.'),
          defaultValue: v.defaultValue,
        }));
      const result = await generateCustomStatusBar(mvu.statusBarStylePrompt, variables, mvu.statusBarMode);
      if (result.html || result.css) {
        onChange({
          ...mvu,
          statusBarHtml: result.html,
          statusBarCss: result.css,
          statusBarCustomEnabled: true,
          statusBarEnabled: true,
        });
      } else {
        setCustomBarError('AI 未能生成状态栏代码，请尝试更详细的描述');
      }
    } catch {
      setCustomBarError('生成失败，请检查 API 配置后重试');
    } finally {
      setCustomBarLoading(false);
    }
  }, [mvu, onChange, generateCustomStatusBar]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-2">美化 / MVU 状态追踪</h2>
      <p className="text-sm text-slate-400 mb-6">
        可选步骤。启用 MVU 可以为角色卡添加状态追踪系统（好感度、地点、时间等），并生成前端美化资产。
        基于 <a href="https://github.com/QiHuang02/world-book-mcp" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300">world-book-mcp v5</a> 方法论。
      </p>

      {/* MVU Toggle */}
      <div className="flex items-center gap-3 mb-6">
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={mvu.enabled}
            onChange={toggleMvu}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
        </label>
        <span className="text-sm text-white">启用 MVU 状态追踪</span>
      </div>

      {mvu.enabled && (
        <div className="space-y-6">
          {/* AI Suggest button */}
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleAiSuggest}
              disabled={aiLoading}
              size="sm"
            >
              {aiLoading ? 'AI 分析中...' : 'AI 建议变量'}
            </Button>
            <span className="text-xs text-slate-500">
              根据卡片内容自动建议状态追踪变量
            </span>
          </div>
          {aiError && (
            <p className="text-xs text-red-400">{aiError}</p>
          )}

          {/* Variable list */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-indigo-300">
                变量列表 ({mvu.variables.length})
              </h3>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={addSeparator}>
                  + 分隔线
                </Button>
                <Button variant="ghost" size="sm" onClick={addVariable}>
                  + 添加变量
                </Button>
              </div>
            </div>

            {mvu.variables.length === 0 ? (
              <p className="text-sm text-slate-500 italic py-4 text-center border border-dashed border-slate-700 rounded-lg">
                暂无变量。点击上方按钮手动添加，或使用 AI 建议。
              </p>
            ) : (
              <div className="space-y-2">
                {mvu.variables.map((v, index) => (
                  <div
                    key={v.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      // Use a small timeout to avoid interfering with the drag image
                      dragNodeRef.current = e.currentTarget as HTMLDivElement;
                      handleDragStart(index);
                    }}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    onDragLeave={handleDragLeave}
                    className={`transition-all duration-150 ${
                      dragIndex === index ? 'opacity-40 scale-[0.98]' : ''
                    } ${
                      dragOverIndex === index && dragIndex !== index
                        ? 'ring-2 ring-indigo-500/60 ring-offset-1 ring-offset-slate-900 rounded-lg'
                        : ''
                    }`}
                  >
                    <VariableRow
                      variable={v}
                      index={index}
                      editing={editingVarId === v.id}
                      onEdit={() => setEditingVarId(editingVarId === v.id ? null : v.id)}
                      onUpdate={(updates) => updateVariable(v.id, updates)}
                      onRemove={() => removeVariable(v.id)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Validation & Correction ─────────────────────────────────────── */}
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-indigo-300">🔍 纠错与审核</h3>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={handleValidate}>
                  检查问题
                </Button>
                {validationIssues && validationIssues.some(i => i.autoFixable) && (
                  <Button size="sm" onClick={handleAutoFix}>
                    🔧 自动修复
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleAiCorrection}
                  disabled={aiCorrectionLoading}
                >
                  {aiCorrectionLoading ? 'AI 审核中...' : '🤖 AI 审核'}
                </Button>
              </div>
            </div>

            {/* Validation results — grouped by category */}
            {validationIssues !== null && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-400">{summarizeIssues(validationIssues)}</p>
                  {validationIssues.length > 0 && (
                    <button
                      onClick={() => setExpandedCats(
                        expandedCats.size > 0 ? new Set() : new Set(validationIssues.map(i => i.category))
                      )}
                      className="text-[10px] text-slate-500 hover:text-slate-300"
                    >
                      {expandedCats.size > 0 ? '全部折叠' : '全部展开'}
                    </button>
                  )}
                </div>
                {validationIssues.length > 0 && (
                  <div className="max-h-[320px] overflow-y-auto space-y-1.5">
                    {groupIssuesByCategory(validationIssues).map(group => {
                      const isExpanded = expandedCats.has(group.category);
                      const hasErrors = group.issues.some(i => i.severity === 'error');
                      const hasWarnings = group.issues.some(i => i.severity === 'warning');
                      const fixableCount = group.issues.filter(i => i.autoFixable).length;
                      return (
                        <div key={group.category} className={`rounded-lg border ${
                          hasErrors ? 'border-red-700/40' : hasWarnings ? 'border-amber-700/40' : 'border-slate-700/40'
                        } overflow-hidden`}>
                          {/* Category header — clickable to expand */}
                          <button
                            onClick={() => toggleCategory(group.category)}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-800/50 transition-colors ${
                              hasErrors ? 'bg-red-900/10' : hasWarnings ? 'bg-amber-900/10' : 'bg-slate-800/30'
                            }`}
                          >
                            <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                            <span className={`font-semibold ${
                              hasErrors ? 'text-red-300' : hasWarnings ? 'text-amber-300' : 'text-slate-400'
                            }`}>{group.category}</span>
                            <span className="text-slate-500">({group.issues.length})</span>
                            {fixableCount > 0 && (
                              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-emerald-800/30 text-emerald-300">
                                {fixableCount} 可修复
                              </span>
                            )}
                          </button>
                          {/* Expanded issues */}
                          {isExpanded && (
                            <div className="divide-y divide-slate-800/50">
                              {group.issues.map(issue => (
                                <div
                                  key={issue.id}
                                  className="flex items-start gap-2 px-3 py-2 text-xs"
                                >
                                  <span className="shrink-0 mt-0.5">
                                    {issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <p className={`${
                                      issue.severity === 'error' ? 'text-red-300' : issue.severity === 'warning' ? 'text-amber-300' : 'text-slate-400'
                                    }`}>{issue.message}</p>
                                    {issue.variableId && (
                                      <p className="text-[10px] text-slate-600 mt-0.5 font-mono">
                                        ID: {issue.variableId.slice(0, 8)}...
                                      </p>
                                    )}
                                  </div>
                                  {issue.autoFixable && (
                                    <button
                                      onClick={() => handleFixSingle(issue)}
                                      className="shrink-0 text-[10px] px-2 py-1 rounded bg-emerald-800/30 text-emerald-300 hover:bg-emerald-700/40 transition-colors"
                                    >
                                      🔧 {issue.fixLabel || '修复'}
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* AI correction results */}
            {aiCorrections !== null && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-400">
                    {aiCorrections.length > 0
                      ? `🤖 AI 发现 ${aiCorrections.length} 个语义问题`
                      : '🤖 AI 未发现问题'}
                  </p>
                  {aiCorrections.length > 0 && (
                    <button
                      onClick={handleApplyAllAiCorrections}
                      disabled={appliedSet.size >= aiCorrections.length}
                      className="text-[10px] px-2 py-1 rounded bg-violet-800/40 text-violet-200 hover:bg-violet-700/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {appliedSet.size >= aiCorrections.length ? '✅ 已全部应用' : `应用全部 (${aiCorrections.length - appliedSet.size})`}
                    </button>
                  )}
                </div>
                {aiCorrections.length > 0 && (
                  <div className="max-h-[280px] overflow-y-auto space-y-1.5">
                    {aiCorrections.map((c, i) => {
                      const isApplied = appliedSet.has(i);
                      return (
                        <div
                          key={i}
                          className={`px-3 py-2.5 rounded-lg border text-xs transition-all ${
                            isApplied
                              ? 'bg-emerald-900/10 border-emerald-700/30 opacity-60'
                              : 'bg-violet-900/15 border-violet-700/30'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-violet-300 font-medium font-mono">{c.path}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-800/40 text-violet-200">
                              {c.action}
                            </span>
                            {isApplied && (
                              <span className="ml-auto text-[10px] text-emerald-400">✅ 已应用</span>
                            )}
                            {!isApplied && (
                              <button
                                onClick={() => handleApplyAiCorrection(i)}
                                className="ml-auto text-[10px] px-2 py-1 rounded bg-violet-700/40 text-violet-200 hover:bg-violet-600/50 transition-colors"
                              >
                                应用
                              </button>
                            )}
                          </div>
                          <p className="text-slate-400 leading-relaxed">{c.reason}</p>
                          {c.suggestion && Object.keys(c.suggestion).length > 0 && (
                            <div className="mt-1.5 p-2 rounded bg-slate-900/50 border border-slate-800/50">
                              <p className="text-[10px] text-slate-500 mb-1">建议修改：</p>
                              <pre className="text-[10px] text-violet-300/70 font-mono whitespace-pre-wrap">
                                {JSON.stringify(c.suggestion, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Frontend beautification options */}
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-indigo-300">前端美化选项</h3>

            {/* Status bar */}
            <div className="flex flex-wrap items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={mvu.statusBarEnabled}
                  onChange={toggleStatusBar}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
              </label>
              <span className="text-sm text-white">HTML 状态栏</span>
              {mvu.statusBarEnabled && (
                <select
                  value={mvu.statusBarMode}
                  onChange={(e) => onChange({ ...mvu, statusBarMode: e.target.value as 'safe_macro' | 'dynamic_js' })}
                  className="ml-2 text-xs bg-slate-700 text-slate-300 border border-slate-600 rounded px-2 py-1"
                >
                  <option value="safe_macro">safe_macro (推荐)</option>
                  <option value="dynamic_js">dynamic_js (高级)</option>
                </select>
              )}
            </div>

            {/* Custom status bar style prompt */}
            {mvu.statusBarEnabled && (
              <div className="rounded-lg border border-cyan-800/40 bg-cyan-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-cyan-300">✨ 自定义美化风格</h4>
                  {mvu.statusBarCustomEnabled && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-800/30 text-emerald-300">已启用自定义</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  描述你想要的状态栏视觉风格，AI 会生成对应的 HTML + CSS。
                </p>
                <textarea
                  value={mvu.statusBarStylePrompt}
                  onChange={(e) => onChange({ ...mvu, statusBarStylePrompt: e.target.value })}
                  placeholder={"例如：赛博朋克风格，深色背景配露光边框，变量用进度条显示，重要数值用红色高亮\n例如：古风仙侠风格，水墨背景，变量用卷轴式布局\n例如：极简暗黑风格，无多余装饰，数值用颜色编码"}
                  className="w-full h-24 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 resize-y focus:border-cyan-500 focus:outline-none"
                />
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    onClick={handleGenerateCustomBar}
                    disabled={customBarLoading || !mvu.statusBarStylePrompt.trim()}
                  >
                    {customBarLoading ? '🤖 生成中...' : '🤖 AI 生成状态栏'}
                  </Button>
                  {mvu.statusBarCustomEnabled && (
                    <button
                      onClick={() => onChange({ ...mvu, statusBarCustomEnabled: false, statusBarHtml: '', statusBarCss: '' })}
                      className="text-[10px] text-slate-500 hover:text-slate-300"
                    >
                      重置为默认样式
                    </button>
                  )}
                </div>
                {customBarError && (
                  <p className="text-[11px] text-red-400">{customBarError}</p>
                )}
                {mvu.statusBarCustomEnabled && mvu.statusBarHtml && (
                  <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3">
                    <p className="text-[10px] text-slate-500 mb-2">生成结果预览：</p>
                    <div className="max-h-[200px] overflow-y-auto">
                      <style>{mvu.statusBarCss}</style>
                      <div dangerouslySetInnerHTML={{ __html: mvu.statusBarHtml }} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Story beautification */}
            <div className="flex flex-wrap items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={mvu.storyBeautifyEnabled}
                  onChange={toggleStoryBeautify}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
              </label>
              <span className="text-sm text-white">正文美化标签</span>
              {mvu.storyBeautifyEnabled && (
                <input
                  type="text"
                  value={mvu.storyBeautifyTag}
                  onChange={(e) => onChange({ ...mvu, storyBeautifyTag: e.target.value })}
                  placeholder="story_view"
                  className="ml-0 sm:ml-2 text-xs bg-slate-700 text-slate-300 border border-slate-600 rounded px-2 py-1 w-full sm:w-32"
                />
              )}
            </div>
          </div>

          {/* Generate & Download */}
          {mvu.variables.length > 0 && (
            <div className="flex items-center gap-3">
              <Button onClick={handleGeneratePreview} size="sm">
                生成预览
              </Button>
              <Button variant="secondary" onClick={handleDownload} size="sm">
                下载 MVU 资产文件
              </Button>
              <span className="text-xs text-slate-500">
                {packageMvuAssets(generatedConfig || mvu).length} 个文件
              </span>
            </div>
          )}

          {/* Asset preview */}
          {showPreview && generatedConfig && (
            <div className="rounded-xl border border-slate-700 bg-slate-900/80 overflow-hidden">
              {/* Tabs */}
              <div className="flex border-b border-slate-700 overflow-x-auto">
                {([
                  ['schema', 'schema.js'],
                  ['initvar', 'initvar.yaml'],
                  ['update-rules', 'update-rules.yaml'],
                  ['variable-list', 'variable-list.md'],
                  ['output-format', 'output-format.md'],
                  ...(mvu.statusBarEnabled ? [['statusbar', '状态栏']] as const : []),
                  ...(mvu.storyBeautifyEnabled ? [['story', '正文美化']] as const : []),
                ] as Array<[PreviewTab, string]>).map(([tab, label]) => (
                  <button
                    key={tab}
                    onClick={() => setPreviewTab(tab)}
                    className={`px-3 py-2 text-xs whitespace-nowrap transition-colors ${
                      previewTab === tab
                        ? 'text-indigo-300 border-b-2 border-indigo-500 bg-slate-800/50'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Preview content */}
              <div className="p-4 max-h-[400px] overflow-y-auto">
                <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap">
                  {getPreviewContent(generatedConfig, previewTab)}
                </pre>
              </div>
            </div>
          )}

          {/* MVU Status Bar Test Panel */}
          <MvuStatusBarTest mvu={mvu} />
        </div>
      )}
    </div>
  );
}

// ── Variable row component ────────────────────────────────────────────────

function VariableRow({
  variable,
  index,
  editing,
  onEdit,
  onUpdate,
  onRemove,
}: {
  variable: MvuVariable;
  index: number;
  editing: boolean;
  onEdit: () => void;
  onUpdate: (updates: Partial<MvuVariable>) => void;
  onRemove: () => void;
}) {
  const dotPath = variable.path.join('.');
  const kindLabel = KIND_OPTIONS.find(k => k.value === variable.kind)?.label ?? variable.kind;

  // ── Separator mode: minimal label-only row ──
  if (variable.isSeparator) {
    if (!editing) {
      return (
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-dashed border-slate-600 bg-slate-800/30 cursor-pointer hover:bg-slate-800/60 transition-colors"
          onClick={onEdit}
        >
          <span
            className="text-slate-600 cursor-grab active:cursor-grabbing select-none text-lg leading-none shrink-0 hover:text-slate-400 transition-colors"
            title="拖拽排序"
            onClick={(e) => e.stopPropagation()}
          >
            ⠿
          </span>
          <span className="text-sm text-indigo-400 font-semibold tracking-wide">{dotPath}</span>
          <span className="flex-1 border-b border-slate-700 mx-2" />
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-500">分隔线</span>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="text-xs text-red-400 hover:text-red-300 ml-2"
          >
            x
          </button>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-indigo-600/50 bg-slate-800/80 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span
            className="text-slate-600 cursor-grab active:cursor-grabbing select-none text-lg leading-none shrink-0 hover:text-slate-400 transition-colors"
            title="拖拽排序"
          >
            ⠿
          </span>
          <span className="text-xs text-slate-500 font-mono">#{index + 1}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-800/40 text-indigo-300">分隔线</span>
          <span className="text-xs text-slate-500 ml-auto">拖拽左侧手柄调整顺序</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400 w-16 shrink-0">标题</label>
          <input
            type="text"
            value={variable.path.join('.')}
            onChange={(e) => {
              const newPath = e.target.value.split('.').map(s => s.trim()).filter(Boolean);
              if (newPath.length > 0) onUpdate({ path: newPath });
            }}
            className="flex-1 text-sm bg-slate-700 text-white border border-slate-600 rounded px-2 py-1 font-mono"
            placeholder="分隔线标题"
          />
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => onUpdate({ isSeparator: false })}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            转为普通变量
          </button>
          <button
            onClick={onEdit}
            className="text-xs text-indigo-400 hover:text-indigo-300 ml-auto"
          >
            完成编辑
          </button>
        </div>
      </div>
    );
  }

  // ── Regular variable: non-editing view ──
  if (!editing) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 cursor-pointer hover:bg-slate-800 transition-colors"
        onClick={onEdit}
      >
        <span
          className="text-slate-600 cursor-grab active:cursor-grabbing select-none text-lg leading-none shrink-0 hover:text-slate-400 transition-colors"
          title="拖拽排序"
          onClick={(e) => e.stopPropagation()}
        >
          ⠿
        </span>
        <div className="flex-1 min-w-0">
          <span className="text-sm text-white font-mono">{dotPath}</span>
          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
            {kindLabel}
          </span>
          {variable.hidden && (
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-500">$ 隐藏</span>
          )}
          {variable.readonly && (
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-500">_ 只读</span>
          )}
        </div>
        <span className="text-xs text-slate-500 truncate max-w-[150px]">
          {variable.description || String(variable.defaultValue)}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="text-xs text-red-400 hover:text-red-300 ml-2"
        >
          x
        </button>
      </div>
    );
  }

  // ── Regular variable: editing view ──
  return (
    <div className="rounded-lg border border-indigo-600/50 bg-slate-800/80 p-4 space-y-3">
      {/* Drag handle + header */}
      <div className="flex items-center gap-2">
        <span
          className="text-slate-600 cursor-grab active:cursor-grabbing select-none text-lg leading-none shrink-0 hover:text-slate-400 transition-colors"
          title="拖拽排序"
        >
          ⠿
        </span>
        <span className="text-xs text-slate-500 font-mono">#{index + 1}</span>
        <span className="text-xs text-slate-500 ml-auto">拖拽左侧手柄调整顺序</span>
      </div>
      {/* Path */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-400 w-16 shrink-0">路径</label>
        <input
          type="text"
          value={variable.path.join('.')}
          onChange={(e) => {
            const newPath = e.target.value.split('.').map(s => s.trim()).filter(Boolean);
            if (newPath.length > 0) onUpdate({ path: newPath });
          }}
          className="flex-1 text-sm bg-slate-700 text-white border border-slate-600 rounded px-2 py-1 font-mono"
          placeholder="主体.变量名"
        />
      </div>

      {/* Kind & default value */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-400 w-16 shrink-0">类型</label>
        <select
          value={variable.kind}
          onChange={(e) => {
            const kind = e.target.value as MvuVariableKind;
            const defaultValue = kind === 'number' ? 0 : kind === 'boolean' ? false : kind === 'enum' ? '' : '';
            onUpdate({ kind, defaultValue });
          }}
          className="text-sm bg-slate-700 text-white border border-slate-600 rounded px-2 py-1"
        >
          {KIND_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <label className="text-xs text-slate-400 ml-2">默认值</label>
        {variable.kind === 'boolean' ? (
          <select
            value={String(variable.defaultValue)}
            onChange={(e) => onUpdate({ defaultValue: e.target.value === 'true' })}
            className="text-sm bg-slate-700 text-white border border-slate-600 rounded px-2 py-1"
          >
            <option value="false">false</option>
            <option value="true">true</option>
          </select>
        ) : variable.kind === 'enum' ? (
          <input
            type="text"
            value={String(variable.defaultValue ?? '')}
            onChange={(e) => onUpdate({ defaultValue: e.target.value })}
            className="flex-1 text-sm bg-slate-700 text-white border border-slate-600 rounded px-2 py-1"
            placeholder="默认枚举值"
          />
        ) : (
          <input
            type={variable.kind === 'number' ? 'number' : 'text'}
            value={String(variable.defaultValue ?? '')}
            onChange={(e) => {
              const val = variable.kind === 'number' ? Number(e.target.value) : e.target.value;
              onUpdate({ defaultValue: val });
            }}
            className="flex-1 text-sm bg-slate-700 text-white border border-slate-600 rounded px-2 py-1"
          />
        )}
      </div>

      {/* Enum values (only for enum type) */}
      {variable.kind === 'enum' && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400 w-16 shrink-0">枚举值</label>
          <input
            type="text"
            value={(variable.enumValues ?? []).join(', ')}
            onChange={(e) => {
              onUpdate({ enumValues: e.target.value.split(',').map(s => s.trim()).filter(Boolean) });
            }}
            className="flex-1 text-sm bg-slate-700 text-white border border-slate-600 rounded px-2 py-1"
            placeholder="值1, 值2, 值3"
          />
        </div>
      )}

      {/* Number range */}
      {variable.kind === 'number' && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400 w-16 shrink-0">范围</label>
          <input
            type="number"
            value={variable.min ?? ''}
            onChange={(e) => onUpdate({ min: e.target.value ? Number(e.target.value) : undefined })}
            className="w-20 text-sm bg-slate-700 text-white border border-slate-600 rounded px-2 py-1"
            placeholder="最小"
          />
          <span className="text-slate-500">~</span>
          <input
            type="number"
            value={variable.max ?? ''}
            onChange={(e) => onUpdate({ max: e.target.value ? Number(e.target.value) : undefined })}
            className="w-20 text-sm bg-slate-700 text-white border border-slate-600 rounded px-2 py-1"
            placeholder="最大"
          />
        </div>
      )}

      {/* Description */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-400 w-16 shrink-0">说明</label>
        <input
          type="text"
          value={variable.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          className="flex-1 text-sm bg-slate-700 text-white border border-slate-600 rounded px-2 py-1"
          placeholder="变量用途说明"
        />
      </div>

      {/* Flags */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={variable.hidden ?? false}
            onChange={(e) => onUpdate({ hidden: e.target.checked })}
            className="rounded border-slate-600 bg-slate-700 text-indigo-600"
          />
          <span className="text-xs text-slate-400">$ 隐藏 (AI 不可见)</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={variable.readonly ?? false}
            onChange={(e) => onUpdate({ readonly: e.target.checked })}
            className="rounded border-slate-600 bg-slate-700 text-indigo-600"
          />
          <span className="text-xs text-slate-400">_ 只读 (AI 不更新)</span>
        </label>
        <button
          onClick={() => onUpdate({ isSeparator: true, kind: 'string', defaultValue: '' })}
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          转为分隔线
        </button>
        <button
          onClick={onEdit}
          className="text-xs text-indigo-400 hover:text-indigo-300 ml-auto"
        >
          完成编辑
        </button>
      </div>
    </div>
  );
}

// ── Preview content helper ────────────────────────────────────────────────

function getPreviewContent(config: MvuConfig, tab: PreviewTab): string {
  switch (tab) {
    case 'schema': return config.schemaJs || '(空)';
    case 'initvar': return config.initvarYaml || '(空)';
    case 'update-rules': return config.updateRulesYaml || '(空)';
    case 'variable-list': return config.variableListMd || '(空)';
    case 'output-format': return config.outputFormatMd || '(空)';
    case 'statusbar': return config.statusBarHtml || '(未启用)';
    case 'story': return config.storyBeautifyHtml || '(未启用)';
    default: return '';
  }
}
