/**
 * Auto-fix service for common world book / card validation issues.
 *
 * Fixes are applied in-place to lorebook entries and return:
 *   - fixedEntries: the corrected entries
 *   - fixes: list of what was changed (for display)
 *
 * Fix rules (ordered by severity):
 *   1. Split long content (>2500 chars) into multiple entries
 *   2. selective without secondary_keys → remove selective or add keys
 *   3. Non-constant entries without keys → add name as key
 *   4. Empty content enabled entries → disable them
 *   5. Single-char keys → warn but don't auto-fix (too risky)
 */

import type { LorebookEntry } from '../constants/defaults';
import { generateId, createEmptyLorebookEntry } from '../constants/defaults';

export interface FixResult {
  /** Fixed entries (replace original array with this) */
  entries: LorebookEntry[];
  /** List of applied fixes for user feedback */
  fixes: string[];
}

/** Split content at natural boundaries (paragraphs, XML tags, sections) */
function splitContent(content: string, maxLen: number = 2000): string[] {
  // Try splitting on double newlines (paragraphs)
  const paragraphs = content.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (!para.trim()) continue;
    if ((current + '\n\n' + para).length > maxLen && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else if (current) {
      current += '\n\n' + para;
    } else {
      current = para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // If any chunk is still too long, force-split by character count
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxLen) {
      finalChunks.push(chunk);
    } else {
      // Force split — find last newline before maxLen
      let remaining = chunk;
      while (remaining.length > maxLen) {
        const cutPoint = remaining.lastIndexOf('\n', maxLen);
        const point = cutPoint > maxLen * 0.5 ? cutPoint : maxLen;
        finalChunks.push(remaining.slice(0, point).trim());
        remaining = remaining.slice(point);
      }
      if (remaining.trim()) finalChunks.push(remaining.trim());
    }
  }

  return finalChunks.filter(c => c.length > 10); // filter out tiny fragments
}

/**
 * Apply all available auto-fixes to lorebook entries.
 */
export function autoFixEntries(entries: LorebookEntry[]): FixResult {
  const fixes: string[] = [];
  let result = [...entries]; // shallow clone, we'll replace individual entries

  // ── Fix 1: Split long content entries ───────────────────────────────────
  const longEntries = result.map((e, i) => ({ entry: e, idx: i }))
    .filter(({ entry }) => entry.content?.length > 2500);

  if (longEntries.length > 0) {
    const newEntries: LorebookEntry[] = [];
    const indicesToRemove = new Set<number>();

    for (const { entry, idx } of longEntries) {
      const chunks = splitContent(entry.content!, 2000);
      if (chunks.length <= 1) continue; // couldn't split meaningfully

      indicesToRemove.add(idx);

      // Keep first chunk in a cloned entry, create new ones for rest
      const fixedEntry: LorebookEntry = { ...entry, content: chunks[0] };
      newEntries.push(fixedEntry);

      for (let ci = 1; ci < chunks.length; ci++) {
        const subEntry: LorebookEntry = {
          ...generateEmptyLorebookEntry(),
          id: generateId(),
          name: `${entry.name} (${ci + 1})`,
          keys: [...entry.keys],
          secondary_keys: [...(entry.secondary_keys || [])],
          content: chunks[ci],
          enabled: entry.enabled,
          constant: entry.constant,
          selective: entry.selective,
          insertion_order: entry.insertion_order,
          priority: entry.priority,
          comment: `${entry.comment} (续${ci + 1})`,
          prevent_recursion: true,
          extensions: { ...entry.extensions },
        };
        newEntries.push(subEntry);
      }

      fixes.push(`拆分条目 "${entry.name}"：${entry.content!.length}字 → ${chunks.length}个条目`);
    }

    // Replace: remove originals, add split versions
    result = result.filter((_, i) => !indicesToRemove.has(i)).concat(newEntries);
  }

  // ── Fix 2: selective without secondary_keys ─────────────────────────────
  // Root cause: AI generation often sets selective=true but forgets secondary_keys.
  // For entries that already have good keys, selective is unnecessary — just turn it off.
  // Only try to add secondary_keys if the entry genuinely needs narrow triggering.
  for (let i = 0; i < result.length; i++) {
    const e = result[i];
    if (e.selective && (!e.secondary_keys || e.secondary_keys.length === 0)) {
      const hasGoodKeys = e.keys && e.keys.length > 0 && e.keys.some(k => k.length > 1);

      if (e.constant) {
        // Blue light entries never need selective
        result[i] = { ...result[i], selective: false };
        fixes.push(`移除 "${e.name}" 的 selective（蓝灯条目不需要）`);
      } else if (hasGoodKeys) {
        // Entry has valid keys → selective is harmful, just disable it
        // (selective without secondary_keys means entry will NEVER fire)
        result[i] = { ...result[i], selective: false };
        fixes.push(`移除 "${e.name}" 的 selective（已有正常触发词，无需精确匹配）`);
      } else {
        // No good keys at all → disable the entry entirely
        result[i] = { ...result[i], enabled: false, selective: false };
        fixes.push(`禁用 "${e.name}"（无有效触发词且无法修复）`);
      }
    }
  }

  // ── Fix 3: Non-constant entries without keys ─────────────────────────────
  for (let i = 0; i < result.length; i++) {
    const e = result[i];
    if (!e.constant && e.enabled && (!e.keys || e.keys.length === 0)) {
      // Use entry name as key (it's usually descriptive enough)
      const nameKey = (e.name || e.comment || '').trim();
      if (nameKey && nameKey.length > 0) {
        result[i] = { ...result[i], keys: [nameKey] };
        fixes.push(`为 "${nameKey}" 添加触发关键词`);
      } else {
        // Disable it instead of adding garbage key
        result[i] = { ...result[i], enabled: false };
        fixes.push(`禁用无关键词的空名条目`);
      }
    }
  }

  // ── Fix 4: Enabled entries with empty content → disable ─────────────────
  for (let i = 0; i < result.length; i++) {
    const e = result[i];
    if (e.enabled && (!e.content || !e.content.trim())) {
      result[i] = { ...result[i], enabled: false };
      fixes.push(`禁用空内容条目 "${e.name}"`);
    }
  }

  // ── Fix 5: Single-char keys → append to warning only (don't auto-fix) ──
  // Too risky to auto-fix single char keys

  return { entries: result, fixes };
}

function generateEmptyLorebookEntry(): LorebookEntry {
  return {
    ...createEmptyLorebookEntry(),
    id: '',
    priority: 100,
    prevent_recursion: false,
    extensions: {},
  };
}
