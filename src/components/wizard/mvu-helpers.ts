/**
 * mvu-helpers - Helper functions and option constants for the MVU variable system.
 *
 * Extracted from StepMvuVariables.tsx to reduce file size and improve maintainability.
 */
import type {
  MvuConfig,
  MvuSchemaSection,
  MvuVariable,
  MvuUpdateRule,
  MvuPrefix,
  EjsEntryConfig,
  LorebookEntry,
} from '../../constants/defaults';
import {
  buildSchemaTs,
  buildInitvarYaml,
  buildUpdateRulesYaml,
  buildEjsPreprocess,
} from '../../services/mvu-builder';
import type { BeginnerTemplate } from './mvu-templates';

// ── Zod type presets ────────────────────────────────────────────────────────

export const ZOD_TYPE_PRESETS = [
  { value: 'z.string()', label: '字符串 (z.string)' },
  { value: 'z.coerce.number()', label: '数字 (z.coerce.number)' },
  { value: 'z.boolean()', label: '布尔 (z.boolean)' },
  { value: 'z.enum(["值1", "值2", "值3"])', label: '枚举 (z.enum)' },
  { value: 'z.array(z.string())', label: '数组 (z.array)' },
  { value: 'z.union([z.string(), z.number()])', label: '联合 (z.union)' },
  { value: 'z.object({})', label: '对象 (z.object)' },
  { value: 'z.record(z.string(), z.string())', label: '动态键值 (z.record)' },
];

export const PREFIX_OPTIONS: { value: MvuPrefix; label: string; desc: string }[] = [
  { value: '', label: '无前缀', desc: 'AI 可见 + 可更新' },
  { value: '_', label: '_ 前缀', desc: 'AI 可见 + 只读' },
  { value: '$', label: '$ 前缀', desc: 'AI 不可见 + 只读' },
];

export const EJS_COMPLEXITY_OPTIONS = [
  { value: '显隐' as const, label: '显隐 (@@if)', desc: '条目级条件显隐' },
  { value: '段落控制' as const, label: '段落控制 (if/else)', desc: '条目内条件分支' },
  { value: '动态文本' as const, label: '动态文本 (<%= %>)', desc: '动态文本替换' },
  { value: '分阶段调度' as const, label: '分阶段调度 (getWorldInfo)', desc: '常驻调度条目按变量值拉取子条目' },
];

export function createEmptyEjsConfig(): EjsEntryConfig {
  return { entryId: '', complexity: '显隐', condition: '', usedVariables: [] };
}

/** 校验导入的 MVU 配置是否合法 */
export function validateImportedConfig(data: unknown): Partial<MvuConfig> | null {
  if (!data || typeof data !== 'object') return null;
  const cfg = data as Record<string, unknown>;
  const result: Partial<MvuConfig> = {};

  // schemaSections
  if (Array.isArray(cfg.schemaSections)) {
    const sections: MvuSchemaSection[] = [];
    for (const s of cfg.schemaSections) {
      if (!s || typeof s !== 'object') continue;
      const sec = s as Record<string, unknown>;
      const name = String(sec.name || '');
      const variables: MvuVariable[] = [];
      if (Array.isArray(sec.variables)) {
        for (const v of sec.variables) {
          if (!v || typeof v !== 'object') continue;
          const vv = v as Record<string, unknown>;
          const prefix = String(vv.prefix || '');
          if (prefix !== '' && prefix !== '_' && prefix !== '$') continue;
          const zodType = String(vv.zodType || 'z.string()');
          const path = String(vv.path || '');
          if (!path) continue;
          variables.push({
            path,
            zodType,
            description: String(vv.description || ''),
            prefix: prefix as MvuPrefix,
            initialValue: vv.initialValue ?? '',
            enumValues: Array.isArray(vv.enumValues) ? vv.enumValues.map(String) : undefined,
            range: vv.range && typeof vv.range === 'object'
              ? { min: Number((vv.range as { min?: unknown }).min ?? 0), max: Number((vv.range as { max?: unknown }).max ?? 100) }
              : undefined,
          });
        }
      }
      if (name || variables.length > 0) {
        sections.push({ name: name || '未命名分区', variables });
      }
    }
    result.schemaSections = sections;
  }

  // updateRules
  if (Array.isArray(cfg.updateRules)) {
    const rules: MvuUpdateRule[] = [];
    for (const r of cfg.updateRules) {
      if (!r || typeof r !== 'object') continue;
      const rr = r as Record<string, unknown>;
      const path = String(rr.path || '');
      if (!path) continue;
      rules.push({
        path,
        type: rr.type !== undefined ? String(rr.type) : undefined,
        range: rr.range !== undefined ? String(rr.range) : undefined,
        format: rr.format !== undefined ? String(rr.format) : undefined,
        value: rr.value !== undefined ? String(rr.value) : undefined,
        check: Array.isArray(rr.check) ? rr.check.map(String) : undefined,
        category: rr.category && typeof rr.category === 'object' ? rr.category as Record<string, string> : undefined,
      });
    }
    result.updateRules = rules;
  }

  // ejsConfigs
  if (Array.isArray(cfg.ejsConfigs)) {
    const ejs: EjsEntryConfig[] = [];
    for (const c of cfg.ejsConfigs) {
      if (!c || typeof c !== 'object') continue;
      const cc = c as Record<string, unknown>;
      const complexity = String(cc.complexity || '显隐');
      if (!['显隐', '段落控制', '动态文本', '分阶段调度'].includes(complexity)) continue;
      ejs.push({
        entryId: String(cc.entryId || ''),
        complexity: complexity as EjsEntryConfig['complexity'],
        condition: String(cc.condition || ''),
        usedVariables: Array.isArray(cc.usedVariables) ? cc.usedVariables.map(String) : [],
      });
    }
    result.ejsConfigs = ejs;
  }

  // statusBarHtml
  if (typeof cfg.statusBarHtml === 'string') {
    result.statusBarHtml = cfg.statusBarHtml;
  }

  // statusBarStyle
  if (typeof cfg.statusBarStyle === 'string') {
    result.statusBarStyle = cfg.statusBarStyle;
  }

  return result;
}

/** 构建 AI 生成 update rules 的 prompt */
export function buildGenerateRulesPrompt(sections: MvuSchemaSection[], cardName?: string): { system: string; user: string } {
  const variables = sections.flatMap(s => s.variables).filter(v => v.prefix !== '$');
  const system = `你是 MVU (Model-View-Update) 变量系统专家。请根据提供的变量 schema，为每个需要 AI 更新的变量生成 updateRules。
规则要求：
- 只返回 JSON，不要 markdown 代码块
- 返回格式：{ "rules": [{ "path": "变量路径", "type": "number|string|boolean|array|object|record", "range?": "0~100", "format?": "", "check": ["规则1", "规则2"] }] }
- 对于数字变量必须提供 range（从变量 range 推断）
- 对于枚举/字符串变量 check 描述如何根据剧情更新
- 对于 boolean 变量 check 描述何时切换 true/false
- 对于 array/object/record 变量 check 描述增删改规则
- 只包含 prefix !== '$' 的变量（隐藏变量不需要更新规则）
- 如果变量明显是自明的（如 current_location 根据场景更新），也需要写 check`;
  const user = `角色卡名称：${cardName || '未命名'}
变量定义：
${JSON.stringify(variables.map(v => ({
    path: v.path,
    zodType: v.zodType,
    description: v.description,
    range: v.range,
    enumValues: v.enumValues,
  })), null, 2)}
请直接返回 JSON。`;
  return { system, user };
}

/** 构建 AI 生成 EJS 配置的 prompt */
export function buildGenerateEjsPrompt(sections: MvuSchemaSection[], entries: LorebookEntry[], selectedEntryIds: string[], cardName?: string): { system: string; user: string } {
  const variables = sections.flatMap(s => s.variables).filter(v => v.prefix !== '$');
  const selectedEntries = entries.filter(e => selectedEntryIds.includes(e.id));
  const system = `你是 SillyTavern EJS 世界书模板专家。请根据提供的变量和选中的世界书条目，生成 EJS 配置。
规则要求：
- 只返回 JSON，不要 markdown 代码块
- 返回格式：{ "ejsConfigs": [{ "entryId": "条目ID", "complexity": "显隐|段落控制|动态文本|分阶段调度", "condition": "条件表达式", "usedVariables": ["变量短名"] }] }
- 条件表达式要使用变量短名（path.split('.').pop()），例如 current_location?.includes('万剑山') 或 affection >= 60
- usedVariables 必须列出 condition 中实际使用的变量短名
- 显隐对应 @@if，段落控制对应 if/else，动态文本对应 <%= %>, 分阶段调度对应 getWorldInfo
- 为每个选中的条目生成合适的 EJS 配置，如果条目内容与变量无关可以返回空 condition`;
  const user = `角色卡名称：${cardName || '未命名'}
变量定义：
${JSON.stringify(variables.map(v => ({
    path: v.path,
    shortName: v.path.split('.').pop(),
    zodType: v.zodType,
    description: v.description,
  })), null, 2)}

选中的世界书条目：
${JSON.stringify(selectedEntries.map(e => ({ id: e.id, name: e.name || e.comment, contentPreview: (e.content || '').slice(0, 200) })), null, 2)}
请直接返回 JSON。`;
  return { system, user };
}

export function applyTemplate(template: BeginnerTemplate): MvuConfig {
  const sections = JSON.parse(JSON.stringify(template.sections)) as MvuSchemaSection[];
  const updateRules = JSON.parse(JSON.stringify(template.updateRules)) as MvuUpdateRule[];
  // 立即生成 schema.ts / initvar.yaml / 更新规则.yaml / EJS 预处理
  // 否则 schemaTsContent 为空，导出时整个 MVU 块会被跳过
  return {
    enabled: true,
    mode: 'beginner',
    beginnerTemplateId: template.id,
    schemaSections: sections,
    updateRules: updateRules,
    ejsConfigs: [],
    ejsPreprocessContent: buildEjsPreprocess([], sections),
    schemaTsContent: buildSchemaTs(sections),
    initvarYamlContent: buildInitvarYaml(sections),
    updateRulesYamlContent: buildUpdateRulesYaml(updateRules),
    statusBarHtml: '',
    statusBarStyle: 'compact-panel',
  };
}
