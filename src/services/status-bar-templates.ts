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
import { getThemeSettings } from './theme-service';

// ── Theme-aware helpers ─────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function resolveCssColor(varName: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallback;
}

/** Build an inline style string that exposes theme variables for status bars. */
function getStatusBarThemeStyle(): string {
  const theme = getThemeSettings();
  return `
    --sb-bg: ${theme.cardBgColor};
    --sb-bg-a: ${hexToRgba(theme.cardBgColor, 0.85)};
    --sb-text: ${theme.textColor};
    --sb-muted: ${hexToRgba(theme.textColor, 0.6)};
    --sb-faint: ${hexToRgba(theme.textColor, 0.4)};
    --sb-primary: ${theme.primaryColor};
    --sb-primary-a: ${hexToRgba(theme.primaryColor, 0.25)};
    --sb-success: ${resolveCssColor('--color-status-success', '#4ade80')};
    --sb-warning: ${resolveCssColor('--color-status-warning', '#fbbf24')};
    --sb-danger: ${resolveCssColor('--color-status-danger', '#f87171')};
    --sb-info: ${resolveCssColor('--color-info', '#38bdf8')};
  `.replace(/\s+/g, ' ').trim();
}

/** Wrap status bar HTML so SillyTavern still has theme vars after stripping <style>. */
function wrapStatusBarHtml(html: string): string {
  return `<div style="${getStatusBarThemeStyle()}">${html}</div>`;
}

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

/** Render a numeric meter using native min/max/value attributes.
 * Avoid CSS arithmetic because many ST/WebView renderers do not support calc() multiplication reliably.
 */
function drawBarHtml(expr: string, color: string, trackBg: string, min = 0, max = 100): string {
  return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;width:100%">
      <meter min="${min}" max="${max}" value="${expr}" style="flex:1;width:100%;height:10px;accent-color:${color};background:${trackBg};border-radius:999px"></meter>
      <span style="min-width:56px;text-align:right;font-weight:700">${expr}</span>
    </div>`;
}

/** Render a negative-capable range meter. Native meter handles min/max/value reliably after macros resolve. */
function drawBidirectionalBarHtml(
  expr: string,
  positiveColor: string,
  _negativeColor: string,
  trackBg: string,
  labelBg: string,
  labelColor: string,
  max: number,
  icon: string,
  name: string,
): string {
  return `<div style="display:block;width:100%;font-size:11px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;color:${labelColor}">
        <span style="white-space:nowrap">${icon} ${name}</span>
        <span style="background:${labelBg};border-radius:999px;padding:1px 7px;font-weight:700">${expr}</span>
      </div>
      <meter min="-${max}" max="${max}" low="-${max * 0.35}" high="${max * 0.35}" optimum="0" value="${expr}" style="display:block;width:100%;height:10px;accent-color:${positiveColor};background:${trackBg};border-radius:999px"></meter>
      <div style="display:flex;justify-content:space-between;margin-top:2px;font-size:9px;opacity:0.72;color:${labelColor}"><span>-${max}</span><span>0</span><span>${max}</span></div>
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
  const boxStyle = `display:block;width:100%;box-sizing:border-box;background:${opts.boxBg};border-radius:8px;padding:8px 10px;margin-bottom:7px;border:1px solid color-mix(in srgb, var(--sb-text) 10%, transparent)`;
  return vars
    .map(v => {
      const icon = getVarIcon(v.path);
      const name = getDisplayName(v.path);
      const expr = formatVarExpr(v);
      const isNumber = v.zodType === 'z.coerce.number()';
      const max = v.range?.max ?? 100;

      if (isNumber) {
        const min = v.range?.min ?? 0;
        const isBidirectional = min < 0;
        const rangeLabel = isBidirectional ? `${min}~${max}` : `${max}`;
        const bar = isBidirectional
          ? drawBidirectionalBarHtml(expr, opts.barColor, 'var(--sb-danger)', opts.barTrack, opts.boxBg, opts.labelColor, Math.max(Math.abs(min), Math.abs(max)), icon, name)
          : drawBarHtml(expr, opts.barColor, opts.barTrack, min, max);
        return `<div style="${boxStyle}">
          ${isBidirectional
            ? `<div style="display:flex;justify-content:flex-end;align-items:center;margin-bottom:5px;font-size:11px">
                 <span style="color:${opts.valueColor};font-weight:600">${expr} / ${rangeLabel}</span>
               </div>
               ${bar}`
            : `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:12px">
                 <span style="color:${opts.labelColor}">${icon} ${name}</span>
                 <span style="color:${opts.valueColor};font-weight:600;font-size:11px">${expr} / ${rangeLabel}</span>
               </div>
               ${bar}`}
        </div>`;
      }
      return `<div style="display:flex;justify-content:space-between;align-items:center;${boxStyle}">
        <span style="color:${opts.labelColor}">${icon} ${name}</span>
        <span style="color:${opts.valueColor};font-weight:600">${expr}</span>
      </div>`;
    })
    .join('\n');
}

// ── Template: Compact Panel ─────────────────────────────────────────────────

const compactPanel: StatusBarTemplate = {
  id: 'compact-panel',
  name: '紧凑信息面板',
  icon: '▣',
  description: '通用稳妥，适合大多数角色卡',
  generate(sections, title) {
    const vars = sections.flatMap(s => s.variables).filter(v => v.prefix !== '$').slice(0, 10);
    const rows = buildVarRows(vars, {
      labelColor: 'var(--sb-muted)',
      valueColor: 'var(--sb-primary)',
      boxBg: 'var(--sb-bg-a)',
      barColor: 'var(--sb-primary)',
      barTrack: 'color-mix(in srgb, var(--sb-text) 18%, transparent)',
      twoColumn: false,
    });

    return `<div style="width:100%;max-width:none;box-sizing:border-box;background:color-mix(in srgb, var(--sb-bg) 88%, transparent);border:1px solid color-mix(in srgb, var(--sb-text) 24%, transparent);border-radius:8px;padding:10px 12px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--sb-text);margin:8px 0;box-shadow:0 6px 18px color-mix(in srgb, black 18%, transparent)">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid color-mix(in srgb, var(--sb-text) 16%, transparent)">
    <span style="font-size:12px;font-weight:700;color:var(--sb-text);white-space:nowrap">${title}</span>
    <span style="font-size:10px;color:var(--sb-faint);text-transform:uppercase;letter-spacing:0.5px">MVU</span>
  </div>
  <div style="display:block;width:100%">
${rows}
  </div>
</div>`;
  },
};

// ── Template: Minimal Dark ──────────────────────────────────────────────────

const minimalDark: StatusBarTemplate = {
  id: 'minimal-dark',
  name: '极简暗色',
  icon: '🌙',
  description: '全宽深色面板，进度条展示',
  generate(sections, title) {
    const vars = sections.flatMap(s => s.variables).filter(v => v.prefix !== '$').slice(0, 8);
    const rows = buildVarRows(vars, {
      labelColor: 'var(--sb-muted)',
      valueColor: 'var(--sb-primary)',
      boxBg: 'color-mix(in srgb, var(--sb-text) 4%, transparent)',
      barColor: 'var(--sb-primary)',
      barTrack: 'color-mix(in srgb, var(--sb-text) 8%, transparent)',
      twoColumn: false,
    });

    return `<div style="width:100%;max-width:none;box-sizing:border-box;background:color-mix(in srgb, var(--sb-bg) 90%, transparent);border:1px solid var(--sb-primary-a);border-radius:10px;padding:12px 14px;font-family:system-ui,sans-serif;color:var(--sb-text);backdrop-filter:blur(8px);box-shadow:0 4px 16px color-mix(in srgb, black 20%, transparent);margin:8px 0">
  <div style="font-size:11px;color:var(--sb-faint);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid color-mix(in srgb, var(--sb-primary) 15%, transparent);padding-bottom:6px;font-weight:600">${title}</div>
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
      labelColor: 'var(--sb-muted)',
      valueColor: 'var(--sb-primary)',
      boxBg: 'color-mix(in srgb, var(--sb-bg) 50%, transparent)',
      barColor: 'var(--sb-primary)',
      barTrack: 'color-mix(in srgb, var(--sb-text) 6%, transparent)',
      twoColumn: false,
    });

    return `<div style="width:100%;max-width:none;box-sizing:border-box;background:color-mix(in srgb, var(--sb-bg) 78%, transparent);border:1px solid color-mix(in srgb, var(--sb-primary) 18%, transparent);border-radius:12px;padding:12px 14px;font-family:system-ui,sans-serif;color:var(--sb-text);backdrop-filter:blur(12px);box-shadow:0 8px 24px color-mix(in srgb, black 6%, transparent);margin:8px 0">
  <div style="font-size:11px;color:var(--sb-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;border-bottom:1px solid color-mix(in srgb, var(--sb-text) 6%, transparent);padding-bottom:6px">${title}</div>
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
      labelColor: 'var(--sb-muted)',
      valueColor: 'var(--sb-primary)',
      boxBg: 'color-mix(in srgb, var(--sb-text) 4%, transparent)',
      barColor: 'var(--sb-primary)',
      barTrack: 'color-mix(in srgb, var(--sb-text) 8%, transparent)',
      twoColumn: false,
    });

    return `<div style="width:100%;max-width:none;box-sizing:border-box;background:linear-gradient(135deg,color-mix(in srgb, var(--sb-bg) 95%, transparent),color-mix(in srgb, var(--sb-bg) 85%, transparent));border:2px solid var(--sb-primary-a);border-radius:10px;padding:12px 14px;font-family:'Segoe UI',system-ui,sans-serif;color:var(--sb-text);box-shadow:0 4px 20px color-mix(in srgb, black 30%, transparent),inset 0 1px 0 color-mix(in srgb, var(--sb-primary) 10%, transparent);margin:8px 0">
  <div style="font-size:11px;color:var(--sb-primary);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;font-weight:700;border-bottom:1px solid color-mix(in srgb, var(--sb-primary) 20%, transparent);padding-bottom:6px;text-shadow:0 0 8px color-mix(in srgb, var(--sb-primary) 30%, transparent)">⚔️ ${title}</div>
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
      labelColor: 'var(--sb-muted)',
      valueColor: 'var(--sb-text)',
      boxBg: 'color-mix(in srgb, var(--sb-text) 12%, transparent)',
      barColor: 'var(--sb-primary)',
      barTrack: 'color-mix(in srgb, var(--sb-text) 12%, transparent)',
      twoColumn: false,
    });

    return `<div style="width:100%;max-width:none;box-sizing:border-box;background:linear-gradient(135deg,color-mix(in srgb, var(--sb-primary) 30%, transparent),color-mix(in srgb, var(--sb-primary) 30%, transparent));border:1px solid color-mix(in srgb, var(--sb-primary) 35%, transparent);border-radius:14px;padding:12px 14px;font-family:'Segoe UI',system-ui,sans-serif;color:var(--sb-text);backdrop-filter:blur(10px);box-shadow:0 8px 24px color-mix(in srgb, var(--sb-primary) 15%, transparent);margin:8px 0">
  <div style="font-size:12px;color:var(--sb-muted);margin-bottom:10px;text-align:center;font-weight:600;letter-spacing:0.5px;text-shadow:0 0 6px color-mix(in srgb, var(--sb-primary) 30%, transparent);border-bottom:1px solid color-mix(in srgb, var(--sb-text) 15%, transparent);padding-bottom:6px">🌸 ${title} 🌸</div>
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
        return `<div style="display:block;width:100%;box-sizing:border-box;margin-bottom:6px;padding:5px 8px;font-size:12px;background:color-mix(in srgb, var(--sb-primary) 6%, transparent);border-radius:4px;font-family:'Cascadia Code','Fira Code',monospace">
          <span style="color:var(--sb-primary)">[</span><span style="color:var(--sb-muted)">${name}</span><span style="color:var(--sb-primary)">]</span>
          <span style="color:var(--sb-success);font-weight:600;float:right">→ ${expr}</span>
          <div style="clear:both"></div>
        </div>`;
      })
      .join('\n');

    return `<div style="width:100%;max-width:none;box-sizing:border-box;background:color-mix(in srgb, var(--sb-bg) 92%, transparent);border:1px solid color-mix(in srgb, var(--sb-primary) 25%, transparent);border-radius:8px;padding:12px 14px;font-family:'Cascadia Code','Fira Code',monospace;color:var(--sb-text);box-shadow:0 0 20px color-mix(in srgb, var(--sb-primary) 8%, transparent),inset 0 0 20px color-mix(in srgb, var(--sb-primary) 3%, transparent);margin:8px 0">
  <div style="font-size:11px;color:var(--sb-primary);margin-bottom:10px;border-bottom:1px solid color-mix(in srgb, var(--sb-primary) 15%, transparent);padding-bottom:6px;letter-spacing:1px">&gt; ${title}</div>
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
    const emotionVars = vars.filter(v => v.zodType === 'z.coerce.number()' && /情感|心境|好感|爱意|恨意|信任|亲密|倾向|天平|羁绊|忠诚|敌意|欲望|羞耻|理智|压力/.test(v.path));
    const otherVars = vars.filter(v => !emotionVars.includes(v));
    const otherRows = buildVarRows(otherVars, {
      labelColor: 'var(--sb-text)',
      valueColor: 'var(--sb-primary)',
      boxBg: 'color-mix(in srgb, var(--sb-bg) 82%, transparent)',
      barColor: 'var(--sb-primary)',
      barTrack: 'color-mix(in srgb, var(--sb-text) 12%, transparent)',
      twoColumn: false,
    });

    const renderEmotion = (v: MvuVariable) => {
      const icon = getVarIcon(v.path);
      const name = getDisplayName(v.path);
      const expr = formatVarExpr(v);
      const min = v.range?.min ?? -100;
      const max = v.range?.max ?? 100;
      const isDual = min < 0;
      const leftText = isDual ? '疏离' : `${min}`;
      const rightText = isDual ? '亲近' : `${max}`;
      return `<div style="background:linear-gradient(135deg,color-mix(in srgb, var(--sb-bg) 95%, transparent),color-mix(in srgb, var(--sb-bg) 86%, transparent));border:1px solid color-mix(in srgb, var(--sb-text) 24%, transparent);border-radius:10px;padding:10px 11px;margin-bottom:9px;box-shadow:inset 0 1px 0 color-mix(in srgb, var(--sb-text) 20%, transparent),0 2px 6px color-mix(in srgb, black 6%, transparent)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">
          <span style="font-size:12px;color:var(--sb-text);font-weight:700;letter-spacing:0.5px">${icon} ${name}</span>
          <span style="font-size:12px;color:var(--sb-primary);font-weight:800;font-family:Georgia,'Times New Roman',serif">${expr}</span>
        </div>
        <meter min="${min}" max="${max}" low="${isDual ? min * 0.35 : min}" high="${isDual ? max * 0.35 : max}" optimum="${isDual ? 0 : max}" value="${expr}" style="display:block;width:100%;height:12px;accent-color:var(--sb-primary);background:var(--sb-bg-a);border-radius:999px"></meter>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--sb-muted);letter-spacing:0.5px;margin-top:4px">
          <span>${leftText}</span><span>${isDual ? '中和' : `${min}~${max}`}</span><span>${rightText}</span>
        </div>
      </div>`;
    };

    const emotionSection = emotionVars.length > 0 ? `<div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;color:var(--sb-primary);font-size:12px;font-weight:700;letter-spacing:1px">
        <span>❦</span><span>心绪流转</span><span style="flex:1;height:1px;background:linear-gradient(90deg,color-mix(in srgb, var(--sb-primary) 28%, transparent),transparent)"></span>
      </div>
${emotionVars.map(renderEmotion).join('\n')}
    </div>` : '';

    return `<div style="width:100%;max-width:none;box-sizing:border-box;margin:8px 0;border:1px solid color-mix(in srgb, var(--sb-text) 30%, transparent);border-radius:8px;overflow:hidden;box-shadow:0 4px 12px color-mix(in srgb, black 8%, transparent);font-family:'Noto Serif SC','Source Han Serif SC',serif;color:var(--sb-text);background:linear-gradient(180deg,color-mix(in srgb, var(--sb-bg) 98%, white),color-mix(in srgb, var(--sb-bg) 90%, white))">
  <div style="padding:10px 14px;background:linear-gradient(to right,color-mix(in srgb, var(--sb-bg) 80%, white),color-mix(in srgb, var(--sb-bg) 95%, white),color-mix(in srgb, var(--sb-bg) 80%, white));border-bottom:1px solid color-mix(in srgb, var(--sb-text) 30%, transparent)">
    <span style="font-weight:700;color:var(--sb-primary);letter-spacing:1px">📜 ${title}</span>
  </div>
  <div style="padding:13px;background:linear-gradient(180deg,color-mix(in srgb, var(--sb-bg) 98%, white),color-mix(in srgb, var(--sb-bg) 94%, white))">
    ${emotionSection}
    <div style="display:block;width:100%">
${otherRows}
    </div>
  </div>
</div>`;
  },
};

// ── Template: Visual Novel (灵感来自"岁岁年年"，支持静态图片) ─────────────────

const visualNovel: StatusBarTemplate = {
  id: 'visual-novel',
  name: '视觉小说风格',
  icon: '🖼️',
  description: '精细卡片布局，支持背景图/立绘/头像，适合恋爱/校园/剧情题材',
  generate(sections, title) {
    const vars = sections.flatMap(s => s.variables).filter(v => v.prefix !== '$').slice(0, 12);
    const numberVars = vars.filter(v => v.zodType === 'z.coerce.number()');
    const stringVars = vars.filter(v => v.zodType !== 'z.coerce.number()');

    // 分组：着装、身体、事件、其他
    const outfitVars = stringVars.filter(v => /着装|上装|下装|内衣|配饰|鞋子/.test(v.path));
    const bodyVars = stringVars.filter(v => /身体|胸部|阴道|子宫|肛门/.test(v.path));
    const eventVars = stringVars.filter(v => /事件|坦白|告白|永恒/.test(v.path));
    const otherStringVars = stringVars.filter(v =>
      !/着装|上装|下装|内衣|配饰|鞋子|身体|胸部|阴道|子宫|肛门|事件|坦白|告白|永恒/.test(v.path)
    );

    const renderNumberVar = (v: MvuVariable) => {
      const icon = getVarIcon(v.path);
      const name = getDisplayName(v.path);
      const expr = formatVarExpr(v);
      const max = v.range?.max ?? 100;
      const min = v.range?.min ?? 0;

      return `<div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px">
          <span style="font-size:13px;font-weight:500;color:var(--sb-text)">${icon} ${name}</span>
          <span style="font-weight:800;font-size:14px;color:var(--sb-primary);font-family:'ZCOOL KuaiLe',cursive,sans-serif">${expr} / ${min}~${max}</span>
        </div>
        <meter min="${min}" max="${max}" low="${min < 0 ? min * 0.35 : min}" high="${min < 0 ? max * 0.35 : max}" optimum="${min < 0 ? 0 : max}" value="${expr}" style="display:block;width:100%;height:11px;accent-color:var(--sb-primary);background:color-mix(in srgb, var(--sb-text) 5%, transparent);border-radius:999px"></meter>
      </div>`;
    };

    const renderListItem = (v: MvuVariable) => {
      const icon = getVarIcon(v.path);
      const name = v.path.split('.').pop() || v.path;
      const expr = formatVarExpr(v);
      return `<div style="display:flex;align-items:center;padding:8px 12px;background:color-mix(in srgb, var(--sb-bg) 70%, transparent);border-radius:10px;margin-bottom:6px;border-left:3px solid var(--sb-primary);box-shadow:0 2px 4px color-mix(in srgb, black 2%, transparent)">
        <span style="margin-right:10px;font-size:16px">${icon}</span>
        <span style="font-weight:600;color:var(--sb-muted);margin-right:8px;min-width:40px;font-size:12px">${name}</span>
        <span style="color:var(--sb-text);font-weight:500;font-size:12px;flex:1;text-align:right">${expr}</span>
      </div>`;
    };

    const renderOtherString = (v: MvuVariable) => {
      const icon = getVarIcon(v.path);
      const name = getDisplayName(v.path);
      const expr = formatVarExpr(v);
      return `<div style="background:color-mix(in srgb, var(--sb-bg) 70%, transparent);border:1px solid color-mix(in srgb, var(--sb-text) 6%, transparent);border-radius:12px;padding:12px;margin-bottom:10px;box-shadow:inset 0 2px 5px color-mix(in srgb, black 2%, transparent)">
        <div style="font-size:12px;font-weight:500;color:var(--sb-muted);margin-bottom:6px">${icon} ${name}</div>
        <div style="font-size:13px;line-height:1.6;color:var(--sb-text);font-family:'ZCOOL KuaiLe',cursive,sans-serif">${expr}</div>
      </div>`;
    };

    // 分区标题样式
    const sectionTitle = (icon: string, label: string) => `
      <div style="font-family:'ZCOOL KuaiLe',cursive,sans-serif;font-size:16px;color:var(--sb-primary);margin-bottom:14px;display:flex;align-items:center;gap:8px">
        <span>${icon}</span><span>${label}</span>
        <span style="flex:1;height:1px;background:linear-gradient(90deg,color-mix(in srgb, var(--sb-primary) 25%, transparent),transparent)"></span>
      </div>`;

    // 卡片容器样式
    const cardStyle = 'background:color-mix(in srgb, var(--sb-bg) 78%, transparent);border:1px solid color-mix(in srgb, var(--sb-primary) 25%, transparent);border-radius:16px;padding:16px;margin-bottom:14px;box-shadow:0 4px 16px color-mix(in srgb, black 6%, transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)';

    const numberSection = numberVars.length > 0 ? `
      <div style="${cardStyle}">
        ${sectionTitle('💕', '核心指数')}
        ${numberVars.map(renderNumberVar).join('\n')}
      </div>` : '';

    const outfitSection = outfitVars.length > 0 ? `
      <div style="${cardStyle}">
        ${sectionTitle('👗', '当前着装')}
        ${outfitVars.map(renderListItem).join('\n')}
      </div>` : '';

    const bodySection = bodyVars.length > 0 ? `
      <div style="${cardStyle}">
        ${sectionTitle('🫦', '身体状态')}
        ${bodyVars.map(renderListItem).join('\n')}
      </div>` : '';

    // 事件卡片 - 不判断实际值（因为无法在模板中判断），统一显示为待解锁状态
    const eventSection = eventVars.length > 0 ? `
      <div style="${cardStyle}">
        ${sectionTitle('✨', '事件')}
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${eventVars.map(v => {
            const name = v.path.split('.').pop() || v.path;
            const expr = formatVarExpr(v);
            return `<div style="flex:1;min-width:80px;aspect-ratio:9/14;border-radius:12px;overflow:hidden;position:relative;background:color-mix(in srgb, var(--sb-bg) 60%, transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:2px solid color-mix(in srgb, var(--sb-primary) 25%, transparent);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px">
              <div style="font-size:24px;margin-bottom:6px">🎭</div>
              <div style="font-size:11px;font-weight:600;color:var(--sb-primary);text-align:center">${name}</div>
              <div style="font-size:10px;color:var(--sb-muted);margin-top:4px">${expr}</div>
            </div>`;
          }).join('\n')}
        </div>
      </div>` : '';

    const otherSection = otherStringVars.length > 0 ? `
      <div style="${cardStyle}">
        ${sectionTitle('📜', '详细信息')}
        ${otherStringVars.map(renderOtherString).join('\n')}
      </div>` : '';

    // 图片URL占位符 - 用户可替换
    const BG_IMAGE = 'https://placehold.co/800x400/ffb6c1/fff?background';
    const TACHIE_IMAGE = 'https://placehold.co/300x500/transparent/fff?text=立绘';
    const AVATAR_IMAGE = 'https://placehold.co/80x80/e87a90/fff?text=头像';

    // 全部使用内联样式，不使用<style>标签
    return `<div style="width:100%;max-width:none;box-sizing:border-box;margin:8px 0;position:relative;border-radius:20px;overflow:hidden;box-shadow:0 15px 35px color-mix(in srgb, black 15%, transparent);font-family:'ZCOOL KuaiLe',cursive,-apple-system,BlinkMacSystemFont,sans-serif">
      <div style="position:absolute;top:0;left:0;width:100%;height:100%;background-image:url('${BG_IMAGE}');background-size:cover;background-position:center top;z-index:0"></div>
      <div style="position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(180deg,color-mix(in srgb, var(--sb-bg) 15%, transparent) 0%,color-mix(in srgb, var(--sb-bg) 35%, transparent) 35%,color-mix(in srgb, var(--sb-bg) 60%, transparent) 100%);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);z-index:1"></div>
      <div style="position:relative;z-index:2;padding:20px">
        <div style="background:color-mix(in srgb, var(--sb-bg) 70%, transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);padding:14px 20px;border-radius:16px;border:1px solid color-mix(in srgb, var(--sb-primary) 25%, transparent);box-shadow:0 4px 15px color-mix(in srgb, black 5%, transparent);margin-bottom:16px;display:flex;align-items:center;gap:14px">
          <div style="width:56px;height:56px;border-radius:12px;overflow:hidden;border:2px solid var(--sb-primary);box-shadow:0 4px 10px color-mix(in srgb, black 10%, transparent);flex-shrink:0">
            <img src="${AVATAR_IMAGE}" alt="avatar" style="width:100%;height:100%;object-fit:cover;display:block">
          </div>
          <div style="flex:1">
            <div style="font-size:20px;color:var(--sb-primary);text-shadow:0 2px 4px color-mix(in srgb, var(--sb-bg) 80%, transparent);letter-spacing:2px">${title}</div>
            <div style="font-size:11px;color:var(--sb-muted);margin-top:4px">Visual Novel Status Bar</div>
          </div>
        </div>
        <div style="position:relative;width:100%;min-height:180px;margin-bottom:16px;display:flex;justify-content:flex-end">
          <img src="${TACHIE_IMAGE}" alt="tachie" style="position:absolute;bottom:0;left:5%;width:45%;max-height:250px;object-fit:contain;object-position:bottom center;filter:drop-shadow(3px 5px 10px color-mix(in srgb, black 20%, transparent));z-index:3">
          <div style="width:50%;margin-left:auto">
            ${numberSection}
          </div>
        </div>
        ${outfitSection}
        ${bodySection}
        ${eventSection}
        ${otherSection}
      </div>
    </div>`;
  },
};

// ── Template registry ───────────────────────────────────────────────────────

export const STATUS_BAR_TEMPLATES: StatusBarTemplate[] = [
  compactPanel,
  minimalDark,
  glassLight,
  gameHud,
  animeCard,
  terminal,
  ancientScroll,
  visualNovel,
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
  return wrapStatusBarHtml(template.generate(sections, title));
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
  let templateId = 'compact-panel';
  if (/赛博|终端|cyber|terminal|霓虹/.test(styleHint)) templateId = 'terminal';
  else if (/粉|二次元|少女|anime|sakura|樱花/.test(styleHint)) templateId = 'anime-card';
  else if (/rpg|游戏|hud|game/.test(styleHint)) templateId = 'game-hud';
  else if (/浅|亮|light|玻璃|glass|白色/.test(styleHint)) templateId = 'glass-light';
  else if (/古风|卷轴|scroll|水墨/.test(styleHint)) templateId = 'ancient-scroll';
  else if (/梦幻|毛玻璃|dreamy|恋爱|校园|柔和/.test(styleHint)) templateId = 'visual-novel';
  else if (/视觉|图片|立绘|visual|vn|剧情|精细/.test(styleHint)) templateId = 'visual-novel';
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
    html: wrapStatusBarHtml(generateStatusBarHtml(templateId, usedSections, title)),
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
2. 数字类型推荐使用 <meter>，不要用 CSS calc() 计算宽度：
   - 正确: <meter min="0" max="100" value="{{getvar::stat_data.角色.好感度}}"></meter>
   - 正确: <meter min="-100" max="100" optimum="0" value="{{getvar::stat_data.角色.情感天平}}"></meter>
   - range 不是 0~100（例如 1~99、-100~100）时尤其必须使用 min/max/value
   - 错误: style="width:{{getvar::stat_data.角色.好感度}}%"
   - 错误: style="width:max(0%, calc({{getvar::stat_data.角色.情感天平}} * 1%))"
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
- 如果用户要求古风/卷轴/水墨风格，情感、好感、心境、信任、倾向、天平等变量应优先做成“心绪/阴阳/亲疏”双向刻度，而不是普通现代进度条
- 顶部有标题栏，带装饰性下边框
- 配色与用户指定的风格一致
- 布局紧凑但信息清晰

## 输出格式

直接输出 HTML 代码，不要包裹在代码块中，不要添加任何解释文字。`,
    user: `卡片名称：${cardName}

## 可用变量列表
${varList || '（无变量）'}

## 风格要求
${styleHint || '基于紧凑信息面板，通用、克制、清晰、兼容移动端'}

请生成状态栏 HTML：`,
  };
}

/**
 * Build the AI prompt for modifying an existing status bar.
 * The AI receives the current HTML and user's natural-language instruction.
 */
export function buildStatusBarModifyAIPrompt(
  sections: MvuSchemaSection[],
  cardName: string,
  currentHtml: string,
  instruction: string,
): { system: string; user: string } {
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
    system: `你是一个 SillyTavern 状态栏 HTML 修改器。用户会提供一段已有的状态栏 HTML 和一段自然语言修改指令，请基于原 HTML 进行修改，而不是重新生成。

## 严格约束（违反将导致状态栏无法显示变量）

1. 必须保留所有现有的 {{getvar::stat_data.路径}} 宏，路径必须与用户提供的一致，不要修改路径。
2. 可以新增布局、样式、图标、颜色，但不能删除已有变量展示。
3. 古风/卷轴/水墨风格下，情感、好感、心境、信任、倾向、天平等变量应优先使用“心绪/阴阳/亲疏”双向刻度。
4. 数字类型推荐使用 <meter min="..." max="..." value="{{getvar::stat_data.路径}}">，不要用 CSS calc() 计算宽度。
   - 负数区间（如 -100~100）使用 <meter min="-100" max="100" optimum="0" value="{{getvar::stat_data.角色.情感天平}}">
   - 非 0 起点区间使用真实 min/max，例如 <meter min="1" max="99" value="{{getvar::stat_data.主角.等级}}">
   - 错误: style="width:{{getvar::stat_data.角色.情感天平}}%"
   - 错误: style="width:max(0%, calc({{getvar::stat_data.角色.情感天平}} * 1%))"
5. 只能使用内联样式（style 属性），不要用 <style> 标签或外部 CSS。
6. 必须是自包含的 HTML，不要引用外部资源。
7. 不要使用 <script> 标签。
8. 根容器必须使用 width:100%，不要固定像素宽度。
9. 使用 box-sizing:border-box。
10. 每个变量卡片必须用 display:block;width:100% 单列全宽布局；禁止多列。
11. 避免使用 <details>/<summary> 标签。

## 输出格式

直接输出修改后的 HTML 代码，不要包裹在代码块中，不要添加任何解释文字。`,
    user: `卡片名称：${cardName}

## 可用变量列表
${varList || '（无变量）'}

## 当前状态栏 HTML
${currentHtml || '（空）'}

## 修改要求
${instruction || '保持原样，仅优化视觉效果'}

请直接输出修改后的 HTML：`,
  };
}
