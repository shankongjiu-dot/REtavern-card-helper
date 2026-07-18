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
import { useToast } from '../shared/Toast';
import { TextInput } from '../shared/TextInput';
import { TextArea } from '../shared/TextArea';
import { useTranslation } from '../../i18n/I18nContext';
import { useAIGenerate } from '../../hooks/useAIGenerate';
import { MVU_BEGINNER_GENERATE_PROMPT } from '../../constants/prompts';
import { MultiCharTemplateModal } from './MultiCharTemplateModal';
import {
  buildSchemaTs,
  buildInitvarYaml,
  buildUpdateRulesYaml,
  buildEjsPreprocess,
  buildZodTxt,
  parseRangeString,
} from '../../services/mvu-builder';
import {
  STATUS_BAR_TEMPLATES,
  generateStatusBarHtml,
  buildStatusBarAIPrompt,
  buildStatusBarModifyAIPrompt,
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
  { value: 'z.boolean()', label: '布尔 (z.boolean)' },
  { value: 'z.enum(["值1", "值2", "值3"])', label: '枚举 (z.enum)' },
  { value: 'z.array(z.string())', label: '数组 (z.array)' },
  { value: 'z.union([z.string(), z.number()])', label: '联合 (z.union)' },
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
  { value: '分阶段调度' as const, label: '分阶段调度 (getWorldInfo)', desc: '常驻调度条目按变量值拉取子条目' },
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

/** Templates that are designed to work with the staged lorebook dispatcher system */
export const STAGED_COMPATIBLE_TEMPLATE_IDS = ['pure-love', 'ntr', 'dual-route'] as const;

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
    id: 'pure-love',
    name: '甜宠纯爱',
    icon: '💕',
    description: '单一情感天平 0~100 单向递增，适合纯甜向剧情',
    sections: [
      {
        name: '关系',
        variables: [
          { path: '关系.情感天平', zodType: 'z.coerce.number()', description: '对主角的情感倾向：0=初识，100=深爱，单调递增（只升不降）', prefix: '', initialValue: 0, range: { min: 0, max: 100 } },
        ],
      },
    ],
    updateRules: [
      { path: '关系.情感天平', type: 'number', range: '0~100', check: ['正面互动 +(3~8)，特殊事件（送礼/告白） +(10~20)', '只增不减，单调递增，达到阈值自动推进阶段'] },
    ],
    statusBarTitle: '💕 纯爱情感',
    statusBarVars: ['关系.情感天平'],
  },
  {
    id: 'ntr',
    name: '虐恋NTR',
    icon: '🖤',
    description: '单一情感天平 0~100 单向递增，适合纯虐向剧情',
    sections: [
      {
        name: '关系',
        variables: [
          { path: '关系.情感天平', zodType: 'z.coerce.number()', description: '情感堕落程度：0=纯洁，100=沉沦，单调递增（只增不减）', prefix: '', initialValue: 0, range: { min: 0, max: 100 } },
        ],
      },
    ],
    updateRules: [
      { path: '关系.情感天平', type: 'number', range: '0~100', check: ['被动事件/胁迫 +(5~15)，主动堕落 +(3~8)', '只增不减，单调递增，达到阈值自动推进阶段'] },
    ],
    statusBarTitle: '🖤 堕落情感',
    statusBarVars: ['关系.情感天平'],
  },
  {
    id: 'dual-route',
    name: '可纯爱可NTR',
    icon: '🔀',
    description: '单一情感天平 -100~100，0附近为缓冲带，支持一次性特殊事件',
    sections: [
      {
        name: '关系',
        variables: [
          { path: '关系.情感天平', zodType: 'z.coerce.number()', description: '情感倾向核心变量：>0 偏向纯爱主角，<0 偏向 NTR 第三者，0 附近为缓冲带', prefix: '', initialValue: 0, range: { min: -100, max: 100 } },
          { path: '关系.恶堕事件玩家方', zodType: 'z.boolean()', description: '隐藏标记：玩家方触发恶堕事件（如主角背叛/伤害女主/主动把她推向他人等），一次性大幅拉低情感天平后锁定，防止重复触发', prefix: '$', initialValue: false },
          { path: '关系.被强制恶堕', zodType: 'z.boolean()', description: '隐藏标记：女主被胁迫/强制发生恶堕事件（如被下药、被威胁、被强迫等），一次性大幅拉低情感天平后锁定，防止重复触发', prefix: '$', initialValue: false },
        ],
      },
    ],
    updateRules: [
      {
        path: '关系.情感天平',
        type: 'number',
        range: '-100~100',
        check: [
          '纯爱侧：主角真诚关心/保护/尊重/亲密/共同回忆，或女主主动靠近 → +3~15',
          'NTR侧（敌人受益的"正面"互动）：主角帮情敌/向威胁屈服/牺牲女主利益/让女主单独面对威胁/敌人 → -5~20',
          'NTR侧（主角负面行为）：主角欺骗/背叛/冷落/主动伤害/暴力 → -5~20',
          '缓冲带：当前值在 -20~20 时，日常互动只 ±1~3；只有明确指向纯爱或NTR的情节才允许 ±5~15 跨区',
          '特殊事件：若「玩家方触发恶堕事件（背叛/伤害/主动推向他人）」且 关系.恶堕事件玩家方=false，则一次性 -30~-50 并将 关系.恶堕事件玩家方 设为 true',
          '特殊事件：若「女主被胁迫/强制发生恶堕事件」且 关系.被强制恶堕=false，则一次性 -30~-50 并将 关系.被强制恶堕 设为 true',
        ],
      },
      {
        path: '关系.恶堕事件玩家方',
        check: ['初始 false', '仅在「玩家方触发恶堕事件」时设为 true，一次性事件不可恢复'],
      },
      {
        path: '关系.被强制恶堕',
        check: ['初始 false', '仅在「女主被强制恶堕」时设为 true，一次性事件不可恢复'],
      },
    ],
    statusBarTitle: '🔀 情感天平',
    statusBarVars: ['关系.情感天平'],
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

// ── Expert mode template market ─────────────────────────────────────────────

interface ExpertTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  sections: MvuSchemaSection[];
  updateRules: MvuUpdateRule[];
  statusBarTitle: string;
  statusBarVars: string[];
}

/** 大神模式模板市场：内置常见变量系统，应用时追加到当前 schemaSections */
const EXPERT_TEMPLATES: ExpertTemplate[] = [
  {
    id: 'rpg-stats',
    name: 'RPG 属性面板',
    icon: '⚔️',
    description: 'HP/MP/等级/金币/经验',
    sections: [
      {
        name: '主角',
        variables: [
          { path: '主角.HP', zodType: 'z.coerce.number()', description: '当前生命值', prefix: '', initialValue: 100, range: { min: 0, max: 100 } },
          { path: '主角.MP', zodType: 'z.coerce.number()', description: '当前魔力值', prefix: '', initialValue: 100, range: { min: 0, max: 100 } },
          { path: '主角.等级', zodType: 'z.coerce.number()', description: '冒险者等级', prefix: '', initialValue: 1, range: { min: 1, max: 99 } },
          { path: '主角.金币', zodType: 'z.coerce.number()', description: '持有金币', prefix: '', initialValue: 100, range: { min: 0, max: 99999 } },
          { path: '主角.经验值', zodType: 'z.coerce.number()', description: '当前经验值', prefix: '', initialValue: 0, range: { min: 0, max: 1000 } },
        ],
      },
    ],
    updateRules: [
      { path: '主角.HP', type: 'number', range: '0~100', check: ['战斗受伤减少，休息或治疗回复', '单次变化不超过 ±30'] },
      { path: '主角.MP', type: 'number', range: '0~100', check: ['使用技能消耗，休息回复', '单次变化不超过 ±25'] },
      { path: '主角.等级', type: 'number', range: '1~99', check: ['经验值达到阈值后升级'] },
      { path: '主角.金币', type: 'number', range: '0~99999', check: ['购买物品减少，出售物品/任务奖励增加'] },
      { path: '主角.经验值', type: 'number', range: '0~1000', check: ['完成任务或击败敌人后增加'] },
    ],
    statusBarTitle: '⚔️ 冒险状态',
    statusBarVars: ['主角.HP', '主角.MP', '主角.等级', '主角.金币'],
  },
  {
    id: 'romance-stats',
    name: '恋爱养成',
    icon: '💕',
    description: '好感度/情绪/关系阶段',
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
    id: 'school-life',
    name: '校园日常',
    icon: '📚',
    description: '好感度/社团/地点/时间段',
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
    id: 'urban-life',
    name: '现代都市',
    icon: '🏙️',
    description: '好感度/亲密度/心情/社交圈',
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
    id: 'date-weather',
    name: '日期天气系统',
    icon: '📅',
    description: '日期、星期、天气、季节',
    sections: [
      {
        name: '时间',
        variables: [
          { path: '时间.日期', zodType: 'z.string()', description: '当前日期', prefix: '', initialValue: '1月1日' },
          { path: '时间.星期', zodType: 'z.enum(["周一", "周二", "周三", "周四", "周五", "周六", "周日"])', description: '当前星期', prefix: '', initialValue: '周一', enumValues: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] },
          { path: '时间.天气', zodType: 'z.enum(["晴天", "多云", "小雨", "暴雨", "下雪", "大风"])', description: '当前天气', prefix: '', initialValue: '晴天', enumValues: ['晴天', '多云', '小雨', '暴雨', '下雪', '大风'] },
          { path: '时间.季节', zodType: 'z.enum(["春", "夏", "秋", "冬"])', description: '当前季节', prefix: '', initialValue: '春', enumValues: ['春', '夏', '秋', '冬'] },
        ],
      },
    ],
    updateRules: [
      { path: '时间.日期', format: 'M月D日', check: ['根据剧情时间推进自然变化'] },
      { path: '时间.星期', check: ['随日期变化循环'] },
      { path: '时间.天气', check: ['根据场景和季节合理变化'] },
      { path: '时间.季节', check: ['根据日期变化，每月对应一季'] },
    ],
    statusBarTitle: '📅 世界时间',
    statusBarVars: ['时间.日期', '时间.星期', '时间.天气', '时间.季节'],
  },
  {
    id: 'quest-tracker',
    name: '任务追踪系统',
    icon: '📜',
    description: '任务列表、完成度',
    sections: [
      {
        name: '任务',
        variables: [
          { path: '任务.列表', zodType: 'z.array(z.string())', description: '当前接取的任务列表', prefix: '', initialValue: [] },
          { path: '任务.完成度', zodType: 'z.record(z.string(), z.coerce.number())', description: '各任务完成度 0~100', prefix: '', initialValue: {} },
          { path: '任务.当前任务', zodType: 'z.string()', description: '当前追踪的主线任务', prefix: '', initialValue: '无' },
        ],
      },
    ],
    updateRules: [
      { path: '任务.列表', check: ['接取新任务时添加，完成任务时移除'] },
      { path: '任务.完成度', check: ['推进任务目标时增加，达到 100 时标记完成'] },
      { path: '任务.当前任务', check: ['切换追踪目标时更新'] },
    ],
    statusBarTitle: '📜 任务追踪',
    statusBarVars: ['任务.当前任务', '任务.列表', '任务.完成度'],
  },
];

// ── Variable presets library (for beginner quick-add) ──────────────────────

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

/** 根据 zodType 推断 update rule 的 type */
function inferVariableType(zodType: string): string {
  if (zodType === 'z.coerce.number()') return 'number';
  if (zodType === 'z.boolean()' || zodType === 'z.boolean') return 'boolean';
  if (zodType.startsWith('z.enum(')) return 'string';
  if (zodType.startsWith('z.array(')) return 'array';
  if (zodType.startsWith('z.union(')) return 'string';
  if (zodType.startsWith('z.object(')) return 'object';
  if (zodType.startsWith('z.record(')) return 'record';
  return 'string';
}

/** 校验导入的 MVU 配置是否合法 */
function validateImportedConfig(data: unknown): Partial<MvuConfig> | null {
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
function buildGenerateRulesPrompt(sections: MvuSchemaSection[], cardName?: string): { system: string; user: string } {
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
function buildGenerateEjsPrompt(sections: MvuSchemaSection[], entries: LorebookEntry[], selectedEntryIds: string[], cardName?: string): { system: string; user: string } {
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

function applyTemplate(template: BeginnerTemplate): MvuConfig {
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

// ── Component ───────────────────────────────────────────────────────────────

interface StepMvuVariablesProps {
  mvu: MvuConfig;
  lorebookEntries: LorebookEntry[];
  onChange: (mvu: MvuConfig) => void;
  /** Card name + character summaries for AI context */
  cardName?: string;
  characterDescriptions?: string;
  /** 多角色套模板应用阶段轴信息（供步骤5分阶段模式预填充） */
  onApplyStageAxes?: (axes: Array<{ characterName: string; axisPath: string }>, templateId: string) => void;
}

export function StepMvuVariables({ mvu, lorebookEntries, onChange, cardName = '', characterDescriptions = '', onApplyStageAxes }: StepMvuVariablesProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
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
  const [aiBarModifyInstruction, setAiBarModifyInstruction] = useState('');
  const [aiBarModifying, setAiBarModifying] = useState(false);
  const [showBarCode, setShowBarCode] = useState(false);
  const [bgImageUrl, setBgImageUrl] = useState('');
  const [tachieImageUrl, setTachieImageUrl] = useState('');
  const [avatarImageUrl, setAvatarImageUrl] = useState('');
  const [showMultiCharModal, setShowMultiCharModal] = useState(false);
  // 大神模式增强状态
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set(mvu.schemaSections.map((_, i) => i)));
  const [selectedVariables, setSelectedVariables] = useState<Set<string>>(new Set());
  const [showTemplateMarket, setShowTemplateMarket] = useState(false);
  const [aiRuleGenerating, setAiRuleGenerating] = useState(false);
  const [aiEjsGenerating, setAiEjsGenerating] = useState(false);
  const [selectedEjsEntries, setSelectedEjsEntries] = useState<Set<string>>(new Set());
  const [draggedVar, setDraggedVar] = useState<{ sectionIdx: number; varIdx: number } | null>(null);
  const [draggedSection, setDraggedSection] = useState<number | null>(null);
  const [dragOverSection, setDragOverSection] = useState<number | null>(null);
  const [dragOverVar, setDragOverVar] = useState<{ sectionIdx: number; varIdx: number } | null>(null);

  const fieldCls = 'w-full rounded border border-[var(--input-border)] bg-[var(--color-surface-raised)] px-2 py-1 text-sm text-[var(--text-color)]';
  const labelCls = 'text-xs text-[var(--color-text-secondary)]';
  const errorCls = 'border-[color-mix(in_srgb,var(--color-status-error)_60%,transparent)] text-[var(--color-status-error)]';

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

  const duplicateSection = (idx: number) => {
    const section = mvu.schemaSections[idx];
    const cloned: MvuSchemaSection = JSON.parse(JSON.stringify(section));
    cloned.name = `${cloned.name} 副本`;
    cloned.variables = cloned.variables.map(v => ({ ...v, path: `${v.path}_副本` }));
    const nextSections = [...mvu.schemaSections];
    nextSections.splice(idx + 1, 0, cloned);
    onChange({ ...mvu, schemaSections: nextSections });
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.add(idx + 1);
      return next;
    });
  };

  const moveSection = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const sections = [...mvu.schemaSections];
    const [moved] = sections.splice(fromIdx, 1);
    const adjustedTo = toIdx > fromIdx ? toIdx - 1 : toIdx;
    sections.splice(adjustedTo, 0, moved);
    onChange({ ...mvu, schemaSections: sections });
    setSelectedSection(adjustedTo);
  };

  const toggleSectionExpanded = (idx: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  // ── Variable management ────────────────────────────────────────────────
  const addVariable = (sectionIdx: number) => {
    const v = createEmptyVariable();
    const section = mvu.schemaSections[sectionIdx];
    v.path = `${section.name}.新变量`;
    updateSection(sectionIdx, { variables: [...section.variables, v] });
    setExpandedVars(prev => new Set([...prev, v.path]));
  };

  const duplicateVariable = (sectionIdx: number, varIdx: number) => {
    const section = mvu.schemaSections[sectionIdx];
    const v = section.variables[varIdx];
    const cloned: MvuVariable = JSON.parse(JSON.stringify(v));
    cloned.path = `${cloned.path}_副本`;
    const nextVars = [...section.variables];
    nextVars.splice(varIdx + 1, 0, cloned);
    updateSection(sectionIdx, { variables: nextVars });
    setExpandedVars(prev => new Set([...prev, cloned.path]));
  };

  const removeVariable = (sectionIdx: number, varIdx: number) => {
    const section = mvu.schemaSections[sectionIdx];
    updateSection(sectionIdx, { variables: section.variables.filter((_, i) => i !== varIdx) });
  };

  const moveVariable = (fromSectionIdx: number, fromVarIdx: number, toSectionIdx: number, toVarIdx: number) => {
    if (fromSectionIdx === toSectionIdx && fromVarIdx === toVarIdx) return;
    const sections = JSON.parse(JSON.stringify(mvu.schemaSections)) as MvuSchemaSection[];
    const [moved] = sections[fromSectionIdx].variables.splice(fromVarIdx, 1);
    const adjustedTo = toVarIdx > fromVarIdx && fromSectionIdx === toSectionIdx ? toVarIdx - 1 : toVarIdx;
    sections[toSectionIdx].variables.splice(adjustedTo, 0, moved);
    onChange({ ...mvu, schemaSections: sections });
  };

  const updateVariable = (sectionIdx: number, varIdx: number, updates: Partial<MvuVariable>) => {
    const section = mvu.schemaSections[sectionIdx];
    const oldPath = section.variables[varIdx].path;
    const newPath = updates.path ?? oldPath;
    updateSection(sectionIdx, { variables: section.variables.map((v, i) => (i === varIdx ? { ...v, ...updates } : v)) });
    // 同步更新展开状态 key，避免修改变量路径时卡片自动折叠
    if (updates.path !== undefined && oldPath !== newPath && expandedVars.has(oldPath)) {
      setExpandedVars((prev) => {
        const next = new Set(prev);
        next.delete(oldPath);
        next.add(newPath);
        return next;
      });
    }
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

  // ── Batch variable operations ──────────────────────────────────────────
  const batchDeleteVariables = () => {
    if (selectedVariables.size === 0) return;
    const nextSections = mvu.schemaSections.map(s => ({
      ...s,
      variables: s.variables.filter(v => !selectedVariables.has(v.path)),
    }));
    onChange({ ...mvu, schemaSections: nextSections });
    setSelectedVariables(new Set());
    addToast('success', `已删除 ${selectedVariables.size} 个变量`);
  };

  // ── Import / Export MVU config ─────────────────────────────────────────
  const exportMvuConfig = () => {
    const payload = {
      schemaSections: mvu.schemaSections,
      updateRules: mvu.updateRules,
      ejsConfigs: mvu.ejsConfigs,
      ejsPreprocessContent: mvu.ejsPreprocessContent,
      statusBarHtml: mvu.statusBarHtml,
      statusBarStyle: mvu.statusBarStyle,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mvu-config-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', 'MVU 配置已导出');
  };

  const importMvuConfig = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = validateImportedConfig(parsed);
      if (!imported || (!imported.schemaSections?.length && !imported.updateRules?.length && !imported.ejsConfigs?.length)) {
        addToast('error', '导入文件不合法或为空');
        return;
      }
      const next: MvuConfig = {
        ...mvu,
        schemaSections: imported.schemaSections ?? mvu.schemaSections,
        updateRules: imported.updateRules ?? mvu.updateRules,
        ejsConfigs: imported.ejsConfigs ?? mvu.ejsConfigs,
        statusBarHtml: imported.statusBarHtml ?? mvu.statusBarHtml,
        statusBarStyle: imported.statusBarStyle ?? mvu.statusBarStyle,
      };
      onChange(next);
      setExpandedSections(new Set(next.schemaSections.map((_, i) => i)));
      addToast('success', 'MVU 配置已导入');
    } catch (err) {
      addToast('error', `导入失败: ${err instanceof Error ? err.message : '请检查 JSON 格式'}`);
    }
  };

  // ── AI generate update rules ───────────────────────────────────────────
  const handleAiGenerateRules = async () => {
    if (mvu.schemaSections.flatMap(s => s.variables).length === 0) {
      addToast('error', '请先定义变量再生成规则');
      return;
    }
    setAiRuleGenerating(true);
    try {
      const prompt = buildGenerateRulesPrompt(mvu.schemaSections, cardName);
      const result = await generateText(prompt.system, prompt.user);
      const parsed = JSON.parse(result);
      const rulesRaw = Array.isArray(parsed.rules) ? parsed.rules : [];
      const rules: MvuUpdateRule[] = rulesRaw.map((r: Record<string, unknown>) => ({
        path: String(r.path || ''),
        type: String(r.type || ''),
        range: r.range !== undefined ? String(r.range) : undefined,
        format: r.format !== undefined ? String(r.format) : undefined,
        value: r.value !== undefined ? String(r.value) : undefined,
        check: Array.isArray(r.check) ? r.check.map(String) : [],
      })).filter((r: MvuUpdateRule) => r.path);
      if (rules.length === 0) {
        addToast('error', 'AI 没有返回可用规则');
        return;
      }
      onChange({ ...mvu, updateRules: rules });
      addToast('success', `已生成 ${rules.length} 条更新规则`);
    } catch (err) {
      addToast('error', `AI 生成规则失败: ${err instanceof Error ? err.message : '请重试'}`);
    } finally {
      setAiRuleGenerating(false);
    }
  };

  // ── AI generate EJS configs ────────────────────────────────────────────
  const handleAiGenerateEjs = async () => {
    if (selectedEjsEntries.size === 0) {
      addToast('error', '请先在下方选择要应用 EJS 的世界书条目');
      return;
    }
    if (mvu.schemaSections.flatMap(s => s.variables).length === 0) {
      addToast('error', '请先定义变量再生成 EJS');
      return;
    }
    setAiEjsGenerating(true);
    try {
      const prompt = buildGenerateEjsPrompt(mvu.schemaSections, lorebookEntries, Array.from(selectedEjsEntries), cardName);
      const result = await generateText(prompt.system, prompt.user);
      const parsed = JSON.parse(result);
      const configsRaw = Array.isArray(parsed.ejsConfigs) ? parsed.ejsConfigs : [];
      const configs: EjsEntryConfig[] = configsRaw.map((c: Record<string, unknown>) => ({
        entryId: String(c.entryId || ''),
        complexity: ['显隐', '段落控制', '动态文本', '分阶段调度'].includes(String(c.complexity))
          ? (String(c.complexity) as EjsEntryConfig['complexity'])
          : '显隐',
        condition: String(c.condition || ''),
        usedVariables: Array.isArray(c.usedVariables) ? c.usedVariables.map(String) : [],
      })).filter((c: EjsEntryConfig) => c.entryId && selectedEjsEntries.has(c.entryId));
      if (configs.length === 0) {
        addToast('error', 'AI 没有返回可用 EJS 配置');
        return;
      }
      const existing = mvu.ejsConfigs.filter(c => !selectedEjsEntries.has(c.entryId));
      onChange({ ...mvu, ejsConfigs: [...existing, ...configs] });
      addToast('success', `已生成 ${configs.length} 条 EJS 配置`);
    } catch (err) {
      addToast('error', `AI 生成 EJS 失败: ${err instanceof Error ? err.message : '请重试'}`);
    } finally {
      setAiEjsGenerating(false);
    }
  };

  // ── Apply expert template (append, do not overwrite) ─────────────────────
  const applyExpertTemplate = (template: ExpertTemplate, overwrite: boolean) => {
    const clonedSections = JSON.parse(JSON.stringify(template.sections)) as MvuSchemaSection[];
    const clonedRules = JSON.parse(JSON.stringify(template.updateRules)) as MvuUpdateRule[];
    let nextSections = overwrite ? clonedSections : [...mvu.schemaSections, ...clonedSections];
    let nextRules = overwrite ? clonedRules : [...mvu.updateRules, ...clonedRules];
    if (!overwrite) {
      // 去重：已有相同路径的变量/规则不再追加
      const existingPaths = new Set(mvu.schemaSections.flatMap(s => s.variables.map(v => v.path)));
      nextSections = [...mvu.schemaSections];
      for (const s of clonedSections) {
        const newVars = s.variables.filter(v => !existingPaths.has(v.path));
        if (newVars.length > 0) {
          const existingSectionIdx = nextSections.findIndex(ns => ns.name === s.name);
          if (existingSectionIdx >= 0) {
            nextSections[existingSectionIdx] = { ...nextSections[existingSectionIdx], variables: [...nextSections[existingSectionIdx].variables, ...newVars] };
          } else {
            nextSections.push({ ...s, variables: newVars });
          }
        }
      }
      const existingRulePaths = new Set(mvu.updateRules.map(r => r.path));
      nextRules = [...mvu.updateRules, ...clonedRules.filter(r => !existingRulePaths.has(r.path))];
    }
    onChange({ ...mvu, schemaSections: nextSections, updateRules: nextRules });
    setExpandedSections(new Set(nextSections.map((_, i) => i)));
    setShowTemplateMarket(false);
    addToast('success', `已应用模板「${template.name}」`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const prompt = MVU_BEGINNER_GENERATE_PROMPT(cardName, characterDescriptions, aiInput, mvu.beginnerTemplateId || selectedTemplate);
      const result = await generateText(prompt.system, prompt.user);
      // Try to parse AI response as JSON
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        const sectionsRaw = Array.isArray(parsed.sections) ? parsed.sections : [];
        const sections: MvuSchemaSection[] = (sectionsRaw as Record<string, unknown>[]).map((s: Record<string, unknown>) => ({
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
              initialValue = isNaN(Number(initialValue)) ? 0 : Number(initialValue);
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

        const updateRulesRaw = Array.isArray(parsed.updateRules) ? parsed.updateRules : [];
        const updateRules: MvuUpdateRule[] = (updateRulesRaw as Record<string, unknown>[]).map((r: Record<string, unknown>) => ({
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
    } catch (err) {
      addToast('error', `MVU 生成失败: ${err instanceof Error ? err.message : '请重试'}`);
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

  // ── Real-time validation ───────────────────────────────────────────────
  const schemaVarPaths = useMemo(() => new Set(mvu.schemaSections.flatMap(s => s.variables.map(v => v.path))), [mvu.schemaSections]);
  const pathOccurrences = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of mvu.schemaSections) {
      for (const v of s.variables) {
        map.set(v.path, (map.get(v.path) || 0) + 1);
      }
    }
    return map;
  }, [mvu.schemaSections]);
  const invalidRulePaths = useMemo(() => new Set(mvu.updateRules.map(r => r.path).filter(p => p && !schemaVarPaths.has(p))), [mvu.updateRules, schemaVarPaths]);
  const invalidEjsVarNames = useMemo(() => {
    const schemaVarNames = new Set(mvu.schemaSections.flatMap(s => s.variables).filter(v => v.prefix !== '$').map(v => v.path.split('.').pop() || v.path));
    const invalid = new Set<string>();
    for (const c of mvu.ejsConfigs) {
      for (const v of c.usedVariables) {
        if (!schemaVarNames.has(v)) invalid.add(v);
      }
    }
    return invalid;
  }, [mvu.ejsConfigs, mvu.schemaSections]);
  const typeMismatchedRules = useMemo(() => {
    const mismatches: { path: string; ruleType: string; varType: string }[] = [];
    for (const r of mvu.updateRules) {
      if (!r.path || !r.type) continue;
      const v = mvu.schemaSections.flatMap(s => s.variables).find(vv => vv.path === r.path);
      if (!v) continue;
      const inferred = inferVariableType(v.zodType);
      if (r.type !== inferred && !(r.type === 'string' && inferred === 'boolean')) {
        mismatches.push({ path: r.path, ruleType: r.type, varType: inferred });
      }
    }
    return mismatches;
  }, [mvu.updateRules, mvu.schemaSections]);

  // ── Status bar: generate preview HTML ──────────────────────────────────
  // Use AI-generated HTML if present, otherwise use template
  const statusBarHtml = useMemo(() => {
    // If user has AI-generated or manually edited HTML, use it
    if (mvu.statusBarHtml) return mvu.statusBarHtml;

    // Otherwise generate from template
    if (mvu.schemaSections.length === 0 || !statusBarStyle) {
      return '<p style="color:var(--color-text-muted);font-size:12px;text-align:center;padding:20px">暂无变量，请先选择模板或生成变量</p>';
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

  const statusBarModeLabel = statusBarStyle === 'ai-custom'
    ? 'AI/手动定制'
    : '模板同步';
  const statusBarModeHint = statusBarStyle === 'ai-custom'
    ? '变量变更不会自动重写状态栏，可手动刷新或重新选择模板。'
    : '变量变更会自动按当前模板重建状态栏。';

  // ── Status bar: apply template ──────────────────────────────────────────
  const applyStatusBarTemplate = (templateId: string) => {
    setStatusBarStyle(templateId);
    let html = generateStatusBarHtml(templateId, mvu.schemaSections, statusBarTitle);
    // 如果是visual-novel模板，应用用户填写的图片URL
    if (templateId === 'visual-novel') {
      if (bgImageUrl) {
        html = html.replace(/https:\/\/placehold\.co\/800x400\/ffb6c1\/fff\?background/g, bgImageUrl);
      }
      if (tachieImageUrl) {
        html = html.replace(/https:\/\/placehold\.co\/300x500\/transparent\/fff\?text=立绘/g, tachieImageUrl);
      }
      if (avatarImageUrl) {
        html = html.replace(/https:\/\/placehold\.co\/80x80\/e87a90\/fff\?text=头像/g, avatarImageUrl);
      }
    }
    onChange({ ...mvu, statusBarStyle: templateId, statusBarHtml: html });
  };

  // ── Status bar: AI generate ─────────────────────────────────────────────
  const handleAiGenerateStatusBar = async () => {
    if (mvu.schemaSections.length === 0) {
      addToast('error', '请先添加 MVU 变量，再生成状态栏');
      return;
    }
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
        addToast('error', 'AI 没有保留变量宏，已拒绝应用');
        return;
      }
      onChange({ ...mvu, statusBarHtml: cleaned, statusBarStyle: 'ai-custom' });
      setStatusBarStyle('ai-custom');
      addToast('success', '状态栏已生成，可在预览中检查后导出');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : '状态栏生成失败');
    } finally {
      setAiBarGenerating(false);
    }
  };

  // ── Status bar: AI modify ────────────────────────────────────────────────
  const handleAiModifyStatusBar = async () => {
    if (mvu.schemaSections.length === 0) {
      addToast('error', '请先添加 MVU 变量，再修改状态栏');
      return;
    }
    const currentHtml = mvu.statusBarHtml || statusBarHtml;
    if (!currentHtml || currentHtml.includes('暂无变量')) {
      addToast('error', '当前没有可修改的状态栏');
      return;
    }
    setAiBarModifying(true);
    try {
      const prompt = buildStatusBarModifyAIPrompt(mvu.schemaSections, cardName, currentHtml, aiBarModifyInstruction);
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
        addToast('error', 'AI 没有保留变量宏，已拒绝应用');
        return;
      }
      onChange({ ...mvu, statusBarHtml: cleaned, statusBarStyle: 'ai-custom' });
      setStatusBarStyle('ai-custom');
      addToast('success', '状态栏已修改，可在预览中检查后导出');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : '状态栏修改失败');
    } finally {
      setAiBarModifying(false);
    }
  };

  // ── Status bar: regenerate from template when variables change ──────────
  const regenerateStatusBar = () => {
    if (statusBarStyle && statusBarStyle !== 'ai-custom') {
      let html = generateStatusBarHtml(statusBarStyle, mvu.schemaSections, statusBarTitle);
      // 如果是visual-novel模板，应用用户填写的图片URL
      if (statusBarStyle === 'visual-novel') {
        if (bgImageUrl) {
          html = html.replace(/https:\/\/placehold\.co\/800x400\/ffb6c1\/fff\?background/g, bgImageUrl);
        }
        if (tachieImageUrl) {
          html = html.replace(/https:\/\/placehold\.co\/300x500\/transparent\/fff\?text=立绘/g, tachieImageUrl);
        }
        if (avatarImageUrl) {
          html = html.replace(/https:\/\/placehold\.co\/80x80\/e87a90\/fff\?text=头像/g, avatarImageUrl);
        }
      }
      onChange({ ...mvu, statusBarHtml: html });
    }
  };

  // ── Render: disabled state ─────────────────────────────────────────────
  if (!mvu.enabled) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-[var(--text-color)]">MVU 变量系统</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">基于 tavern-cards MVU 规范，为角色卡定义动态变量追踪系统</p>
          </div>
        </div>
        <div className="text-center py-16 border border-dashed border-[var(--color-border-default)] rounded-xl">
          <p className="text-[var(--color-text-secondary)] mb-4">MVU 变量系统用于追踪角色好感度、场景状态、装备等动态信息</p>
          <p className="text-sm text-[var(--color-text-muted)] mb-6">启用后可在世界书条目中使用 EJS 条件渲染，开场白也可引用变量初始状态</p>
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

    /** 切换变量类型时给出合适的默认初始值 */
    function getInitialValueForType(zodType: string, current: unknown): unknown {
      if (zodType === 'z.coerce.number()') return typeof current === 'number' ? current : 0;
      if (zodType === 'z.boolean()' || zodType === 'z.boolean') return typeof current === 'boolean' ? current : false;
      if (zodType.startsWith('z.enum(')) {
        const match = zodType.match(/z\.enum\(\[([^\]]+)\]\)/);
        if (match) {
          const first = match[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''))[0];
          return first ?? '';
        }
        return '';
      }
      if (zodType.startsWith('z.array(')) return Array.isArray(current) ? current : [];
      if (zodType.startsWith('z.union(')) return current ?? '';
      if (zodType.startsWith('z.object(') || zodType.startsWith('z.record(')) return (current !== null && typeof current === 'object' && !Array.isArray(current)) ? current : {};
      return typeof current === 'string' ? current : '';
    }

    /** 根据变量类型渲染初始值输入控件 */
    function renderInitialValueInput(v: MvuVariable, sectionIdx: number, varIdx: number) {
      if (v.zodType === 'z.boolean()' || v.zodType === 'z.boolean') {
        return (
          <select value={String(v.initialValue ?? false)} onChange={(e) => updateVariable(sectionIdx, varIdx, { initialValue: e.target.value === 'true' })} className={fieldCls}>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        );
      }
      if (v.zodType.startsWith('z.array(')) {
        return <input value={JSON.stringify(v.initialValue ?? [])} onChange={(e) => { try { const parsed = JSON.parse(e.target.value); if (Array.isArray(parsed)) updateVariable(sectionIdx, varIdx, { initialValue: parsed }); } catch { /* ignore invalid JSON */ } }} placeholder='JSON 数组: ["a", "b"]' className={fieldCls} />;
      }
      if (v.zodType.startsWith('z.object(') || v.zodType.startsWith('z.record(')) {
        return <input value={JSON.stringify(v.initialValue ?? {})} onChange={(e) => { try { const parsed = JSON.parse(e.target.value); if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) updateVariable(sectionIdx, varIdx, { initialValue: parsed }); } catch { /* ignore invalid JSON */ } }} placeholder='JSON 对象: {"key": "value"}' className={fieldCls} />;
      }
      if (v.zodType.startsWith('z.union(')) {
        return <input value={String(v.initialValue ?? '')} onChange={(e) => updateVariable(sectionIdx, varIdx, { initialValue: e.target.value })} placeholder="字符串或数字" className={fieldCls} />;
      }
      return <input value={String(v.initialValue ?? '')} onChange={(e) => { let val: unknown = e.target.value; if (v.zodType === 'z.coerce.number()') { const parsed = e.target.value === '' ? 0 : Number(e.target.value); val = Number.isNaN(parsed) ? v.initialValue : parsed; } updateVariable(sectionIdx, varIdx, { initialValue: val }); }} placeholder="0" className={fieldCls} />;
    }

    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-[var(--text-color)]">MVU 变量系统</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">schema.ts · initvar.yaml · 更新规则 · EJS 配置</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" onClick={exportMvuConfig} title="导出当前 MVU 配置为 JSON">📤 导出配置</Button>
            <label className="text-[11px] px-2 py-1 rounded border border-[var(--color-border-default)] hover:border-[var(--input-border)] text-[var(--color-text-secondary)] cursor-pointer transition-colors">
              📥 导入配置
              <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) importMvuConfig(f); e.target.value = ''; }} />
            </label>
            <Button variant="ghost" size="sm" onClick={toggleMode} title="切换到小白模式">
              🔧 切换到小白模式
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleMvu}>禁用 MVU</Button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-4 border-b border-[var(--color-border-default)]">
          {(['schema', 'updateRules', 'ejs', 'output'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
                activeTab === tab ? 'border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] text-[color-mix(in_srgb,var(--color-primary)_80%,var(--text-color))]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}>
              {{ schema: '📐 Schema', updateRules: '📋 更新规则', ejs: '⚡ EJS', output: '📤 输出' }[tab]}
            </button>
          ))}
        </div>

        {/* Schema Tab */}
        {activeTab === 'schema' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                {selectedVariables.size > 0 && (
                  <>
                    <span className="text-xs text-[var(--color-text-secondary)]">已选 {selectedVariables.size} 个变量</span>
                    <Button variant="danger" size="sm" onClick={batchDeleteVariables}>批量删除</Button>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedVariables(new Set())}>取消选择</Button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setShowTemplateMarket(true)}>🏪 应用模板</Button>
                <Button variant="ghost" size="sm" onClick={addSection}>+ 新分区</Button>
              </div>
            </div>

            {/* Section tabs with drag & drop */}
            <div className="flex items-center gap-2 flex-wrap">
              {mvu.schemaSections.map((s, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={() => setDraggedSection(i)}
                  onDragOver={(e) => { e.preventDefault(); setDragOverSection(i); }}
                  onDragLeave={() => setDragOverSection(null)}
                  onDrop={(e) => { e.preventDefault(); if (draggedSection !== null) moveSection(draggedSection, i); setDraggedSection(null); setDragOverSection(null); }}
                  className={`flex items-center gap-1 px-3 py-1 text-xs rounded-lg border transition-colors cursor-move ${
                    i === selectedSection ? 'bg-[color-mix(in_srgb,var(--color-primary)_30%,transparent)] border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] text-[color-mix(in_srgb,var(--color-primary)_80%,var(--text-color))]' : 'border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--input-border)]'
                  } ${dragOverSection === i ? 'ring-2 ring-[var(--color-primary)]' : ''}`}
                >
                  <button onClick={() => setSelectedSection(i)} className="flex items-center gap-1">
                    <span>{expandedSections.has(i) ? '▼' : '▶'}</span>
                    <span>{s.name}</span>
                    {s.variables.length > 0 && <span className="text-[10px] text-[var(--color-text-muted)]">({s.variables.length})</span>}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); toggleSectionExpanded(i); }} className="ml-1 text-[10px] hover:text-[var(--color-primary)]">
                    {expandedSections.has(i) ? '折叠' : '展开'}
                  </button>
                </div>
              ))}
            </div>

            {section && (
              <div className="rounded-xl border border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)] p-4 space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <TextInput label="分区名称" value={section.name} onChange={(e) => updateSection(selectedSection, { name: e.target.value })} placeholder="例如：角色、世界、主角" />
                  <Button variant="ghost" size="sm" onClick={() => duplicateSection(selectedSection)} title="复制分区">📋 复制</Button>
                  {mvu.schemaSections.length > 1 && <Button variant="danger" size="sm" onClick={() => removeSection(selectedSection)}>删除分区</Button>}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[var(--color-text-secondary)]">变量定义</span>
                    <Button variant="secondary" size="sm" onClick={() => addVariable(selectedSection)}>+ 添加变量</Button>
                  </div>
                  {section.variables.length === 0 && <p className="text-xs text-[var(--color-text-muted)] py-4 text-center">暂无变量</p>}
                  {expandedSections.has(selectedSection) && section.variables.map((v, vi) => {
                    const isDuplicate = (pathOccurrences.get(v.path) || 0) > 1;
                    const isSelected = selectedVariables.has(v.path);
                    return (
                      <div
                        key={vi}
                        draggable
                        onDragStart={() => setDraggedVar({ sectionIdx: selectedSection, varIdx: vi })}
                        onDragOver={(e) => { e.preventDefault(); setDragOverVar({ sectionIdx: selectedSection, varIdx: vi }); }}
                        onDragLeave={() => setDragOverVar(null)}
                        onDrop={(e) => { e.preventDefault(); if (draggedVar) moveVariable(draggedVar.sectionIdx, draggedVar.varIdx, selectedSection, vi); setDraggedVar(null); setDragOverVar(null); }}
                        className={`rounded-lg border bg-[color-mix(in_srgb,var(--input-bg)_30%,transparent)] overflow-hidden cursor-move ${
                          isDuplicate ? 'border-[color-mix(in_srgb,var(--color-status-error)_60%,transparent)]' : 'border-[color-mix(in_srgb,var(--color-border-default)_50%,transparent)]'
                        } ${dragOverVar?.sectionIdx === selectedSection && dragOverVar?.varIdx === vi ? 'ring-2 ring-[var(--color-primary)]' : ''}`}
                      >
                        <div className="flex items-center justify-between px-3 py-2 hover:bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)]" onClick={() => toggleExpanded(v.path)}>
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => {
                                setSelectedVariables(prev => {
                                  const next = new Set(prev);
                                  if (next.has(v.path)) next.delete(v.path); else next.add(v.path);
                                  return next;
                                });
                              }}
                              className="cursor-pointer"
                            />
                            <span className="text-xs text-[var(--color-text-muted)]">{expandedVars.has(v.path) ? '▼' : '▶'}</span>
                            <span className={`text-sm font-mono truncate ${isDuplicate ? 'text-[var(--color-status-error)]' : 'text-[var(--text-color)]'}`}>{v.path || '(未命名变量)'}</span>
                            {isDuplicate && <span className="text-[10px] text-[var(--color-status-error)]">路径重复</span>}
                            {v.prefix && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--color-status-warning)_40%,transparent)] text-[var(--color-status-warning)]">{v.prefix}前缀</span>}
                            <span className="text-[10px] text-[var(--color-text-muted)] bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)] px-1.5 py-0.5 rounded">{v.zodType.replace(/\(.*\)/, '(...)')}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); duplicateVariable(selectedSection, vi); }} title="复制变量">📋</Button>
                            <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); removeVariable(selectedSection, vi); }}>×</Button>
                          </div>
                        </div>
                        {expandedVars.has(v.path) && (
                          <div className="px-3 pb-3 space-y-2 border-t border-[color-mix(in_srgb,var(--color-border-default)_30%,transparent)] pt-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className={labelCls}>变量路径</label>
                                <input value={v.path} onChange={(e) => updateVariable(selectedSection, vi, { path: e.target.value })} placeholder="角色.好感度" className={`${fieldCls} ${isDuplicate ? errorCls : ''}`} />
                              </div>
                              <div>
                                <label className={labelCls}>Zod 类型</label>
                                <select value={v.zodType} onChange={(e) => updateVariable(selectedSection, vi, { zodType: e.target.value, initialValue: getInitialValueForType(e.target.value, v.initialValue) })} className={fieldCls}>{ZOD_TYPE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div><label className={labelCls}>可见性前缀</label><select value={v.prefix} onChange={(e) => updateVariable(selectedSection, vi, { prefix: e.target.value as MvuPrefix })} className={fieldCls}>{PREFIX_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label} — {p.desc}</option>)}</select></div>
                              <div><label className={labelCls}>初始值</label>{renderInitialValueInput(v, selectedSection, vi)}</div>
                            </div>
                            <div><label className={labelCls}>描述</label><input value={v.description} onChange={(e) => updateVariable(selectedSection, vi, { description: e.target.value })} placeholder="变量用途说明" className={fieldCls} /></div>
                            {v.zodType === 'z.coerce.number()' && (
                              <div className="grid grid-cols-2 gap-2">
                                <div><label className={labelCls}>最小值</label><input type="number" value={v.range?.min ?? 0} onChange={(e) => { const parsed = Number(e.target.value); updateVariable(selectedSection, vi, { range: { min: Number.isNaN(parsed) ? (v.range?.min ?? 0) : parsed, max: v.range?.max ?? 100 } }); }} className={fieldCls} /></div>
                                <div><label className={labelCls}>最大值</label><input type="number" value={v.range?.max ?? 100} onChange={(e) => { const parsed = Number(e.target.value); updateVariable(selectedSection, vi, { range: { min: v.range?.min ?? 0, max: Number.isNaN(parsed) ? (v.range?.max ?? 100) : parsed } }); }} className={fieldCls} /></div>
                              </div>
                            )}
                            {v.zodType.startsWith('z.enum(') && (
                              <div><label className={labelCls}>枚举值 (逗号分隔)</label><input value={v.enumValues?.join(', ') ?? ''} onChange={(e) => { const values = e.target.value.split(',').map(s => s.trim()).filter(Boolean); updateVariable(selectedSection, vi, { enumValues: values }); }} placeholder="开心, 正常, 低落" className={fieldCls} /></div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Template market modal */}
            {showTemplateMarket && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="w-full max-w-2xl max-h-[80vh] overflow-auto rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-raised)] p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-[var(--text-color)]">🏪 模板市场</h3>
                    <Button variant="danger" size="sm" onClick={() => setShowTemplateMarket(false)}>×</Button>
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)]">选择一个模板追加到当前配置。已存在的变量路径不会被重复添加。</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {EXPERT_TEMPLATES.map(tmpl => (
                      <div key={tmpl.id} className="rounded-xl border border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)] p-3 text-left">
                        <div className="text-2xl mb-1">{tmpl.icon}</div>
                        <div className="text-sm font-medium text-[var(--text-color)]">{tmpl.name}</div>
                        <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{tmpl.description}</div>
                        <div className="mt-2 flex gap-1">
                          <Button variant="secondary" size="sm" onClick={() => applyExpertTemplate(tmpl, false)}>追加</Button>
                          <Button variant="ghost" size="sm" onClick={() => applyExpertTemplate(tmpl, true)}>覆盖</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Update Rules Tab */}
        {activeTab === 'updateRules' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-[var(--color-text-secondary)]">告诉 AI 如何更新变量。自明变量不需写规则。</p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={handleAiGenerateRules} disabled={aiRuleGenerating}>
                  {aiRuleGenerating ? '⏳ AI 生成中' : '🤖 AI 生成规则'}
                </Button>
                <Button variant="secondary" size="sm" onClick={addUpdateRule}>+ 添加规则</Button>
              </div>
            </div>

            {typeMismatchedRules.length > 0 && (
              <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-status-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-status-warning)_10%,transparent)] p-3">
                <p className="text-xs text-[var(--color-status-warning)] mb-1">⚠️ 规则类型与变量类型可能不匹配：</p>
                <ul className="text-[11px] text-[var(--color-status-warning)] list-disc list-inside">
                  {typeMismatchedRules.map(m => (<li key={m.path}>{m.path}：规则类型「{m.ruleType}」与变量类型「{m.varType}」不一致</li>))}
                </ul>
              </div>
            )}

            {/* Auto-suggest: variables without rules */}
            {mvu.schemaSections.flatMap(s => s.variables).filter(v => v.prefix !== '$' && !mvu.updateRules.some(r => r.path === v.path)).length > 0 && (
              <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-status-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-status-warning)_10%,transparent)] p-3">
                <p className="text-xs text-[var(--color-status-warning)] mb-2">💡 以下变量尚无更新规则：</p>
                <div className="flex flex-wrap gap-1.5">
                  {mvu.schemaSections.flatMap(s => s.variables).filter(v => v.prefix !== '$' && !mvu.updateRules.some(r => r.path === v.path)).map(v => (
                    <button
                      key={v.path}
                      onClick={() => {
                        const inferred = inferVariableType(v.zodType);
                        const preset = CHECK_RULE_PRESETS.find(p => p.type === inferred) || CHECK_RULE_PRESETS.find(p => p.type === 'string');
                        const newRule: MvuUpdateRule = {
                          path: v.path,
                          type: inferred,
                          range: inferred === 'number' ? `${v.range?.min ?? 0}~${v.range?.max ?? 100}` : undefined,
                          check: preset ? [...preset.check] : [],
                        };
                        onChange({ ...mvu, updateRules: [...mvu.updateRules, newRule] });
                      }}
                      className="text-[11px] px-2 py-1 rounded border border-[color-mix(in_srgb,var(--color-status-warning)_40%,transparent)] text-[var(--color-status-warning)] hover:bg-[color-mix(in_srgb,var(--color-status-warning)_20%,transparent)] transition-colors"
                    >
                      + {v.path}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mvu.updateRules.length === 0 && <p className="text-xs text-[var(--color-text-muted)] py-8 text-center">暂无更新规则</p>}
            {mvu.updateRules.map((rule, ri) => (
              <div key={ri} className={`rounded-xl border bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)] p-4 space-y-3 ${invalidRulePaths.has(rule.path) ? 'border-[color-mix(in_srgb,var(--color-status-error)_60%,transparent)]' : 'border-[var(--color-border-default)]'}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-mono ${invalidRulePaths.has(rule.path) ? 'text-[var(--color-status-error)]' : 'text-[color-mix(in_srgb,var(--color-primary)_80%,var(--text-color))]'}`}>
                    {rule.path || '(新规则)'}
                    {invalidRulePaths.has(rule.path) && <span className="ml-2 text-[10px]">变量路径不存在</span>}
                  </span>
                  <Button variant="danger" size="sm" onClick={() => removeUpdateRule(ri)}>×</Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>变量路径</label>
                    <select value={rule.path} onChange={(e) => {
                      const newPath = e.target.value;
                      const matchedVar = mvu.schemaSections.flatMap(s => s.variables).find(v => v.path === newPath);
                      const inferredType = matchedVar ? inferVariableType(matchedVar.zodType) : rule.type;
                      const inferredRange = matchedVar?.range ? `${matchedVar.range.min}~${matchedVar.range.max}` : rule.range;
                      updateUpdateRule(ri, { path: newPath, type: rule.type || inferredType, range: rule.range || inferredRange });
                    }} className={`${fieldCls} ${invalidRulePaths.has(rule.path) ? errorCls : ''}`}>
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
                      }} className="text-[11px] rounded border border-[var(--input-border)] bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[var(--color-text-secondary)]">
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
              <p className="text-sm text-[var(--color-text-secondary)]">配置世界书条目的 EJS 动态渲染。</p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={handleAiGenerateEjs} disabled={aiEjsGenerating || selectedEjsEntries.size === 0}>
                  {aiEjsGenerating ? '⏳ AI 生成中' : '🤖 AI 生成 EJS'}
                </Button>
                <Button variant="secondary" size="sm" onClick={addEjsConfig}>+ 添加 EJS 配置</Button>
              </div>
            </div>

            {/* Entry selector for AI generation */}
            <div className="rounded-lg border border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)] p-3">
              <p className="text-xs text-[var(--color-text-secondary)] mb-2">选择要应用 EJS 的世界书条目（用于 AI 生成）：</p>
              <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto">
                {lorebookEntries.length === 0 && <span className="text-[11px] text-[var(--color-text-muted)]">暂无世界书条目</span>}
                {lorebookEntries.map(e => {
                  const checked = selectedEjsEntries.has(e.id);
                  return (
                    <label key={e.id} className={`text-[11px] px-2 py-1 rounded border cursor-pointer transition-colors select-none ${
                      checked
                        ? 'border-[color-mix(in_srgb,var(--color-status-success)_50%,transparent)] bg-[color-mix(in_srgb,var(--color-status-success)_30%,transparent)] text-[var(--color-status-success)]'
                        : 'border-[color-mix(in_srgb,var(--input-border)_50%,transparent)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)]'
                    }`}>
                      <input type="checkbox" className="sr-only" checked={checked} onChange={() => {
                        setSelectedEjsEntries(prev => {
                          const next = new Set(prev);
                          if (next.has(e.id)) next.delete(e.id); else next.add(e.id);
                          return next;
                        });
                      }} />
                      {e.name || e.comment || `条目 ${e.id}`}
                    </label>
                  );
                })}
              </div>
            </div>

            {invalidEjsVarNames.size > 0 && (
              <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-status-error)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-status-error)_10%,transparent)] p-3">
                <p className="text-xs text-[var(--color-status-error)]">❌ 以下 EJS 使用的变量未在 schema 中定义：{Array.from(invalidEjsVarNames).join(', ')}</p>
              </div>
            )}

            {mvu.ejsConfigs.length === 0 && <p className="text-xs text-[var(--color-text-muted)] py-8 text-center">暂无 EJS 配置</p>}
            {mvu.ejsConfigs.map((cfg, ci) => (
              <div key={ci} className="rounded-xl border border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)] p-4 space-y-3">
                <div className="flex items-center justify-between"><span className="text-sm font-mono text-[var(--color-status-success)]">EJS 配置 #{ci + 1}</span><Button variant="danger" size="sm" onClick={() => removeEjsConfig(ci)}>×</Button></div>
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
                      const isInvalid = invalidEjsVarNames.has(varName);
                      return (
                        <label key={varName} className={`text-[11px] px-2 py-1 rounded border cursor-pointer transition-colors select-none ${
                          isInvalid
                            ? 'border-[color-mix(in_srgb,var(--color-status-error)_60%,transparent)] bg-[color-mix(in_srgb,var(--color-status-error)_20%,transparent)] text-[var(--color-status-error)]'
                            : isChecked
                              ? 'border-[color-mix(in_srgb,var(--color-status-success)_50%,transparent)] bg-[color-mix(in_srgb,var(--color-status-success)_30%,transparent)] text-[var(--color-status-success)]'
                              : 'border-[color-mix(in_srgb,var(--input-border)_50%,transparent)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)]'
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
                  <p className="text-[10px] text-[var(--color-text-muted)] mt-1">这些变量名将在 EJS 预处理中通过 define() 注册</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Output Tab */}
        {activeTab === 'output' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between"><p className="text-sm text-[var(--color-text-secondary)]">预览生成的 MVU 文件内容（修改变量后自动同步更新）。</p><Button onClick={generateAll}>🔄 强制重新生成</Button></div>

            {/* Status bar preview */}
            <details open className="rounded-xl border border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-primary)_20%,transparent)] overflow-hidden">
              <summary className="px-4 py-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-sm font-medium text-[var(--color-primary)]">🎨 状态栏实时预览</summary>
              <div className="px-4 pb-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input value={statusBarTitle} onChange={(e) => { setStatusBarTitle(e.target.value); if (statusBarStyle !== 'ai-custom') { const html = generateStatusBarHtml(statusBarStyle, mvu.schemaSections, e.target.value); onChange({ ...mvu, statusBarHtml: html }); } }} placeholder="状态栏标题" className={fieldCls} />
                  <select value={statusBarStyle} onChange={(e) => applyStatusBarTemplate(e.target.value)} className={fieldCls}>
                    {STATUS_BAR_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    <option value="ai-custom">AI/手动定制</option>
                  </select>
                </div>
                <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-border-default)_50%,transparent)] bg-[color-mix(in_srgb,var(--input-bg)_40%,transparent)] p-4">
                  <div className="w-full" dangerouslySetInnerHTML={{ __html: statusBarPreviewHtml }} />
                </div>
              </div>
            </details>

            <details className="rounded-xl border border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)] overflow-hidden"><summary className="px-4 py-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-surface-raised)_30%,transparent)] text-sm font-medium text-[color-mix(in_srgb,var(--color-primary)_80%,var(--text-color))]">📐 schema.ts</summary><pre className="px-4 pb-3 text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto font-mono">{mvu.schemaTsContent || '(请先添加变量分区和变量)'}</pre></details>
            <details className="rounded-xl border border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)] overflow-hidden"><summary className="px-4 py-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-surface-raised)_30%,transparent)] text-sm font-medium text-[var(--color-status-warning)]">📋 initvar.yaml</summary><pre className="px-4 pb-3 text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto font-mono">{mvu.initvarYamlContent || '(请先添加变量分区和变量)'}</pre></details>
            <details className="rounded-xl border border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)] overflow-hidden"><summary className="px-4 py-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-surface-raised)_30%,transparent)] text-sm font-medium text-[var(--color-status-success)]">📋 变量更新规则.yaml</summary><pre className="px-4 pb-3 text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto font-mono">{mvu.updateRulesYamlContent || '(请先添加更新规则)'}</pre></details>
            <details className="rounded-xl border border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)] overflow-hidden"><summary className="px-4 py-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-surface-raised)_30%,transparent)] text-sm font-medium text-[var(--color-info)]">⚡ EJS 预处理</summary><pre className="px-4 pb-3 text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto font-mono">{mvu.ejsPreprocessContent || '(未配置 EJS 条目或使用的变量为空)'}</pre></details>
            {mvu.schemaTsContent && <details className="rounded-xl border border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)] overflow-hidden"><summary className="px-4 py-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-surface-raised)_30%,transparent)] text-sm font-medium text-[var(--color-primary)]">🔧 Zod.txt (SillyTavern 运行时)</summary><pre className="px-4 pb-3 text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap overflow-x-auto max-h-[300px] overflow-y-auto font-mono">{buildZodTxt(mvu.schemaTsContent)}</pre></details>}
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
            <h2 className="text-xl font-bold text-[var(--text-color)]">MVU 变量系统</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              <span className="text-[var(--color-status-success)]">小白模式</span> — 预设模板 + AI 辅助，无需懂代码
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
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-status-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-status-success)_20%,transparent)] p-4 mb-4">
          <h3 className="text-sm font-bold text-[var(--color-status-success)] mb-3">📋 第一步：选择场景模板</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {BEGINNER_TEMPLATES.map(tmpl => (
              <button
                key={tmpl.id}
                onClick={() => handleApplyTemplate(tmpl.id)}
                className={`rounded-xl border p-3 text-left transition-all hover:border-[color-mix(in_srgb,var(--color-status-success)_50%,transparent)] ${
                  selectedTemplate === tmpl.id
                    ? 'border-[var(--color-status-success)] bg-[color-mix(in_srgb,var(--color-status-success)_30%,transparent)]'
                    : 'border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)]'
                }`}
              >
                <div className="text-2xl mb-1">{tmpl.icon}</div>
                <div className="text-sm font-medium text-[var(--text-color)]">{tmpl.name}</div>
                <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{tmpl.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: AI generate or manual tweak */}
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-status-warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-status-warning)_20%,transparent)] p-4 mb-4">
          <h3 className="text-sm font-bold text-[var(--color-status-warning)] mb-3">🤖 第二步：AI 生成（可选）</h3>
          <p className="text-xs text-[var(--color-status-warning)] mb-2">
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
          <div className="mt-3 pt-3 border-t border-[color-mix(in_srgb,var(--color-status-warning)_20%,transparent)]">
            <p className="text-xs text-[var(--color-status-warning)] mb-2">
              多角色卡？可直接为每个角色套用纯爱 / NTR / 双路线模板，并统一生成阶段轴。
            </p>
            <Button variant="secondary" size="sm" onClick={() => setShowMultiCharModal(true)}>
              👥 {t('multiCharTemplate.entryButton')}
            </Button>
          </div>
        </div>

        {/* Step 3: Variable cards */}
        {hasVariables && (
          <div className="rounded-xl border border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)] p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[var(--text-color)]">📐 变量列表 ({totalVars}个)</h3>
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
                    className="text-sm font-medium text-[color-mix(in_srgb,var(--color-primary)_80%,var(--text-color))] bg-transparent border-b border-transparent hover:border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] focus:border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] focus:outline-none px-1"
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
                    const typeBadgeColor = isNumber ? 'bg-[color-mix(in_srgb,var(--color-status-success)_40%,transparent)] text-[var(--color-status-success)]' : isEnum ? 'bg-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] text-[var(--color-primary)]' : 'bg-[color-mix(in_srgb,var(--color-info)_40%,transparent)] text-[var(--color-info)]';
                    return (
                      <div key={vi} className="rounded-lg border border-[color-mix(in_srgb,var(--color-border-default)_50%,transparent)] bg-[color-mix(in_srgb,var(--input-bg)_30%,transparent)] overflow-hidden">
                        {/* Collapsed row */}
                        <div
                          className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)] transition-colors"
                          onClick={() => toggleExpanded(v.path)}
                        >
                          <span className="text-[10px] text-[var(--color-text-muted)]">{isExpanded ? '▼' : '▶'}</span>
                          <span className="text-sm font-mono text-[var(--text-color)] truncate flex-1 min-w-0">{v.path.split('.').pop()}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeBadgeColor}`}>{typeLabel}</span>
                          {v.prefix && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--color-status-warning)_40%,transparent)] text-[var(--color-status-warning)]">{v.prefix}前缀</span>}
                          <input
                            value={String(v.initialValue ?? '')}
                            onChange={(e) => {
                              let val: unknown = e.target.value;
                              if (isNumber) {
                                const parsed = e.target.value === '' ? 0 : Number(e.target.value);
                                val = Number.isNaN(parsed) ? v.initialValue : parsed;
                              }
                              updateVariable(si, vi, { initialValue: val });
                            }}
                            className="w-16 text-center rounded border border-[var(--input-border)] bg-[var(--color-surface-raised)] text-xs text-[color-mix(in_srgb,var(--color-primary)_80%,var(--text-color))] py-0.5"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); removeVariable(si, vi); }}>×</Button>
                        </div>
                        {/* Expanded editor */}
                        {isExpanded && (
                          <div className="px-3 pb-3 space-y-2 border-t border-[color-mix(in_srgb,var(--color-border-default)_30%,transparent)] pt-2">
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
                                <div><label className={labelCls}>最小值</label><input type="number" value={v.range?.min ?? 0} onChange={(e) => { const parsed = Number(e.target.value); updateVariable(si, vi, { range: { min: Number.isNaN(parsed) ? (v.range?.min ?? 0) : parsed, max: v.range?.max ?? 100 } }); }} className={fieldCls} /></div>
                                <div><label className={labelCls}>最大值</label><input type="number" value={v.range?.max ?? 100} onChange={(e) => { const parsed = Number(e.target.value); updateVariable(si, vi, { range: { min: v.range?.min ?? 0, max: Number.isNaN(parsed) ? (v.range?.max ?? 100) : parsed } }); }} className={fieldCls} /></div>
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
            <div className="mt-3 pt-3 border-t border-[color-mix(in_srgb,var(--color-border-default)_50%,transparent)]">
              <details className="rounded-lg border border-[color-mix(in_srgb,var(--color-status-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-status-success)_10%,transparent)]">
                <summary className="px-3 py-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-status-success)_10%,transparent)] text-xs font-medium text-[var(--color-status-success)] flex items-center gap-1.5">
                  📚 一键添加常用变量
                  <span className="text-[var(--color-status-success)]">点击展开</span>
                </summary>
                <div className="px-3 pb-3 space-y-2">
                  {VARIABLE_PRESETS.map(presetCat => (
                    <div key={presetCat.category}>
                      <div className="text-[10px] text-[var(--color-text-muted)] mb-1">{presetCat.category}</div>
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
                                  ? 'border-[color-mix(in_srgb,var(--color-border-default)_30%,transparent)] text-[var(--color-text-muted)] cursor-not-allowed'
                                  : 'border-[color-mix(in_srgb,var(--input-border)_50%,transparent)] text-[var(--color-text-secondary)] hover:border-[color-mix(in_srgb,var(--color-status-success)_50%,transparent)] hover:text-[var(--color-status-success)] hover:bg-[color-mix(in_srgb,var(--color-status-success)_20%,transparent)]'
                              }`}
                              title={alreadyExists ? '已存在' : `添加 ${preset.path}`}
                            >
                              {preset.path.split('.').pop()}
                              {alreadyExists && <span className="ml-0.5 text-[var(--color-text-muted)]">✓</span>}
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
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-primary)_20%,transparent)] p-4 mb-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[var(--color-primary)]">🎨 状态栏美化</h3>
                <span className="rounded border border-[color-mix(in_srgb,var(--color-primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--color-primary)]">{statusBarModeLabel}</span>
              </div>
              <p className="mt-1 text-[10px] text-[var(--color-primary)]">{statusBarModeHint}</p>
            </div>
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
            <label className="text-xs text-[var(--color-text-secondary)] mb-1.5 block">选择风格模板</label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {STATUS_BAR_TEMPLATES.map(tmpl => (
                <button
                  key={tmpl.id}
                  onClick={() => applyStatusBarTemplate(tmpl.id)}
                  className={`rounded-lg border p-2 text-center transition-all ${
                    statusBarStyle === tmpl.id
                      ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_40%,transparent)]'
                      : 'border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)] hover:border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)]'
                  }`}
                  title={tmpl.description}
                >
                  <div className="text-lg">{tmpl.icon}</div>
                  <div className="text-[10px] text-[var(--color-text-secondary)] mt-0.5">{tmpl.name}</div>
                </button>
              ))}
              {mvu.statusBarStyle === 'ai-custom' && (
                <div className="rounded-lg border border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] p-2 text-center">
                  <div className="text-lg">🤖</div>
                  <div className="text-[10px] text-[var(--color-primary)] mt-0.5">AI 定制</div>
                </div>
              )}
            </div>
          </div>

          {/* Visual Novel 图片配置 - 仅在选择visual-novel模板时显示 */}
          {statusBarStyle === 'visual-novel' && (
            <div className="mb-3 rounded-lg border border-[color-mix(in_srgb,var(--color-primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] p-3">
              <label className="text-xs text-[var(--color-primary)] mb-1.5 block">🖼️ 图片配置（可选，留空使用占位图）</label>
              <p className="text-[10px] text-[var(--color-primary)] mb-2">外部图片依赖网络环境，导入 SillyTavern 后可能因跨域或资源失效而无法显示。</p>
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-[var(--color-text-muted)] mb-0.5 block">背景图 URL</label>
                  <input
                    value={bgImageUrl}
                    onChange={(e) => {
                      setBgImageUrl(e.target.value);
                      const html = generateStatusBarHtml(statusBarStyle, mvu.schemaSections, statusBarTitle)
                        .replace(/https:\/\/placehold\.co\/800x400\/ffb6c1\/fff\?background/g, e.target.value || 'https://placehold.co/800x400/ffb6c1/fff?background');
                      onChange({ ...mvu, statusBarHtml: html });
                    }}
                    placeholder="https://example.com/background.jpg"
                    className={fieldCls}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--color-text-muted)] mb-0.5 block">角色立绘 URL</label>
                  <input
                    value={tachieImageUrl}
                    onChange={(e) => {
                      setTachieImageUrl(e.target.value);
                      const html = generateStatusBarHtml(statusBarStyle, mvu.schemaSections, statusBarTitle)
                        .replace(/https:\/\/placehold\.co\/300x500\/transparent\/fff\?text=立绘/g, e.target.value || 'https://placehold.co/300x500/transparent/fff?text=立绘');
                      onChange({ ...mvu, statusBarHtml: html });
                    }}
                    placeholder="https://example.com/character.png"
                    className={fieldCls}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--color-text-muted)] mb-0.5 block">头像 URL</label>
                  <input
                    value={avatarImageUrl}
                    onChange={(e) => {
                      setAvatarImageUrl(e.target.value);
                      const html = generateStatusBarHtml(statusBarStyle, mvu.schemaSections, statusBarTitle)
                        .replace(/https:\/\/placehold\.co\/80x80\/e87a90\/fff\?text=头像/g, e.target.value || 'https://placehold.co/80x80/e87a90/fff?text=头像');
                      onChange({ ...mvu, statusBarHtml: html });
                    }}
                    placeholder="https://example.com/avatar.jpg"
                    className={fieldCls}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Title input */}
          <div className="mb-3">
            <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">状态栏标题</label>
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
          <div className="mb-3 rounded-lg border border-[color-mix(in_srgb,var(--color-status-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-status-warning)_10%,transparent)] p-3">
            <label className="text-xs text-[var(--color-status-warning)] mb-1.5 block">🤖 AI 生成状态栏（可选）</label>
            <p className="text-[10px] text-[var(--color-status-warning)] mb-2">
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

          {/* AI modify */}
          <div className="mb-3 rounded-lg border border-[color-mix(in_srgb,var(--color-info)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-info)_10%,transparent)] p-3">
            <label className="text-xs text-[var(--color-info)] mb-1.5 block">✏️ AI 修改状态栏（可选）</label>
            <p className="text-[10px] text-[var(--color-info)] mb-2">
              用自然语言描述想怎么改当前状态栏，AI 会在保留变量宏的基础上调整样式和布局
            </p>
            <div className="flex gap-2">
              <input
                value={aiBarModifyInstruction}
                onChange={(e) => setAiBarModifyInstruction(e.target.value)}
                placeholder="例如：把标题居中、加大字号、给进度条加圆角、换成粉色系"
                className={fieldCls}
              />
              <Button
                onClick={handleAiModifyStatusBar}
                disabled={aiBarModifying || mvu.schemaSections.length === 0 || !(mvu.statusBarHtml || statusBarHtml)}
                variant="secondary"
                size="sm"
              >
                {aiBarModifying ? '⏳ 修改中' : '✏️ AI 修改'}
              </Button>
            </div>
          </div>

          {/* Preview or Code view */}
          {showBarCode ? (
            <div>
              <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">HTML 代码（可手动编辑）</label>
              <textarea
                value={mvu.statusBarHtml || statusBarHtml}
                onChange={(e) => onChange({ ...mvu, statusBarHtml: e.target.value, statusBarStyle: 'ai-custom' })}
                rows={10}
                className="w-full rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1 text-xs text-[var(--color-text-secondary)] font-mono"
                placeholder="状态栏 HTML 代码..."
              />
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                提示：编辑时用 <code className="text-[var(--color-status-warning)]">{'{{getvar::stat_data.路径}}'}</code> 宏读取变量，导出时会自动转换为 SillyTavern 可显示的宏。
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-border-default)_50%,transparent)] bg-[color-mix(in_srgb,var(--input-bg)_40%,transparent)] p-4">
              <div className="w-full" dangerouslySetInnerHTML={{ __html: statusBarPreviewHtml }} />
            </div>
          )}

          <p className="text-[10px] text-[var(--color-primary)] mt-3 text-center">
            导出时状态栏 HTML 会通过 regex_scripts 替换 first_mes 中的占位符，在 SillyTavern 前端显示
          </p>
        </div>

        {/* Generated code preview — auto-synced */}
        {mvu.schemaTsContent && (
          <details className="rounded-xl border border-[var(--color-border-default)] bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)] overflow-hidden">
            <summary className="px-4 py-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-surface-raised)_30%,transparent)] text-sm font-medium text-[var(--color-text-secondary)]">
              🔧 查看生成的代码 (schema.ts + initvar.yaml + 更新规则) — 自动同步
            </summary>
            <div className="px-4 pb-3 space-y-2">
              <pre className="text-xs text-[var(--color-text-secondary)] bg-[color-mix(in_srgb,var(--input-bg)_50%,transparent)] p-2 rounded max-h-[200px] overflow-y-auto font-mono whitespace-pre-wrap">{mvu.schemaTsContent || '(空)'}</pre>
              <pre className="text-xs text-[var(--color-text-secondary)] bg-[color-mix(in_srgb,var(--input-bg)_50%,transparent)] p-2 rounded max-h-[200px] overflow-y-auto font-mono whitespace-pre-wrap">{mvu.initvarYamlContent || '(空)'}</pre>
              <pre className="text-xs text-[var(--color-text-secondary)] bg-[color-mix(in_srgb,var(--input-bg)_50%,transparent)] p-2 rounded max-h-[200px] overflow-y-auto font-mono whitespace-pre-wrap">{mvu.updateRulesYamlContent || '(空)'}</pre>
            </div>
          </details>
        )}

        {/* 多角色套模板弹窗 */}
        <MultiCharTemplateModal
          isOpen={showMultiCharModal}
          onClose={() => setShowMultiCharModal(false)}
          cardName={cardName}
          lorebookEntries={lorebookEntries}
          onApplyMvu={(newMvu) => {
            onChange(newMvu);
          }}
          onApplyStageAxes={onApplyStageAxes}
        />
      </div>
    );
  }
}