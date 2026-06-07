/**
 * Card Validator - validates a card against SillyTavern Character Card V2 spec.
 *
 * V2 Spec: https://github.com/malfoyslastname/character-card-spec-v2
 *
 * Returns errors (blocking) and warnings (non-blocking).
 */

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const VALID_POSITIONS = [
  'before_char',
  'after_char',
  'before_example',
  'after_example',
  'before_author',
  'after_author',
  'at_depth',
];

function estimateTokens(text: string): number {
  return Math.round((text || '').length * 1.3);
}

export function validateCard(card: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── V2 envelope validation ──────────────────────────────────────────────
  if (!card.spec || card.spec !== 'chara_card_v2') {
    errors.push('缺少 spec: "chara_card_v2"');
  }

  if (!card.spec_version || card.spec_version !== '2.0') {
    errors.push('缺少 spec_version: "2.0"');
  }

  const data = card.data as Record<string, unknown> | undefined;

  if (!data) {
    errors.push('缺少 data 对象');
    return { valid: false, errors, warnings };
  }

  // ── Required V1 fields (nested in data) ────────────────────────────────
  if (!data.name || typeof data.name !== 'string') {
    errors.push('卡片名称 (name) 是必填项');
  }

  if (!data.description || typeof data.description !== 'string') {
    warnings.push('描述 (description) 为空 — 角色可能无法正确显示');
  }

  if (!data.first_mes || typeof data.first_mes !== 'string') {
    warnings.push('开场白 (first_mes) 为空 — 对话将没有开场');
  }

  // personality, scenario, mes_example can be empty strings per spec
  if (data.personality !== undefined && typeof data.personality !== 'string') {
    warnings.push('personality 应为字符串类型');
  }

  if (data.scenario !== undefined && typeof data.scenario !== 'string') {
    warnings.push('scenario 应为字符串类型');
  }

  // ── V2 specific fields ─────────────────────────────────────────────────
  // extensions must exist and default to {}
  if (data.extensions !== undefined && typeof data.extensions !== 'object') {
    errors.push('extensions 必须是对象类型');
  }

  // alternate_greetings should be an array
  if (data.alternate_greetings !== undefined && !Array.isArray(data.alternate_greetings)) {
    warnings.push('alternate_greetings 应为数组');
  }

  // tags should be an array of strings
  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags)) {
      warnings.push('tags 应为字符串数组');
    }
  }

  // ── character_book validation ──────────────────────────────────────────
  const charBook = data.character_book as Record<string, unknown> | undefined;
  if (charBook) {
    // character_book.extensions must exist
    if (charBook.extensions !== undefined && typeof charBook.extensions !== 'object') {
      warnings.push('character_book.extensions 应为对象');
    }

    if (charBook.entries && Array.isArray(charBook.entries)) {
      let constantTokenEstimate = 0;
      let enabledCount = 0;
      let disabledWithContentCount = 0;
      let emptyContentCount = 0;

      charBook.entries.forEach((entry: Record<string, unknown>, i: number) => {
        const entryName = (entry.name as string) || `条目 ${i + 1}`;
        const keys = Array.isArray(entry.keys) ? entry.keys as string[] : [];
        const secondaryKeys = Array.isArray(entry.secondary_keys) ? entry.secondary_keys as string[] : [];
        const content = typeof entry.content === 'string' ? entry.content : '';
        const enabled = entry.enabled !== false;
        const constant = entry.constant === true;
        const selective = entry.selective === true;
        const probability = entry.extensions && typeof entry.extensions === 'object'
          ? ((entry.extensions as Record<string, unknown>).probability as number | undefined)
          : undefined;

        if (enabled) enabledCount++;
        if (!enabled && content.trim()) disabledWithContentCount++;
        if (!content.trim()) emptyContentCount++;
        if (enabled && constant) constantTokenEstimate += estimateTokens(content);

        // keys: required for non-constant entries
        if (!entry.keys || !Array.isArray(entry.keys)) {
          warnings.push(`世界书条目 "${entryName}" 缺少 keys 数组`);
        } else if (keys.length === 0 && !constant) {
          warnings.push(`世界书条目 "${entryName}" 没有触发关键词（非常量条目将无法被激活）`);
        }

        if (!constant && keys.some((key) => key.trim().length === 1)) {
          warnings.push(`世界书条目 "${entryName}" 存在单字符触发词，容易误触发`);
        }

        if (selective && secondaryKeys.length === 0) {
          warnings.push(`世界书条目 "${entryName}" 启用了 selective 但没有 secondary_keys`);
        }

        if (enabled && probability === 0) {
          warnings.push(`世界书条目 "${entryName}" 的 probability 为 0，启用后也不会触发`);
        }

        // content: should not be empty
        if (!content.trim()) {
          warnings.push(`世界书条目 "${entryName}" 内容为空`);
        }

        if (content.length > 2500) {
          warnings.push(`世界书条目 "${entryName}" 内容较长（>2500 字符），建议拆分为多个条目`);
        }

        // insertion_order: should be a number
        if (entry.insertion_order !== undefined && typeof entry.insertion_order !== 'number') {
          warnings.push(`世界书条目 "${entryName}" 的 insertion_order 应为数字`);
        }

        // position validation
        if (entry.position && !VALID_POSITIONS.includes(entry.position as string)) {
          warnings.push(`世界书条目 "${entryName}" 的 position 值无效`);
        }

        // entry.extensions must exist
        if (entry.extensions !== undefined && typeof entry.extensions !== 'object') {
          warnings.push(`世界书条目 "${entryName}" 的 extensions 应为对象`);
        }
      });

      if (enabledCount === 0 && charBook.entries.length > 0) {
        warnings.push('所有世界书条目都处于禁用状态');
      }

      if (disabledWithContentCount > 0) {
        warnings.push(`${disabledWithContentCount} 个有内容的世界书条目处于禁用状态`);
      }

      if (emptyContentCount > 3) {
        warnings.push(`存在 ${emptyContentCount} 个空内容世界书条目，建议导出前清理`);
      }

      const tokenBudget = typeof charBook.token_budget === 'number' ? charBook.token_budget : 1500;
      if (constantTokenEstimate > tokenBudget) {
        warnings.push(`常驻世界书约 ${constantTokenEstimate} Token，超过当前世界书预算 ${tokenBudget}`);
      }
    }
  }

  // Token count estimation warning
  if (typeof data.description === 'string' && data.description.length > 5000) {
    warnings.push('描述过长（>5000 字符）— 建议将详细内容移至世界书条目中以节省 Token');
  }

  return { valid: errors.length === 0, errors, warnings };
}
