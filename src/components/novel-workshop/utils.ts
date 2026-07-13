/**
 * Novel Workshop - Utility functions
 * Migrated from .temp_statusbar.astro
 */

import type {
  GateMode,
  NarrativeMode,
  CallEstimate,
  ChatPrompt,
} from './types';
import {
  DEFAULT_STAGE_ORDER,
  DEFAULT_CHUNK_CHAR_LIMIT,
  DEFAULT_SAFE_PROMPT_TOKENS,
  LONG_CONTEXT_SAFE_PROMPT_TOKENS,
  MERGE_BATCH_SIZE,
  MAX_WORKFLOW_CALLS,
  CATEGORY_LABELS,
} from './types';

// ── String Utilities ──────────────────────────────────────────────────────

export function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, '&#39;');
}

export function uniqueStrings(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  (list || []).forEach((item) => {
    const key = String(item || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });
  return out;
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

export function formatNumber(num: number): string {
  return Number(num || 0).toLocaleString('zh-CN');
}

// ── ID Generation ─────────────────────────────────────────────────────────

export function sanitizeSegment(value: string): string {
  return String(value || '')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'flag';
}

export function stableId(prefix: string, value: string, index: number): string {
  let base = sanitizeSegment(value || `${prefix}_${index}`);
  if (!/^[A-Za-z_\u4e00-\u9fa5]/.test(base)) base = `${prefix}_${base}`;
  return base || `${prefix}_${index}`;
}

export function hashString(value: string): string {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return String(hash >>> 0);
}

// ── Token Estimation ──────────────────────────────────────────────────────

export function estimateTokenCount(text: string): number {
  const value = String(text || '');
  if (!value) return 0;
  const cjkCount = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const otherCount = Math.max(0, value.length - cjkCount);
  return Math.ceil(cjkCount * 1.35 + otherCount / 4);
}

export function estimatePromptTokens(prompt: ChatPrompt): number {
  return estimateTokenCount(prompt.system) + estimateTokenCount(prompt.user);
}

// ── Category Helpers ──────────────────────────────────────────────────────

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[String(category || '').toLowerCase()] || '条目';
}

export function narrativeModeLabel(mode: NarrativeMode): string {
  return mode === 'lore_only' ? '只整理设定' : '按剧情顺序';
}

export function getStageIndex(stageOrder: string[], stage: string): number {
  const idx = stageOrder.indexOf(stage);
  return idx >= 0 ? idx : 0;
}

export function stageOptionsForMode(mode: GateMode, incoming?: string[]): string[] {
  if (mode === 'public_only') return ['公开'];
  if (Array.isArray(incoming) && incoming.length) return uniqueStrings(incoming);
  return [...DEFAULT_STAGE_ORDER];
}

// ── Text Processing ───────────────────────────────────────────────────────

export function splitTextIntoChunks(text: string, maxChars: number): string[] {
  const clean = String(text || '').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let current = '';
  const parts = clean
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}|(?=第[^\n]{1,20}[章节卷回部篇])|(?=chapter\s+\d+)/i)
    .map((part) => String(part || '').trim())
    .filter(Boolean);

  parts.forEach((part) => {
    if (part.length > maxChars) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      for (let start = 0; start < part.length; start += maxChars) {
        chunks.push(part.slice(start, start + maxChars));
      }
      return;
    }
    if (!current) {
      current = part;
      return;
    }
    if ((current.length + 2 + part.length) <= maxChars) {
      current += '\n\n' + part;
    } else {
      chunks.push(current.trim());
      current = part;
    }
  });
  if (current) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

// ── Call Estimation ────────────────────────────────────────────────────────

export function countMergeCalls(itemCount: number, batchSize: number): number {
  let calls = 0;
  let current = itemCount;
  while (current > 1) {
    current = Math.ceil(current / batchSize);
    calls += current;
  }
  return calls;
}

export function countSequentialMergeCalls(itemCount: number): number {
  return Math.max(0, Number(itemCount || 0) - 1);
}

export function buildCallEstimate(source: string, chunkCharLimit: number): CallEstimate {
  const sourceChars = source.length;
  if (!sourceChars) {
    return {
      sourceChars: 0,
      chunkCount: 0,
      mergeCalls: 0,
      totalCalls: 0,
      chunkSize: chunkCharLimit || DEFAULT_CHUNK_CHAR_LIMIT,
    };
  }
  const chunkLimit = chunkCharLimit || DEFAULT_CHUNK_CHAR_LIMIT;
  const chunks = splitTextIntoChunks(source, chunkLimit);
  const chunkCount = Math.max(1, chunks.length);
  const mergeCalls = chunkCount > 1 ? Math.min(
    countMergeCalls(chunkCount, MERGE_BATCH_SIZE),
    countSequentialMergeCalls(chunkCount)
  ) : 0;
  return {
    sourceChars,
    chunkCount,
    mergeCalls,
    totalCalls: chunkCount + mergeCalls,
    chunkSize: chunkLimit,
  };
}

export function renderCallRisk(estimate: CallEstimate): string {
  if (!estimate.totalCalls) return '先导入文件或粘贴一段文字，这里才会显示预计调用次数。';
  if (estimate.totalCalls > MAX_WORKFLOW_CALLS) {
    return '预计调用次数太多，会阻止运行。建议按卷/章节分批导入，或调大"每次处理多少字"。';
  }
  if (estimate.totalCalls > 40) {
    return '调用次数偏多，建议先用一小段文字试跑，确认效果满意后再处理完整文本。';
  }
  return '调用次数在可控范围内，可以开始生成。';
}

// ── Model Helpers ──────────────────────────────────────────────────────────

export function getSafePromptTokenLimit(modelName: string): number {
  const name = String(modelName || '').toLowerCase();
  if (name.indexOf('gemini') >= 0) return LONG_CONTEXT_SAFE_PROMPT_TOKENS;
  if (name.indexOf('deepseek') >= 0) return 120000;
  if (name.indexOf('claude-3') >= 0 || name.indexOf('claude-sonnet-4') >= 0 || name.indexOf('claude-opus-4') >= 0) return 180000;
  if (name.indexOf('gpt-4.1') >= 0 || name.indexOf('gpt-4o') >= 0 || name.indexOf('o3') >= 0 || name.indexOf('o4') >= 0) return 120000;
  return DEFAULT_SAFE_PROMPT_TOKENS;
}

// ── Workflow Affordability Check ───────────────────────────────────────────

export function assertWorkflowAffordable(estimate: CallEstimate): void {
  if (!estimate || !estimate.totalCalls) return;
  if (estimate.totalCalls > MAX_WORKFLOW_CALLS) {
    throw new Error(
      `当前预计需要 ${formatNumber(estimate.totalCalls)} 次调用，超过安全上限 ${MAX_WORKFLOW_CALLS} 次。请调大"每次处理多少字"、减少原文范围，或先按卷/章节分批生成。`
    );
  }
}

// ── API Error Normalization ────────────────────────────────────────────────

export function normalizeApiErrorMessage(status: number, message: string): string {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  if (lower.indexOf('prohibited_content') >= 0 || lower.indexOf('request blocked by gemini api') >= 0) {
    return 'Gemini 安全策略拦截了本次小说内容。请减少露骨性描写、未成年相关、极端暴力/自残等片段，或改用更适合长篇创作整理的模型后重试。';
  }
  if (status === 400 && lower.indexOf('safety') >= 0) {
    return '模型安全策略拒绝了本次请求。建议先缩小导入范围，删去高风险描写，或换用其他模型。';
  }
  if (status === 429) return '接口限流或额度不足，请稍后再试，或减少每次处理的字数来降低调用频率。';
  return text;
}

// ── JSON Extraction ────────────────────────────────────────────────────────

export function extractJsonObject(raw: string): unknown {
  const text = String(raw || '').trim();
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    try { return JSON.parse(fence[1].trim()); } catch {}
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
  throw new Error('AI 返回中没有有效 JSON 对象');
}
