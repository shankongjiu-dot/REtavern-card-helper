/**
 * MVU Builder - assembles MVU variable system files from structured data.
 * 
 * Generates:
 *   - schema.ts (Zod 4 schema)
 *   - initvar.yaml (initial variable values)
 *   - 变量更新规则.yaml (AI update rules)
 *   - Zod.txt (inlined schema for SillyTavern runtime)
 *   - 变量列表.txt (variable list for ST)
 *   - 变量输出格式.txt (output format for ST)
 *   - EJS 预处理 content (define() statements)
 *
 * Follows the tavern-cards MVU conventions:
 *   - Zod 4.x rules (idempotent, z.coerce.number, transform clamping)
 *   - Variable prefixes: ''=read-write, '_'=readonly, '$'=hidden
 *   - Path formats: dot-notation for EJS, slash-notation for AI JSON Patch
 */

import type { MvuConfig, MvuSchemaSection, MvuVariable, MvuUpdateRule, EjsEntryConfig } from '../constants/defaults';

// ── 解析工具 ──────────────────────────────────────────────────────────────

/**
 * 将 AI 或用户输入的范围字符串解析为 { min, max }。
 * 支持 "0~100"、"0-100"、"0..100"、"0~100" 以及 "0 到 100" 等格式。
 * 解析失败返回 undefined。
 */
export function parseRangeString(raw: unknown): { min: number; max: number } | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'object' && raw !== null) {
    const r = raw as { min?: unknown; max?: unknown };
    const min = Number(r.min);
    const max = Number(r.max);
    if (Number.isFinite(min) && Number.isFinite(max)) return { min, max };
  }
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  // 优先匹配带分隔符的格式
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:~|\.\.|-|到|至)\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const min = Number(m[1]);
    const max = Number(m[2]);
    if (Number.isFinite(min) && Number.isFinite(max)) return { min, max };
  }
  // 退化：仅一个数字（视为 max，min=0）
  const single = Number(s);
  if (Number.isFinite(single)) return { min: 0, max: single };
  return undefined;
}

/**
 * 从 zodType 字符串中提取 enumValues。
 * 例如 `z.enum(["a", "b"])` → `["a", "b"]`
 */
export function extractEnumValues(zodType: string): string[] | undefined {
  if (!zodType) return undefined;
  const m = zodType.match(/z\.enum\(\s*\[([\s\S]*)\]\s*\)/);
  if (!m) return undefined;
  // 拆分并清理引号
  return m[1]
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

// ── Zod 4 rules from tavern-cards references/mvu/zod-rule.yaml ──────────────

const ZOD_RULES_HEADER = `// ── MVU 变量结构定义 (Zod 4.x) ──────────────────────────────
// 遵循 tavern-cards MVU Zod 4 规则:
//   1. 幂等性: Schema.parse(Schema.parse(x)) === Schema.parse(x)
//   2. 数字: z.coerce.number() 而非 z.number()
//   3. 软限制: _.clamp() 而非 min/max
//   4. 优先 z.object() 而非 z.array()
//   5. z.enum 节制: 仅在精确匹配需要时使用
//   6. 复杂对象: .or(z.literal('待初始化')).prefault('待初始化')
//   7. 根字段不使用 .optional()
//   8. 不使用 .strict() / .passthrough() (Zod 4 不存在)
//   9. z.record 用于动态键
//   10. transform 不使用 context 参数
//
// 可见性前缀:
//   无前缀 = AI 可见 + 可更新
//   _ 前缀 = AI 可见 + 只读（脚本可更新）
//   $ 前缀 = AI 不可见 + 只读（脚本可更新）
`;

interface SchemaNode {
  children: Map<string, SchemaNode>;
  variable?: MvuVariable;
}

function buildSchemaTree(sections: MvuSchemaSection[]): SchemaNode {
  const root: SchemaNode = { children: new Map() };
  for (const section of sections) {
    for (const v of section.variables) {
      const parts = v.path.split('.');
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!node.children.has(part)) {
          node.children.set(part, { children: new Map() });
        }
        node = node.children.get(part)!;
        if (i === parts.length - 1) {
          node.variable = v;
        }
      }
    }
  }
  return root;
}

function serializeSchemaNode(node: SchemaNode, indent: number): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  lines.push(`${pad}z.object({`);
  for (const [key, child] of node.children) {
    if (child.children.size === 0 && child.variable) {
      const leafVar = { ...child.variable, path: key };
      lines.push(`${pad}  ${key}: ${buildZodExpression(leafVar)},`);
    } else {
      const childExpr = serializeSchemaNode(child, indent + 2);
      lines.push(`${pad}  ${key}: ${childExpr.trimStart()},`);
    }
  }
  lines.push(`${pad}})`);
  return lines.join('\n');
}

/**
 * Build the schema.ts content from structured MVU sections.
 */
export function buildSchemaTs(sections: MvuSchemaSection[]): string {
  const lines: string[] = [ZOD_RULES_HEADER];
  lines.push('export const Schema = z.object({');

  const tree = buildSchemaTree(sections);
  for (const [rootKey, child] of tree.children) {
    lines.push(`  // ── ${rootKey} ──`);
    if (child.children.size === 0 && child.variable) {
      lines.push(`  ${rootKey}: ${buildZodExpression(child.variable)},`);
    } else {
      const childExpr = serializeSchemaNode(child, 2);
      lines.push(`  ${rootKey}: ${childExpr.trimStart()},`);
    }
    lines.push('');
  }

  lines.push('});');
  lines.push('');
  lines.push('export type Schema = z.output<typeof Schema>;');

  return lines.join('\n');
}

/**
 * Build a Zod expression for a single variable.
 */
function buildZodExpression(v: MvuVariable): string {
  // Handle nested paths (e.g. "角色.好感度" → nested object)
  if (v.path.includes('.')) {
    return buildNestedZod(v);
  }

  const type = v.zodType;

  // z.coerce.number()
  if (type === 'z.coerce.number()') {
    let expr = 'z.coerce.number()';
    if (v.range) {
      expr = `z.coerce.number().transform(v => _.clamp(v, ${v.range.min}, ${v.range.max}))`;
    }
    return expr;
  }

  // z.enum([...])
  if (type.startsWith('z.enum(')) {
    return type;
  }

  // z.object({...})
  if (type.startsWith('z.object(')) {
    // Add .or(z.literal('待初始化')).prefault('待初始化') for complex objects
    if (type.includes('{') && type.includes('}')) {
      return `${type}.or(z.literal('待初始化')).prefault('待初始化')`;
    }
    return type;
  }

  // z.record(...)
  if (type.startsWith('z.record(')) {
    return type;
  }

  // Default: z.string()
  return 'z.string()';
}

/**
 * Build nested Zod expression for dotted paths.
 */
function buildNestedZod(v: MvuVariable): string {
  const parts = v.path.split('.');
  // Build from inside out
  let inner = buildZodExpression({ ...v, path: parts[parts.length - 1] });
  for (let i = parts.length - 2; i >= 0; i--) {
    inner = `z.object({ ${parts[i + 1]}: ${inner} })`;
  }
  return inner;
}

/**
 * Build initvar content from MVU sections.
 * Uses YAML format matching reference card conventions (e.g. 「银帷骑士团」).
 * The InitVar entry is disabled by default — initial values are set via EJS setvar in first_mes.
 */
export function buildInitvarYaml(sections: MvuSchemaSection[]): string {
  if (sections.length === 0) return '';

  // Build nested object from sections
  const root: Record<string, unknown> = {};

  for (const section of sections) {
    for (const v of section.variables) {
      // Skip hidden variables ($ prefix) — they are not in stat_data
      if (v.prefix === '$') continue;

      const parts = v.path.split('.');
      let current = root;

      // Create nested structure for all parts except the last
      for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in current)) {
          current[parts[i]] = {};
        }
        current = current[parts[i]] as Record<string, unknown>;
      }

      // Set the leaf value
      const leafKey = parts[parts.length - 1];
      current[leafKey] = v.initialValue ?? '';
    }
  }

  // Convert to YAML format (matching reference card convention)
  return toYaml(root);
}

/**
 * Convert a nested object to YAML-like indented format.
 * Matches the format used by reference cards like 「银帷骑士团」.
 */
function toYaml(obj: Record<string, unknown>, indent = 0): string {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${pad}${key}:`);
      lines.push(toYaml(value as Record<string, unknown>, indent + 1));
    } else {
      const formatted = formatYamlScalar(value);
      lines.push(`${pad}${key}: ${formatted}`);
    }
  }

  return lines.join('\n');
}

function formatYamlScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    // If the string contains special YAML chars, quote it
    if (/[:{}[\]&*#?|<>!=@`"']/.test(value) || value === '' || value.startsWith(' ') || value.endsWith(' ')) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  return String(value);
}

/**
 * Build 变量更新规则.yaml content from update rules.
 */
export function buildUpdateRulesYaml(rules: MvuUpdateRule[]): string {
  const lines: string[] = [
    '# MVU 变量更新规则',
    '# 告诉 AI 如何更新变量（自明变量省略规则，同类变量用 ${key1|key2} 合并）',
    '# 特殊前缀 _ 和 $ 的变量不写更新规则',
    '',
    '变量更新规则:',
  ];

  // Group rules by top-level path
  const grouped = groupRulesByPath(rules);

  for (const [key, subRules] of Object.entries(grouped)) {
    if (subRules.length === 1 && !subRules[0].path.includes('.')) {
      // Simple variable
      const r = subRules[0];
      lines.push(`  ${key}:`);
      appendRuleFields(lines, r, 4);
    } else {
      // Nested or merged
      lines.push(`  ${key}:`);
      for (const r of subRules) {
        const subKey = r.path.split('.').slice(1).join('.') || key;
        lines.push(`    ${subKey}:`);
        appendRuleFields(lines, r, 6);
      }
    }
  }

  return lines.join('\n');
}

interface GroupedRule extends MvuUpdateRule {
  _displayPath: string;
}

function groupRulesByPath(rules: MvuUpdateRule[]): Record<string, GroupedRule[]> {
  const result: Record<string, GroupedRule[]> = {};
  for (const r of rules) {
    const rootKey = r.path.split('.')[0];
    if (!result[rootKey]) result[rootKey] = [];
    result[rootKey].push({ ...r, _displayPath: r.path });
  }
  return result;
}

function appendRuleFields(lines: string[], r: MvuUpdateRule, indent: number) {
  const pad = ' '.repeat(indent);
  if (r.type) lines.push(`${pad}type: ${r.type}`);
  if (r.range) {
    lines.push(`${pad}range: ${r.range}`);
    if (r.category && Object.keys(r.category).length > 0) {
      lines.push(`${pad}category:`);
      for (const [k, v] of Object.entries(r.category)) {
        lines.push(`${pad}  ${k}: ${v}`);
      }
    }
  }
  if (r.format) lines.push(`${pad}format: ${r.format}`);
  if (r.value) lines.push(`${pad}value: ${r.value}`);
  if (r.check && r.check.length > 0) {
    lines.push(`${pad}check:`);
    for (const c of r.check) {
      lines.push(`${pad}  - ${c}`);
    }
  }
}

/**
 * Build EJS 预处理 content (define() statements).
 */
export function buildEjsPreprocess(configs: EjsEntryConfig[], sections: MvuSchemaSection[]): string {
  // Collect all unique variable names used in EJS conditions
  const usedVars = new Set<string>();
  for (const c of configs) {
    for (const v of c.usedVariables) {
      usedVars.add(v);
    }
  }

  if (usedVars.size === 0) return '';

  const lines: string[] = ['@@generate_before', '<%_'];

  // Build variable path map from schema sections
  const varPathMap = new Map<string, string>();
  for (const section of sections) {
    for (const v of section.variables) {
      if (v.prefix === '$') continue; // Hidden vars not needed in EJS
      varPathMap.set(v.path.split('.').pop() || v.path, v.path);
    }
  }

  for (const varName of usedVars) {
    const fullPath = varPathMap.get(varName);
    if (fullPath) {
      const statPath = fullPath.split('.').join('.');
      const defaults = getDefaultForDefine(fullPath, sections);
      lines.push(`define('${varName}', getvar('stat_data.${statPath}', { defaults: ${defaults} }));`);
    } else {
      // Variable not found in schema, use generic define
      lines.push(`define('${varName}', getvar('stat_data.${varName}', { defaults: '' }));`);
    }
  }

  lines.push('_%>');
  return lines.join('\n');
}

function getDefaultForDefine(path: string, sections: MvuSchemaSection[]): string {
  for (const section of sections) {
    for (const v of section.variables) {
      if (v.path === path) {
        if (v.zodType === 'z.coerce.number()') return '0';
        if (v.zodType.startsWith('z.enum(')) {
          const match = v.zodType.match(/z\.enum\(\[(.+)\]\)/);
          if (match) {
            const first = match[1].split(',').map(s => s.trim().replace(/['"]/g, ''))[0];
            return `'${first}'`;
          }
        }
        return "''";
      }
    }
  }
  return "''";
}

/**
 * Build Zod.txt (inlined schema for SillyTavern runtime).
 * Replaces // SCHEMA_CONTENT placeholder with actual schema.ts content.
 */
export function buildZodTxt(schemaTsContent: string): string {
  const template = `import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';
// SCHEMA_CONTENT

$(() => {
  registerMvuSchema(Schema);
});
`;
  return template.replace('// SCHEMA_CONTENT', schemaTsContent.replace(/^export type.*$/gm, ''));
}

/**
 * Build 变量列表.txt (variable list for SillyTavern).
 */
export function buildVariableList(sections: MvuSchemaSection[]): string {
  const lines: string[] = [];
  for (const section of sections) {
    for (const v of section.variables) {
      if (v.prefix === '$') continue;
      const displayPath = v.path.replace(/\./g, ' > ');
      const prefix = v.prefix === '_' ? '[只读] ' : '';
      lines.push(`${prefix}${displayPath}: ${v.description}`);
    }
  }
  return lines.join('\n');
}

/**
 * Build 变量输出格式.txt (output format for SillyTavern).
 */
export function buildVariableOutputFormat(sections: MvuSchemaSection[]): string {
  const lines: string[] = ['当前变量状态：', ''];
  for (const section of sections) {
    lines.push(`【${section.name}】`);
    for (const v of section.variables) {
      if (v.prefix === '$') continue;
      const key = v.path.split('.').pop() || v.path;
      lines.push(`${key}: {${v.path}}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Consistency check: validate MVU config against world book entries.
 * Returns an array of issues (empty = all good).
 */
export interface MvuConsistencyIssue {
  type: 'error' | 'warning';
  message: string;
  fix?: {
    type: 'enum_missing';
    varPath: string;
    enumValues: string[];
  } | {
    type: 'scene_first_message';
    vars: { path: string; initialValue: string }[];
  };
}

export function validateMvuConsistency(
  mvu: MvuConfig,
  lorebookEntryNames: string[],
  firstMessage: string,
): MvuConsistencyIssue[] {
  const issues: MvuConsistencyIssue[] = [];

  if (!mvu.enabled) return issues;

  // Check 1: schema variables with enum values should have corresponding world book entries
  for (const section of mvu.schemaSections) {
    for (const v of section.variables) {
      if (v.enumValues && v.enumValues.length > 0) {
        const covered = v.enumValues.some(ev =>
          lorebookEntryNames.some(name => name.includes(ev))
        );
        if (!covered && v.enumValues.length <= 5) {
          issues.push({
            type: 'warning',
            message: `变量 "${v.path}" 的枚举值 [${v.enumValues.join(', ')}] 在世界书中可能缺少对应的描述条目`,
            fix: { type: 'enum_missing', varPath: v.path, enumValues: v.enumValues },
          });
        }
      }
    }
  }

  // Check 2: EJS conditions reference variables defined in schema
  if (mvu.ejsConfigs.length > 0) {
    const schemaVarNames = new Set<string>();
    for (const section of mvu.schemaSections) {
      for (const v of section.variables) {
        schemaVarNames.add(v.path.split('.').pop() || v.path);
      }
    }

    for (const ejs of mvu.ejsConfigs) {
      for (const varName of ejs.usedVariables) {
        if (!schemaVarNames.has(varName)) {
          issues.push({
            type: 'error',
            message: `EJS 条目 "${ejs.entryId}" 使用的变量 "${varName}" 未在 schema.ts 中定义`,
          });
        }
      }
    }
  }

  // Check 3: initvar values should match first message initial state
  if (firstMessage && mvu.schemaSections.length > 0) {
    // Check if any location/scene variables are defined
    const sceneVars = mvu.schemaSections
      .flatMap(s => s.variables)
      .filter(v => v.path.includes('场景') || v.path.includes('区域') || v.path.includes('当前'));
    if (sceneVars.length > 0 && firstMessage.length < 50) {
      issues.push({
        type: 'warning',
        message: '定义了场景/位置变量但开场白较短，建议确保开场白与 initvar 初始状态一致',
        fix: { type: 'scene_first_message', vars: sceneVars.map(v => ({ path: v.path, initialValue: String(v.initialValue ?? '') })) },
      });
    }
  }

  // Check 4: EJS preprocess should cover all variables used in EJS configs
  if (mvu.ejsConfigs.length > 0) {
    const allUsedVars = new Set<string>();
    for (const ejs of mvu.ejsConfigs) {
      for (const v of ejs.usedVariables) {
        allUsedVars.add(v);
      }
    }

    if (allUsedVars.size > 0 && !mvu.ejsPreprocessContent) {
      issues.push({
        type: 'error',
        message: 'EJS 条目使用了变量但尚未生成 EJS 预处理内容',
      });
    }

    // Check that each used variable appears in preprocess
    if (mvu.ejsPreprocessContent) {
      for (const v of allUsedVars) {
        if (!mvu.ejsPreprocessContent.includes(`define('${v}'`)) {
          issues.push({
            type: 'error',
            message: `EJS 使用的变量 "${v}" 未在 EJS 预处理中注册`,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Build the complete MVU script bundle for embedding in the card.
 * This includes all runtime scripts needed by SillyTavern for MVU to work.
 *
 * 注意：statusBarHtml 由 card-exporter 通过 regex_scripts 直接替换占位符渲染，
 *   不放入世界书条目，也不依赖 EJS 扩展。
 *
 * 兜底：如果 schemaTsContent / initvarYamlContent / updateRulesYamlContent
 *   为空（旧项目或小白模式未点"重新生成"），但 schemaSections 有内容，
 *   则自动从 schemaSections 生成，避免导出时 MVU 块被整体跳过。
 */
export function buildMvuScriptBundle(mvu: MvuConfig): {
  zodTxt: string;
  variableList: string;
  variableOutputFormat: string;
  ejsPreprocess: string;
  statusBarHtml: string;
  initvarYaml: string;
  updateRulesYaml: string;
} {
  // 兜底生成：旧项目或小白模式 AI 生成后未手动 regenerate 的情况
  const schemaTsContent = mvu.schemaTsContent ||
    (mvu.schemaSections.length > 0 ? buildSchemaTs(mvu.schemaSections) : '');
  const initvarYaml = mvu.initvarYamlContent ||
    (mvu.schemaSections.length > 0 ? buildInitvarYaml(mvu.schemaSections) : '');
  const updateRulesYaml = mvu.updateRulesYamlContent ||
    (mvu.updateRules.length > 0 ? buildUpdateRulesYaml(mvu.updateRules) : '');

  return {
    zodTxt: buildZodTxt(schemaTsContent),
    variableList: buildVariableList(mvu.schemaSections),
    variableOutputFormat: buildVariableOutputFormat(mvu.schemaSections),
    ejsPreprocess: mvu.ejsPreprocessContent || buildEjsPreprocess([], mvu.schemaSections),
    statusBarHtml: mvu.statusBarHtml,
    initvarYaml,
    updateRulesYaml,
  };
}