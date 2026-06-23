/**
 * StepMvuVariables - MVU (Model-View-Update) variable system editor.
 *
 * Dual mode:
 *   - 大神模式 (expert): Full manual schema/update-rules/EJS editor
 *   - 小白模式 (beginner): Preset templates + AI generation + status bar preview
 *
 * Auto-sync: 当 schemaSections / updateRules / ejsConfigs 发生变化时，
 *   自动重新生成 schemaTsContent / initvarYamlContent / updateRulesYamlContent / ejsPreprocessContent，
 *   不再需要手动点"重新生成"按钮，避免导出时 MVU 块被静默跳过。
 */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Button } from '../shared/Button';
import { TextInput } from '../shared/TextInput';
import { TextArea } from '../shared/TextArea';
import { useTranslation } from '../../i18n/I18nContext';
import { useAIGenerate } from '../../hooks/useAIGenerate';
import { MVU_BEGINNER_GENERATE_PROMPT } from '../../constants/prompts';
import {
  buildSchemaTs,
  buildInitvarYaml,
  buildUpdateRulesYaml,
  buildEjsPreprocess,
  buildZodTxt,
  parseRangeString,
  extractEnumValues,
} from '../../services/mvu-builder';
import {
  STATUS_BAR_TEMPLATES,
  generateStatusBarHtml,
  buildStatusBarAIPrompt,
  generateStatusBarFromAiConfig,
} from '../../services/status-bar-templates';
import type {
  MvuConfig,
  MvuSchemaSection,
  MvuVariable,
  MvuUpdateRule,
  MvuPrefix,
  EjsEntryConfig,
  LorebookEntry,
} from '../../constants/defaults';

// ── Zod type presets ────────────────────────────────────────────────────────

const ZOD_TYPE_PRESETS = [
  { value: 'z.string()', label: '字符串 (z.string)' },
  { value: 'z.coerce.number()', label: '数字 (z.coerce.number)' },
  { value: 'z.enum(["值1", "值2", "值3"])', label: '枚举 (z.enum)' },
  { value: 'z.object({})', label: '对象 (z.object)' },
  { value: 'z.record(z.string(), z.string())', label: '动态键值 (z.record)' },
];

const PREFIX_OPTIONS: { value: MvuPrefix; label: string; desc: string }[] = [
  { value: '', label: '无前缀', desc: 'AI 可见 + 可更新' },
  { value: '_', label: '_ 前缀', desc: 'AI 可见 + 只读' },
  { value: '$', label: '$ 前缀', desc: 'AI 不可见 + 只读' },
];

const EJS_COMPLEXITY_OPTIONS = [
  { value: '显隐' as const, label: '显隐 (@@if)', desc: '条目级条件显隐' },
  { value: '段落控制' as const, label: '段落控制 (if/else)', desc: '条目内条件分支' },
  { value: '动态文本' as const, label: '动态文本 (<%= %>)', desc: '动态文本替换' },
];

// ── Beginner mode preset templates ──────────────────────────────────────────

interface BeginnerTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  sections: MvuSchemaSection[];
  updateRules: MvuUpdateRule[];
  statusBarTitle: string;
  statusBarVars: string[];
}

const BEGINNER_TEMPLATES: BeginnerTemplate[] = [
  {
    id: 'romance',
    name: '恋爱养成',
    icon: '💕',
    description: '好感度、关系阶段、情绪状态',
    sections: [
      {
        name: '角色',
        variables: [
          { path: '角色.好感度', zodType: 'z.coerce.number()', description: '对主角的好感度', prefix: '', initialValue: 30, range: { min: 0, max: 100 } },
          { path: '角色.情绪', zodType: 'z.enum(["开心", "平静", "害羞", "生气", "悲伤"])', description: '当前情绪状态', prefix: '', initialValue: '平静', enumValues: ['开心', '平静', '害羞', '生气', '悲伤'] },
        ],
      },
      {
        name: '关系',
        variables: [
          { path: '关系.阶段', zodType: 'z.enum(["陌生人", "认识", "朋友", "暧昧", "恋人", "伴侣"])', description: '与主角的关系阶段', prefix: '', initialValue: '陌生人', enumValues: ['陌生人', '认识', '朋友', '暧昧', '恋人', '伴侣'] },
        ],
      },
    ],
    updateRules: [
      { path: '角色.好感度', type: 'number', range: '0~100', check: ['根据互动调整 ±(3~8)，正面互动增加，负面减少', '特殊事件（送礼、告白等）可调整 ±(10~20)'] },
      { path: '角色.情绪', check: ['根据当前场景和对话内容更新'] },
      { path: '关系.阶段', check: ['好感度达到阈值时推进：60→朋友，75→暧昧，90→恋人，95→伴侣'] },
    ],
    statusBarTitle: '💕 关系状态',
    statusBarVars: ['角色.好感度', '角色.情绪', '关系.阶段'],
  },
  {
    id: 'rpg',
    name: 'RPG冒险',
    icon: '⚔️',
    description: '属性面板、装备、任务进度',
    sections: [
      {
        name: '主角',
        variables: [
          { path: '主角.HP', zodType: 'z.coerce.number()', description: '当前生命值', prefix: '', initialValue: 100, range: { min: 0, max: 100 } },
          { path: '主角.MP', zodType: 'z.coerce.number()', description: '当前魔力值', prefix: '', initialValue: 100, range: { min: 0, max: 100 } },
          { path: '主角.等级', zodType: 'z.coerce.number()', description: '冒险者等级', prefix: '', initialValue: 1, range: { min: 1, max: 99 } },
        ],
      },
      {
        name: '世界',
        variables: [
          { path: '世界.当前区域', zodType: 'z.string()', description: '当前所在区域', prefix: '', initialValue: '起始城镇' },
          { path: '世界.时间', zodType: 'z.enum(["清晨", "上午", "下午", "黄昏", "夜晚", "深夜"])', description: '当前时间', prefix: '', initialValue: '上午', enumValues: ['清晨', '上午', '下午', '黄昏', '夜晚', '深夜'] },
        ],
      },
    ],
    updateRules: [
      { path: '主角.HP', type: 'number', range: '0~100', check: ['战斗受伤减少，休息或治疗回复', '单次变化不超过 ±30'] },
      { path: '主角.MP', type: 'number', range: '0~100', check: ['使用技能消耗，休息回复', '单次变化不超过 ±25'] },
      { path: '主角.等级', type: 'number', range: '1~99', check: ['完成重大任务或击败强敌后升级'] },
      { path: '世界.当前区域', check: ['根据角色移动更新'] },
      { path: '世界.时间', check: ['根据事件推进和休息更新'] },
    ],
    statusBarTitle: '⚔️ 冒险状态',
    statusBarVars: ['主角.HP', '主角.MP', '主角.等级', '世界.当前区域'],
  },
  {
    id: 'school',
    name: '校园日常',
    icon: '📚',
    description: '好感度、社团、成绩',
    sections: [
      {
        name: '角色',
        variables: [
          { path: '角色.好感度', zodType: 'z.coerce.number()', description: '对主角的好感度', prefix: '', initialValue: 50, range: { min: 0, max: 100 } },
          { path: '角色.社团', zodType: 'z.string()', description: '所属社团', prefix: '', initialValue: '无' },
        ],
      },
      {
        name: '学校',
        variables: [
          { path: '学校.当前地点', zodType: 'z.enum(["教室", "操场", "食堂", "图书馆", "社团活动室", "校门口", "天台"])', description: '当前学校地点', prefix: '', initialValue: '教室', enumValues: ['教室', '操场', '食堂', '图书馆', '社团活动室', '校门口', '天台'] },
          { path: '学校.时间段', zodType: 'z.enum(["早自习", "上课", "午休", "下午课", "放学后", "傍晚"])', description: '当前时间段', prefix: '', initialValue: '上课', enumValues: ['早自习', '上课', '午休', '下午课', '放学后', '傍晚'] },
        ],
      },
    ],
    updateRules: [
      { path: '角色.好感度', type: 'number', range: '0~100', check: ['根据互动调整 ±(3~6)', '一起参加社团活动增加较多'] },
      { path: '角色.社团', check: ['角色加入社团时更新'] },
      { path: '学校.当前地点', check: ['根据活动场景更新'] },
      { path: '学校.时间段', check: ['根据事件推进自然流转'] },
    ],
    statusBarTitle: '📚 校园日常',
    statusBarVars: ['角色.好感度', '学校.当前地点', '学校.时间段'],
  },
  {
    id: 'fantasy',
    name: '奇幻冒险',
    icon: '🐉',
    description: '属性、装备、声望、阵营',
    sections: [
      {
        name: '主角',
        variables: [
          { path: '主角.HP', zodType: 'z.coerce.number()', description: '当前生命值', prefix: '', initialValue: 100, range: { min: 0, max: 100 } },
          { path: '主角.MP', zodType: 'z.coerce.number()', description: '当前魔力值', prefix: '', initialValue: 100, range: { min: 0, max: 100 } },
          { path: '主角.等级', zodType: 'z.coerce.number()', description: '冒险者等级', prefix: '', initialValue: 1, range: { min: 1, max: 99 } },
          { path: '主角.金币', zodType: 'z.coerce.number()', description: '持有金币', prefix: '', initialValue: 100, range: { min: 0, max: 99999 } },
        ],
      },
      {
        name: '世界',
        variables: [
          { path: '世界.当前区域', zodType: 'z.string()', description: '当前所在区域', prefix: '', initialValue: '新手村' },
          { path: '世界.时间', zodType: 'z.enum(["清晨", "上午", "下午", "黄昏", "夜晚", "深夜"])', description: '当前时间', prefix: '', initialValue: '上午', enumValues: ['清晨', '上午', '下午', '黄昏', '夜晚', '深夜'] },
          { path: '世界.声望', zodType: 'z.coerce.number()', description: '在当前区域的声望', prefix: '', initialValue: 0, range: { min: -100, max: 100 } },
        ],
      },
    ],
    updateRules: [
      { path: '主角.HP', type: 'number', range: '0~100', check: ['战斗受伤减少，休息或治疗回复', '单次变化不超过 ±30'] },
      { path: '主角.MP', type: 'number', range: '0~100', check: ['使用技能消耗，休息回复', '单次变化不超过 ±25'] },
      { path: '主角.等级', type: 'number', range: '1~99', check: ['完成重大任务或击败强敌后升级'] },
      { path: '主角.金币', type: 'number', range: '0~99999', check: ['购买物品减少，出售物品/任务奖励增加'] },
      { path: '世界.当前区域', check: ['根据角色移动更新'] },
      { path: '世界.声望', type: 'number', range: '-100~100', check: ['完成任务或帮助他人增加', '掠夺/攻击无辜减少'] },
    ],
    statusBarTitle: '🐉 冒险状态',
    statusBarVars: ['主角.HP', '主角.MP', '主角.等级', '主角.金币', '世界.当前区域'],
  },
  {
    id: 'urban',
    name: '现代都市',
    icon: '🏙️',
    description: '好感度、亲密度、社交圈',
    sections: [
      {
        name: '角色',
        variables: [
          { path: '角色.好感度', zodType: 'z.coerce.number()', description: '对主角的好感度', prefix: '', initialValue: 40, range: { min: 0, max: 100 } },
          { path: '角色.亲密度', zodType: 'z.coerce.number()', description: '两人之间的亲密度', prefix: '', initialValue: 20, range: { min: 0, max: 100 } },
          { path: '角色.心情', zodType: 'z.enum(["开心", "平静", "烦躁", "难过", "尴尬"])', description: '当前心情', prefix: '', initialValue: '平静', enumValues: ['开心', '平静', '烦躁', '难过', '尴尬'] },
        ],
      },
      {
        name: '关系',
        variables: [
          { path: '关系.阶段', zodType: 'z.enum(["陌生人", "认识", "朋友", "暧昧", "恋人", "伴侣"])', description: '关系阶段', prefix: '', initialValue: '认识', enumValues: ['陌生人', '认识', '朋友', '暧昧', '恋人', '伴侣'] },
          { path: '关系.社交圈', zodType: 'z.enum(["无交集", "同校", "同公司", "朋友的朋友", "青梅竹马"])', description: '两人社交圈交集', prefix: '', initialValue: '同校', enumValues: ['无交集', '同校', '同公司', '朋友的朋友', '青梅竹马'] },
        ],
      },
    ],
    updateRules: [
      { path: '角色.好感度', type: 'number', range: '0~100', check: ['日常互动 ±(2~5)，特殊事件 ±(8~15)'] },
      { path: '角色.亲密度', type: 'number', range: '0~100', check: ['只有正面互动时增加', '冷战或伤害会大幅降低'] },
      { path: '角色.心情', check: ['根据当前场景和对话内容更新'] },
      { path: '关系.阶段', check: ['好感度≥30→朋友，≥60→暧昧，≥85→恋人，≥95→伴侣'] },
    ],
    statusBarTitle: '🏙️ 都市关系',
    statusBarVars: ['角色.好感度', '角色.亲密度', '角色.心情', '关系.阶段'],
  },
  {
    id: 'apocalypse',
    name: '末日生存',
    icon: '☢️',
    description: '生存资源、威胁等级、队伍状态',
    sections: [
      {
        name: '主角',
        variables: [
          { path: '主角.HP', zodType: 'z.coerce.number()', description: '生命值', prefix: '', initialValue: 100, range: { min: 0, max: 100 } },
          { path: '主角.体力', zodType: 'z.coerce.number()', description: '体力值', prefix: '', initialValue: 80, range: { min: 0, max: 100 } },
          { path: '主角.精神', zodType: 'z.coerce.number()', description: '精神状态', prefix: '', initialValue: 70, range: { min: 0, max: 100 } },
        ],
      },
      {
        name: '资源',
        variables: [
          { path: '资源.食物', zodType: 'z.coerce.number()', description: '食物储备 (天)', prefix: '', initialValue: 5, range: { min: 0, max: 30 } },
          { path: '资源.水源', zodType: 'z.coerce.number()', description: '饮水储备 (天)', prefix: '', initialValue: 3, range: { min: 0, max: 20 } },
          { path: '资源.弹药', zodType: 'z.coerce.number()', description: '弹药储备', prefix: '', initialValue: 30, range: { min: 0, max: 999 } },
          { path: '资源.威胁等级', zodType: 'z.enum(["安全", "警戒", "危险", "极度危险", "绝境"])', description: '当前威胁等级', prefix: '', initialValue: '警戒', enumValues: ['安全', '警戒', '危险', '极度危险', '绝境'] },
        ],
      },
    ],
    updateRules: [
      { path: '主角.HP', type: 'number', range: '0~100', check: ['受伤减少，休息/治疗恢复'] },
      { path: '主角.体力', type: 'number', range: '0~100', check: ['行动消耗，休息恢复'] },
      { path: '主角.精神', type: 'number', range: '0~100', check: ['遭遇恐怖/损失降低，安全休息恢复'] },
      { path: '资源.食物', type: 'number', range: '0~30', check: ['每天消耗 1 单位，搜刮可能获得'] },
      { path: '资源.水源', type: 'number', range: '0~20', check: ['每天消耗 1 单位'] },
      { path: '资源.弹药', type: 'number', range: '0~999', check: ['战斗消耗，搜刮获得'] },
      { path: '资源.威胁等级', check: ['根据周围环境动态调整'] },
    ],
    statusBarTitle: '☢️ 末日生存',
    statusBarVars: ['主角.HP', '主角.体力', '资源.食物', '资源.威胁等级'],
  },
  {
    id: 'cultivation',
    name: '修真仙侠',
    icon: '⚔️',
    description: '修为境界、灵力、丹药',
    sections: [
      {
        name: '修士',
        variables: [
          { path: '修士.修为', zodType: 'z.coerce.number()', description: '修为值', prefix: '', initialValue: 0, range: { min: 0, max: 10000 } },
          { path: '修士.境界', zodType: 'z.enum(["炼气", "筑基", "金丹", "元婴", "化神", "渡劫", "大乘"])', description: '当前境界', prefix: '', initialValue: '炼气', enumValues: ['炼气', '筑基', '金丹', '元婴', '化神', '渡劫', '大乘'] },
          { path: '修士.灵力', zodType: 'z.coerce.number()', description: '当前灵力', prefix: '', initialValue: 100, range: { min: 0, max: 100 } },
          { path: '修士.心魔', zodType: 'z.coerce.number()', description: '心魔值', prefix: '', initialValue: 0, range: { min: 0, max: 100 } },
        ],
      },
      {
        name: '资源',
        variables: [
          { path: '资源.丹药', zodType: 'z.coerce.number()', description: '持有丹药数', prefix: '', initialValue: 2, range: { min: 0, max: 99 } },
          { path: '资源.灵石', zodType: 'z.coerce.number()', description: '持有灵石数', prefix: '', initialValue: 50, range: { min: 0, max: 99999 } },
        ],
      },
    ],
    updateRules: [
      { path: '修士.修为', type: 'number', range: '0~10000', check: ['修炼/突破增加，突破境界需要修为阈值'] },
      { path: '修士.境界', check: ['修为达到阈值时自动晋升'] },
      { path: '修士.灵力', type: 'number', range: '0~100', check: ['施展法术消耗，打坐/丹药恢复'] },
      { path: '修士.心魔', type: 'number', range: '0~100', check: ['杀孽/负面行为增加，悟道/渡劫降低'] },
      { path: '资源.丹药', type: 'number', range: '0~99', check: ['使用丹药减少，炼丹/交易获得'] },
      { path: '资源.灵石', type: 'number', range: '0~99999', check: ['交易消耗，任务/副本获得'] },
    ],
    statusBarTitle: '⚔️ 修真境界',
    statusBarVars: ['修士.境界', '修士.修为', '修士.灵力', '资源.灵石'],
  },
  {
    id: 'custom',
    name: '自定义',
    icon: '✨',
    description: '从空白开始，用 AI 描述生成',
    sections: [],
    updateRules: [],
    statusBarTitle: '状态栏',
    statusBarVars: [],
  },
];

// ── Variable presets library (for beginner quick-add) ──────────────────────

interface VariablePreset {
  path: string;
  zodType: string;
  description: string;
  prefix: MvuPrefix;
  initialValue: unknown;
  range?: { min: number; max: number };
  enumValues?: string[];
}

/** 用于在小白模式下快速添加常用变量的预设库 */
const VARIABLE_PRESETS: { category: string; items: VariablePreset[] }[] = [
  {
    category: '🎭 角色',
    items: [
      { path: '角色.好感度', zodType: 'z.coerce.number()', description: '对主角的好感度', prefix: '', initialValue: 50, range: { min: 0, max: 100 } },
      { path: '角色.情绪', zodType: 'z.enum(["开心", "平静", "害羞", "生气", "悲伤"])', description: '当前情绪状态', prefix: '', initialValue: '平静', enumValues: ['开心', '平静', '害羞', '生气', '悲伤'] },
      { path: '角色.亲密度', zodType: 'z.coerce.number()', description: '两人之间的亲密度', prefix: '', initialValue: 30, range: { min: 0, max: 100 } },
      { path: '角色.信任度', zodType: 'z.coerce.number()', description: '对主角的信任程度', prefix: '', initialValue: 40, range: { min: 0, max: 100 } },
      { path: '角色.心情', zodType: 'z.enum(["开心", "平静", "烦躁", "难过", "尴尬"])', description: '当前心情', prefix: '', initialValue: '平静', enumValues: ['开心', '平静', '烦躁', '难过', '尴尬'] },
    ],
  },
  {
    category: '🌍 场景',
    items: [
      { path: '场景.当前地点', zodType: 'z.string()', description: '当前所在地点', prefix: '', initialValue: '未知' },
      { path: '场景.时间', zodType: 'z.enum(["清晨", "上午", "下午", "黄昏", "夜晚", "深夜"])', description: '当前时间', prefix: '', initialValue: '上午', enumValues: ['清晨', '上午', '下午', '黄昏', '夜晚', '深夜'] },
      { path: '场景.天气', zodType: 'z.enum(["晴天", "多云", "小雨", "暴雨", "下雪", "大风"])', description: '当前天气', prefix: '', initialValue: '晴天', enumValues: ['晴天', '多云', '小雨', '暴雨', '下雪', '大风'] },
      { path: '场景.季节', zodType: 'z.enum(["春", "夏", "秋", "冬"])', description: '当前季节', prefix: '', initialValue: '春', enumValues: ['春', '夏', '秋', '冬'] },
    ],
  },
  {
    category: '🔗 关系',
    items: [
      { path: '关系.阶段', zodType: 'z.enum(["陌生人", "认识", "朋友", "暧昧", "恋人", "伴侣"])', description: '与主角的关系阶段', prefix: '', initialValue: '陌生人', enumValues: ['陌生人', '认识', '朋友', '暧昧', '恋人', '伴侣'] },
      { path: '关系.阵营', zodType: 'z.enum(["友方", "中立", "敌对"])', description: '当前阵营关系', prefix: '', initialValue: '中立', enumValues: ['友方', '中立', '敌对'] },
    ],
  },
  {
    category: '⚔️ RPG',
    items: [
      { path: '主角.HP', zodType: 'z.coerce.number()', description: '当前生命值', prefix: '', initialValue: 100, range: { min: 0, max: 100 } },
      { path: '主角.MP', zodType: 'z.coerce.number()', description: '当前魔力值', prefix: '', initialValue: 100, range: { min: 0, max: 100 } },
      { path: '主角.等级', zodType: 'z.coerce.number()', description: '冒险者等级', prefix: '', initialValue: 1, range: { min: 1, max: 99 } },
      { path: '主角.金币', zodType: 'z.coerce.number()', description: '持有金币', prefix: '', initialValue: 100, range: { min: 0, max: 99999 } },
      { path: '主角.经验值', zodType: 'z.coerce.number()', description: '当前经验值', prefix: '', initialValue: 0, range: { min: 0, max: 1000 } },
    ],
  },
];

/** 各类型变量的 check 规则预设，用于新增 update rule 时自动填充 */
const CHECK_RULE_PRESETS: { type: string; label: string; check: string[] }[] = [
  { type: 'number', label: '好感度类', check: ['正面互动增加，负面互动减少，单次变化 ±(3~8)'] },
  { type: 'number', label: 'HP/资源类', check: ['消耗减少，休息/治疗恢复，变化不超过当前值 30%'] },
  { type: 'number', label: '等级/经验值', check: ['完成重大事件后提升'] },
  { type: 'number', label: '声望类', check: ['正面行为增加，负面行为减少'] },
  { type: 'string', label: '场景切换', check: ['根据角色移动或场景推进更新'] },
  { type: 'string', label: '情绪/心情', check: ['根据当前场景和对话内容更新'] },
  { type: 'string', label: '关系阶段', check: ['根据互动频率和好感度阈值推进'] },
  { type: 'string', label: '时间流转', check: ['根据事件推进自然流转'] },
];

// ── Helper functions ────────────────────────────────────────────────────────

function createEmptyVariable(): MvuVariable {
  return { path: '', zodType: 'z.string()', description: '', prefix: '', initialValue: '' };
}

function createEmptyUpdateRule(): MvuUpdateRule {
  return { path: '', type: '', range: '', check: [] };
}

function createEmptyEjsConfig(): EjsEntryConfig {
  return { entryId: '', complexity: '显隐', condition: '', usedVariables: [] };
}

function applyTemplate(template: BeginnerTemplate): MvuConfig {
  const sections = JSON.parse(JSON.stringify(template.sections)) as MvuSchemaSection[];
  const updateRules = JSON.parse(JSON.stringify(template.updateRules)) as MvuUpdateRule[];
  // 立即生成 schema.ts / initvar.yaml / 更新规则.yaml / EJS 预处理
  // 否则 schemaTsContent 为空，导出时整个 MVU 块会被跳过
  return {
    enabled: true,
    mode: 'beginner',
    schemaSections: sections,
    updateRules: updateRules,
    ejsConfigs: [],
    ejsPreprocessContent: buildEjsPreprocess([], sections),
    schemaTsContent: buildSchemaTs(sections),
    initvarYamlContent: buildInitvarYaml(sections),
    updateRulesYamlContent: buildUpdateRulesYaml(updateRules),
    statusBarHtml: '',
    statusBarStyle: 'minimal-dark',
  };
}

// ── Component ───────────────────────────────────────────────────────────────

interface StepMvuVariablesProps {
  mvu: MvuConfig;
  lorebookEntries: LorebookEntry[];
  onChange: (mvu: MvuConfig) => void;
  /** Card name + character summaries for AI context */
  cardName?: string;
  characterDescriptions?: string;
}

export function StepMvuVariables({ mvu, lorebookEntries, onChange, cardName = '', characterDescriptions = '' }: StepMvuVariablesProps) {
  const { t } = useTranslation();
  const { generateText } = useAIGenerate();
  const [activeTab, setActiveTab] = useState<'schema' | 'updateRules' | 'ejs' | 'output'>('schema');
  const [selectedSection, setSelectedSection] = useState(0);
  const [expandedVars, setExpandedVars] = useState<Set<string>>(new Set());
  const [aiInput, setAiInput] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [statusBarStyle, setStatusBarStyle] = useState(mvu.statusBarStyle || 'minimal-dark');
  const [statusBarTitle, setStatusBarTitle] = useState('状态栏');
  const [aiBarGenerating, setAiBarGenerating] = useState(false);
  const [aiBarStyle, setAiBarStyle] = useState('');
  const [showBarCode, setShowBarCode] = useState(false);

  const fieldCls = 'w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-200';
  const labelCls = 'text-xs text-slate-400';

  // ── MVU enable toggle ─────────────────────────────────────────────────
  const toggleMvu = () => {
    onChange({ ...mvu, enabled: !mvu.enabled });
  };

  const toggleMode = () => {
    const newMode = mvu.mode === 'expert' ? 'beginner' : 'expert';
    onChange({ ...mvu, mode: newMode });
  };

  // ── Section management ─────────────────────────────────────────────────
  const addSection = () => {
    const newSection: MvuSchemaSection = {
      name: `新分区 ${mvu.schemaSections.length + 1}`,
      variables: [],
    };
    onChange({ ...mvu, schemaSections: [...mvu.schemaSections, newSection] });
    setSelectedSection(mvu.schemaSections.length);
  };

  const removeSection = (idx: number) => {
    onChange({ ...mvu, schemaSections: mvu.schemaSections.filter((_, i) => i !== idx) });
    if (selectedSection >= mvu.schemaSections.length - 1) {
      setSelectedSection(Math.max(0, mvu.schemaSections.length - 2));
    }
  };

  const updateSection = (idx: number, updates: Partial<MvuSchemaSection>) => {
    onChange({ ...mvu, schemaSections: mvu.schemaSections.map((s, i) => (i === idx ? { ...s, ...updates } : s)) });
  };

  // ── Variable management ────────────────────────────────────────────────
  const addVariable = (sectionIdx: number) => {
    const v = createEmptyVariable();
    const section = mvu.schemaSections[sectionIdx];
    v.path = `${section.name}.新变量`;
    updateSection(sectionIdx, { variables: [...section.variables, v] });
    setExpandedVars(prev => new Set([...prev, v.path]));
  };

  const removeVariable = (sectionIdx: number, varIdx: number) => {
    const section = mvu.schemaSections[sectionIdx];
    updateSection(sectionIdx, { variables: section.variables.filter((_, i) => i !== varIdx) });
  };

  const updateVariable = (sectionIdx: number, varIdx: number, updates: Partial<MvuVariable>) => {
    const section = mvu.schemaSections[sectionIdx];
    updateSection(sectionIdx, { variables: section.variables.map((v, i) => (i === varIdx ? { ...v, ...updates } : v)) });
  };

  const toggleExpanded = (path: string) => {
    setExpandedVars(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  // ── Update rule management ─────────────────────────────────────────────
  const addUpdateRule = () => { onChange({ ...mvu, updateRules: [...mvu.updateRules, createEmptyUpdateRule()] }); };
  const removeUpdateRule = (idx: number) => { onChange({ ...mvu, updateRules: mvu.updateRules.filter((_, i) => i !== idx) }); };
  const updateUpdateRule = (idx: number, updates: Partial<MvuUpdateRule>) => {
    onChange({ ...mvu, updateRules: mvu.updateRules.map((r, i) => (i === idx ? { ...r, ...updates } : r)) });
  };
  const addCheckRule = (idx: number) => {
    const rule = mvu.updateRules[idx];
    updateUpdateRule(idx, { check: [...(rule.check || []), ''] });
  };
  const updateCheckRule = (ruleIdx: number, checkIdx: number, value: string) => {
    const rule = mvu.updateRules[ruleIdx];
    const newCheck = [...(rule.check || [])]; newCheck[checkIdx] = value;
    updateUpdateRule(ruleIdx, { check: newCheck });
  };
  const removeCheckRule = (ruleIdx: number, checkIdx: number) => {
    const rule = mvu.updateRules[ruleIdx];
    updateUpdateRule(ruleIdx, { check: (rule.check || []).filter((_, i) => i !== checkIdx) });
  };

  // ── EJS config management ──────────────────────────────────────────────
  const addEjsConfig = () => { onChange({ ...mvu, ejsConfigs: [...mvu.ejsConfigs, createEmptyEjsConfig()] }); };
  const removeEjsConfig = (idx: number) => { onChange({ ...mvu, ejsConfigs: mvu.ejsConfigs.filter((_, i) => i !== idx) }); };
  const updateEjsConfig = (idx: number, updates: Partial<EjsEntryConfig>) => {
    onChange({ ...mvu, ejsConfigs: mvu.ejsConfigs.map((c, i) => (i === idx ? { ...c, ...updates } : c)) });
  };

  // ── Generate all outputs (manual trigger — kept as fallback) ────────────
  const generateAll = useCallback(() => {
    const schemaTs = buildSchemaTs(mvu.schemaSections);
    const initvarYaml = buildInitvarYaml(mvu.schemaSections);
    const updateRulesYaml = buildUpdateRulesYaml(mvu.updateRules);
    const ejsPreprocess = buildEjsPreprocess(mvu.ejsConfigs, mvu.schemaSections);
    onChange({ ...mvu, schemaTsContent: schemaTs, initvarYamlContent: initvarYaml, updateRulesYamlContent: updateRulesYaml, ejsPreprocessContent: ejsPreprocess });
  }, [mvu]);

  // ── Auto-sync: derived content re-generates when source data changes ─────
  // 消除"忘记点重新生成"导致导出时 MVU 块被跳过的坑。
  // 每当 schemaSections / updateRules / ejsConfigs 发生变化，自动重新生成
  // schemaTsContent / initvarYamlContent / updateRulesYamlContent / ejsPreprocessContent。
  const syncingRef = useRef(false);
  useEffect(() => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const schemaTs = buildSchemaTs(mvu.schemaSections);
    const initvarYaml = buildInitvarYaml(mvu.schemaSections);
    const updateRulesYaml = buildUpdateRulesYaml(mvu.updateRules);
    const ejsPreprocess = buildEjsPreprocess(mvu.ejsConfigs, mvu.schemaSections);
    // 仅在内容确实发生变化时才触发 onChange，避免循环渲染
    if (
      schemaTs !== mvu.schemaTsContent ||
      initvarYaml !== mvu.initvarYamlContent ||
      updateRulesYaml !== mvu.updateRulesYamlContent ||
      ejsPreprocess !== mvu.ejsPreprocessContent
    ) {
      onChange({ ...mvu, schemaTsContent: schemaTs, initvarYamlContent: initvarYaml, updateRulesYamlContent: updateRulesYaml, ejsPreprocessContent: ejsPreprocess });
    }
    syncingRef.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mvu.schemaSections, mvu.updateRules, mvu.ejsConfigs]);

  // ── Auto-sync status bar: non-AI-custom 模式下变量变化时自动重生成 ──────
  useEffect(() => {
    if (mvu.statusBarStyle && mvu.statusBarStyle !== 'ai-custom' && mvu.schemaSections.length > 0) {
      const html = generateStatusBarHtml(mvu.statusBarStyle, mvu.schemaSections, statusBarTitle);
      onChange({ ...mvu, statusBarHtml: html });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mvu.schemaSections, mvu.statusBarStyle]);

  // ── Beginner: apply template ───────────────────────────────────────────
  const handleApplyTemplate = (templateId: string) => {
    const template = BEGINNER_TEMPLATES.find(t => t.id === templateId);
    if (!template) return;
    const cfg = applyTemplate(template);
    onChange({ ...cfg, mode: 'beginner' });
    setSelectedTemplate(templateId);
  };

  // ── Beginner: AI generate ──────────────────────────────────────────────
  const handleAiGenerate = async () => {
    setAiGenerating(true);
    try {
      const prompt = MVU_BEGINNER_GENERATE_PROMPT(cardName, characterDescriptions, aiInput);
      const result = await generateText(prompt.system, prompt.user);
      // Try to parse AI response as JSON
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        const sections: MvuSchemaSection[] = (parsed.sections || [] as Record<string, unknown>[]).map((s: Record<string, unknown>) => ({
          name: String(s.name || ''),
          variables: ((s.variables || []) as Record<string, unknown>[]).map((v: Record<string, unknown>) => {
            const type = String(v.type || 'string');
            let zodType = 'z.string()';
            let enumValues: string[] | undefined;
            let range: { min: number; max: number } | undefined;
            let initialValue: unknown = v.initialValue ?? '';

            if (type === 'number') {
              zodType = 'z.coerce.number()';
              // 优先读取 AI 返回的 rangeMin/rangeMax，退化读取 range 字符串
              const rm = v.rangeMin != null && v.rangeMax != null
                ? { min: Number(v.rangeMin), max: Number(v.rangeMax) }
                : parseRangeString(v.range);
              range = rm || { min: 0, max: 100 };
              initialValue = Number(initialValue) || 0;
            } else if (type === 'enum') {
              const ev = Array.isArray(v.enumValues) ? v.enumValues.map(String) : [];
              enumValues = ev;
              zodType = ev.length > 0 ? `z.enum(${JSON.stringify(ev)})` : 'z.string()';
              // initialValue 必须是 enumValues 之一
              if (ev.length > 0 && !ev.includes(String(initialValue))) {
                initialValue = ev[0];
              }
            }
            return {
              path: String(v.path || ''),
              zodType,
              description: String(v.description || ''),
              prefix: '' as MvuPrefix,
              initialValue,
              range,
              enumValues,
            };
          }),
        }));

        const updateRules: MvuUpdateRule[] = (parsed.updateRules || []).map((r: Record<string, unknown>) => ({
          path: String(r.path || ''),
          type: String(r.type || ''),
          range: String(r.range || ''),
          check: (r.check as string[] || []),
        }));

        // 立即生成 schema.ts / initvar.yaml / 更新规则.yaml / EJS 预处理
        // 否则 schemaTsContent 为空，导出时整个 MVU 块会被跳过
        const schemaTs = buildSchemaTs(sections);
        const initvarYaml = buildInitvarYaml(sections);
        const updateRulesYaml = buildUpdateRulesYaml(updateRules);
        const ejsPreprocess = buildEjsPreprocess([], sections);

        // 应用 AI 返回的状态栏配置
        let newStatusBarHtml = mvu.statusBarHtml;
        let newStatusBarStyle = mvu.statusBarStyle;
        if (parsed.statusBar) {
          const sb = parsed.statusBar as Record<string, unknown>;
          const cfg = generateStatusBarFromAiConfig(sections, {
            title: String(sb.title || ''),
            showVariables: Array.isArray(sb.showVariables) ? sb.showVariables.map(String) : [],
            styleHint: String(sb.styleHint || ''),
          });
          newStatusBarHtml = cfg.html;
          newStatusBarStyle = cfg.templateId;
          setStatusBarTitle(cfg.title);
          setStatusBarStyle(cfg.templateId);
        }

        onChange({
          ...mvu,
          schemaSections: sections,
          updateRules: updateRules,
          ejsConfigs: [],
          ejsPreprocessContent: ejsPreprocess,
          schemaTsContent: schemaTs,
          initvarYamlContent: initvarYaml,
          updateRulesYamlContent: updateRulesYaml,
          statusBarHtml: newStatusBarHtml,
          statusBarStyle: newStatusBarStyle,
        });
        setSelectedTemplate('custom');
      }
    } catch {
      // AI generation failed, keep existing state
    } finally {
      setAiGenerating(false);
    }
  };

  // ── Beginner: quick add variable from presets ──────────────────────────
  const quickAddVar = (sectionIdx: number, preset: VariablePreset) => {
    const v: MvuVariable = {
      path: preset.path,
      zodType: preset.zodType,
      description: preset.description,
      prefix: preset.prefix,
      initialValue: preset.initialValue,
      range: preset.range,
      enumValues: preset.enumValues,
    };
    updateSection(sectionIdx, { variables: [...mvu.schemaSections[sectionIdx].variables, v] });
    setExpandedVars(prev => new Set([...prev, v.path]));
  };

  // ── Status bar: generate preview HTML ──────────────────────────────────
  // Use AI-generated HTML if present, otherwise use template
  const statusBarHtml = useMemo(() => {
    // If user has AI-generated or manually edited HTML, use it
    if (mvu.statusBarHtml) return mvu.statusBarHtml;

    // Otherwise generate from template
    if (mvu.schemaSections.length === 0 || !statusBarStyle) {
      return '<p style="color:#6b7280;font-size:12px;text-align:center;padding:20px">暂无变量，请先选择模板或生成变量</p>';
    }
    return generateStatusBarHtml(statusBarStyle, mvu.schemaSections, statusBarTitle);
  }, [mvu.statusBarHtml, mvu.schemaSections, statusBarStyle, statusBarTitle]);

  // ── Status bar: preview HTML (substitute getvar with initial values) ────
  const statusBarPreviewHtml = useMemo(() => {
    let html = statusBarHtml;
    // Replace getvar macros with initial values for preview
    const vars = mvu.schemaSections.flatMap(s => s.variables).filter(v => v.prefix !== '$');
    const varMap = new Map(vars.map(v => [v.path, String(v.initialValue ?? '')]));
    html = html.replace(/\{\{getvar::stat_data\.([^}]+)\}\}/g, (_match, path) => {
      return varMap.get(path) ?? '';
    });

    // Fix layout: force all block-level elements to width:100% except progress bar fills
    // (AI-generated HTML may have containers with fixed/narrow widths)
    try {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      tmp.querySelectorAll<HTMLElement>('[style]').forEach(el => {
        const s = el.style;
        // Skip progress bar fills: they have background + height:100% + small border-radius (3-5px)
        // Character cards typically have border-radius 8-14px, so threshold at 6px is safe
        const br = parseFloat(s.borderRadius) || 0;
        const isProgressBarFill =
          (s.background || s.backgroundColor || s.backgroundImage) &&
          s.height === '100%' &&
          br > 0 && br <= 6;
        if (isProgressBarFill) return;
        // Override width to 100% for layout elements
        if (s.width && s.width !== '100%') {
          s.width = '100%';
        }
        // Remove max-width constraints
        if (s.maxWidth) {
          s.maxWidth = 'none';
        }
      });
      html = tmp.innerHTML;
    } catch { /* ignore */ }

    return html;
  }, [statusBarHtml, mvu.schemaSections]);

  // ── Status bar: apply template ──────────────────────────────────────────
  const applyStatusBarTemplate = (templateId: string) => {
    setStatusBarStyle(templateId);
    const html = generateStatusBarHtml(templateId, mvu.schemaSections, statusBarTitle);
    onChange({ ...mvu, statusBarStyle: templateId, statusBarHtml: html });
  };

  // ── Status bar: AI generate ─────────────────────────────────────────────
  const handleAiGenerateStatusBar = async () => {
    if (mvu.schemaSections.length === 0) return;
    setAiBarGenerating(true);
    try {
      const prompt = buildStatusBarAIPrompt(mvu.schemaSections, cardName, aiBarStyle);
      const result = await generateText(prompt.system, prompt.user);
      // Clean: remove markdown code fences if present
      let cleaned = result.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:html)?\n?/, '').replace(/\n?```$/, '');
      }
      // 兼容：AI 可能误用 format_message_variable，自动转为正确的 getvar 宏
      cleaned = cleaned.replace(/\{\{format_message_variable::stat_data\.([^}]+)\}\}/g, '{{getvar::stat_data.$1}}');
      // Validate: must contain getvar macro
      if (!cleaned.includes('{{getvar::')) {
        // AI didn't use macros, reject
        return;
      }
      onChange({ ...mvu, statusBarHtml: cleaned, statusBarStyle: 'ai-custom' });
    } catch {
      // AI generation failed
    } finally {
      setAiBarGenerating(false);
    }
  };

  // ── Status bar: regenerate from template when variables change ──────────
  const regenerateStatusBar = () => {
    if (statusBarStyle && statusBarStyle !== 'ai-custom') {
      const html = generateStatusBarHtml(statusBarStyle, mvu.schemaSections, statusBarTitle);
      onChange({ ...mvu, statusBarHtml: html });
    }
  };

  // ── Render: disabled state ─────────────────────────────────────────────
  if (!mvu.enabled) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-white">MVU 变量系统</h2>
            <p className="text-sm text-slate-400 mt-1">基于 tavern-cards MVU 规范，为角色卡定义动态变量追踪系统</p>
          </div>
        </div>
        <div className="text-center py-16 border border-dashed border-slate-700 rounded-xl">
          <p className="text-slate-400 mb-4">MVU 变量系统用于追踪角色好感度、场景状态、装备等动态信息</p>
          <p className="text-sm text-slate-500 mb-6">启用后可在世界书条目中使用 EJS 条件渲染，开场白也可引用变量初始状态</p>
          <Button onClick={toggleMvu}>✨ 启用 MVU 变量系统</Button>
        </div>
      </div>
    );
  }

  // ── Render: expert mode ────────────────────────────────────────────────
  if (mvu.mode === 'expert') {
    return renderExpertMode();
  }

  // ── Render: beginner mode ──────────────────────────────────────────────
  return renderBeginnerMode();

  // ────────────────────────────────────────────────────────────────────────
  // Expert mode renderer
  // ────────────────────────────────────────────────────────────────────────
  function renderExpertMode() {
    const section = mvu.schemaSections[selectedSection];

    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-white">MVU 变量系统</h2>
            <p className="text-sm text-slate-400 mt-1">schema.ts · initvar.yaml · 更新规则 · EJS 配置</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={toggleMode} title="切换到小白模式">
              🔧 切换到小白模式
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleMvu}>禁用 MVU</Button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-4 border-b border-slate-700">
          {(['schema', 'updateRules', 'ejs', 'output'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
                activeTab === tab ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
              {{ schema: '📐 Schema', updateRules: '📋 更新规则', ejs: '⚡ EJS', output: '📤 输出' }[tab]}
            </button>
          ))}
        </div>

        {/* Schema Tab */}
        {activeTab === 'schema' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              {mvu.schemaSections.map((s, i) => (
                <button key={i} onClick={() => setSelectedSection(i)}
                  className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                    i === selectedSection ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-300' : 'border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                  {s.name}
                  {s.variables.length > 0 && <span className="ml-1 text-[10px] text-slate-500">({s.variables.length})</span>}
                </button>
              ))}
              <Button variant="ghost" size="sm" onClick={addSection}>+ 新分区</Button>
            </div>

            {section && (
              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <TextInput label="分区名称" value={section.name} onChange={(e) => updateSection(selectedSection, { name: e.target.value })} placeholder="例如：角色、世界、主角" />
                  {mvu.schemaSections.length > 1 && <Button variant="danger" size="sm" onClick={() => removeSection(selectedSection)}>删除分区</Button>}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-300">变量定义</span>
                    <Button variant="secondary" size="sm" onClick={() => addVariable(selectedSection)}>+ 添加变量</Button>
                  </div>
                  {section.variables.length === 0 && <p className="text-xs text-slate-500 py-4 text-center">暂无变量</p>}
                  {section.variables.map((v, vi) => (
                    <div key={vi} className="rounded-lg border border-slate-700/50 bg-slate-900/30 overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-800/50" onClick={() => toggleExpanded(v.path)}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs text-slate-500">{expandedVars.has(v.path) ? '▼' : '▶'}</span>
                          <span className="text-sm font-mono text-slate-200 truncate">{v.path || '(未命名变量)'}</span>
                          {v.prefix && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400">{v.prefix}前缀</span>}
                          <span className="text-[10px] text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded">{v.zodType.replace(/\(.*\)/, '(...)')}</span>
                        </div>
                        <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); removeVariable(selectedSection, vi); }}>×</Button>
                      </div>
                      {expandedVars.has(v.path) && (
                        <div className="px-3 pb-3 space-y-2 border-t border-slate-700/30 pt-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div><label className={labelCls}>变量路径</label><input value={v.path} onChange={(e) => updateVariable(selectedSection, vi, { path: e.target.value })} placeholder="角色.好感度" className={fieldCls} /></div>
                            <div><label className={labelCls}>Zod 类型</label><select value={v.zodType} onChange={(e) => updateVariable(selectedSection, vi, { zodType: e.target.value })} className={fieldCls}>{ZOD_TYPE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div><label className={labelCls}>可见性前缀</label><select value={v.prefix} onChange={(e) => updateVariable(selectedSection, vi, { prefix: e.target.value as MvuPrefix })} className={fieldCls}>{PREFIX_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label} — {p.desc}</option>)}</select></div>
                            <div><label className={labelCls}>初始值</label><input value={String(v.initialValue ?? '')} onChange={(e) => { let val: unknown = e.target.value; if (v.zodType === 'z.coerce.number()') val = Number(e.target.value) || 0; updateVariable(selectedSection, vi, { initialValue: val }); }} placeholder="0" className={fieldCls} /></div>
                          </div>
                          <div><label className={labelCls}>描述</label><input value={v.description} onChange={(e) => updateVariable(selectedSection, vi, { description: e.target.value })} placeholder="变量用途说明" className={fieldCls} /></div>
                          {v.zodType === 'z.coerce.number()' && (
                            <div className="grid grid-cols-2 gap-2">
                              <div><label className={labelCls}>最小值</label><input type="number" value={v.range?.min ?? 0} onChange={(e) => updateVariable(selectedSection, vi, { range: { min: Number(e.target.value), max: v.range?.max ?? 100 } })} className={fieldCls} /></div>
                              <div><label className={labelCls}>最大值</label><input type="number" value={v.range?.max ?? 100} onChange={(e) => updateVariable(selectedSection, vi, { range: { min: v.range?.min ?? 0, max: Number(e.target.value) } })} className={fieldCls} /></div>
                            </div>
                          )}
                          {v.zodType.startsWith('z.enum(') && (
                            <div><label className={labelCls}>枚举值 (逗号分隔)</label><input value={v.enumValues?.join(', ') ?? ''} onChange={(e) => { const values = e.target.value.split(',').map(s => s.trim()).filter(Boolean); updateVariable(selectedSection, vi, { enumValues: values }); }} placeholder="开心, 正常, 低落" className={fieldCls} /></div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Update Rules Tab */}
        {activeTab === 'updateRules' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">告诉 AI 如何更新变量。自明变量不需写规则。</p>
              <Button variant="secondary" size="sm" onClick={addUpdateRule}>+ 添加规则</Button>
            </div>

            {/* Auto-suggest: variables without rules */}
            {mvu.schemaSections.flatMap(s => s.variables).filter(v => v.prefix !== '$' && !mvu.updateRules.some(r => r.path === v.path)).length > 0 && (
              <div className="rounded-lg border border-amber-700/30 bg-amber-950/10 p-3">
                <p className="text-xs text-amber-400/80 mb-2">💡 以下变量尚无更新规则：</p>
                <div className="flex flex-wrap gap-1.5">
                  {mvu.schemaSections.flatMap(s => s.variables).filter(v => v.prefix !== '$' && !mvu.updateRules.some(r => r.path === v.path)).map(v => (
                    <button
                      key={v.path}
                      onClick={() => {
                        const isNumber = v.zodType === 'z.coerce.number()';
                        const preset = isNumber ? CHECK_RULE_PRESETS[0] : CHECK_RULE_PRESETS.find(p => p.type === 'string');
                        const newRule: MvuUpdateRule = {
                          path: v.path,
                          type: isNumber ? 'number' : 'string',
                          range: isNumber ? `${v.range?.min ?? 0}~${v.range?.max ?? 100}` : undefined,
                          check: preset ? [...preset.check] : [],
                        };
                        onChange({ ...mvu, updateRules: [...mvu.updateRules, newRule] });
                      }}
                      className="text-[11px] px-2 py-1 rounded border border-amber-600/40 text-amber-300 hover:bg-amber-900/20 transition-colors"
                    >
                      + {v.path}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mvu.updateRules.length === 0 && <p className="text-xs text-slate-500 py-8 text-center">暂无更新规则</p>}
            {mvu.updateRules.map((rule, ri) => (
              <div key={ri} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3">
                <div className="flex items-center justify-between"><span className="text-sm font-mono text-indigo-300">{rule.path || '(新规则)'}</span><Button variant="danger" size="sm" onClick={() => removeUpdateRule(ri)}>×</Button></div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>变量路径</label>
                    <select value={rule.path} onChange={(e) => {
                      const newPath = e.target.value;
                      // 自动推断类型
                      const matchedVar = mvu.schemaSections.flatMap(s => s.variables).find(v => v.path === newPath);
                      const inferredType = matchedVar?.zodType === 'z.coerce.number()' ? 'number' : 'string';
                      const inferredRange = matchedVar?.range ? `${matchedVar.range.min}~${matchedVar.range.max}` : rule.range;
                      updateUpdateRule(ri, { path: newPath, type: rule.type || inferredType, range: rule.range || inferredRange });
                    }} className={fieldCls}>
                      <option value="">-- 选择变量 --</option>
                      {mvu.schemaSections.map((s, si) => (
                        <optgroup key={si} label={s.name}>
                          {s.variables.filter(v => v.prefix !== '$').map(v => (
                            <option key={v.path} value={v.path}>{v.path} {v.prefix === '_' ? '(只读)' : ''}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div><label className={labelCls}>类型</label><input value={rule.type || ''} onChange={(e) => updateUpdateRule(ri, { type: e.target.value })} placeholder="number / string" className={fieldCls} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={labelCls}>范围</label><input value={rule.range || ''} onChange={(e) => updateUpdateRule(ri, { range: e.target.value })} placeholder="0~100" className={fieldCls} /></div>
                  <div><label className={labelCls}>格式</label><input value={rule.format || ''} onChange={(e) => updateUpdateRule(ri, { format: e.target.value })} placeholder="YYYY/MM/DD-HH:MM" className={fieldCls} /></div>
                </div>
                <div><label className={labelCls}>值描述</label><input value={rule.value || ''} onChange={(e) => updateUpdateRule(ri, { value: e.target.value })} placeholder="主角对变量内容的即时感受" className={fieldCls} /></div>
                <div>
                  <div className="flex items-center justify-between mb-1"><label className={labelCls}>更新条件 (check)</label>
                    <div className="flex items-center gap-1">
                      <select onChange={(e) => {
                        const preset = CHECK_RULE_PRESETS.find(p => p.label === e.target.value);
                        if (preset) {
                          const existing = rule.check || [];
                          updateUpdateRule(ri, { check: [...existing, ...preset.check] });
                        }
                        e.target.value = '';
                      }} className="text-[11px] rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-slate-300">
                        <option value="">预设规则...</option>
                        {CHECK_RULE_PRESETS.filter(p => rule.type ? p.type === rule.type : true).map(p => (
                          <option key={p.label} value={p.label}>{p.label}</option>
                        ))}
                      </select>
                      <Button variant="ghost" size="sm" onClick={() => addCheckRule(ri)}>+ 添加</Button>
                    </div>
                  </div>
                  {(rule.check || []).map((c, ci) => (
                    <div key={ci} className="flex items-center gap-1 mb-1"><input value={c} onChange={(e) => updateCheckRule(ri, ci, e.target.value)} placeholder="根据角色行为调整 ±(3~6)" className={fieldCls} /><Button variant="danger" size="sm" onClick={() => removeCheckRule(ri, ci)}>×</Button></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* EJS Tab */}
        {activeTab === 'ejs' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">配置世界书条目的 EJS 动态渲染。</p>
              <Button variant="secondary" size="sm" onClick={addEjsConfig}>+ 添加 EJS 配置</Button>
            </div>
            {mvu.ejsConfigs.length === 0 && <p className="text-xs text-slate-500 py-8 text-center">暂无 EJS 配置</p>}
            {mvu.ejsConfigs.map((cfg, ci) => (
              <div key={ci} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3">
                <div className="flex items-center justify-between"><span className="text-sm font-mono text-emerald-300">EJS 配置 #{ci + 1}</span><Button variant="danger" size="sm" onClick={() => removeEjsConfig(ci)}>×</Button></div>
                <div><label className={labelCls}>关联世界书条目</label><select value={cfg.entryId} onChange={(e) => updateEjsConfig(ci, { entryId: e.target.value })} className={fieldCls}><option value="">-- 选择条目 --</option>{lorebookEntries.map(e => <option key={e.id} value={e.id}>{e.name || e.comment || `条目 ${e.id}`}</option>)}</select></div>
                <div><label className={labelCls}>复杂度</label><select value={cfg.complexity} onChange={(e) => updateEjsConfig(ci, { complexity: e.target.value as EjsEntryConfig['complexity'] })} className={fieldCls}>{EJS_COMPLEXITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} — {o.desc}</option>)}</select></div>
                <div><label className={labelCls}>{cfg.complexity === '显隐' ? '@@if 条件表达式' : cfg.complexity === '段落控制' ? 'if/else 条件表达式' : 'EJS 模板代码'}</label><TextArea value={cfg.condition} onChange={(e) => updateEjsConfig(ci, { condition: e.target.value })} placeholder={cfg.complexity === '显隐' ? 'current_location?.includes("万剑山")' : cfg.complexity === '段落控制' ? 'affection >= 60' : '<%= variable %>'} rows={cfg.complexity === '动态文本' ? 4 : 2} /></div>
                {/* Used variables — multi-select checkboxes */}
                <div>
                  <label className={labelCls}>使用的变量</label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {mvu.schemaSections.flatMap(s => s.variables).filter(v => v.prefix !== '$').map(v => {
                      const varName = v.path.split('.').pop() || v.path;
                      const isChecked = cfg.usedVariables.includes(varName);
                      return (
                        <label key={varName} className={`text-[11px] px-2 py-1 rounded border cursor-pointer transition-colors select-none ${
                          isChecked
                            ? 'border-emerald-500/50 bg-emerald-900/30 text-emerald-300'
                            : 'border-slate-600/50 text-slate-400 hover:border-slate-500'
                        }`}>
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={isChecked}
                            onChange={() => {
                              const current = cfg.usedVariables;
                              const next = isChecked
                                ? current.filter(n => n !== varName)
                                : [...current, varName];
                              updateEjsConfig(ci, { usedVariables: next });
                            }}
                          />
                          {varName}
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">这些变量名将在 EJS 预处理中通过 define() 注册</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Output Tab */}
        {activeTab === 'output' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between"><p className="text-sm text-slate-400">预览生成的 MVU 文件内容（修改变量后自动同步更新）。</p><Button onClick={generateAll}>🔄 强制重新生成</Button></div>
            <details className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden"><summary className="px-4 py-2 cursor-pointer hover:bg-slate-700/30 text-sm font-medium text-indigo-300">📐 schema.ts</summary><pre className="px-4 pb-3 text-xs text-slate-300 whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto font-mono">{mvu.schemaTsContent || '(请先添加变量分区和变量)'}</pre></details>
            <details className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden"><summary className="px-4 py-2 cursor-pointer hover:bg-slate-700/30 text-sm font-medium text-amber-300">📋 initvar.yaml</summary><pre className="px-4 pb-3 text-xs text-slate-300 whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto font-mono">{mvu.initvarYamlContent || '(请先添加变量分区和变量)'}</pre></details>
            <details className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden"><summary className="px-4 py-2 cursor-pointer hover:bg-slate-700/30 text-sm font-medium text-emerald-300">📋 变量更新规则.yaml</summary><pre className="px-4 pb-3 text-xs text-slate-300 whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto font-mono">{mvu.updateRulesYamlContent || '(请先添加更新规则)'}</pre></details>
            <details className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden"><summary className="px-4 py-2 cursor-pointer hover:bg-slate-700/30 text-sm font-medium text-teal-300">⚡ EJS 预处理</summary><pre className="px-4 pb-3 text-xs text-slate-300 whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto font-mono">{mvu.ejsPreprocessContent || '(未配置 EJS 条目或使用的变量为空)'}</pre></details>
            {mvu.schemaTsContent && <details className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden"><summary className="px-4 py-2 cursor-pointer hover:bg-slate-700/30 text-sm font-medium text-purple-300">🔧 Zod.txt (SillyTavern 运行时)</summary><pre className="px-4 pb-3 text-xs text-slate-300 whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto font-mono">{buildZodTxt(mvu.schemaTsContent)}</pre></details>}
          </div>
        )}
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Beginner mode renderer
  // ────────────────────────────────────────────────────────────────────────
  function renderBeginnerMode() {
    const hasVariables = mvu.schemaSections.some(s => s.variables.length > 0);
    const totalVars = mvu.schemaSections.reduce((sum, s) => sum + s.variables.length, 0);

    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-white">MVU 变量系统</h2>
            <p className="text-sm text-slate-400 mt-1">
              <span className="text-emerald-400">小白模式</span> — 预设模板 + AI 辅助，无需懂代码
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={toggleMode} title="切换到大神模式（手搓代码）">
              🧙 切换到大神模式
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleMvu}>禁用 MVU</Button>
          </div>
        </div>

        {/* Step 1: Choose template */}
        <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-4 mb-4">
          <h3 className="text-sm font-bold text-emerald-300 mb-3">📋 第一步：选择场景模板</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {BEGINNER_TEMPLATES.map(tmpl => (
              <button
                key={tmpl.id}
                onClick={() => handleApplyTemplate(tmpl.id)}
                className={`rounded-xl border p-3 text-left transition-all hover:border-emerald-500/50 ${
                  selectedTemplate === tmpl.id
                    ? 'border-emerald-500 bg-emerald-900/30'
                    : 'border-slate-700 bg-slate-800/50'
                }`}
              >
                <div className="text-2xl mb-1">{tmpl.icon}</div>
                <div className="text-sm font-medium text-slate-200">{tmpl.name}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{tmpl.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: AI generate or manual tweak */}
        <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 p-4 mb-4">
          <h3 className="text-sm font-bold text-amber-300 mb-3">🤖 第二步：AI 生成（可选）</h3>
          <p className="text-xs text-amber-400/60 mb-2">
            用自然语言描述你想要的变量系统，AI 会自动生成。例如："我想追踪角色好感度、当前情绪、以及两人的关系阶段"
          </p>
          <div className="flex gap-2">
            <input
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              placeholder="描述你想要的变量，例如：好感度、情绪、位置、时间..."
              className={fieldCls}
            />
            <Button onClick={handleAiGenerate} disabled={aiGenerating}>
              {aiGenerating ? '⏳ 生成中...' : '✨ AI 生成'}
            </Button>
          </div>
        </div>

        {/* Step 3: Variable cards */}
        {hasVariables && (
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-200">📐 变量列表 ({totalVars}个)</h3>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={addSection}>+ 新分区</Button>
              </div>
            </div>

            {mvu.schemaSections.map((section, si) => (
              <div key={si} className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    value={section.name}
                    onChange={(e) => updateSection(si, { name: e.target.value })}
                    className="text-sm font-medium text-indigo-300 bg-transparent border-b border-transparent hover:border-indigo-500/50 focus:border-indigo-500 focus:outline-none px-1"
                    style={{ width: `${Math.max(4, section.name.length + 2)}ch` }}
                  />
                  {mvu.schemaSections.length > 1 && (
                    <Button variant="danger" size="sm" onClick={() => removeSection(si)}>×</Button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {section.variables.map((v, vi) => {
                    const isExpanded = expandedVars.has(v.path);
                    const isNumber = v.zodType === 'z.coerce.number()';
                    const isEnum = v.zodType.startsWith('z.enum(');
                    const typeLabel = isNumber ? '数字' : isEnum ? '枚举' : '字符串';
                    const typeBadgeColor = isNumber ? 'bg-emerald-900/40 text-emerald-400' : isEnum ? 'bg-violet-900/40 text-violet-400' : 'bg-sky-900/40 text-sky-400';
                    return (
                      <div key={vi} className="rounded-lg border border-slate-700/50 bg-slate-900/30 overflow-hidden">
                        {/* Collapsed row */}
                        <div
                          className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-800/50 transition-colors"
                          onClick={() => toggleExpanded(v.path)}
                        >
                          <span className="text-[10px] text-slate-500">{isExpanded ? '▼' : '▶'}</span>
                          <span className="text-sm font-mono text-slate-200 truncate flex-1 min-w-0">{v.path.split('.').pop()}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeBadgeColor}`}>{typeLabel}</span>
                          {v.prefix && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400">{v.prefix}前缀</span>}
                          <input
                            value={String(v.initialValue ?? '')}
                            onChange={(e) => {
                              let val: unknown = e.target.value;
                              if (isNumber) val = Number(e.target.value) || 0;
                              updateVariable(si, vi, { initialValue: val });
                            }}
                            className="w-16 text-center rounded border border-slate-600 bg-slate-800 text-xs text-indigo-300 py-0.5"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); removeVariable(si, vi); }}>×</Button>
                        </div>
                        {/* Expanded editor */}
                        {isExpanded && (
                          <div className="px-3 pb-3 space-y-2 border-t border-slate-700/30 pt-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div><label className={labelCls}>变量路径</label><input value={v.path} onChange={(e) => updateVariable(si, vi, { path: e.target.value })} placeholder="角色.好感度" className={fieldCls} /></div>
                              <div><label className={labelCls}>Zod 类型</label><select value={v.zodType} onChange={(e) => updateVariable(si, vi, { zodType: e.target.value })} className={fieldCls}>{ZOD_TYPE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div><label className={labelCls}>可见性前缀</label><select value={v.prefix} onChange={(e) => updateVariable(si, vi, { prefix: e.target.value as MvuPrefix })} className={fieldCls}>{PREFIX_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label} — {p.desc}</option>)}</select></div>
                              <div><label className={labelCls}>描述</label><input value={v.description} onChange={(e) => updateVariable(si, vi, { description: e.target.value })} placeholder="变量用途说明" className={fieldCls} /></div>
                            </div>
                            {isNumber && (
                              <div className="grid grid-cols-2 gap-2">
                                <div><label className={labelCls}>最小值</label><input type="number" value={v.range?.min ?? 0} onChange={(e) => updateVariable(si, vi, { range: { min: Number(e.target.value), max: v.range?.max ?? 100 } })} className={fieldCls} /></div>
                                <div><label className={labelCls}>最大值</label><input type="number" value={v.range?.max ?? 100} onChange={(e) => updateVariable(si, vi, { range: { min: v.range?.min ?? 0, max: Number(e.target.value) } })} className={fieldCls} /></div>
                              </div>
                            )}
                            {isEnum && (
                              <div><label className={labelCls}>枚举值 (逗号分隔)</label><input value={v.enumValues?.join(', ') ?? ''} onChange={(e) => { const values = e.target.value.split(',').map(s => s.trim()).filter(Boolean); updateVariable(si, vi, { enumValues: values, zodType: values.length > 0 ? `z.enum(${JSON.stringify(values)})` : 'z.string()' }); }} placeholder="开心, 正常, 低落" className={fieldCls} /></div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2">
                  <Button variant="ghost" size="sm" onClick={() => addVariable(si)}>+ 空变量</Button>
                </div>
              </div>
            ))}

            {/* Variable presets library */}
            <div className="mt-3 pt-3 border-t border-slate-700/50">
              <details className="rounded-lg border border-emerald-700/30 bg-emerald-950/10">
                <summary className="px-3 py-2 cursor-pointer hover:bg-emerald-900/10 text-xs font-medium text-emerald-300 flex items-center gap-1.5">
                  📚 一键添加常用变量
                  <span className="text-emerald-500/60">点击展开</span>
                </summary>
                <div className="px-3 pb-3 space-y-2">
                  {VARIABLE_PRESETS.map(presetCat => (
                    <div key={presetCat.category}>
                      <div className="text-[10px] text-slate-500 mb-1">{presetCat.category}</div>
                      <div className="flex flex-wrap gap-1">
                        {presetCat.items.map(preset => {
                          // 检查该变量路径是否已存在
                          const alreadyExists = mvu.schemaSections.some(s =>
                            s.variables.some(v => v.path === preset.path)
                          );
                          const targetSectionIdx = 0; // 默认加到第一个分区
                          return (
                            <button
                              key={preset.path}
                              onClick={() => quickAddVar(targetSectionIdx, preset)}
                              disabled={alreadyExists}
                              className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                                alreadyExists
                                  ? 'border-slate-700/30 text-slate-600 cursor-not-allowed'
                                  : 'border-slate-600/50 text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300 hover:bg-emerald-900/20'
                              }`}
                              title={alreadyExists ? '已存在' : `添加 ${preset.path}`}
                            >
                              {preset.path.split('.').pop()}
                              {alreadyExists && <span className="ml-0.5 text-slate-600">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </div>
        )}

        {/* Step 4: Status bar styling & preview */}
        <div className="rounded-xl border border-purple-700/40 bg-purple-950/20 p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-purple-300">🎨 状态栏美化</h3>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={regenerateStatusBar} title="根据当前变量重新生成">
                🔄 刷新
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowBarCode(!showBarCode)}>
                {showBarCode ? '👁️ 预览' : '📝 代码'}
              </Button>
            </div>
          </div>

          {/* Template selector */}
          <div className="mb-3">
            <label className="text-xs text-slate-400 mb-1.5 block">选择风格模板</label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {STATUS_BAR_TEMPLATES.map(tmpl => (
                <button
                  key={tmpl.id}
                  onClick={() => applyStatusBarTemplate(tmpl.id)}
                  className={`rounded-lg border p-2 text-center transition-all ${
                    statusBarStyle === tmpl.id
                      ? 'border-purple-500 bg-purple-900/40'
                      : 'border-slate-700 bg-slate-800/50 hover:border-purple-500/40'
                  }`}
                  title={tmpl.description}
                >
                  <div className="text-lg">{tmpl.icon}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{tmpl.name}</div>
                </button>
              ))}
              {mvu.statusBarStyle === 'ai-custom' && (
                <div className="rounded-lg border border-purple-500 bg-purple-900/40 p-2 text-center">
                  <div className="text-lg">🤖</div>
                  <div className="text-[10px] text-purple-300 mt-0.5">AI 定制</div>
                </div>
              )}
            </div>
          </div>

          {/* Title input */}
          <div className="mb-3">
            <label className="text-xs text-slate-400 mb-1 block">状态栏标题</label>
            <input
              value={statusBarTitle}
              onChange={(e) => {
                setStatusBarTitle(e.target.value);
                if (statusBarStyle !== 'ai-custom') {
                  const html = generateStatusBarHtml(statusBarStyle, mvu.schemaSections, e.target.value);
                  onChange({ ...mvu, statusBarHtml: html });
                }
              }}
              placeholder="例如：💕 关系状态"
              className={fieldCls}
            />
          </div>

          {/* AI generate */}
          <div className="mb-3 rounded-lg border border-amber-700/30 bg-amber-950/10 p-3">
            <label className="text-xs text-amber-400/80 mb-1.5 block">🤖 AI 生成状态栏（可选）</label>
            <p className="text-[10px] text-amber-400/50 mb-2">
              描述你想要的状态栏风格，AI 会根据当前变量生成。约束已内置：变量必须用 {'{{getvar::stat_data.路径}}'} 宏读取
            </p>
            <div className="flex gap-2">
              <input
                value={aiBarStyle}
                onChange={(e) => setAiBarStyle(e.target.value)}
                placeholder="例如：赛博朋克霓虹风格，带进度条动画，紫色发光边框"
                className={fieldCls}
              />
              <Button
                onClick={handleAiGenerateStatusBar}
                disabled={aiBarGenerating || mvu.schemaSections.length === 0}
                variant="secondary"
                size="sm"
              >
                {aiBarGenerating ? '⏳ 生成中' : '✨ AI 生成'}
              </Button>
            </div>
          </div>

          {/* Preview or Code view */}
          {showBarCode ? (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">HTML 代码（可手动编辑）</label>
              <textarea
                value={mvu.statusBarHtml || statusBarHtml}
                onChange={(e) => onChange({ ...mvu, statusBarHtml: e.target.value, statusBarStyle: 'ai-custom' })}
                rows={10}
                className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-300 font-mono"
                placeholder="状态栏 HTML 代码..."
              />
              <p className="text-[10px] text-slate-500 mt-1">
                提示：变量必须用 <code className="text-amber-400">{'{{getvar::stat_data.路径}}'}</code> 宏读取
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-4">
              <div className="w-full" dangerouslySetInnerHTML={{ __html: statusBarPreviewHtml }} />
            </div>
          )}

          <p className="text-[10px] text-purple-400/60 mt-3 text-center">
            导出时状态栏 HTML 会通过 regex_scripts 替换 first_mes 中的占位符，在 SillyTavern 前端显示
          </p>
        </div>

        {/* Generated code preview — auto-synced */}
        {mvu.schemaTsContent && (
          <details className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
            <summary className="px-4 py-2 cursor-pointer hover:bg-slate-700/30 text-sm font-medium text-slate-400">
              🔧 查看生成的代码 (schema.ts + initvar.yaml + 更新规则) — 自动同步
            </summary>
            <div className="px-4 pb-3 space-y-2">
              <pre className="text-xs text-slate-400 bg-slate-900/50 p-2 rounded max-h-[200px] overflow-y-auto font-mono whitespace-pre-wrap">{mvu.schemaTsContent || '(空)'}</pre>
              <pre className="text-xs text-slate-400 bg-slate-900/50 p-2 rounded max-h-[200px] overflow-y-auto font-mono whitespace-pre-wrap">{mvu.initvarYamlContent || '(空)'}</pre>
              <pre className="text-xs text-slate-400 bg-slate-900/50 p-2 rounded max-h-[200px] overflow-y-auto font-mono whitespace-pre-wrap">{mvu.updateRulesYamlContent || '(空)'}</pre>
            </div>
          </details>
        )}
      </div>
    );
  }
}