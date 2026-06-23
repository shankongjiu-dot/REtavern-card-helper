/**
 * Status bar templates and AI generation for MVU status bar.
 *
 * Status bar HTML is embedded into regex_scripts and rendered by replacing
 * the <StatusPlaceHolderImpl/> placeholder in SillyTavern.
 *
 * Variable access: {{getvar::stat_data.角色.好感度}}
 *
 * Constraints for AI generation:
 *   - Must use {{getvar::stat_data.路径}} for variables
 *   - Must be self-contained HTML (no external CSS/JS)
 *   - Must use inline styles only (SillyTavern strips <style> tags in some configs)
 *   - Must use width:100% to fill the message container
 */

import type { MvuSchemaSection, MvuVariable } from '../constants/defaults';

// ── Template definitions ────────────────────────────────────────────────────

export interface StatusBarTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Generate HTML from variables */
  generate: (sections: MvuSchemaSection[], title: string) => string;
}

/** Get variable icon based on path keywords */
function getVarIcon(path: string): string {
  const lower = path.toLowerCase();
  if (path.includes('好感') || lower.includes('affection')) return '💕';
  if (path.includes('情绪') || lower.includes('emotion') || lower.includes('mood')) return '😊';
  if (path.includes('HP') || path.includes('生命') || lower.includes('health')) return '❤️';
  if (path.includes('MP') || path.includes('魔力') || lower.includes('mana')) return '💎';
  if (path.includes('等级') || lower.includes('level') || lower.includes('lv')) return '⭐';
  if (path.includes('场景') || path.includes('区域') || path.includes('地点') || lower.includes('location')) return '📍';
  if (path.includes('时间') || lower.includes('time')) return '🕐';
  if (path.includes('阶段') || lower.includes('phase') || lower.includes('stage')) return '📈';
  if (path.includes('关系') || lower.includes('relation')) return '🔗';
  if (path.includes('金币') || lower.includes('gold') || lower.includes('money')) return '🪙';
  if (path.includes('装备') || lower.includes('equipment')) return '⚔️';
  if (path.includes('任务') || lower.includes('quest')) return '📜';
  if (path.includes('天气') || lower.includes('weather')) return '🌤️';
  if (path.includes('社团') || lower.includes('club')) return '🎯';
  return '📌';
}

/** Get display name from variable path — show full path to distinguish same-named vars across characters */
function getDisplayName(path: string): string {
  const parts = path.split('.');
  if (parts.length <= 1) return path;
  return parts.join(' > ');
}

/** Generate SillyTavern getvar macro for a variable */
function formatVarExpr(v: MvuVariable): string {
  return `{{getvar::stat_data.${v.path}}}`;
}

/** Render a numeric progress bar (macro-friendly, no external CSS)
 *  Uses max(0%, calc(expr * 1%)) to handle empty macro values gracefully:
 *  - When getvar returns a number (e.g. 95): calc(95 * 1%) = 95% ✓
 *  - When getvar returns empty: calc() is invalid → max falls back to 0% ✓
 */
function drawBarHtml(expr: string, color: string, trackBg: string): string {
  const safeWidth = `max(0%, calc(${expr} * 1%))`;
  return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;width:100%">
      <div style="flex:1;background:${trackBg};height:6px;border-radius:3px;overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,0.1)">
        <div style="width:${safeWidth};background:${color};height:100%;border-radius:3px;transition:width 0.3s"></div>
      </div>
      <span style="min-width:40px;text-align:right;font-weight:600">${expr}</span>
    </div>`;
}

/** Build compact variable boxes used across templates (single-column full-width) */
function buildVarRows(
  vars: MvuVariable[],
  opts: {
    labelColor: string;
    valueColor: string;
    boxBg: string;
    barColor: string;
    barTrack: string;
    twoColumn?: boolean;
  },
): string {
  const boxStyle = `display:block;width:100%;box-sizing:border-box;background:${opts.boxBg};border-radius:6px;padding:6px 8px;margin-bottom:6px`;
  return vars
    .map(v => {
      const icon = getVarIcon(v.path);
      const name = getDisplayName(v.path);
      const expr = formatVarExpr(v);
      const isNumber = v.zodType === 'z.coerce.number()';
      const max = v.range?.max ?? 100;

      if (isNumber) {
        return `<div style="${boxStyle}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:12px">
            <span style="color:${opts.labelColor}">${icon} ${name}</span>
            <span style="color:${opts.valueColor};font-weight:600;font-size:11px">${expr} / ${max}</span>
          </div>
          ${drawBarHtml(expr, opts.barColor, opts.barTrack)}
        </div>`;
      }
      return `<div style="display:flex;justify-content:space-between;align-items:center;${boxStyle}">
        <span style="color:${opts.labelColor}">${icon} ${name}</span>
        <span style="color:${opts.valueColor};font-weight:600">${expr}</span>
      </div>`;
    })
    .join('\n');
}

// ── Template: Minimal Dark ──────────────────────────────────────────────────

const minimalDark: StatusBarTemplate = {
  id: 'minimal-dark',
  name: '极简暗色',
  icon: '🌙',
  description: '全宽深色面板，进度条展示',
  generate(sections, title) {
    const vars = sections.flatMap(s => s.variables).filter(v => v.prefix !== '$').slice(0, 8);
    const rows = buildVarRows(vars, {
      labelColor: '#94a3b8',
      valueColor: '#818cf8',
      boxBg: 'rgba(255,255,255,0.04)',
      barColor: '#818cf8',
      barTrack: 'rgba(255,255,255,0.08)',
      twoColumn: false,
    });

    return `<div style="width:100%;max-width:none;box-sizing:border-box;background:rgba(15,23,42,0.9);border:1px solid rgba(99,102,241,0.25);border-radius:10px;padding:12px 14px;font-family:system-ui,sans-serif;color:#e2e8f0;backdrop-filter:blur(8px);box-shadow:0 4px 16px rgba(0,0,0,0.2);margin:8px 0">
  <div style="font-size:11px;color:#64748b;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid rgba(99,102,241,0.15);padding-bottom:6px;font-weight:600">${title}</div>
  <div style="display:block;width:100%">
${rows}
  </div>
</div>`;
  },
};

// ── Template: Glass Light ───────────────────────────────────────────────────

const glassLight: StatusBarTemplate = {
  id: 'glass-light',
  name: '毛玻璃浅色',
  icon: '☀️',
  description: '全宽毛玻璃浅色面板',
  generate(sections, title) {
    const vars = sections.flatMap(s => s.variables).filter(v => v.prefix !== '$').slice(0, 8);
    const rows = buildVarRows(vars, {
      labelColor: '#64748b',
      valueColor: '#6366f1',
      boxBg: 'rgba(255,255,255,0.5)',
      barColor: '#6366f1',
      barTrack: 'rgba(0,0,0,0.06)',
      twoColumn: false,
    });

    return `<div style="width:100%;max-width:none;box-sizing:border-box;background:rgba(255,255,255,0.78);border:1px solid rgba(99,102,241,0.18);border-radius:12px;padding:12px 14px;font-family:system-ui,sans-serif;color:#334155;backdrop-filter:blur(12px);box-shadow:0 8px 24px rgba(0,0,0,0.06);margin:8px 0">
  <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;border-bottom:1px solid rgba(0,0,0,0.06);padding-bottom:6px">${title}</div>
  <div style="display:block;width:100%">
${rows}
  </div>
</div>`;
  },
};

// ── Template: Game HUD ──────────────────────────────────────────────────────

const gameHud: StatusBarTemplate = {
  id: 'game-hud',
  name: '游戏HUD',
  icon: '🎮',
  description: 'RPG 游戏风格全宽 HUD',
  generate(sections, title) {
    const vars = sections.flatMap(s => s.variables).filter(v => v.prefix !== '$').slice(0, 8);
    const rows = buildVarRows(vars, {
      labelColor: '#cbd5e1',
      valueColor: '#fbbf24',
      boxBg: 'rgba(0,0,0,0.25)',
      barColor: 'linear-gradient(90deg,#f59e0b,#fbbf24)',
      barTrack: 'rgba(0,0,0,0.4)',
      twoColumn: false,
    });

    return `<div style="width:100%;max-width:none;box-sizing:border-box;background:linear-gradient(135deg,rgba(15,23,42,0.95),rgba(30,41,59,0.95));border:2px solid rgba(251,191,36,0.25);border-radius:10px;padding:12px 14px;font-family:'Segoe UI',system-ui,sans-serif;color:#e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,0.3),inset 0 1px 0 rgba(251,191,36,0.1);margin:8px 0">
  <div style="font-size:11px;color:#fbbf24;margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;border-bottom:1px solid rgba(251,191,36,0.2);padding-bottom:6px;text-shadow:0 0 8px rgba(251,191,36,0.3)">⚔️ ${title}</div>
  <div style="display:block;width:100%">
${rows}
  </div>
</div>`;
  },
};

// ── Template: Anime Card ────────────────────────────────────────────────────

const animeCard: StatusBarTemplate = {
  id: 'anime-card',
  name: '二次元卡片',
  icon: '🌸',
  description: '粉色系全宽卡片面板',
  generate(sections, title) {
    const vars = sections.flatMap(s => s.variables).filter(v => v.prefix !== '$').slice(0, 8);
    const rows = buildVarRows(vars, {
      labelColor: '#fce7f3',
      valueColor: '#fdf2f8',
      boxBg: 'rgba(255,255,255,0.12)',
      barColor: '#f472b6',
      barTrack: 'rgba(255,255,255,0.12)',
      twoColumn: false,
    });

    return `<div style="width:100%;max-width:none;box-sizing:border-box;background:linear-gradient(135deg,rgba(236,72,153,0.3),rgba(168,85,247,0.3));border:1px solid rgba(244,114,182,0.35);border-radius:14px;padding:12px 14px;font-family:'Segoe UI',system-ui,sans-serif;color:#fdf2f8;backdrop-filter:blur(10px);box-shadow:0 8px 24px rgba(236,72,153,0.15);margin:8px 0">
  <div style="font-size:12px;color:#fbcfe8;margin-bottom:10px;text-align:center;font-weight:600;letter-spacing:0.5px;text-shadow:0 0 6px rgba(244,114,182,0.3);border-bottom:1px solid rgba(255,255,255,0.15);padding-bottom:6px">🌸 ${title} 🌸</div>
  <div style="display:block;width:100%">
${rows}
  </div>
</div>`;
  },
};

// ── Template: Terminal ──────────────────────────────────────────────────────

const terminal: StatusBarTemplate = {
  id: 'terminal',
  name: '终端风格',
  icon: '💻',
  description: '赛博朋克终端全宽面板',
  generate(sections, title) {
    const vars = sections.flatMap(s => s.variables).filter(v => v.prefix !== '$').slice(0, 8);
    const rows = vars
      .map(v => {
        const name = getDisplayName(v.path);
        const expr = formatVarExpr(v);
        return `<div style="display:block;width:100%;box-sizing:border-box;margin-bottom:6px;padding:5px 8px;font-size:12px;background:rgba(34,211,238,0.06);border-radius:4px;font-family:'Cascadia Code','Fira Code',monospace">
          <span style="color:#22d3ee">[</span><span style="color:#94a3b8">${name}</span><span style="color:#22d3ee">]</span>
          <span style="color:#4ade80;font-weight:600;float:right">→ ${expr}</span>
          <div style="clear:both"></div>
        </div>`;
      })
      .join('\n');

    return `<div style="width:100%;max-width:none;box-sizing:border-box;background:rgba(10,14,26,0.92);border:1px solid rgba(34,211,238,0.25);border-radius:8px;padding:12px 14px;font-family:'Cascadia Code','Fira Code',monospace;color:#e2e8f0;box-shadow:0 0 20px rgba(34,211,238,0.08),inset 0 0 20px rgba(34,211,238,0.03);margin:8px 0">
  <div style="font-size:11px;color:#22d3ee;margin-bottom:10px;border-bottom:1px solid rgba(34,211,238,0.15);padding-bottom:6px;letter-spacing:1px">&gt; ${title}</div>
  <div style="display:block;width:100%">
${rows}
  </div>
</div>`;
  },
};

// ── Template: Ancient Scroll（参考示例的古风折叠面板）───────────────────────

const ancientScroll: StatusBarTemplate = {
  id: 'ancient-scroll',
  name: '古风卷轴',
  icon: '📜',
  description: '参考大炎王朝示例的古风全宽折叠面板',
  generate(sections, title) {
    const vars = sections.flatMap(s => s.variables).filter(v => v.prefix !== '$').slice(0, 12);
    const rows = buildVarRows(vars, {
      labelColor: '#6b5a45',
      valueColor: '#8b6914',
      boxBg: '#faf8f5',
      barColor: '#b54a3a',
      barTrack: '#e3dbce',
      twoColumn: false,
    });

    return `<div style="width:100%;max-width:none;box-sizing:border-box;margin:8px 0;border:1px solid #d4c9b8;border-radius:6px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);font-family:'Noto Serif SC','Source Han Serif SC',serif;color:#2c2418;background:#fcfaf7">
  <div style="padding:10px 14px;background:linear-gradient(to right,#ede4d8,#f5f0e6);border-bottom:1px solid #d4c9b8">
    <span style="font-weight:600;color:#8b6914;letter-spacing:1px">📜 ${title}</span>
  </div>
  <div style="padding:12px;background:#fcfaf7">
    <div style="display:block;width:100%">
${rows}
    </div>
  </div>
</div>`;
  },
};

// ── Template registry ───────────────────────────────────────────────────────

export const STATUS_BAR_TEMPLATES: StatusBarTemplate[] = [
  minimalDark,
  glassLight,
  gameHud,
  animeCard,
  terminal,
  ancientScroll,
];

export function getTemplateById(id: string): StatusBarTemplate | undefined {
  return STATUS_BAR_TEMPLATES.find(t => t.id === id);
}

export function generateStatusBarHtml(
  templateId: string,
  sections: MvuSchemaSection[],
  title: string,
): string {
  const template = getTemplateById(templateId);
  if (!template) return '';
  return template.generate(sections, title);
}

/**
 * 根据 AI 返回的状态栏配置（标题、要显示的变量路径列表、风格提示）
 * 选择最合适的模板并生成 HTML。会被 AI 生成流程使用。
 *
 * - 若 showVariables 为空，则展示全部非隐藏变量
 * - 若指定了风格关键词（如"赛博"、"暗色"、"粉色"），匹配对应模板
 * - 默认使用 minimal-dark
 */
export function generateStatusBarFromAiConfig(
  sections: MvuSchemaSection[],
  cfg: { title?: string; showVariables?: string[]; styleHint?: string },
): { html: string; templateId: string; title: string } {
  const title = (cfg.title || '状态栏').trim();
  const styleHint = (cfg.styleHint || '').toLowerCase();

  // 风格关键词 → 模板 id
  let templateId = 'minimal-dark';
  if (/赛博|终端|cyber|terminal|霓虹/.test(styleHint)) templateId = 'terminal';
  else if (/粉|二次元|少女|anime|sakura|樱花/.test(styleHint)) templateId = 'anime-card';
  else if (/rpg|游戏|hud|game/.test(styleHint)) templateId = 'game-hud';
  else if (/浅|亮|light|玻璃|glass|白色/.test(styleHint)) templateId = 'glass-light';
  else if (/古风|卷轴|scroll|水墨/.test(styleHint)) templateId = 'ancient-scroll';
  else if (/暗|dark|深色|极简|minimal/.test(styleHint)) templateId = 'minimal-dark';

  // 若指定了要显示的变量，构造一个过滤后的 sections 副本
  const showSet = new Set((cfg.showVariables || []).filter(Boolean));
  let usedSections = sections;
  if (showSet.size > 0) {
    usedSections = sections
      .map(s => ({
        ...s,
        variables: s.variables.filter(v => showSet.has(v.path)),
      }))
      .filter(s => s.variables.length > 0);
  }

  return {
    html: generateStatusBarHtml(templateId, usedSections, title),
    templateId,
    title,
  };
}

// ── AI generation prompt ────────────────────────────────────────────────────

/**
 * Build the AI prompt for status bar generation.
 * Includes strict constraints to ensure MVU/EJS compatibility.
 */
export function buildStatusBarAIPrompt(
  sections: MvuSchemaSection[],
  cardName: string,
  styleHint: string,
): { system: string; user: string } {
  // Build variable list for AI context
  const varList = sections
    .flatMap(s => s.variables)
    .filter(v => v.prefix !== '$')
    .map(v => {
      const type = v.zodType === 'z.coerce.number()' ? 'number' : v.zodType.startsWith('z.enum(') ? 'enum' : 'string';
      const range = v.range ? ` (range: ${v.range.min}-${v.range.max})` : '';
      return `  - ${v.path} [${type}${range}]: ${v.description} (initial: ${v.initialValue})`;
    })
    .join('\n');

  return {
    system: `你是一个 SillyTavern 状态栏 HTML 生成器。根据用户提供的 MVU 变量列表，生成一个美观的状态栏 HTML 模板。

## 严格约束（违反将导致状态栏无法显示变量）

1. 变量读取必须使用 SillyTavern 内置宏 {{getvar::stat_data.路径}}，路径必须以 stat_data. 开头：
   - 正确: {{getvar::stat_data.角色.好感度}}
   - 错误: <%- getvar('stat_data.角色.好感度') %>
   - 错误: {{getvar::角色.好感度}}
   - 错误: {{好感度}}
2. 数字类型用于进度条宽度时，必须用 max + calc 包裹以防止变量为空时进度条满格：
   - 正确: style="width:max(0%, calc({{getvar::stat_data.角色.好感度}} * 1%))"
   - 错误: style="width:{{getvar::stat_data.角色.好感度}}%"
3. 只能使用内联样式（style 属性），不要用 <style> 标签或外部 CSS
4. 必须是自包含的 HTML，不要引用外部资源
5. 不要使用 <script> 标签
6. 变量路径必须与用户提供的列表完全一致，不要自行修改路径
7. 根容器必须使用 width:100%，让状态栏填满 SillyTavern 消息容器，不要固定像素宽度
8. 使用 box-sizing:border-box 避免 padding/border 撑破布局
9. 每个变量卡片必须用 display:block;width:100% 单列全宽布局；禁止用 display:inline-block;width:48% 做多列、禁止用 display:grid / display:flex 做多列（SillyTavern 消息渲染会把它压成一行）
10. 避免使用 <details>/<summary> 标签，SillyTavern 消息渲染会将其显示为原始符号
11. 每个卡片内部用简单的 div 堆叠：标题、数值、进度条，不要嵌套复杂结构

## 状态栏渲染机制

生成的 HTML 会被嵌入 SillyTavern 的 regex_scripts 中：
- 每次 AI 回复末尾会自动包含 \`<StatusPlaceHolderImpl/>\`
- regex 脚本 "状态栏界面" 会把该占位符替换为这段 HTML（仅在前端显示）
- regex 脚本 "对AI隐藏状态栏" 会把占位符从 AI prompt 中删除

因此生成的 HTML 不需要 \`@@render_after\` 装饰器，也不需要 \`<script>\` 标签。

## 设计要求

- 状态栏显示在聊天消息区域，宽度必须填满容器
- 使用卡片/分组样式展示变量，每个变量一个小 box
- 数字变量用进度条展示，字符串变量用标签展示
- 顶部有标题栏，带装饰性下边框
- 配色与用户指定的风格一致
- 布局紧凑但信息清晰

## 输出格式

直接输出 HTML 代码，不要包裹在代码块中，不要添加任何解释文字。`,
    user: `卡片名称：${cardName}

## 可用变量列表
${varList || '（无变量）'}

## 风格要求
${styleHint || '深色半透明风格，简洁美观'}

请生成状态栏 HTML：`,
  };
}
