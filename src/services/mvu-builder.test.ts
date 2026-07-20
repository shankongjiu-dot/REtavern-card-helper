/**
 * MVU Builder Tests - 验证 .prefault() 默认值修复
 */
import { describe, it, expect } from 'vitest';
import { buildSchemaTs, buildMvuScriptBundle, buildEjsPreprocess } from './mvu-builder';
import { createEmptyMvuConfig } from '../constants/defaults';
import type { MvuSchemaSection, EjsEntryConfig } from '../constants/defaults';

describe('MVU Builder - .prefault() 修复验证', () => {
  function makeTestSections(): MvuSchemaSection[] {
    return [
      {
        name: '基础属性',
        variables: [
          {
            path: 'HP',
            zodType: 'z.coerce.number()',
            initialValue: 100,
            range: { min: 0, max: 100 },
            prefix: '',
            description: '角色生命值',
          },
          {
            path: 'MP',
            zodType: 'z.coerce.number()',
            initialValue: 50,
            prefix: '',
            description: '魔法值',
          },
          {
            path: '名字',
            zodType: 'z.string()',
            initialValue: '艾伦',
            prefix: '',
            description: '角色名',
          },
          {
            path: '存活',
            zodType: 'z.boolean()',
            initialValue: true,
            prefix: '',
            description: '是否存活',
          },
          {
            path: '阵营',
            zodType: 'z.enum(["守序善良","中立善良","混乱善良"])',
            initialValue: '守序善良',
            prefix: '',
            description: '人格阵营',
          },
        ],
      },
      {
        name: '嵌套属性',
        variables: [
          {
            path: '属性.力量',
            zodType: 'z.coerce.number()',
            initialValue: 10,
            range: { min: 0, max: 20 },
            prefix: '',
            description: '力量属性',
          },
          {
            path: '属性.敏捷',
            zodType: 'z.coerce.number()',
            initialValue: 12,
            range: { min: 0, max: 20 },
            prefix: '',
            description: '敏捷属性',
          },
          {
            path: '属性.智力',
            zodType: 'z.coerce.number()',
            initialValue: 14,
            range: { min: 0, max: 20 },
            prefix: '',
            description: '智力属性',
          },
        ],
      },
    ];
  }

  it('叶子数字字段应该有 .prefault(默认值)', () => {
    const sections = makeTestSections();
    const schema = buildSchemaTs(sections);
    expect(schema).toContain('.prefault(100)');
    expect(schema).toContain('.prefault(50)');
  });

  it('叶子字符串字段应该有 .prefault(默认值字符串)', () => {
    const sections = makeTestSections();
    const schema = buildSchemaTs(sections);
    expect(schema).toContain(".prefault('艾伦')");
  });

  it('叶子布尔字段应该有 .prefault(默认值)', () => {
    const sections = makeTestSections();
    const schema = buildSchemaTs(sections);
    expect(schema).toContain('.prefault(true)');
  });

  it('叶子枚举字段应该有 .prefault(默认值)', () => {
    const sections = makeTestSections();
    const schema = buildSchemaTs(sections);
    expect(schema).toContain(".prefault('守序善良')");
  });

  it('嵌套对象应该有 .prefault({...}) 包含完整默认值', () => {
    const sections = makeTestSections();
    const schema = buildSchemaTs(sections);
    expect(schema).toContain('.prefault({');
    expect(schema).toContain('力量: 10');
    expect(schema).toContain('敏捷: 12');
    expect(schema).toContain('智力: 14');
  });

  it('根级别z.object()不应该有.prefault()（匹配参考卡格式）', () => {
    const sections = makeTestSections();
    const schema = buildSchemaTs(sections);
    const lines = schema.split('\n');
    const lastObjectLine = lines.filter(l => l.includes('});')).pop();
    expect(lastObjectLine).toBe('});');
  });

  it('buildMvuScriptBundle 应该始终生成 updateRulesYaml', () => {
    const mvu = createEmptyMvuConfig();
    mvu.enabled = true;
    mvu.schemaSections = makeTestSections();
    const bundle = buildMvuScriptBundle(mvu);
    expect(bundle.updateRulesYaml).toBeTruthy();
    expect(bundle.updateRulesYaml).toContain('变量更新规则');
  });

  it('buildMvuScriptBundle 应该生成包含所有变量默认值的 initvarYaml', () => {
    const mvu = createEmptyMvuConfig();
    mvu.enabled = true;
    mvu.schemaSections = makeTestSections();
    const bundle = buildMvuScriptBundle(mvu);
    expect(bundle.initvarYaml).toContain('HP: 100');
    expect(bundle.initvarYaml).toContain('MP: 50');
    expect(bundle.initvarYaml).toContain('名字: 艾伦');
  });

  it('zodTxt应该包含registerMvuSchema导入和调用', () => {
    const mvu = createEmptyMvuConfig();
    mvu.enabled = true;
    mvu.schemaSections = makeTestSections();
    const bundle = buildMvuScriptBundle(mvu);
    expect(bundle.zodTxt).toContain("import { registerMvuSchema }");
    expect(bundle.zodTxt).toContain("registerMvuSchema(Schema)");
  });

  it('record类型字段应该有.prefault()默认值', () => {
    const sectionsWithRecord: MvuSchemaSection[] = [
      {
        name: '好感度',
        variables: [
          {
            path: '好感度',
            zodType: 'z.record(z.string(), z.coerce.number())',
            initialValue: { 'NPC1': 0, 'NPC2': 50 },
            prefix: '',
            description: 'NPC好感度',
          },
        ],
      },
    ];
    const schema = buildSchemaTs(sectionsWithRecord);
    expect(schema).toContain('.prefault({');
    expect(schema).toContain('NPC1');
  });
});

// ── H10 regression: varName / statPath must be escaped in buildEjsPreprocess ──
//
// buildEjsPreprocess emits:
//   define('${varName}', getvar('stat_data.${statPath}', { defaults: ${defaults} }));
// Both varName and statPath come from user/AI-provided variable paths (v.path)
// which are free-text <input> fields in StepMvuVariables.tsx and are populated
// without sanitization by mergeVariableBlueprintsIntoMvu (AI-generated). A `'`,
// `\`, or `%>` in the path would otherwise break out of the single-quoted JS
// string literals and allow EJS code injection.

describe('MVU Builder — H10 EJS varName/statPath escaping in buildEjsPreprocess', () => {
  /**
   * Naive EJS→JS converter for testing: strips @@generate_before, wraps
   * `<%_ ... _%>` blocks as plain JS, so we can use `new Function()` to verify
   * the generated EJS compiles and runs without injection.
   */
  function ejsToJs(ejs: string): string {
    return ejs
      .replace(/^@@generate_before\s*\n?/m, '')
      .replace(/<%_/g, '')
      .replace(/_%>/g, '')
      .replace(/<%=/g, 'output += ')
      .replace(/%>/g, ';');
  }

  /** Compile and run the EJS preprocess content with stubbed define/getvar. */
  function runEjs(content: string, getvarImpl: (path: string, opts?: unknown) => unknown) {
    // `new Function()` does not capture closure variables, so `defines` must be
    // declared inside the function body and returned alongside `output`.
    const getvar = (path: string, opts?: unknown) => getvarImpl(path, opts);
    const fn = new Function(
      'define', 'getvar',
      `let output = ''; const defines = {}; const __define = (n, v) => { defines[n] = v; }; ${ejsToJs(content).replace(/\bdefine\(/g, '__define(')}; return { output, defines };`,
    );
    return fn(undefined, getvar);
  }

  it('escapes single quote in variable path (EJS injection vector)', () => {
    // Malicious/AI-generated path containing a single quote that would break
    // out of the single-quoted JS string literal in getvar('stat_data....', ...).
    // varPathMap keys on v.path.split('.').pop() — i.e. the last segment after
    // the final dot — so usedVariables must match that exact (malicious) key.
    const sections: MvuSchemaSection[] = [
      {
        name: '角色',
        variables: [
          { path: "角色.好感度'); evilCode(); //", zodType: 'z.coerce.number()', initialValue: 0, prefix: '', description: '好感度' },
        ],
      },
    ];
    const configs: EjsEntryConfig[] = [
      { entryId: 'e1', complexity: '显隐', condition: '', usedVariables: ["好感度'); evilCode(); //"] },
    ];
    const content = buildEjsPreprocess(configs, sections);

    // The raw path must NOT appear unescaped inside the getvar string literal
    expect(content).not.toContain("stat_data.角色.好感度'); evilCode(); //'");
    // The escaped form must be present (single quote escaped to \')
    expect(content).toContain("stat_data.角色.好感度\\'); evilCode(); //");
  });

  it('escapes backslash in variable path', () => {
    const sections: MvuSchemaSection[] = [
      {
        name: '角色',
        variables: [
          // path literal `角色.好感度\夜` (single backslash between 好感度 and 夜)
          { path: '角色.好感度\\夜', zodType: 'z.coerce.number()', initialValue: 0, prefix: '', description: '好感度' },
        ],
      },
    ];
    const configs: EjsEntryConfig[] = [
      // varPathMap keys on v.path.split('.').pop() = '好感度\夜' — usedVariables
      // must match this exact key to hit the if-branch where statPath is emitted.
      { entryId: 'e1', complexity: '显隐', condition: '', usedVariables: ['好感度\\夜'] },
    ];
    const content = buildEjsPreprocess(configs, sections);

    // Backslash must be doubled to avoid escaping the closing quote
    expect(content).not.toMatch(/stat_data\.角色\.好感度\\夜'/);
    expect(content).toContain('stat_data.角色.好感度\\\\夜');
  });

  it('escapes backslash at end of variable path (critical case)', () => {
    // A trailing backslash would escape the closing quote and break syntax.
    const sections: MvuSchemaSection[] = [
      {
        name: '角色',
        variables: [
          { path: '角色.x\\', zodType: 'z.coerce.number()', initialValue: 0, prefix: '', description: 'x' },
        ],
      },
    ];
    const configs: EjsEntryConfig[] = [
      { entryId: 'e1', complexity: '显隐', condition: '', usedVariables: ['x\\'] },
    ];
    const content = buildEjsPreprocess(configs, sections);

    // Trailing backslash must be doubled (so \\' in output, which is \\\\ in regex)
    expect(content).toMatch(/stat_data\.角色\.x\\\\'/);
  });

  it('escapes %> sequence in variable path to prevent EJS close tag injection', () => {
    const sections: MvuSchemaSection[] = [
      {
        name: '角色',
        variables: [
          { path: '角色.x%>y', zodType: 'z.coerce.number()', initialValue: 0, prefix: '', description: 'x' },
        ],
      },
    ];
    const configs: EjsEntryConfig[] = [
      { entryId: 'e1', complexity: '显隐', condition: '', usedVariables: ['x%>y'] },
    ];
    const content = buildEjsPreprocess(configs, sections);

    // %> must be escaped so it doesn't terminate the EJS scriptlet early
    expect(content).not.toMatch(/stat_data\.角色\.x%>y/);
    expect(content).toContain('stat_data.角色.x%\\>y');
  });

  it('escapes newline in variable path', () => {
    const sections: MvuSchemaSection[] = [
      {
        name: '角色',
        variables: [
          { path: '角色.x\ny', zodType: 'z.coerce.number()', initialValue: 0, prefix: '', description: 'x' },
        ],
      },
    ];
    const configs: EjsEntryConfig[] = [
      { entryId: 'e1', complexity: '显隐', condition: '', usedVariables: ['x\ny'] },
    ];
    const content = buildEjsPreprocess(configs, sections);

    // Newline must be escaped to \n (backslash-n) so it doesn't break the JS literal
    expect(content).not.toMatch(/stat_data\.角色\.x\ny/);
    expect(content).toContain('stat_data.角色.x\\ny');
  });

  it('sanitized path keeps EJS runtime working (no injection at runtime)', () => {
    // The sanitized path should still be a valid JS string that getvar receives
    // verbatim, so the runtime behaviour is preserved.
    const sections: MvuSchemaSection[] = [
      {
        name: '角色',
        variables: [
          { path: "角色.好感度'", zodType: 'z.coerce.number()', initialValue: 42, prefix: '', description: '好感度' },
        ],
      },
    ];
    const configs: EjsEntryConfig[] = [
      { entryId: 'e1', complexity: '显隐', condition: '', usedVariables: ["好感度'"] },
    ];
    const content = buildEjsPreprocess(configs, sections);

    // Verify the generated EJS compiles and runs without throwing
    const seenPaths: string[] = [];
    const result = runEjs(content, (path) => {
      seenPaths.push(path);
      return 42;
    });

    // getvar should receive the verbatim path including the single quote
    expect(seenPaths).toContain("stat_data.角色.好感度'");
    // define() should have been called with the varName including the single quote
    expect(result.defines).toHaveProperty("好感度'", 42);
  });

  it('escapes varName when variable is not found in schema (else branch)', () => {
    // When a varName from EJS config doesn't match any schema variable,
    // buildEjsPreprocess falls back to the else branch where varName is used
    // for both define() and getvar() — it must still be escaped.
    const sections: MvuSchemaSection[] = [
      { name: '角色', variables: [] },
    ];
    const configs: EjsEntryConfig[] = [
      { entryId: 'e1', complexity: '显隐', condition: '', usedVariables: ["evil'); evilCode(); //"] },
    ];
    const content = buildEjsPreprocess(configs, sections);

    // The else branch must also escape the varName
    expect(content).not.toContain("define('evil'); evilCode(); //'");
    expect(content).toContain("define('evil\\'); evilCode(); //");
    expect(content).toContain("getvar('stat_data.evil\\'); evilCode(); //',");
  });
});
