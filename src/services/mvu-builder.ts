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

/**
 * Serialize a SchemaNode and return both the Zod expression and its default value literal.
 * @param node - The schema node to serialize
 * @param keyIndent - Indentation level (spaces) where the field key starts;
 *                    the closing `})` aligns at this level, inner fields at keyIndent+2.
 */
function serializeSchemaNode(node: SchemaNode, keyIndent: number): { expr: string; defaults: string } {
  const innerPad = ' '.repeat(keyIndent + 2);
  const keyPad = ' '.repeat(keyIndent);
  const lines: string[] = [];
  const defaultsEntries: string[] = [];

  lines.push(`z.object({`);
  for (const [key, child] of node.children) {
    if (child.children.size === 0 && child.variable) {
      const leafVar = { ...child.variable, path: key };
      const { expr, defLit } = buildLeafZod(leafVar);
      lines.push(`${innerPad}${key}: ${expr},`);
      defaultsEntries.push(`${innerPad}${key}: ${defLit}`);
    } else {
      const childResult = serializeSchemaNode(child, keyIndent + 2);
      lines.push(`${innerPad}${key}: ${childResult.expr},`);
      defaultsEntries.push(`${innerPad}${key}: ${childResult.defaults}`);
    }
  }
  lines.push(`${keyPad}})`);

  const objExpr = lines.join('\n');
  const defaults = `{\n${defaultsEntries.join(',\n')}\n${keyPad}}`;
  return { expr: objExpr, defaults };
}

/**
 * Build a leaf-level Zod expression with .prefault() and return the default value literal.
 */
function buildLeafZod(v: MvuVariable): { expr: string; defLit: string } {
  const type = v.zodType;
  const initialValue = v.initialValue;

  // z.coerce.number() with optional transform clamp
  if (type === 'z.coerce.number()') {
    let base = 'z.coerce.number()';
    if (v.range) {
      base = `z.coerce.number().transform(v => _.clamp(Math.round(v), ${v.range.min}, ${v.range.max}))`;
    }
    const defVal = typeof initialValue === 'number' ? initialValue : 0;
    return { expr: `${base}.prefault(${defVal})`, defLit: String(defVal) };
  }

  // z.boolean()
  if (type === 'z.boolean()' || type === 'z.boolean') {
    const defVal = initialValue === true;
    return { expr: `z.boolean().prefault(${defVal})`, defLit: String(defVal) };
  }

  // z.enum([...])
  if (type.startsWith('z.enum(')) {
    const enumMatch = type.match(/z\.enum\(\[([^\]]+)\]\)/);
    let enumExpr = type;
    let defVal: string;
    if (enumMatch) {
      const values = enumMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
      defVal = typeof initialValue === 'string' && values.includes(initialValue)
        ? `'${initialValue}'`
        : (values.length > 0 ? `'${values[0]}'` : "''");
      enumExpr = `z.enum([${values.map(vv => `'${vv}'`).join(', ')}])`;
    } else {
      defVal = typeof initialValue === 'string' ? `'${initialValue}'` : "''";
    }
    return { expr: `${enumExpr}.prefault(${defVal})`, defLit: defVal };
  }

  // z.object({...}) — complex object type (gets .or(z.literal('待初始化')) fallback)
  if (type.startsWith('z.object(')) {
    return { expr: `${type}.or(z.literal('待初始化')).prefault('待初始化')`, defLit: "'待初始化'" };
  }

  // z.record(...) — record/map type
  if (type.startsWith('z.record(')) {
    // Build default record object from initialValue if it's an object
    let defLit = '{}';
    if (initialValue !== null && typeof initialValue === 'object' && !Array.isArray(initialValue)) {
      const entries = Object.entries(initialValue as Record<string, unknown>);
      if (entries.length > 0) {
        defLit = `{ ${entries.map(([k, val]) => {
          if (val !== null && typeof val === 'object') {
            const subEntries = Object.entries(val as Record<string, unknown>);
            return `'${k}': { ${subEntries.map(([sk, sv]) => {
              if (typeof sv === 'string') return `${sk}: '${sv}'`;
              if (typeof sv === 'boolean') return `${sk}: ${sv}`;
              return `${sk}: ${sv}`;
            }).join(', ')} }`;
          }
          if (typeof val === 'string') return `'${k}': '${val}'`;
          return `'${k}': ${val}`;
        }).join(', ')} }`;
      }
    }
    return { expr: `${type}.prefault(${defLit})`, defLit };
  }

  // Default: z.string()
  const strDef = typeof initialValue === 'string' ? `'${initialValue.replace(/'/g, "\\'")}'` : "''";
  return { expr: `z.string().prefault(${strDef})`, defLit: strDef };
}

/**
 * Build the schema.ts content from structured MVU sections.
 * Every field gets .prefault(defaultValue), and every nested z.object
 * gets .prefault({...}) with the full default structure.
 */
export function buildSchemaTs(sections: MvuSchemaSection[]): string {
  const lines: string[] = [];
  lines.push('export const Schema = z.object({');

  const tree = buildSchemaTree(sections);

  for (const [rootKey, child] of tree.children) {
    if (child.children.size === 0 && child.variable) {
      const leafVar = { ...child.variable, path: rootKey };
      const { expr } = buildLeafZod(leafVar);
      lines.push(`  ${rootKey}: ${expr},`);
    } else {
      const result = serializeSchemaNode(child, 2);
      lines.push(`  ${rootKey}: ${result.expr}.prefault(${result.defaults}),`);
    }
  }

  lines.push('});');
  lines.push('');
  lines.push('export type Schema = z.output<typeof Schema>;');

  return lines.join('\n');
}

/**
 * Build initvar content from MVU sections.
 * Uses YAML format matching reference card conventions (e.g. 「银帷骑士团」).
 * The InitVar entry is disabled by default — initial values are set via EJS setvar in first_mes.
 */
export function buildInitvarYaml(sections: MvuSchemaSection[]): string {
  if (sections.length === 0) return '# MVU enabled but no variables defined\n_init: true';

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

export function formatYamlScalar(value: unknown): string {
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
 *
 * Matches the reference card convention (e.g. 「银帷骑士团」):
 *   - <update_variable_rules>: instruct AI to emit <UpdateVariable> JSON Patch blocks
 *   - <status_bar_rule>: instruct AI to append <StatusPlaceHolderImpl/> at the end of every reply
 *   - <status_current_variable>: show current stat_data for reference
 */
export function buildVariableOutputFormat(sections: MvuSchemaSection[], rules: MvuUpdateRule[] = []): string {
  const variableListLines: string[] = [];
  for (const section of sections) {
    variableListLines.push(`  ${section.name}:`);
    for (const v of section.variables) {
      if (v.prefix === '$') continue;
      variableListLines.push(`    ${v.path}: ${formatYamlScalar(v.initialValue ?? '')}`);
    }
  }

  const rulesYaml = rules.length > 0 ? buildUpdateRulesYaml(rules) : '变量更新规则: {}';

  return `---
<update_variable_rules>
rule:
  - you must output the update analysis and the actual update commands at once in the end of the next reply
  - 'the update commands must strictly follow the **JSON Patch (RFC 6902)** standard, but can only use the following operations: \`replace\` (replace the value of existing paths), \`add\` (only used to insert new items into an object or array), \`remove\`; that is, the output must be a valid JSON array containing operation objects'
format: |-
  <UpdateVariable>
  <Analysis>$(IN ENGLISH, no more than 80 words)
  - \${calculate time passed: ...}
  - \${decide whether dramatic updates are allowed as it's in a special case or the time passed is more than usual: yes/no}
  - \${analyze every variable based on its corresponding \`check\`, according only to current reply instead of previous plots: ...}
  - \${if the value is number, please write down the calculation: old_value (X) + delta (Y) = new_value (Z)}
  </Analysis>
  <JSONPatch>
  [
    { "op": "replace", "path": "/stat_data/\${section/variable}", "value": \${new_value} },
    { "op": "add", "path": "/stat_data/\${section/object}/newKey", "value": \${content} },
    { "op": "remove", "path": "/stat_data/\${section/array}/0" },
    ...
  ]
  </JSONPatch>
  </UpdateVariable>
${rulesYaml}
</update_variable_rules>
---
<status_bar_rule>
- after the <UpdateVariable> block, on a new line at the very end of every reply, output the literal token \`<StatusPlaceHolderImpl/>\` exactly as written
- this token renders the status bar; never omit it, never translate or modify it
</status_bar_rule>
---
<status_current_variable>
当前变量状态:
${variableListLines.join('\n')}

{{format_message_variable::stat_data}}
</status_current_variable>
`;
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
  // 始终从结构化数据(schemaSections/updateRules)重新生成，确保 .prefault() 等修复生效
  // 仅当结构化数据为空时才回退到缓存的文本内容（兼容极端情况）
  const schemaTsContent = mvu.schemaSections.length > 0
    ? buildSchemaTs(mvu.schemaSections)
    : (mvu.schemaTsContent || '');
  const initvarYaml = mvu.schemaSections.length > 0
    ? buildInitvarYaml(mvu.schemaSections)
    : (mvu.initvarYamlContent || '# MVU enabled but no variables defined\n_init: true');
  const updateRulesYaml = mvu.updateRules.length > 0
    ? buildUpdateRulesYaml(mvu.updateRules)
    : (mvu.updateRulesYamlContent || '变量更新规则: {}');

  return {
    zodTxt: buildZodTxt(schemaTsContent),
    variableList: buildVariableList(mvu.schemaSections),
    variableOutputFormat: buildVariableOutputFormat(mvu.schemaSections, mvu.updateRules),
    ejsPreprocess: mvu.ejsConfigs.length > 0
      ? buildEjsPreprocess(mvu.ejsConfigs, mvu.schemaSections)
      : (mvu.ejsPreprocessContent || buildEjsPreprocess([], mvu.schemaSections)),
    statusBarHtml: mvu.statusBarHtml,
    initvarYaml,
    updateRulesYaml,
  };
}