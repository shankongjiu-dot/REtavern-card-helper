/**
 * Step 6: Review & Save - preview of all card fields aligned with V2 spec.
 * Shows JSON preview (spec-compliant export) and allows saving to the library.
 * Includes AI Card Diagnosis (小皮医生) feature.
 */
import { useState, useCallback } from 'react';
import { assembleCard, exportAsJson, exportAsPng } from '../../services/card-exporter';
import { validateCard } from '../../services/card-validator';
import { useAIGenerate } from '../../hooks/useAIGenerate';
import { useToast } from '../shared/Toast';
import { Button } from '../shared/Button';
import type { WizardDraft } from '../../constants/defaults';

interface StepReviewProps {
  draft: WizardDraft;
}

interface DiagnosisReport {
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

function estimateTokens(text: string): number {
  return Math.round((text || '').length * 1.3);
}

export function StepReview({ draft }: StepReviewProps) {
  const [showJson, setShowJson] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosisReport, setDiagnosisReport] = useState<DiagnosisReport | null>(null);
  const { diagnoseCard } = useAIGenerate();
  const { addToast } = useToast();

  // Assemble card preview
  const card = assembleCard(draft);
  const validation = validateCard(card);
  const enabledEntries = draft.lorebookEntries.filter(e => e.enabled !== false);
  const constantEntries = enabledEntries.filter(e => e.constant);
  const triggerEntries = enabledEntries.filter(e => !e.constant);
  const emptyEntries = draft.lorebookEntries.filter(e => !e.content.trim());
  const noKeyEntries = triggerEntries.filter(e => e.keys.length === 0);
  const neverTriggerEntries = enabledEntries.filter(e => e.probability === 0);
  const worldbookTokens = draft.lorebookEntries.reduce((sum, e) => sum + estimateTokens(e.content), 0);
  const constantTokens = constantEntries.reduce((sum, e) => sum + estimateTokens(e.content), 0);
  const longestEntry = draft.lorebookEntries.reduce((max, entry) =>
    entry.content.length > max.content.length ? entry : max,
    { name: '', content: '' } as { name: string; content: string },
  );
  const jsonString = JSON.stringify(
    { spec: card.spec, spec_version: card.spec_version, data: card.data },
    null,
    2,
  );

  const handleCopyJson = async () => {
    await navigator.clipboard.writeText(jsonString);
  };

  const handleDiagnose = useCallback(async () => {
    setDiagnosing(true);
    setDiagnosisReport(null);
    try {
      const report = await diagnoseCard(card.data as Record<string, unknown>);
      if (report) {
        setDiagnosisReport(report);
      } else {
        addToast('error', 'AI 诊断未返回有效结果，请重试');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '诊断失败';
      addToast('error', `AI 诊断失败：${msg}`);
    } finally {
      setDiagnosing(false);
    }
  }, [diagnoseCard, card.data, addToast]);

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-6">预览与保存</h2>

      {/* Validation status */}
      {!validation.valid && (
        <div className="rounded-lg bg-red-900/30 border border-red-700 px-4 py-3 mb-4">
          <p className="text-sm text-red-300 font-semibold mb-1">⚠ 存在问题:</p>
          {validation.errors.map((e, i) => (
            <p key={i} className="text-xs text-red-300">• {e}</p>
          ))}
        </div>
      )}
      {validation.warnings.length > 0 && (
        <div className="rounded-lg bg-amber-900/20 border border-amber-700/50 px-4 py-3 mb-4">
          <p className="text-sm text-amber-300 font-semibold mb-1">提示:</p>
          {validation.warnings.slice(0, 5).map((w, i) => (
            <p key={i} className="text-xs text-amber-300">• {w}</p>
          ))}
          {validation.warnings.length > 5 && (
            <p className="text-xs text-amber-400 mt-1">...还有 {validation.warnings.length - 5} 条提示</p>
          )}
        </div>
      )}

      {/* Card stats */}
      <div className="rounded-xl border border-cyan-700/40 bg-cyan-950/20 p-5 mb-4">
        <h3 className="text-sm font-semibold text-cyan-300 mb-3">卡片统计</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <Stat label="角色" value={draft.characters.filter(c => c.name.trim()).length} />
          <Stat label="世界书" value={draft.lorebookEntries.length} />
          <Stat label="启用条目" value={enabledEntries.length} />
          <Stat label="常驻条目" value={constantEntries.length} />
          <Stat label="触发条目" value={triggerEntries.length} />
          <Stat label="世界书估算" value={`~${worldbookTokens} Token`} />
          <Stat label="常驻估算" value={`~${constantTokens} Token`} />
          <Stat label="MVU 变量" value={draft.mvu?.variables.length ?? 0} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {emptyEntries.length > 0 && <Badge tone="warn">空内容 {emptyEntries.length}</Badge>}
          {noKeyEntries.length > 0 && <Badge tone="warn">无触发词 {noKeyEntries.length}</Badge>}
          {neverTriggerEntries.length > 0 && <Badge tone="warn">永不触发 {neverTriggerEntries.length}</Badge>}
          {longestEntry.content && <Badge tone="info">最长条目：{longestEntry.name || '未命名'} · {longestEntry.content.length} 字</Badge>}
          {constantTokens > draft.bookTokenBudget && <Badge tone="danger">常驻内容超过预算</Badge>}
        </div>
      </div>

      {/* Card summary */}
      <div className="space-y-4">
        {/* Card Name */}
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
          <h3 className="text-sm font-semibold text-indigo-300 mb-2">卡片名称</h3>
          <p className="text-white">{draft.cardName || '(空)'}</p>
          {Array.isArray(draft.tags) && draft.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {draft.tags.map((tag, i) => (
                <span key={i} className="px-1.5 py-0.5 bg-slate-700 text-slate-300 text-xs rounded">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Characters */}
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
          <h3 className="text-sm font-semibold text-indigo-300 mb-2">
            角色 ({draft.characters.length}){' '}
            <span className="text-slate-500 font-normal">— 自动注入世界书</span>
          </h3>
          {draft.characters.map((c, i) => (
            <div key={c.id} className="mb-3 last:mb-0">
              <p className="text-white font-medium">{c.name || `角色 ${i + 1}`}</p>
              <p className="text-sm text-slate-400 mt-1 line-clamp-3">
                {c.description || '(无描述)'}
              </p>
            </div>
          ))}
        </div>

        {/* Scenario */}
        {draft.scenario && (
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <h3 className="text-sm font-semibold text-indigo-300 mb-2">
              场景 / Scenario <span className="text-slate-500 font-normal">— 永久 Token</span>
            </h3>
            <p className="text-sm text-slate-300 whitespace-pre-wrap line-clamp-3">{draft.scenario}</p>
          </div>
        )}

        {/* World Book */}
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
          <h3 className="text-sm font-semibold text-indigo-300 mb-2">
            世界书 ({draft.lorebookEntries.length} 个条目) <span className="text-slate-500 font-normal">— 动态 Token</span>
          </h3>
          {draft.lorebookEntries.length === 0 ? (
            <p className="text-slate-500 text-sm">无世界书条目</p>
          ) : (
            (draft.lorebookEntries ?? []).map((entry, i) => (
              <div key={entry.id} className="mb-2 last:mb-0 flex items-start gap-2">
                <div className="flex-1">
                  <p className="text-white text-sm font-medium">
                    {entry.name || `条目 ${i + 1}`}
                    {entry.constant && (
                      <span className="ml-1 text-[10px] bg-emerald-800/50 text-emerald-300 px-1 rounded">常量</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    关键词: {entry.keys.join(', ') || '(无)'}
                  </p>
                </div>
              </div>
            ))
          )}
          <p className="text-[11px] text-slate-600 mt-2">
            扫描深度: {draft.bookScanDepth} · Token 预算: {draft.bookTokenBudget}
          </p>
        </div>

        {/* First Message */}
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
          <h3 className="text-sm font-semibold text-indigo-300 mb-2">开场白</h3>
          <p className="text-sm text-slate-300 whitespace-pre-wrap line-clamp-4">
            {draft.firstMessage || '(空)'}
          </p>
          {draft.alternate_greetings.length > 0 && (
            <p className="text-[11px] text-slate-500 mt-2">
              + {draft.alternate_greetings.length} 个备选开场白
            </p>
          )}
        </div>

        {/* Example Dialogues */}
        {draft.exampleDialogues && (
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <h3 className="text-sm font-semibold text-indigo-300 mb-2">示例对话</h3>
            <pre className="text-xs text-slate-400 whitespace-pre-wrap font-mono line-clamp-4">
              {draft.exampleDialogues}
            </pre>
          </div>
        )}

        {/* MVU & Beautification */}
        {draft.mvu?.enabled && draft.mvu.variables.length > 0 && (
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <h3 className="text-sm font-semibold text-indigo-300 mb-2">
              MVU 状态追踪 ({draft.mvu.variables.length} 个变量)
            </h3>
            <div className="space-y-1">
              {draft.mvu.variables.slice(0, 10).map(v => (
                <div key={v.id} className="flex items-center gap-2 text-xs">
                  <span className="text-white font-mono">{v.path.join('.')}</span>
                  <span className="text-slate-500">({v.kind})</span>
                  <span className="text-slate-500">=</span>
                  <span className="text-slate-400">{String(v.defaultValue)}</span>
                  {v.description && (
                    <span className="text-slate-600 truncate">— {v.description}</span>
                  )}
                </div>
              ))}
              {draft.mvu.variables.length > 10 && (
                <p className="text-xs text-slate-500">...还有 {draft.mvu.variables.length - 10} 个变量</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {draft.mvu.statusBarEnabled && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-800/40 text-emerald-300">
                  状态栏 ({draft.mvu.statusBarMode})
                </span>
              )}
              {draft.mvu.storyBeautifyEnabled && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-800/40 text-emerald-300">
                  正文美化 (&lt;{draft.mvu.storyBeautifyTag}&gt;)
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Advanced V2 fields toggle */}
      <div className="mt-4">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-sm text-indigo-400 hover:text-indigo-300"
        >
          {showAdvanced ? '▼' : '▶'} 高级 V2 字段
        </button>
        {showAdvanced && (
          <div className="mt-3 rounded-xl border border-slate-700 bg-slate-800/50 p-5 space-y-3">
            <Field label="system_prompt" value={draft.system_prompt} hint="覆盖默认系统提示词（空=使用用户默认）" />
            <Field label="post_history_instructions" value={draft.post_history_instructions} hint="对话后指令 / jailbreak" />
            <Field label="creator" value={draft.creator} hint="创建者名称" />
            <Field label="character_version" value={draft.character_version} hint="角色版本" />
            <Field label="creator_notes" value={draft.creator_notes} hint="创建者备注（不出现在提示词中）" multiline />
          </div>
        )}
      </div>

      {/* AI Diagnosis section */}
      <div className="mt-6">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleDiagnose}
          disabled={diagnosing}
        >
          {diagnosing ? '⏳ AI 诊断中...' : '🩺 AI 角色卡诊断'}
        </Button>
        {diagnosisReport && (
          <div className="mt-4 rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">🩺</span>
              <div>
                <h3 className="text-sm font-semibold text-white">AI 诊断报告</h3>
                <p className="text-xs text-slate-400 mt-0.5">{diagnosisReport.summary}</p>
              </div>
              <div className="ml-auto text-right">
                <span className={`text-2xl font-bold ${
                  diagnosisReport.overall_score >= 80 ? 'text-emerald-400' :
                  diagnosisReport.overall_score >= 60 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {diagnosisReport.overall_score}
                </span>
                <span className="text-xs text-slate-500 block">/100</span>
              </div>
            </div>

            {/* Highlights */}
            {diagnosisReport.highlights.length > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-emerald-900/20 border border-emerald-800/30">
                <p className="text-xs font-medium text-emerald-300 mb-1">✨ 亮点</p>
                {diagnosisReport.highlights.map((h, i) => (
                  <p key={i} className="text-xs text-emerald-200/80">• {h}</p>
                ))}
              </div>
            )}

            {/* Categories */}
            <div className="space-y-3">
              {diagnosisReport.categories.map((cat, i) => (
                <div key={i} className="p-3 rounded-lg bg-slate-900/50 border border-slate-700/50">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-white">{cat.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      cat.score >= 80 ? 'bg-emerald-800/40 text-emerald-300' :
                      cat.score >= 60 ? 'bg-amber-800/40 text-amber-300' : 'bg-red-800/40 text-red-300'
                    }`}>
                      {cat.score}分
                    </span>
                  </div>
                  {cat.issues.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] text-red-400 font-medium mb-0.5">问题</p>
                      {cat.issues.map((issue, j) => (
                        <p key={j} className="text-xs text-slate-400">• {issue}</p>
                      ))}
                    </div>
                  )}
                  {cat.suggestions.length > 0 && (
                    <div>
                      <p className="text-[10px] text-indigo-400 font-medium mb-0.5">建议</p>
                      {cat.suggestions.map((s, j) => (
                        <p key={j} className="text-xs text-slate-300">• {s}</p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Export buttons */}
      <div className="mt-6">
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={() => {
            exportAsJson(card);
          }}>
            📄 导出 JSON
          </Button>
          <Button variant="secondary" size="sm" onClick={async () => {
            await exportAsPng(card);
          }}>
            🖼️ 导出 PNG
          </Button>
          <Button variant="secondary" size="sm" onClick={async () => {
            // Export PNG with custom image
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.png,image/png';
            input.onchange = async (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (!file) return;
              const buffer = await file.arrayBuffer();
              await exportAsPng(card, buffer);
            };
            input.click();
          }}>
            🎨 导出 PNG（选图片）
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowJson(!showJson)}>
            {showJson ? '隐藏 JSON' : '查看 JSON 预览'}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCopyJson}>
            📋 复制
          </Button>
        </div>
        {showJson && (
          <div className="mt-3 rounded-lg bg-slate-900 border border-slate-700 p-4 max-h-[500px] overflow-y-auto">
            <pre className="text-xs text-slate-300 font-mono whitespace-pre">{jsonString}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

/** Small stat display component */
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-slate-900/50 border border-slate-700/60 px-3 py-2">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-100 mt-0.5">{value}</p>
    </div>
  );
}

function Badge({ tone, children }: { tone: 'info' | 'warn' | 'danger'; children: React.ReactNode }) {
  const cls = tone === 'danger'
    ? 'bg-red-900/30 text-red-300 border-red-700/50'
    : tone === 'warn'
      ? 'bg-amber-900/30 text-amber-300 border-amber-700/50'
      : 'bg-slate-800 text-slate-300 border-slate-700';
  return <span className={`rounded border px-2 py-0.5 ${cls}`}>{children}</span>;
}

/** Simple field display component */
function Field({ label, value, hint, multiline }: { label: string; value: string; hint: string; multiline?: boolean }) {
  return (
    <div>
      <p className="text-xs text-slate-500">
        <span className="text-slate-400 font-mono">{label}</span> — {hint}
      </p>
      {value ? (
        multiline ? (
          <p className="text-sm text-slate-300 whitespace-pre-wrap mt-0.5 line-clamp-3">{value}</p>
        ) : (
          <p className="text-sm text-slate-300 mt-0.5">{value}</p>
        )
      ) : (
        <p className="text-sm text-slate-600 italic mt-0.5">(空)</p>
      )}
    </div>
  );
}
