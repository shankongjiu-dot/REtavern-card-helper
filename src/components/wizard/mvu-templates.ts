/**
 * mvu-templates - Static template data and preset definitions for the MVU variable system.
 *
 * Extracted from StepMvuVariables.tsx to reduce file size and improve maintainability.
 */
import type {
  MvuSchemaSection,
  MvuUpdateRule,
  MvuPrefix,
} from '../../constants/defaults';

// ── Beginner mode preset templates ──────────────────────────────────────────

export interface BeginnerTemplate {
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

export const BEGINNER_TEMPLATES: BeginnerTemplate[] = [
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

export interface VariablePreset {
  path: string;
  zodType: string;
  description: string;
  prefix: MvuPrefix;
  initialValue: unknown;
  range?: { min: number; max: number };
  enumValues?: string[];
}

// ── Expert mode template market ─────────────────────────────────────────────

export interface ExpertTemplate {
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
export const EXPERT_TEMPLATES: ExpertTemplate[] = [
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
export const VARIABLE_PRESETS: { category: string; items: VariablePreset[] }[] = [
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
export const CHECK_RULE_PRESETS: { type: string; label: string; check: string[] }[] = [
  { type: 'number', label: '好感度类', check: ['正面互动增加，负面互动减少，单次变化 ±(3~8)'] },
  { type: 'number', label: 'HP/资源类', check: ['消耗减少，休息/治疗恢复，变化不超过当前值 30%'] },
  { type: 'number', label: '等级/经验值', check: ['完成重大事件后提升'] },
  { type: 'number', label: '声望类', check: ['正面行为增加，负面行为减少'] },
  { type: 'string', label: '场景切换', check: ['根据角色移动或场景推进更新'] },
  { type: 'string', label: '情绪/心情', check: ['根据当前场景和对话内容更新'] },
  { type: 'string', label: '关系阶段', check: ['根据互动频率和好感度阈值推进'] },
  { type: 'string', label: '时间流转', check: ['根据事件推进自然流转'] },
];
