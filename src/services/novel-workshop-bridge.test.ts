import { describe, it, expect } from 'vitest';
import {
  variableBlueprintsToMvuSections,
  mergeVariableBlueprintsIntoMvu,
  revealFlagsToVariableBlueprints,
  workshopEntriesToLorebookEntries,
} from './novel-workshop-bridge';
import { createEmptyMvuConfig } from '../constants/defaults';
import type { MvuConfig } from '../constants/defaults';
import type { VariableBlueprint, GeneratedEntry, RevealFlag } from '../components/novel-workshop/types';

describe('variableBlueprintsToMvuSections', () => {
  it('groups blueprints by first path segment', () => {
    const blueprints: VariableBlueprint[] = [
      { path: '剧情.进度', type: 'enum', options: ['前期', '中期'], default: '前期', description: 'd1' },
      { path: '剧情.支线', type: 'boolean', default: false, description: 'd2' },
      { path: '彩蛋.hidden_x', type: 'boolean', default: false, description: 'd3' },
    ];
    const sections = variableBlueprintsToMvuSections(blueprints);
    expect(sections.map((s) => s.name)).toEqual(['剧情', '彩蛋']);
    expect(sections[0].variables.map((v) => v.path)).toEqual(['剧情.进度', '剧情.支线']);
    expect(sections[1].variables.map((v) => v.path)).toEqual(['彩蛋.hidden_x']);
  });

  it('deduplicates blueprints with identical paths', () => {
    const blueprints: VariableBlueprint[] = [
      { path: '剧情.进度', type: 'enum', options: ['A'], default: 'A', description: 'first' },
      { path: '剧情.进度', type: 'enum', options: ['B'], default: 'B', description: 'second' },
    ];
    const sections = variableBlueprintsToMvuSections(blueprints);
    expect(sections[0].variables).toHaveLength(1);
    expect(sections[0].variables[0].description).toBe('first');
  });
});

describe('mergeVariableBlueprintsIntoMvu', () => {
  it('adds new sections when none exist', () => {
    const current = createEmptyMvuConfig();
    const blueprints: VariableBlueprint[] = [
      { path: '剧情.进度', type: 'enum', options: ['前期'], default: '前期', description: 'd' },
    ];
    const result = mergeVariableBlueprintsIntoMvu(current, blueprints);
    expect(result.enabled).toBe(true);
    expect(result.schemaSections).toHaveLength(1);
    expect(result.schemaSections[0].name).toBe('剧情');
    expect(result.schemaSections[0].variables[0].path).toBe('剧情.进度');
  });

  it('merges new variables into an existing section with the same name', () => {
    // Existing MVU has section "剧情" with variable "剧情.旧变量"
    // Import has section "剧情" with variable "剧情.进度"
    // Expected: result section "剧情" has BOTH variables
    const current: MvuConfig = {
      ...createEmptyMvuConfig(),
      enabled: true,
      schemaSections: [
        {
          name: '剧情',
          variables: [
            {
              path: '剧情.旧变量',
              zodType: 'z.string()',
              description: 'existing',
              prefix: '',
              initialValue: '',
            },
          ],
        },
      ],
    };
    const blueprints: VariableBlueprint[] = [
      { path: '剧情.进度', type: 'enum', options: ['前期', '中期'], default: '前期', description: 'new' },
    ];
    const result = mergeVariableBlueprintsIntoMvu(current, blueprints);
    const plotSection = result.schemaSections.find((s) => s.name === '剧情');
    expect(plotSection).toBeDefined();
    expect(plotSection!.variables.map((v) => v.path).sort()).toEqual(['剧情.旧变量', '剧情.进度']);
  });

  it('preserves existing variable when import has the same path', () => {
    // Existing: 剧情.进度 enum with options ['旧前期']
    // Import: 剧情.进度 enum with options ['新前期']
    // Expected: existing variable is NOT overwritten (user data wins)
    const current: MvuConfig = {
      ...createEmptyMvuConfig(),
      enabled: true,
      schemaSections: [
        {
          name: '剧情',
          variables: [
            {
              path: '剧情.进度',
              zodType: "z.enum([\"旧前期\"])",
              description: 'user-edited',
              prefix: '',
              initialValue: '旧前期',
              enumValues: ['旧前期'],
            },
          ],
        },
      ],
    };
    const blueprints: VariableBlueprint[] = [
      { path: '剧情.进度', type: 'enum', options: ['新前期'], default: '新前期', description: 'ai-generated' },
    ];
    const result = mergeVariableBlueprintsIntoMvu(current, blueprints);
    const plotSection = result.schemaSections.find((s) => s.name === '剧情');
    expect(plotSection!.variables).toHaveLength(1);
    expect(plotSection!.variables[0].description).toBe('user-edited');
    expect(plotSection!.variables[0].enumValues).toEqual(['旧前期']);
  });

  it('handles re-import gracefully (idempotent)', () => {
    // First import adds 剧情.进度
    const blueprints: VariableBlueprint[] = [
      { path: '剧情.进度', type: 'enum', options: ['前期'], default: '前期', description: 'd' },
      { path: '彩蛋.x', type: 'boolean', default: false, description: 'egg' },
    ];
    const first = mergeVariableBlueprintsIntoMvu(createEmptyMvuConfig(), blueprints);
    // Second import should not duplicate
    const second = mergeVariableBlueprintsIntoMvu(first, blueprints);
    expect(second.schemaSections).toHaveLength(2);
    const plotVars = second.schemaSections.find((s) => s.name === '剧情')!.variables;
    const eggVars = second.schemaSections.find((s) => s.name === '彩蛋')!.variables;
    expect(plotVars).toHaveLength(1);
    expect(eggVars).toHaveLength(1);
  });
});

describe('revealFlagsToVariableBlueprints', () => {
  it('converts flags to 开关.{id} boolean blueprints', () => {
    const flags: RevealFlag[] = [
      { id: 'flag_a', label: '标记A', description: 'desc A', value: false },
      { id: 'flag_b', label: '标记B', description: 'desc B', value: true },
    ];
    const blueprints = revealFlagsToVariableBlueprints(flags);
    expect(blueprints.map((b) => b.path)).toEqual(['开关.flag_a', '开关.flag_b']);
    expect(blueprints[0].type).toBe('boolean');
    expect(blueprints[0].default).toBe(false);
  });

  it('skips flags with empty id', () => {
    const flags: RevealFlag[] = [
      { id: '', label: 'empty', description: '', value: false },
      { id: 'ok', label: 'good', description: '', value: false },
    ];
    const blueprints = revealFlagsToVariableBlueprints(flags);
    expect(blueprints).toHaveLength(1);
    expect(blueprints[0].path).toBe('开关.ok');
  });

  it('deduplicates by flag id', () => {
    const flags: RevealFlag[] = [
      { id: 'dup', label: 'first', description: '', value: false },
      { id: 'dup', label: 'second', description: '', value: false },
    ];
    const blueprints = revealFlagsToVariableBlueprints(flags);
    expect(blueprints).toHaveLength(1);
  });

  it('returns empty array for null/undefined input', () => {
    expect(revealFlagsToVariableBlueprints(null as unknown as RevealFlag[])).toEqual([]);
    expect(revealFlagsToVariableBlueprints(undefined as unknown as RevealFlag[])).toEqual([]);
    expect(revealFlagsToVariableBlueprints([])).toEqual([]);
  });
});

describe('workshopEntriesToLorebookEntries', () => {
  function makeEntry(overrides: Partial<GeneratedEntry> = {}): GeneratedEntry {
    return {
      id: 'e1',
      entityId: 'ent1',
      category: 'character',
      name: '测试',
      aspect: '',
      content: '内容',
      keys: ['测试'],
      stage: '',
      requiredFlags: [],
      strategy: 'selective',
      priority: 700,
      ...overrides,
    };
  }

  it('tags every entry with fromSkeleton=true and skeletonExpanded=false', () => {
    const entries = workshopEntriesToLorebookEntries([makeEntry(), makeEntry({ id: 'e2' })], []);
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.fromSkeleton).toBe(true);
      expect(e.skeletonExpanded).toBe(false);
    }
  });

  it('wraps content with EJS guard when requiredFlags is non-empty', () => {
    const entries = workshopEntriesToLorebookEntries(
      [makeEntry({ requiredFlags: ['flag_a', 'flag_b'] })],
      [],
    );
    expect(entries[0].content).toContain("<%_ if (getvar('stat_data.开关.flag_a') === true && getvar('stat_data.开关.flag_b') === true) { _%>");
    expect(entries[0].content).toContain('内容');
    expect(entries[0].content).toContain('<%_ } _%>');
  });

  it('does not wrap content when requiredFlags is empty', () => {
    const entries = workshopEntriesToLorebookEntries([makeEntry({ requiredFlags: [] })], []);
    expect(entries[0].content).toBe('内容');
  });

  it('handles undefined requiredFlags gracefully', () => {
    const entry = makeEntry();
    delete (entry as Partial<GeneratedEntry>).requiredFlags;
    const entries = workshopEntriesToLorebookEntries([entry], []);
    expect(entries[0].content).toBe('内容');
  });

  it('filters out entries with empty content', () => {
    const entries = workshopEntriesToLorebookEntries(
      [makeEntry({ content: '   ' }), makeEntry({ content: 'ok' })],
      [],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('ok');
  });

  // ── H6 regression: AI-generated flag ids must be sanitized before going into EJS ──

  it('sanitizes flag ids with single quotes in requiredFlags to prevent EJS injection', () => {
    // If AI returns id "flag'bad", the raw EJS guard would be:
    //   getvar('stat_data.开关.flag'bad') === true
    // which breaks the JS string literal. The id must be sanitized to "flag_bad".
    const entries = workshopEntriesToLorebookEntries(
      [makeEntry({ requiredFlags: ["flag'bad", 'normal_flag'] })],
      [],
    );
    expect(entries[0].content).toContain("getvar('stat_data.开关.flag_bad') === true");
    expect(entries[0].content).toContain("getvar('stat_data.开关.normal_flag') === true");
    // Must NOT contain the raw unsanitized id with single quote
    expect(entries[0].content).not.toContain("开关.flag'bad");
  });

  it('sanitizes flag ids with spaces and special characters in requiredFlags', () => {
    // "my flag id!" → "my_flag_id"
    const entries = workshopEntriesToLorebookEntries(
      [makeEntry({ requiredFlags: ['my flag id!'] })],
      [],
    );
    expect(entries[0].content).toContain("getvar('stat_data.开关.my_flag_id') === true");
  });

  it('produces EJS that compiles and executes correctly with sanitized flag ids', () => {
    // End-to-end: build EJS with a problematic flag id, then run it through
    // the same ejsToJs + new Function() pattern used in staged-lorebook-builder tests.
    const entries = workshopEntriesToLorebookEntries(
      [makeEntry({ requiredFlags: ["flag'bad"], content: 'guarded content' })],
      [],
    );
    const ejs = entries[0].content;

    function ejsToJs(ejsText: string): string {
      const tagRe = /(<%_[\s\S]*?_%>|<%=!?[\s\S]*?%>|<%[\s\S]*?%>)/g;
      const out: string[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(ejsText)) !== null) {
        const text = ejsText.slice(last, m.index);
        if (text) out.push(`output += ${JSON.stringify(text)};`);
        const tag = m[1];
        if (tag.startsWith('<%_')) {
          out.push(tag.slice(4, -3).trim());
        } else if (tag.startsWith('<%=')) {
          const expr = tag.slice(3, tag.endsWith('_%>') ? -3 : -2).trim().replace(/^await\s+/, '');
          out.push(`output += String(${expr});`);
        } else {
          out.push(tag.slice(2, tag.endsWith('_%>') ? -3 : -2).trim());
        }
        last = tagRe.lastIndex;
      }
      const tail = ejsText.slice(last);
      if (tail) out.push(`output += ${JSON.stringify(tail)};`);
      return out.join('\n');
    }

    function render(getvarReturn: unknown): string {
      const getvar = () => getvarReturn;
      // eslint-disable-next-line no-new-func
      const fn = new Function('getvar', `let output = ''; ${ejsToJs(ejs)}; return output;`);
      return fn(getvar);
    }

    // When flag is false → content hidden
    expect(render(false)).not.toContain('guarded content');
    // When flag is true → content shown
    expect(render(true)).toContain('guarded content');
  });
});

describe('revealFlagsToVariableBlueprints — id sanitization', () => {
  it('sanitizes flag ids with single quotes before building variable path', () => {
    const flags: RevealFlag[] = [
      { id: "flag'bad", label: '测试', description: '', value: false },
    ];
    const blueprints = revealFlagsToVariableBlueprints(flags);
    expect(blueprints).toHaveLength(1);
    expect(blueprints[0].path).toBe('开关.flag_bad');
  });

  it('keeps already-sanitized flag ids unchanged', () => {
    const flags: RevealFlag[] = [
      { id: 'normal_flag', label: '正常', description: '', value: false },
    ];
    const blueprints = revealFlagsToVariableBlueprints(flags);
    expect(blueprints[0].path).toBe('开关.normal_flag');
  });

  it('sanitizes spaces and special characters in flag ids', () => {
    const flags: RevealFlag[] = [
      { id: 'my flag id!', label: '带空格', description: '', value: false },
    ];
    const blueprints = revealFlagsToVariableBlueprints(flags);
    expect(blueprints[0].path).toBe('开关.my_flag_id');
  });
});
