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

  // 国内写卡通常把角色设定放在世界书，description 保持为空是正常做法

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

      // ── MVU entries validation ──────────────────────────────────────────
      const mvuEntryNames = ['[InitVar]请勿打开', '[mvu_update]变量更新规则', 'EJS预处理', '变量列表.txt', '变量输出格式.txt'];
      const mvuEntries = (charBook.entries as Record<string, unknown>[]).filter(e =>
        mvuEntryNames.includes(e.name as string)
      );
      if (mvuEntries.length > 0) {
        // Check initvar exists
        const hasInitvar = mvuEntries.some(e => e.name === '[InitVar]请勿打开');
        if (!hasInitvar) {
          warnings.push('MVU 已启用但缺少 [InitVar] 初始变量条目');
        }
        // Check update rules exists
        const hasUpdateRules = mvuEntries.some(e => e.name === '[mvu_update]变量更新规则');
        if (!hasUpdateRules) {
          warnings.push('MVU 已启用但缺少变量更新规则条目');
        }
        // Check all MVU entries are constant
        for (const entry of mvuEntries) {
          if (!entry.constant) {
            warnings.push(`MVU 条目 "${entry.name}" 应为蓝灯条目 (constant)`);
          }
        }

        // Check MVU scripts and regex scripts in extensions
        // SillyTavern / JS-Slash-Runner 要求 scripts 和 regex_scripts 都是数组
        const ext = (data.extensions || {}) as Record<string, unknown>;
        const tavernHelper = ext.tavern_helper as Record<string, unknown> | undefined;
        const scripts = tavernHelper?.scripts as unknown[] | undefined;
        const hasMvuScript = Array.isArray(scripts) && scripts.some(
          s => typeof s === 'object' && s !== null && (s as { name?: string }).name === 'MVU'
        );
        const hasZodScript = Array.isArray(scripts) && scripts.some(
          s => typeof s === 'object' && s !== null && (s as { name?: string }).name === 'Zod'
        );
        if (!hasMvuScript) {
          warnings.push('MVU 已启用但酒馆助手脚本未注册 MVU 主脚本（extensions.tavern_helper.scripts 中缺少 name=MVU 的脚本）');
        }
        if (!hasZodScript) {
          warnings.push('MVU 已启用但酒馆助手脚本未注册 Zod 校验脚本（extensions.tavern_helper.scripts 中缺少 name=Zod 的脚本）');
        }

        const regexScripts = ext.regex_scripts as unknown[] | undefined;
        const hasHideUpdateScript = Array.isArray(regexScripts) && regexScripts.some(
          s => typeof s === 'object' && s !== null && (s as { scriptName?: string }).scriptName === '对AI隐藏变量更新'
        );
        if (!hasHideUpdateScript) {
          warnings.push('MVU 已启用但缺少变量更新隐藏正则脚本，<update> 标签会暴露给 AI');
        }

        // 状态栏通过 regex_scripts 实现
        const hasStatusBar = ext.mvu_has_status_bar === true;
        if (hasStatusBar) {
          const hasStatusBarRegex = Array.isArray(regexScripts) && regexScripts.some(
            s => typeof s === 'object' && s !== null && (s as { scriptName?: string }).scriptName === '状态栏界面'
          );
          const hasHideStatusBarRegex = Array.isArray(regexScripts) && regexScripts.some(
            s => typeof s === 'object' && s !== null && (s as { scriptName?: string }).scriptName === '对AI隐藏状态栏'
          );
          if (!hasStatusBarRegex) {
            warnings.push('MVU 已启用且包含状态栏，但 regex_scripts 中缺少 "状态栏界面" 正则脚本');
          }
          if (!hasHideStatusBarRegex) {
            warnings.push('MVU 已启用且包含状态栏，但 regex_scripts 中缺少 "对AI隐藏状态栏" 正则脚本');
          }
        }
      }

    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
