/**
 * Staged Lorebook Builder
 *
 * 实现"阶段性触发世界书"模式（参考「高考冲刺100天」卡）：
 *   - 1 个 constant 调度条目：用 EJS if/else if 读阶段轴变量，按值互斥地
 *     通过 `await getWorldInfo(bookName, childComment)` 拉取对应子条目内容。
 *   - N 个 enabled:false 子阶段条目：默认禁用，只被调度条目显式拉取时才注入，
 *     保证阶段严格互斥、token 省。
 *
 * 调度条目 content 示例（enum 轴）：
 *   <%_ if (getvar('stat_data.关系.阶段[0]') === undefined) { _%>
 *   <!-- 错误：变量"关系.阶段"未定义 -->
 *   <%_ } else if (getvar('stat_data.关系.阶段[0]') === '陌生人') { _%>
 *   <%= await getWorldInfo("书名", "人设分阶段：陌生人") _%>
 *   <%_ } else if (getvar('stat_data.关系.阶段[0]') === '朋友') { _%>
 *   <%= await getWorldInfo("书名", "人设分阶段：朋友") _%>
 *   <%_ } else { _%>
 *   <%= await getWorldInfo("书名", "人设分阶段：未知") _%>
 *   <%_ } _%>
 */

import type { LorebookEntry, LorebookPosition } from '../constants/defaults';
import { createEmptyLorebookEntry } from '../constants/defaults';

/** 阶段轴变量类型 */
export type StageAxisType = 'enum' | 'number';

/** 数值轴的比较方向：>= 表示阈值以上触发（倒计时型），<= 表示阈值以下触发（好感度型） */
export type NumericDirection = '>=' | '<=';

/** 单个阶段的定义 */
export interface StageDefinition {
  /** 阶段名（用于子条目 comment 去重与展示，如 "朋友"/"百炼之初"） */
  name: string;
  /**
   * 触发条件表达式（不含外层括号），如：
   *  - enum: `=== '朋友'`
   *  - number(>=): `>= 60`
   *  - number(<=): `<= -80`
   * 留空时由 buildStagesFromConfig 自动生成。
   */
  condition?: string;
  /** 该阶段的子条目内容（键值对格式）。留空则生成占位内容。 */
  content?: string;
}

/** 分阶段世界书配置 */
export interface StagedLorebookConfig {
  /** 阶段轴变量路径（点分，如 "关系.阶段" / "世界.高考倒计时天数"） */
  axisPath: string;
  /** 轴类型 */
  axisType: StageAxisType;
  /** 数值轴的比较方向（仅 axisType='number' 时有效） */
  numericDirection?: NumericDirection;
  /** 世界书名（getWorldInfo 的第一个参数，通常等于卡片名） */
  bookName: string;
  /** 调度条目名（也作为子条目 comment 的前缀，如 "张雨桐分阶段人设"） */
  dispatcherName: string;
  /** 阶段列表（顺序即 if/else if 顺序） */
  stages: StageDefinition[];
  /** 附加说明（可选，写入调度条目顶部注释） */
  description?: string;
  /** 子条目插入位置，默认 after_char */
  position?: LorebookPosition;
  /** 调度条目 insertion_order，默认 100 */
  dispatcherOrder?: number;
  /** 子条目 insertion_order，默认 100 */
  childOrder?: number;
}

/** 子条目 comment 命名规则：{dispatcherName}：{stageName} */
export function buildChildComment(dispatcherName: string, stageName: string): string {
  return `${dispatcherName}：${stageName}`;
}

/** Sanitize a dispatcher name into a valid JS identifier suffix for EJS variables.
 *  Keeps letters, digits, underscore, and CJK characters; replaces others with '_'.
 */
export function makeVarSuffix(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_');
}

/**
 * Escape a value for safe embedding inside a double-quoted JS string literal in EJS.
 * - Escapes backslash and double quote (the two characters that break JS strings)
 * - Escapes newlines / line separators (would break the EJS template across lines)
 * - Neutralises `%>` so user input can't prematurely close the EJS tag
 *
 * Used for `bookName` and `childComment` arguments to `getWorldInfo("book", "comment")`.
 */
export function escapeEjsDoubleQuoted(s: unknown): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/%>/g, '%\\>');
}

/**
 * Escape a value for safe embedding inside a single-quoted JS string literal in EJS.
 * - Escapes backslash and single quote (the two characters that break JS strings)
 * - Escapes newlines / line separators (would break the EJS template across lines)
 * - Neutralises `%>` so user input can't prematurely close the EJS tag
 *
 * Used for `axisPath` in `getvar('stat_data.${axisPath}')` calls.
 */
export function escapeEjsSingleQuoted(s: unknown): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/%>/g, '%\\>');
}

/**
 * 兼容旧版分阶段调度条目：把无后缀的 __stagedRaw / __stagedVal
 * 重写成带 dispatcherName 后缀的唯一变量名，避免多角色卡中重复声明。
 */
export function migrateStagedDispatcherContent(content: string): string {
  if (!content) return content;
  // 仅处理旧版写法：__stagedVal 直接引用无后缀的 __stagedRaw
  if (!/const\s+__stagedVal\s*=\s*Array\.isArray\s*\(\s*__stagedRaw\s*\)/.test(content)) {
    return content;
  }
  // 从第一个 getWorldInfo 子条目 comment 提取 dispatcherName
  const match = content.match(/getWorldInfo\(\s*"[^"]+"\s*,\s*"([^"]+)"\s*\)/);
  if (!match) return content;
  const childComment = match[1];
  const sepIndex = childComment.indexOf('：');
  if (sepIndex === -1) return content;
  const dispatcherName = childComment.slice(0, sepIndex);
  const suffix = makeVarSuffix(dispatcherName);
  return content
    .replace(/\b__stagedRaw\b/g, `__stagedRaw_${suffix}`)
    .replace(/\b__stagedVal\b/g, `__stagedVal_${suffix}`);
}

/**
 * 为阶段自动生成条件表达式。
 * - enum: `=== 'value'`
 * - number + '>=': `>= threshold`
 * - number + '<=': `<= threshold`
 */
export function autoCondition(
  axisType: StageAxisType,
  value: string | number,
  direction: NumericDirection = '>=',
): string {
  if (axisType === 'enum') {
    // H12: Use escapeEjsSingleQuoted (not just `replace(/'/g, "\\'")`) so a
    // backslash in stage.name can't combine with the quote-escaping to break
    // out of the single-quoted JS string literal. Attack vector:
    //   stage.name = `阶段\'; evilCode(); //`
    //   old replace: `阶段\\'; evilCode(); //` (the `\\` becomes `\`, then
    //   `'` closes the string, then `evilCode()` runs).
    const v = escapeEjsSingleQuoted(value);
    return `=== '${v}'`;
  }
  const n = Number(value);
  return `${direction} ${Number.isFinite(n) ? n : 0}`;
}

/**
 * 构建调度条目的 EJS content。
 * 包含 undefined 守卫 + 各阶段 if/else if + 兜底 else。
 */
export function buildDispatcherContent(config: StagedLorebookConfig): string {
  const { axisPath, axisType, stages, bookName, dispatcherName, description } = config;
  // stat_data 下的点分路径。参考卡「高考冲刺100天」用数组 [值, 描述]，项目 MVU 默认用标量。
  // 这里先读取原始值，再用 Array.isArray 判断取首元素或直接用，保证两种格式都能工作。
  // Escape axisPath so a `'` or `\` in user/AI-provided paths can't break out of
  // the single-quoted JS string literal in getvar('stat_data.{axisPath}').
  const escapedAxisPath = escapeEjsSingleQuoted(axisPath);
  const rawExpr = `getvar('stat_data.${escapedAxisPath}')`;

  // Each dispatcher needs its own EJS locals so multiple dispatchers can coexist
  // in the same EJS compile unit (e.g. when combined in first_mes or preprocess).
  const suffix = makeVarSuffix(dispatcherName);
  const rawVar = `__stagedRaw_${suffix}`;
  const valVar = `__stagedVal_${suffix}`;

  // Escape bookName and childComment so a `"` or `\` in user/AI-provided names
  // can't break out of the double-quoted JS string literal in getWorldInfo(...).
  const escapedBook = escapeEjsDoubleQuoted(bookName);

  const lines: string[] = [];
  if (description) {
    lines.push(`--- ${description} ---`);
  }
  lines.push(`<%_ const ${rawVar} = ${rawExpr}; _%>`);
  lines.push(`<%_ const ${valVar} = Array.isArray(${rawVar}) ? ${rawVar}[0] : ${rawVar}; _%>`);
  lines.push(`<%_ if (${valVar} === undefined) { _%>`);
  lines.push(`<!-- 错误：阶段轴变量"${escapedAxisPath}"未定义，无法加载分阶段内容。 -->`);

  stages.forEach((stage) => {
    const cond = stage.condition || autoCondition(
      axisType,
      axisType === 'enum' ? stage.name : (stage as { threshold?: number }).threshold ?? 0,
      config.numericDirection,
    );
    const childComment = buildChildComment(dispatcherName, stage.name);
    const escapedComment = escapeEjsDoubleQuoted(childComment);
    lines.push(`<%_ } else if (${valVar} ${cond}) { _%>`);
    lines.push(`<%= await getWorldInfo("${escapedBook}", "${escapedComment}") _%>`);
  });

  // 兜底：变量有值但不在任何阶段范围内
  lines.push('<%_ } else { _%>');
  lines.push(`<!-- 警告：阶段轴变量"${escapedAxisPath}"的值未匹配任何已定义阶段。 -->`);
  lines.push('<%_ } _%>');

  return lines.join('\n');
}

/**
 * 根据 config + 可选的每阶段 content，构建一组 lorebook 条目：
 *   [0] = 调度条目（constant:true, enabled:true）
 *   [1..N] = 子阶段条目（constant:false, enabled:false, 只被 getWorldInfo 拉取）
 */
export function buildStagedLorebookEntries(config: StagedLorebookConfig): LorebookEntry[] {
  const {
    dispatcherName,
    stages,
    position = 'after_char',
    dispatcherOrder = 100,
    childOrder = 100,
  } = config;

  const entries: LorebookEntry[] = [];

  // 1. 调度条目
  const dispatcher = {
    ...createEmptyLorebookEntry(),
    name: dispatcherName,
    comment: dispatcherName,
    content: buildDispatcherContent(config),
    enabled: true,
    constant: true,
    selective: true,
    insertion_order: dispatcherOrder,
    position,
    depth: 3,
    priority: 100,
    probability: 100,
  } as LorebookEntry;
  entries.push(dispatcher);

  // 2. 子阶段条目（默认禁用，靠 getWorldInfo 显式拉取）
  stages.forEach((stage) => {
    const childComment = buildChildComment(dispatcherName, stage.name);
    const child = {
      ...createEmptyLorebookEntry(),
      name: childComment,
      comment: childComment,
      content: stage.content?.trim() || `# ${stage.name} 阶段\n（请在此填写「${stage.name}」阶段的具体内容，键值对格式）`,
      enabled: false,
      constant: false,
      selective: true,
      insertion_order: childOrder,
      position,
      depth: 4,
      priority: 50,
      probability: 100,
    } as LorebookEntry;
    entries.push(child);
  });

  return entries;
}

/**
 * 从一个阶段轴定义快速生成 StageDefinition 列表。
 *  - enum: values 数组 → 每个值一个阶段，condition 为 `=== 'value'`
 *  - number: thresholds 数组（按方向排序）→ 每个阈值一个阶段
 */
export function buildStagesFromAxis(
  axisType: StageAxisType,
  values: Array<string | number>,
  direction: NumericDirection = '>=',
): StageDefinition[] {
  return values.map((v) => ({
    name: String(v),
    condition: autoCondition(axisType, v, direction),
  }));
}

/**
 * 从已存在的调度条目内容反向解析出 config（用于导入后识别）。
 * 返回 null 表示该条目不是分阶段调度条目。
 */
export function parseDispatcherContent(
  content: string,
): { axisPath: string; bookName: string; childComments: string[] } | null {
  // 匹配 getvar('stat_data.XXX[0]') 与 getWorldInfo("YYY", "ZZZ")
  const varMatch = content.match(/getvar\(\s*'stat_data\.([^[\]'"]+)(?:\[0\])?'\s*\)/);
  if (!varMatch) return null;
  const axisPath = varMatch[1];
  const bookMatch = content.match(/getWorldInfo\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/);
  if (!bookMatch) return null;
  const bookName = bookMatch[1];
  const childComments = Array.from(
    content.matchAll(/getWorldInfo\(\s*"[^"]+"\s*,\s*"([^"]+)"\s*\)/g),
  ).map((m) => m[1]);
  return { axisPath, bookName, childComments };
}

/**
 * 按数值方向对阶段排序，确保 if/else if 正确匹配：
 * - ">=" 方向：阈值从高到低（最极端在前）
 * - "<=" 方向：阈值从低到高（最极端在前）
 * 非 number 类型或无法解析的条件保持原顺序。
 */
export function sortStagesByDirection<T extends { condition?: string }>(
  stages: T[],
  axisType: StageAxisType,
  direction: NumericDirection = '>=',
): T[] {
  if (axisType !== 'number') return [...stages];
  const parsed = stages.map((s) => {
    const match = (s.condition || '').match(/^(>=|<=)\s*(-?\d+(?:\.\d+)?)/);
    const value = match ? Number(match[2]) : NaN;
    return { stage: s, value };
  });
  if (parsed.some((p) => Number.isNaN(p.value))) return [...stages];
  const sorted = parsed.slice().sort((a, b) => {
    if (direction === '>=') return b.value - a.value;
    return a.value - b.value;
  });
  return sorted.map((p) => p.stage);
}
