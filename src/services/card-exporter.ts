/**
 * Card Exporter - assembles SillyTavern Character Card V2 spec-compliant JSON.
 *
 * V2 Spec: https://github.com/malfoyslastname/character-card-spec-v2
 *
 * Architecture (per SillyTavern conventions):
 *   - `description`: Core character info → ALWAYS in prompt ("Permanent Tokens")
 *   - `personality`: Brief personality summary → ALWAYS in prompt
 *   - `scenario`: Dialogue circumstances → ALWAYS in prompt
 *   - `character_book` (World Book): Detailed character/world info stored as
 *     keyword-triggered entries, dynamically injected when keywords appear in chat.
 *     This is where the bulk of character detail SHOULD live for token efficiency.
 *   - `first_mes`: Opening message (sent once at chat start)
 *
 * The character_book is a character-specific lorebook that stacks with the
 * user's global World Info. It gets embedded in the card on export.
 *
 * 状态栏渲染方案：
 *   通过 regex_scripts 注入 SillyTavern 正则脚本：
 *     1. 状态栏界面：把 <StatusPlaceHolderImpl/> 替换成 HTML 状态栏（markdownOnly）
 *     2. 对AI隐藏状态栏：把占位符从 prompt 中删除（promptOnly）
 *   first_mes 末尾自动追加占位符，保证开场消息也会渲染状态栏。
 */
import { generateId, createEmptyMvuConfig } from '../constants/defaults';
import type { WizardDraft, LorebookEntry, LorebookPosition, MvuConfig } from '../constants/defaults';
import { buildMvuScriptBundle } from './mvu-builder';

/**
 * Position string → numeric index mapping.
 * SillyTavern uses this numeric value internally for insertion position.
 * Reference: tavern-cards-forge DataReference.md PositionType table.
 *
 * IMPORTANT: The numeric order determines actual insertion order in the prompt:
 *   0=before_char → 1=after_char → 2=before_author → 3=after_author → 4=at_depth → 5=before_example → 6=after_example
 */
const POSITION_INDEX: Record<string, number> = {
  before_char: 0,           // before_character_definition
  after_char: 1,            // after_character_definition
  before_author: 2,         // before_author_note
  after_author: 3,          // after_author_note
  at_depth: 4,              // at_depth (ST runtime)
  before_example: 5,        // before_example_messages
  after_example: 6,         // after_example_messages
};

/**
 * SelectiveLogic string → numeric mapping.
 * Reference: tavern-cards-forge DataReference.md SelectiveLogic table.
 */
const SELECTIVE_LOGIC_INDEX: Record<number, number> = {
  0: 0,  // AND ANY → and_any
  1: 3,  // AND ALL → and_all
  2: 1,  // NOT ALL → not_all
  3: 2,  // NOT ANY → not_any
};

/** Reverse mapping: SillyTavern numeric → our UI index */
const SELECTIVE_LOGIC_REVERSE: Record<number, number> = {
  0: 0,  // and_any → AND ANY
  3: 1,  // and_all → AND ALL
  1: 2,  // not_all → NOT ALL
  2: 3,  // not_any → NOT ANY
};

/** Placeholder appended to first_mes and every AI reply for status bar rendering */
const STATUS_BAR_PLACEHOLDER = '<StatusPlaceHolderImpl/>';

function buildFirstMessage(draft: WizardDraft): string {
  const base = draft.firstMessage || '';
  let result = base;

  // 如果有 MVU 变量且需要设置初始值，在开头添加 EJS setvar 调用
  // 与参考卡「银帷骑士团」一致：通过 setvar 设置初始值，不依赖 InitVar
  if (draft.mvu?.enabled && draft.mvu.schemaSections.length > 0) {
    const setvarCalls: string[] = [];
    for (const section of draft.mvu.schemaSections) {
      for (const v of section.variables) {
        if (v.prefix === '$') continue; // 隐藏变量
        const initVal = v.initialValue;
        if (initVal !== undefined && initVal !== null && initVal !== '') {
          // 数字类型不引号，字符串类型需要引号
          if (v.zodType === 'z.coerce.number()') {
            setvarCalls.push(`setvar('stat_data.${v.path}', ${Number(initVal)});`);
          } else if (v.zodType.startsWith('z.boolean(')) {
            const boolVal = initVal === true || initVal === 'true';
            setvarCalls.push(`setvar('stat_data.${v.path}', ${boolVal});`);
          } else {
            const escapedVal = String(initVal).replace(/'/g, "\\'");
            setvarCalls.push(`setvar('stat_data.${v.path}', '${escapedVal}');`);
          }
        }
      }
    }
    if (setvarCalls.length > 0) {
      const setvarBlock = `<%_ ${setvarCalls.join(' ')} _%>`;
      result = result ? `${setvarBlock}\n${result}` : setvarBlock;
    }
  }

  // 追加状态栏占位符
  if (draft.mvu?.enabled && draft.mvu.statusBarHtml?.trim()) {
    result = result ? `${result}\n${STATUS_BAR_PLACEHOLDER}` : STATUS_BAR_PLACEHOLDER;
  }

  return result;
}

/**
 * Build card-level extensions object.
 *
 * 当 MVU 启用时，注册 SillyTavern 酒馆助手（JS-Slash-Runner）所需的：
 *   1. tavern_helper.scripts — MVU 主脚本 + Zod 校验脚本注册
 *   2. regex_scripts — 5 个正则脚本：
 *        - 对 AI 隐藏 <update> 变量更新标签
 *        - 美化 <update> 变量更新标签
 *        - 状态栏界面（替换占位符为 HTML）
 *        - 对AI隐藏状态栏（从 prompt 中删除占位符）
 *
 * 状态栏渲染通过 regex_scripts 实现，不是世界书条目。
 */
function buildCardExtensions(draft: WizardDraft, zodScript?: string): Record<string, unknown> {
  if (!draft.mvu?.enabled) return {};

  const deps: string[] = [];
  if (draft.mvu.schemaTsContent || draft.mvu.schemaSections.length > 0) {
    deps.push('SillyTavern-MVU');
  }

  // ── 酒馆助手脚本注册 ──────────────────────────────────────────────────
  // MVU 主脚本：加载 MagVarUpdate bundle.js，提供变量更新、Zod 校验等功能
  // Zod 脚本：内联的 Zod 4 校验脚本
  // 注意：
  //   - 脚本内容直接内联在 content 字段（酒馆助手要求字段名是 content，不是 script）
  //   - scripts 必须是数组，不是对象（JS-Slash-Runner 校验 z.array(ScriptTree)）
  //   - 每个脚本必须有 name 字段
  const tavernHelperScripts: unknown[] = [];

  if (draft.mvu.schemaTsContent || draft.mvu.schemaSections.length > 0) {
    // MVU 主脚本：从 CDN 加载 MagVarUpdate bundle（与可用卡一致）
    tavernHelperScripts.push({
      type: 'script',
      name: 'MVU',
      content: "import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js'",
      enabled: true,
      id: 'd0311ca6-5e9a-498e-a777-f74dc4dc6b12',
      info: '',
      button: {
        enabled: true,
        buttons: [
          { name: '重新处理变量', visible: true },
          { name: '重新读取初始变量', visible: true },
          { name: '快照楼层', visible: false },
          { name: '重演楼层', visible: false },
          { name: '重试额外模型解析', visible: false },
          { name: '清除旧楼层变量', visible: false },
        ],
      },
      data: {},
      export_with: { data: true, button: true },
    });
    // Zod 脚本内容（从 buildMvuScriptBundle 拿到的 zodTxt）
    tavernHelperScripts.push({
      type: 'script',
      name: 'Zod',
      content: zodScript || '', // 由 assembleCard 传入 bundle.zodTxt
      enabled: true,
      id: '5b3b09af-35e3-4149-a0f7-2f08776ed6a1',
      info: '',
      button: { enabled: true, buttons: [] },
      data: {},
      export_with: { data: true, button: true },
    });
  }

  // ── 正则脚本 ──────────────────────────────────────────────────────────
  // 3 个正则脚本：对 AI 隐藏 / 美化 <update> 变量更新标签
  // 注意：SillyTavern 要求 regex_scripts 是数组，每个脚本有 scriptName 字段
  const regexScripts: unknown[] = [];

  // 1. 对AI隐藏变量更新 — 移除 <update>...</update> 标签（AI 回复中的变量更新指令）
  regexScripts.push({
    id: 'aa12731a-97c4-4450-ac2f-0bfe1d6a4f64',
    scriptName: '对AI隐藏变量更新',
    findRegex: '/<(update(?:variable)?)>(?:(?!.*<\\/\\1>)(?:(?!<\\1>).)*$|(?:(?!<\\1>).)*<\\/\\1?>)/gsi',
    replaceString: '',
    trimStrings: [],
    placement: [1, 2],
    disabled: false,
    markdownOnly: false,
    promptOnly: true,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  });
  // 2. 变量更新中美化 — 未闭合的 <update> 标签美化
  regexScripts.push({
    id: 'b9d5f25b-a9d0-41bf-8a69-602d64bbde22',
    scriptName: '变量更新中美化',
    findRegex: '/<(update(?:variable)?)>(?!.*<\\/\\1>)\\s*((?:(?!<\\1>).)*)\\s*$/gsi',
    replaceString: '',
    trimStrings: [],
    placement: [1, 2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  });
  // 3. 变量更新美化 — 闭合的 <update>...</update> 标签美化
  regexScripts.push({
    id: '92d49340-fe5e-4929-871f-43d110e5ec76',
    scriptName: '变量更新美化',
    findRegex: '/<(update(?:variable)?)>\\s*((?:(?!<\\1>).)*)\\s*<\\/\\1>/gsi',
    replaceString: '',
    trimStrings: [],
    placement: [1, 2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  });

  // 4. 状态栏界面 — 把占位符替换为 HTML 状态栏，只在界面显示（promptOnly=false, markdownOnly=true）
  // 使用 SillyTavern 内置的 {{format_message_variable::}} 宏直接读取 stat_data 值
  // （与可用卡「银帷骑士团」方案一致，不依赖 MVU InitVar 或 JS 渲染脚本）
  if (draft.mvu.statusBarHtml && draft.mvu.statusBarHtml.trim()) {
    const cleanHtml = draft.mvu.statusBarHtml
      .replace(/^@@render_after\s*\n?/m, '')
      .replace(/\n/g, '')
      // 兼容旧版 AI 生成的 EJS getvar → SillyTavern 内置 format_message_variable 宏
      .replace(/<%-\s*getvar\('stat_data\.([^']+)',\s*\{\s*defaults:\s*[^}]+\s*\}\)\s*%>/g, '{{format_message_variable::stat_data.$1}}')
      .replace(/<%-\s*getvar\('stat_data\.([^']+)'\)\s*%>/g, '{{format_message_variable::stat_data.$1}}')
      // {{getvar::}} → {{format_message_variable::}}（AI 可能生成 getvar 宏）
      .replace(/\{\{getvar::(stat_data\.[^}]+)\}\}/g, '{{format_message_variable::$1}}')
      // 旧版写卡站自定义 __MVU_VAR::...__ 标记 → ST 内置 format_message_variable 宏
      .replace(/__MVU_VAR::(stat_data\.[^_]+)__/g, '{{format_message_variable::$1}}')
      // CSS 中的 calc(... * 1%) 替换为直接使用宏输出的百分比
      .replace(/width:\s*max\s*\(\s*0%\s*,\s*calc\s*\(\s*\{\{format_message_variable::([^}]+)\}\}\s*\*\s*1%\s*\)\s*\)/gi, 'width:{{format_message_variable::$1}}%');
    // 注意：状态栏的 findRegex 必须用纯字符串（非 /.../gi 正则），
    // 与参考卡「银帷骑士团」一致。SillyTavern 对纯字符串做字面替换。
    regexScripts.push({
      id: 'c5e7a8d9-1234-4a5b-9c6d-7e8f9a0b1c2d',
      scriptName: '状态栏界面',
      findRegex: '<StatusPlaceHolderImpl/>',
      replaceString: cleanHtml,
      trimStrings: [],
      placement: [2],
      disabled: false,
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: true,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    });

    // 5. 对AI隐藏状态栏 — 把占位符从 AI prompt 中删除
    regexScripts.push({
      id: 'd6f8b9e0-2345-4b6c-ad7e-8f9a0b1c2d3e',
      scriptName: '对AI隐藏状态栏',
      findRegex: '<StatusPlaceHolderImpl/>',
      replaceString: '',
      trimStrings: [],
      placement: [2],
      disabled: false,
      markdownOnly: false,
      promptOnly: true,
      runOnEdit: true,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    });
  }

  return {
    mvu_enabled: true,
    mvu_dependencies: deps,
    mvu_schema_sections: draft.mvu.schemaSections.length,
    mvu_has_status_bar: Boolean(draft.mvu.statusBarHtml),
    mvu_has_ejs_preprocess: Boolean(draft.mvu.ejsPreprocessContent),
    // 酒馆助手脚本注册
    tavern_helper: Object.keys(tavernHelperScripts).length > 0 ? { scripts: tavernHelperScripts } : undefined,
    // 正则脚本
    regex_scripts: Object.keys(regexScripts).length > 0 ? regexScripts : undefined,
  };
}

/**
 * Build SillyTavern runtime extensions object for a lorebook entry.
 * This is the common structure shared by both wizard entries and generated character entries.
 * Format aligned with CardForge createEmptyWorldEntry + SillyTavern world-info.
 */
function buildSTExtensions(overrides: {
  position: string;
  displayIndex: number;
  probability?: number;
  group?: string;
  groupWeight?: number;
  selectiveLogic?: number;
  role?: number;
  depth?: number;
  excludeRecursion?: boolean;
  preventRecursion?: boolean;
  caseSensitive?: boolean | null;
  sticky?: number;
  cooldown?: number;
  delay?: number;
  ignoreBudget?: boolean;
} = {
  position: 'after_char',
  displayIndex: 0,
}): Record<string, unknown> {
  return {
    position: POSITION_INDEX[overrides.position] ?? 1,
    probability: overrides.probability ?? 100,
    useProbability: (overrides.probability ?? 100) < 100,
    group: overrides.group ?? '',
    group_override: false,
    group_weight: overrides.groupWeight ?? 100,
    selectiveLogic: SELECTIVE_LOGIC_INDEX[overrides.selectiveLogic ?? 0] ?? 0,
    role: overrides.role ?? 0,
    depth: overrides.depth ?? 4,
    scan_depth: (overrides.depth ?? 4) > 0 ? (overrides.depth ?? 4) : null,
    exclude_recursion: overrides.excludeRecursion ?? false,
    prevent_recursion: overrides.preventRecursion ?? true,
    delay_until_recursion: false,
    match_whole_words: null,
    use_group_scoring: false,
    case_sensitive: overrides.caseSensitive ?? null,
    automation_id: '',
    sticky: overrides.sticky != null ? overrides.sticky : null,
    cooldown: overrides.cooldown != null ? overrides.cooldown : null,
    delay: overrides.delay != null ? overrides.delay : null,
    match_persona_description: false,
    match_character_description: false,
    match_character_personality: false,
    match_character_depth_prompt: false,
    match_scenario: false,
    match_creator_notes: false,
    triggers: [],
    ignore_budget: overrides.ignoreBudget ?? false,
    vectorized: false,
    display_index: overrides.displayIndex,
  };
}

/**
 * Build a character-based lorebook entry for auto-injection into the world book.
 */
function buildCharacterEntry(charName: string, content: string, order: number) {
  return {
    id: 1000 + order,
    keys: [charName],
    secondary_keys: [],
    content,
    name: `${charName} - 角色设定`,
    enabled: true,
    insertion_order: order,
    case_sensitive: false,
    selective: false,
    constant: true,
    position: 'after_char',
    priority: 100,
    comment: `${charName} 的角色设定`,
    use_regex: false,
    extensions: buildSTExtensions({
      position: 'after_char',
      displayIndex: order,
      preventRecursion: true,
    }),
  };
}

export function assembleCard(draft: WizardDraft, existingId?: number) {
  // ── Export mode: worldbook-first ───────────────────────────────
  // description = "", personality = ""
  // Character content is injected through draft.lorebookEntries, which is
  // synchronized by the wizard before preview/save.

  // ── Build `description` (always empty — content lives in world book) ──
  const description = '';
  const personality = '';

  // ── Build character_book entries (V2 CharacterBook format) ─────────────
  // V2 spec fields go directly on the entry.
  // SillyTavern runtime fields go in `extensions` (preserved by ST on import).
  const entries = draft.lorebookEntries.map((entry, i) => ({
    id: i + 1,
    keys: entry.keys,
    secondary_keys: entry.secondary_keys || [],
    content: entry.content,
    name: entry.name || `Entry ${i + 1}`,
    enabled: entry.enabled,
    insertion_order: entry.insertion_order ?? i,
    case_sensitive: entry.case_sensitive ?? false,
    selective: entry.selective ?? false,
    constant: entry.constant ?? false,
    position: entry.position ?? 'after_char',
    priority: entry.priority ?? 0,
    comment: entry.comment || entry.name || '',
    use_regex: entry.use_regex ?? false,
    extensions: buildSTExtensions({
      position: entry.position ?? 'after_char',
      displayIndex: i,
      probability: entry.probability ?? 100,
      group: entry.group || '',
      groupWeight: entry.group_weight ?? 100,
      selectiveLogic: entry.selectiveLogic ?? 0,
      role: entry.role ?? 0,
      depth: entry.depth ?? 4,
      excludeRecursion: entry.exclude_recursion ?? false,
      preventRecursion: entry.prevent_recursion ?? false,
      caseSensitive: entry.case_sensitive ? true : null,
      sticky: entry.sticky,
      cooldown: entry.cooldown,
      delay: entry.delay,
      ignoreBudget: entry.ignore_budget ?? false,
    }),
  }));

  // ── MVU entries (embedded when MVU is enabled) ──────────────────────────
  // 入口条件：MVU 启用 且 (有 schemaTsContent 或 schemaSections 非空)
  // buildMvuScriptBundle 内部会兜底生成缺失的 schemaTs/initvar/updateRules
  let mvuEntryOffset = entries.length;
  let mvuBundle: ReturnType<typeof buildMvuScriptBundle> | null = null;
  if (draft.mvu?.enabled && (draft.mvu.schemaTsContent || draft.mvu.schemaSections.length > 0)) {
    const bundle = buildMvuScriptBundle(draft.mvu);
    mvuBundle = bundle;

    // [InitVar]请勿打开 — initial variable values (disabled by default, like reference card)
    // 初始值通过 first_mes 中的 EJS setvar 设置，InitVar 仅作为禁用回退
    if (bundle.initvarYaml) {
      mvuEntryOffset++;
      entries.push({
        id: mvuEntryOffset,
        keys: [],
        secondary_keys: [],
        content: bundle.initvarYaml,
        name: '[InitVar]请勿打开',
        enabled: false,
        insertion_order: 200,
        case_sensitive: false,
        selective: false,
        constant: true,
        position: 'after_char', // top-level V2 field matches reference card
        priority: 100,
        comment: '[InitVar]请勿打开',
        use_regex: true,
        extensions: buildSTExtensions({
          position: 'at_depth', // runtime position: at_depth with depth 0
          displayIndex: mvuEntryOffset,
          depth: 0,
          preventRecursion: true,
          excludeRecursion: true,
        }),
      });
    }

    // [mvu_update]变量更新规则 — AI update rules
    if (bundle.updateRulesYaml) {
      mvuEntryOffset++;
      entries.push({
        id: mvuEntryOffset,
        keys: [],
        secondary_keys: [],
        content: bundle.updateRulesYaml,
        name: '[mvu_update]变量更新规则',
        enabled: true,
        insertion_order: 1000,
        case_sensitive: false,
        selective: false,
        constant: true,
        position: 'after_char',
        priority: 100,
        comment: 'MVU 变量更新规则',
        use_regex: false,
        extensions: buildSTExtensions({
          position: 'after_char',
          displayIndex: mvuEntryOffset,
          preventRecursion: true,
        }),
      });
    }

    // EJS预处理 — EJS preprocess entry
    if (bundle.ejsPreprocess) {
      mvuEntryOffset++;
      entries.push({
        id: mvuEntryOffset,
        keys: [],
        secondary_keys: [],
        content: bundle.ejsPreprocess,
        name: 'EJS预处理',
        enabled: true,
        insertion_order: 1001,
        case_sensitive: false,
        selective: false,
        constant: true,
        position: 'after_char',
        priority: 100,
        comment: 'EJS 变量预处理',
        use_regex: false,
        extensions: buildSTExtensions({
          position: 'after_char',
          displayIndex: mvuEntryOffset,
          preventRecursion: true,
        }),
      });
    }

    // 脚本/MVU.txt 和 脚本/Zod.txt 不作为世界书条目
    // 它们的内容直接内联在 extensions.tavern_helper.scripts 里（酒馆助手脚本区）
    // 状态栏 HTML 通过 regex_scripts 替换 <StatusPlaceHolderImpl/> 占位符，见 buildCardExtensions

    // 变量列表.txt — Variable list
    if (bundle.variableList) {
      mvuEntryOffset++;
      entries.push({
        id: mvuEntryOffset,
        keys: [],
        secondary_keys: [],
        content: bundle.variableList,
        name: '变量列表.txt',
        enabled: true,
        insertion_order: 2001,
        case_sensitive: false,
        selective: false,
        constant: true,
        position: 'after_char',
        priority: 100,
        comment: 'MVU 变量列表',
        use_regex: false,
        extensions: buildSTExtensions({
          position: 'after_char',
          displayIndex: mvuEntryOffset,
          preventRecursion: true,
        }),
      });
    }

    // 变量输出格式.txt — Variable output format
    if (bundle.variableOutputFormat) {
      mvuEntryOffset++;
      entries.push({
        id: mvuEntryOffset,
        keys: [],
        secondary_keys: [],
        content: bundle.variableOutputFormat,
        name: '变量输出格式.txt',
        enabled: true,
        insertion_order: 2002,
        case_sensitive: false,
        selective: false,
        constant: true,
        position: 'after_char',
        priority: 100,
        comment: 'MVU 变量输出格式',
        use_regex: false,
        extensions: buildSTExtensions({
          position: 'after_char',
          displayIndex: mvuEntryOffset,
          preventRecursion: true,
        }),
      });
    }

    // 状态栏通过 regex_scripts 实现，不放在世界书条目里
  }

  const now = new Date();

  return {
    // Preserve existing id for edits
    ...(existingId ? { id: existingId } : {}),

    // ── Tavern V2 spec envelope ──────────────────────────────────────────
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      // V1 fields (nested inside data for V2)
      name: draft.cardName,
      description,
      personality,
      scenario: draft.scenario || '',
      first_mes: buildFirstMessage(draft),

      // V2 new fields
      creator_notes: draft.creator_notes || '',
      system_prompt: draft.system_prompt || '',
      post_history_instructions: draft.post_history_instructions || '',
      alternate_greetings: draft.alternate_greetings || [],
      character_book: {
        name: `${draft.cardName}的世界书`,
        description: '',
        scan_depth: draft.bookScanDepth ?? 200,
        token_budget: draft.bookTokenBudget ?? 1500,
        recursive_scanning: draft.bookRecursiveScanning ?? false,
        extensions: {},
        entries,
      },
      tags: draft.tags || [],
      creator: draft.creator || '',
      character_version: draft.character_version || '1.0',
      extensions: buildCardExtensions(draft, mvuBundle?.zodTxt),
    },

    // ── App-level metadata (NOT part of Tavern spec, for re-editing) ─────
    _meta: {
      characters: draft.characters.map((c) => ({
        id: c.id || generateId(),
        name: c.name,
        description: c.description,
        entryIds: c.entryIds || [],
      })),
    },

    // Timestamps
    name: draft.cardName,
    createdAt: now,
    updatedAt: now,
    deletedAt: null as Date | null,
  };
}

/**
 * Download a JSON file to the user's device.
 * Exports with V1 legacy top-level fields + V2 data block.
 * This matches SillyTavern's expected import format AND CardForge's export format.
 */
export function exportAsJson(card: ReturnType<typeof assembleCard>) {
  const d = card.data;
  const exportObj = {
    // V1 legacy fields at top level (for backward compatibility)
    name: d.name,
    description: d.description,
    personality: d.personality,
    scenario: d.scenario,
    first_mes: d.first_mes,
    creatorcomment: d.creator_notes,
    avatar: 'none',
    talkativeness: '0.5',
    fav: false,
    tags: d.tags || [],
    // V2 spec envelope
    spec: card.spec,
    spec_version: card.spec_version,
    data: d,
    // App-level metadata (not part of the Tavern spec) for re-editing.
    _meta: card._meta,
    create_date: new Date().toISOString(),
  };

  const json = JSON.stringify(exportObj, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${d.name || 'character-card'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export card as PNG with embedded JSON (SillyTavern standard format).
 * Optionally uses a user-provided PNG as the base image.
 * If no PNG provided, generates a minimal placeholder PNG.
 */
export async function exportAsPng(
  card: ReturnType<typeof assembleCard>,
  pngBuffer?: ArrayBuffer,
) {
  const { embedJsonInPng, downloadPng } = await import('./png-service');

  // Only embed the Tavern spec portion (no _meta, no timestamps)
  const specData = { spec: card.spec, spec_version: card.spec_version, data: card.data };
  const pngData = embedJsonInPng(pngBuffer || null, specData);
  downloadPng(pngData, card.data.name || 'character-card');
}

/**
 * Import a character card from a PNG file (SillyTavern format).
 * Extracts embedded JSON from the PNG tEXt chunk.
 * @returns The character card object, or null if no data found.
 */
export async function importFromPng(
  pngBuffer: ArrayBuffer,
): Promise<Record<string, unknown> | null> {
  const { extractJsonFromPng } = await import('./png-service');
  return extractJsonFromPng(pngBuffer);
}

/**
 * Reconstruct MVU config from saved card data.
 * Checks extensions for MVU metadata and lorebook entries for MVU content.
 */
function reconstructMvuConfig(
  data: Record<string, unknown>,
  rawEntries: Array<Record<string, unknown>>,
): MvuConfig | undefined {
  const ext = (data.extensions || {}) as Record<string, unknown>;

  // If MVU was never enabled, skip
  if (!ext.mvu_enabled) return undefined;

  // Extract MVU content from lorebook entries by name
  const mvuEntryNames = ['[InitVar]请勿打开', '[mvu_update]变量更新规则', 'EJS预处理', '变量列表.txt', '变量输出格式.txt'];
  const mvuEntries = rawEntries.filter(e => mvuEntryNames.includes((e.name as string) || ''));

  let schemaTsContent = '';
  let initvarYamlContent = '';
  let updateRulesYamlContent = '';
  let ejsPreprocessContent = '';
  let statusBarHtml = '';

  for (const entry of mvuEntries) {
    const name = (entry.name as string) || '';
    const content = (entry.content as string) || '';
    if (name === '[InitVar]请勿打开') initvarYamlContent = content;
    else if (name === '[mvu_update]变量更新规则') updateRulesYamlContent = content;
    else if (name === 'EJS预处理') ejsPreprocessContent = content;
  }

  // Recover status bar HTML from extensions
  const regexScripts = (ext.regex_scripts || []) as Array<Record<string, unknown>>;
  for (const script of regexScripts) {
    if ((script.scriptName as string) === '状态栏界面') {
      statusBarHtml = (script.replaceString as string) || '';
      break;
    }
  }

  return {
    enabled: true,
    mode: 'expert', // Default to expert for reconstructed config
    schemaSections: [], // Sections are lost on export; user can re-import
    updateRules: [],
    ejsConfigs: [],
    ejsPreprocessContent,
    schemaTsContent,
    initvarYamlContent,
    updateRulesYamlContent,
    statusBarHtml,
    statusBarStyle: (ext.mvu_has_status_bar ? 'minimal-dark' : ''),
  };
}

/**
 * Convert an existing card's stored data back to wizard draft format (for editing).
 * Handles both V1 and V2 cards.
 */
export function cardToDraft(card: Record<string, unknown>): WizardDraft {
  const data = (card.data || card) as Record<string, unknown>;
  const meta = (card._meta || {}) as Record<string, unknown>;

  // Reconstruct characters from _meta, description, or generated character entries
  let characters: WizardDraft['characters'] = [];
  if (meta.characters && Array.isArray(meta.characters) && (meta.characters as unknown[]).length > 0) {
    characters = (meta.characters as unknown[]).map((c: unknown) => {
      const ch = c as Record<string, unknown>;
      return {
        id: (ch.id as string) || generateId(),
        name: (ch.name as string) || '',
        description: (ch.description as string) || '',
        entryIds: (ch.entryIds as string[]) || [],
      };
    }) as WizardDraft['characters'];
  } else if (data.description) {
    // Fallback: single character from description
    characters = [{
      id: generateId(),
      name: (data.name as string) || '',
      description: (data.description as string) || '',
    }];
  }

  // Reconstruct lorebook entries from character_book
  const charBook = data.character_book as Record<string, unknown> | undefined;
  const rawEntries = (charBook?.entries || []) as Array<Record<string, unknown>>;

  if (characters.length === 0) {
    const generatedCharacterEntries = rawEntries.filter((e) => {
      const name = (e.name as string) || '';
      return e.constant === true && name.endsWith(' - 角色设定') && typeof e.content === 'string';
    });

    characters = generatedCharacterEntries.map((e) => ({
      id: generateId(),
      name: ((e.name as string) || '').replace(/ - 角色设定$/, ''),
      description: (e.content as string) || '',
      entryIds: [(e.id as string) || generateId()],
    }));
  }

  return {
    cardName: (data.name as string) || (card.name as string) || '',
    characters,
    lorebookEntries: rawEntries.map((e, i) => {
      const ext = (e.extensions || {}) as Record<string, unknown>;
      return {
        id: (e.id as string) || generateId(),
        keys: (e.keys as string[]) || [],
        secondary_keys: (e.secondary_keys as string[]) || [],
        content: (e.content as string) || '',
        name: (e.name as string) || `Entry ${i + 1}`,
        enabled: (e.enabled as boolean) ?? true,
        constant: (e.constant as boolean) ?? false,
        selective: (e.selective as boolean) ?? false,
        insertion_order: (e.insertion_order as number) ?? i,
        position: ((e.position as string) || 'after_char') as LorebookPosition,
        priority: (e.priority as number) ?? 0,
        case_sensitive: (e.case_sensitive as boolean) ?? false,
        comment: (e.comment as string) || (e.name as string) || '',
        use_regex: (e.use_regex as boolean) ?? false,
        // ST runtime fields (from extensions, aligned with CardForge format)
        probability: (ext.probability as number) ?? 100,
        group: (ext.group as string) || '',
        group_weight: (ext.group_weight as number) ?? 100,
        selectiveLogic: SELECTIVE_LOGIC_REVERSE[(ext.selectiveLogic as number) ?? 0] ?? 0,
        role: (ext.role as number) ?? 0,
        depth: (ext.depth as number) ?? (ext.scan_depth as number) ?? 4,
        exclude_recursion: (ext.exclude_recursion as boolean) ?? false,
        prevent_recursion: (ext.prevent_recursion as boolean) ?? false,
        match_whole_words: (ext.match_whole_words as boolean) ?? true,
        sticky: (ext.sticky as number) ?? 0,
        cooldown: (ext.cooldown as number) ?? 0,
        delay: (ext.delay as number) ?? 0,
        ignore_budget: (ext.ignore_budget as boolean) ?? false,
      };
    }),
    firstMessage: (data.first_mes as string) || '',

    // V2 advanced fields
    scenario: (data.scenario as string) || '',
    system_prompt: (data.system_prompt as string) || '',
    post_history_instructions: (data.post_history_instructions as string) || '',
    alternate_greetings: (data.alternate_greetings as string[]) || [],
    creator_notes: (data.creator_notes as string) || '',
    creator: (data.creator as string) || '',
    character_version: (data.character_version as string) || '',
    tags: (data.tags as string[]) || [],
    bookScanDepth: (charBook?.scan_depth as number) ?? 200,
    bookTokenBudget: (charBook?.token_budget as number) ?? 1500,
    bookRecursiveScanning: (charBook?.recursive_scanning as boolean) ?? false,

    // Reconstruct MVU config from extensions + lorebook entries
    mvu: reconstructMvuConfig(data, rawEntries),
  };
}
