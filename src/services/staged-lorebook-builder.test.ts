/**
 * Staged Lorebook Builder Tests - 验证调度条目兼容数组/标量两种 MVU 格式
 */
import { describe, it, expect } from 'vitest';
import {
  buildDispatcherContent,
  buildStagedLorebookEntries,
  migrateStagedDispatcherContent,
  parseDispatcherContent,
  sortStagesByDirection,
  type StagedLorebookConfig,
} from './staged-lorebook-builder';

describe('Staged Lorebook Builder - 调度条目兼容性', () => {
  function makeConfig(override?: Partial<StagedLorebookConfig>): StagedLorebookConfig {
    return {
      axisPath: '傅雪.情感天平',
      axisType: 'number',
      numericDirection: '<=',
      stages: [
        { name: '完全沉沦于张强', condition: '<= -100' },
        { name: '深陷爱河', condition: '<= -80' },
        { name: '意乱情迷', condition: '<= -50' },
        { name: '暗生情愫', condition: '<= -20' },
        { name: '初识涟漪', condition: '<= 19' },
        { name: '母爱变质', condition: '<= 49' },
        { name: '醋意渐生', condition: '<= 79' },
        { name: '爱欲深缠', condition: '<= 99' },
        { name: '孽缘情定', condition: '>= 100' },
      ],
      bookName: '高考冲刺100天',
      dispatcherName: '傅雪分阶段人设',
      ...override,
    };
  }

  it('调度条目应包含 Array.isArray 兼容处理', () => {
    const content = buildDispatcherContent(makeConfig());
    expect(content).toContain("const __stagedRaw_傅雪分阶段人设 = getvar('stat_data.傅雪.情感天平');");
    expect(content).toContain('const __stagedVal_傅雪分阶段人设 = Array.isArray(__stagedRaw_傅雪分阶段人设) ? __stagedRaw_傅雪分阶段人设[0] : __stagedRaw_傅雪分阶段人设;');
  });

  it('所有阶段判断都应使用 __stagedVal', () => {
    const content = buildDispatcherContent(makeConfig());
    expect(content).toContain('if (__stagedVal_傅雪分阶段人设 === undefined)');
    // 所有阶段都用 } else if（第一阶段接在 undefined 检查后）
    expect(content).toContain('} else if (__stagedVal_傅雪分阶段人设 <= -100) {');
    expect(content).toContain('} else if (__stagedVal_傅雪分阶段人设 <= -80) {');
    expect(content).toContain('} else if (__stagedVal_傅雪分阶段人设 >= 100) {');
    // 不应再出现直接 getvar(...) 作为判断条件
    expect(content).not.toMatch(/if \(getvar\(/);
  });

  it('反向解析器仍能正确提取 axisPath 和 bookName', () => {
    const content = buildDispatcherContent(makeConfig());
    const parsed = parseDispatcherContent(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.axisPath).toBe('傅雪.情感天平');
    expect(parsed!.bookName).toBe('高考冲刺100天');
    expect(parsed!.childComments).toContain('傅雪分阶段人设：完全沉沦于张强');
    expect(parsed!.childComments).toContain('傅雪分阶段人设：孽缘情定');
  });

  it('阶段条目应包含 dispatcher 和正确数量的子阶段', () => {
    const entries = buildStagedLorebookEntries(makeConfig());
    expect(entries.length).toBe(10);
    const dispatcher = entries[0];
    expect(dispatcher.constant).toBe(true);
    expect(dispatcher.selective).toBe(true);
    expect(dispatcher.enabled).toBe(true);
    expect(dispatcher.depth).toBe(3);

    const children = entries.slice(1);
    expect(children.every((e) => e.enabled === false)).toBe(true);
    expect(children.every((e) => e.constant === false)).toBe(true);
    expect(children.every((e) => e.depth === 4)).toBe(true);
  });

  it('<= 方向阶段应按阈值从低到高排序', () => {
    const sorted = sortStagesByDirection(
      [
        { name: 'a', condition: '<= 99' },
        { name: 'b', condition: '<= -100' },
        { name: 'c', condition: '<= -50' },
        { name: 'd', condition: '<= 49' },
      ],
      'number',
      '<=',
    );
    expect(sorted.map((s) => s.condition)).toEqual(['<= -100', '<= -50', '<= 49', '<= 99']);
  });

  it('>= 方向阶段应按阈值从高到低排序', () => {
    const sorted = sortStagesByDirection(
      [
        { name: 'a', condition: '>= 40' },
        { name: 'b', condition: '>= 90' },
        { name: 'c', condition: '>= 0' },
        { name: 'd', condition: '>= 70' },
      ],
      'number',
      '>=',
    );
    expect(sorted.map((s) => s.condition)).toEqual(['>= 90', '>= 70', '>= 40', '>= 0']);
  });

  it('应能同时兼容标量与数组两种 MVU 存储格式', () => {
    const content = buildDispatcherContent(makeConfig());

    // 把 EJS 标签与文本片段转成可执行的 JS
    function ejsToJs(ejs: string): string {
      const tagRe = /(<%_[\s\S]*?_%>|<%=!?[\s\S]*?%>|<%[\s\S]*?%>)/g;
      const out: string[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(ejs)) !== null) {
        const text = ejs.slice(last, m.index);
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
      const tail = ejs.slice(last);
      if (tail) out.push(`output += ${JSON.stringify(tail)};`);
      return out.join('\n');
    }

    function render(getvarReturn: unknown): string {
      const getvar = () => getvarReturn;
      const getWorldInfo = (_book: string, comment: string) => `[[${comment}]]`;
      // eslint-disable-next-line no-new-func
      const fn = new Function('getvar', 'getWorldInfo', `let output = ''; ${ejsToJs(content)}; return output;`);
      return fn(getvar, getWorldInfo);
    }

    // 标量：直接返回值
    expect(render(-100)).toContain('傅雪分阶段人设：完全沉沦于张强');
    expect(render(100)).toContain('傅雪分阶段人设：孽缘情定');
    expect(render(0)).toContain('傅雪分阶段人设：初识涟漪');

    // 数组：参考卡 [值, 描述] 格式
    expect(render([-100, 'desc'])).toContain('傅雪分阶段人设：完全沉沦于张强');
    expect(render([100, 'desc'])).toContain('傅雪分阶段人设：孽缘情定');
    expect(render([0, 'desc'])).toContain('傅雪分阶段人设：初识涟漪');

    // 未定义
    expect(render(undefined)).toContain('未定义');
  });

  it('dual-route 统一 >= 方向应按阈值从高到低排序（含负值缓冲带）', () => {
    const sorted = sortStagesByDirection(
      [
        { name: '缓冲带', condition: '>= -20' },
        { name: '纯爱·深爱', condition: '>= 80' },
        { name: 'NTR·沉沦', condition: '>= -100' },
        { name: '纯爱·暧昧', condition: '>= 20' },
        { name: 'NTR·动摇', condition: '>= -50' },
        { name: 'NTR·沦陷', condition: '>= -80' },
      ],
      'number',
      '>=',
    );
    expect(sorted.map((s) => s.condition)).toEqual([
      '>= 80',
      '>= 20',
      '>= -20',
      '>= -50',
      '>= -80',
      '>= -100',
    ]);
  });

  it('dual-route dispatcher 应正确引用 per-character axis path', () => {
    const cfg = makeConfig({
      axisPath: '林雅宁.情感天平',
      dispatcherName: '林雅宁分阶段人设',
      numericDirection: '>=',
      stages: [
        { name: '纯爱·深爱', condition: '>= 80' },
        { name: '中立·缓冲带', condition: '>= -20' },
        { name: 'NTR·动摇', condition: '>= -50' },
      ],
    });
    const content = buildDispatcherContent(cfg);
    expect(content).toContain("const __stagedRaw_林雅宁分阶段人设 = getvar('stat_data.林雅宁.情感天平');");
    expect(content).toContain('} else if (__stagedVal_林雅宁分阶段人设 >= 80) {');
    expect(content).toContain('} else if (__stagedVal_林雅宁分阶段人设 >= -20) {');
    expect(content).toContain('} else if (__stagedVal_林雅宁分阶段人设 >= -50) {');

    const parsed = parseDispatcherContent(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.axisPath).toBe('林雅宁.情感天平');
    expect(parsed!.childComments).toContain('林雅宁分阶段人设：纯爱·深爱');
  });

  it('dual-route dispatcher 渲染：缓冲带 0 应命中缓冲带阶段', () => {
    const cfg = makeConfig({
      axisPath: '林雅宁.情感天平',
      dispatcherName: '林雅宁分阶段人设',
      numericDirection: '>=',
      stages: [
        { name: '纯爱·深爱', condition: '>= 80' },
        { name: '中立·缓冲带', condition: '>= -20' },
        { name: 'NTR·动摇', condition: '>= -50' },
      ],
    });
    const content = buildDispatcherContent(cfg);

    function ejsToJs(ejs: string): string {
      const tagRe = /(<%_[\s\S]*?_%>|<%=!?[\s\S]*?%>|<%[\s\S]*?%>)/g;
      const out: string[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(ejs)) !== null) {
        const text = ejs.slice(last, m.index);
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
      const tail = ejs.slice(last);
      if (tail) out.push(`output += ${JSON.stringify(tail)};`);
      return out.join('\n');
    }

    function render(getvarReturn: unknown): string {
      const getvar = () => getvarReturn;
      const getWorldInfo = (_book: string, comment: string) => `[[${comment}]]`;
      // eslint-disable-next-line no-new-func
      const fn = new Function('getvar', 'getWorldInfo', `let output = ''; ${ejsToJs(content)}; return output;`);
      return fn(getvar, getWorldInfo);
    }

    expect(render(0)).toContain('林雅宁分阶段人设：中立·缓冲带');
    expect(render(90)).toContain('林雅宁分阶段人设：纯爱·深爱');
    expect(render(-40)).toContain('林雅宁分阶段人设：NTR·动摇');
  });

  it('migrateStagedDispatcherContent 应把旧版无后缀变量改为角色唯一变量名', () => {
    const oldContent = `<%_ const __stagedRaw = getvar('stat_data.温玉婵.情感天平'); _%>
<%_ const __stagedVal = Array.isArray(__stagedRaw) ? __stagedRaw[0] : __stagedRaw; _%>
<%_ if (__stagedVal === undefined) { _%>
<!-- 错误：阶段轴变量"温玉婵.情感天平"未定义，无法加载分阶段内容。 -->
<%_ } if (__stagedVal >= 90) { _%>
<%= await getWorldInfo("寒雨将临", "温玉婵分阶段人设：甘愿臣服") _%>`;
    const migrated = migrateStagedDispatcherContent(oldContent);
    expect(migrated).toContain('const __stagedRaw_温玉婵分阶段人设 = getvar');
    expect(migrated).toContain('const __stagedVal_温玉婵分阶段人设 = Array.isArray(__stagedRaw_温玉婵分阶段人设)');
    expect(migrated).toContain('if (__stagedVal_温玉婵分阶段人设 >= 90)');
    expect(migrated).not.toMatch(/\b__stagedRaw\b(?!_)/);
    expect(migrated).not.toMatch(/\b__stagedVal\b(?!_)/);
  });

  it('migrateStagedDispatcherContent 对已是新版的调度条目不做改动', () => {
    const newContent = buildDispatcherContent(makeConfig());
    expect(migrateStagedDispatcherContent(newContent)).toBe(newContent);
  });

  it('migrateStagedDispatcherContent 对普通世界书条目不做改动', () => {
    const plain = '# 普通条目\n这是普通内容';
    expect(migrateStagedDispatcherContent(plain)).toBe(plain);
  });
});
