/**
 * MultiCharTemplateModal - 多角色套模板生成器
 *
 * 流程：
 *   1. 选择模板（纯爱 / NTR / 可纯爱可NTR）
 *   2. AI 读世界书识别候选角色
 *   3. 用户勾选确认要套用的角色
 *   4. 为每个角色套用模板，生成「角色名前缀」变量组 + 阶段轴预览
 *      - 支持 AI 生成
 *      - 也支持一键直接复制模板变量组
 *   5. 在预览中可修改变量路径、描述、初始值、范围
 *   6. 应用到 MVU 配置
 */
import { useState } from 'react';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { useToast } from '../shared/Toast';
import { useTranslation } from '../../i18n/I18nContext';
import { useAIGenerate } from '../../hooks/useAIGenerate';
import { themeAlpha } from '../../constants/theme';
import { AIProgressPanel, type AIProgressStatus } from '../shared/AIProgressPanel';
import {
  buildSchemaTs,
  buildInitvarYaml,
  buildUpdateRulesYaml,
  buildEjsPreprocess,
  parseRangeString,
} from '../../services/mvu-builder';
import type { MvuConfig, MvuSchemaSection, MvuVariable, MvuUpdateRule, MvuPrefix, LorebookEntry } from '../../constants/defaults';

/** 多角色模板选项 */
const TEMPLATE_OPTIONS = [
  { id: 'pure-love', name: '甜宠纯爱', icon: '💕' },
  { id: 'ntr', name: '虐恋NTR', icon: '🖤' },
  { id: 'dual-route', name: '可纯爱可NTR', icon: '🔀' },
] as const;

/** 多角色模板结构化定义（用于「一键套用模板」和构建 AI 蓝图） */
interface MultiCharTemplate {
  id: string;
  name: string;
  icon: string;
  /** 阶段轴变量的默认名称，用户可在预览中修改 */
  defaultAxisName: string;
  /** 构建某个角色的变量分区 */
  buildSection: (charName: string) => MvuSchemaSection;
  /** 构建某个角色的更新规则 */
  buildRules: (charName: string) => MvuUpdateRule[];
  statusBarTitle: string;
  statusBarVars: string[];
}

const MULTI_CHAR_TEMPLATES: MultiCharTemplate[] = [
  {
    id: 'pure-love',
    name: '甜宠纯爱',
    icon: '💕',
    defaultAxisName: '情感天平',
    buildSection: (charName: string): MvuSchemaSection => ({
      name: charName,
      variables: [
        {
          path: `${charName}.情感天平`,
          zodType: 'z.coerce.number()',
          description: '对主角的情感倾向：0=初识，100=深爱，单调递增（只升不降）',
          prefix: '',
          initialValue: 0,
          range: { min: 0, max: 100 },
          categories: [
            { range: '>= 90', label: '深爱' },
            { range: '>= 75', label: '恋人' },
            { range: '>= 60', label: '暧昧' },
            { range: '>= 40', label: '朋友' },
            { range: '>= 20', label: '认识' },
            { range: '>= 0', label: '陌生人' },
          ],
        },
      ],
    }),
    buildRules: (charName: string): MvuUpdateRule[] => [
      {
        path: `${charName}.情感天平`,
        type: 'number',
        range: '0~100',
        check: [
          '正面互动 +(3~8)，特殊事件（送礼/告白） +(10~20)',
          '只增不减，单调递增，达到阈值自动推进阶段',
        ],
      },
    ],
    statusBarTitle: '💕 纯爱情感',
    statusBarVars: ['{charName}.情感天平'],
  },
  {
    id: 'ntr',
    name: '虐恋NTR',
    icon: '🖤',
    defaultAxisName: '情感天平',
    buildSection: (charName: string): MvuSchemaSection => ({
      name: charName,
      variables: [
        {
          path: `${charName}.情感天平`,
          zodType: 'z.coerce.number()',
          description: '情感堕落程度：0=纯洁，100=沉沦，单调递增（只增不减）',
          prefix: '',
          initialValue: 0,
          range: { min: 0, max: 100 },
          categories: [
            { range: '>= 95', label: '毁灭' },
            { range: '>= 70', label: '沉沦' },
            { range: '>= 40', label: '沦陷' },
            { range: '>= 20', label: '动摇' },
            { range: '>= 0', label: '压抑' },
          ],
        },
      ],
    }),
    buildRules: (charName: string): MvuUpdateRule[] => [
      {
        path: `${charName}.情感天平`,
        type: 'number',
        range: '0~100',
        check: [
          '被动事件/胁迫 +(5~15)，主动堕落 +(3~8)',
          '只增不减，单调递增，达到阈值自动推进阶段',
        ],
      },
    ],
    statusBarTitle: '🖤 堕落情感',
    statusBarVars: ['{charName}.情感天平'],
  },
  {
    id: 'dual-route',
    name: '可纯爱可NTR',
    icon: '🔀',
    defaultAxisName: '情感天平',
    buildSection: (charName: string): MvuSchemaSection => ({
      name: charName,
      variables: [
        {
          path: `${charName}.情感天平`,
          zodType: 'z.coerce.number()',
          description: '情感倾向核心变量：>0 偏向纯爱主角，<0 偏向 NTR 第三者，0 附近为缓冲带',
          prefix: '',
          initialValue: 0,
          range: { min: -100, max: 100 },
          categories: [
            { range: '>= 100', label: '纯爱·至死不渝' },
            { range: '>= 80', label: '纯爱·深爱' },
            { range: '>= 50', label: '纯爱·恋人' },
            { range: '>= 20', label: '纯爱·暧昧' },
            { range: '>= -20', label: '中立·缓冲带' },
            { range: '>= -50', label: 'NTR·动摇' },
            { range: '>= -80', label: 'NTR·沦陷' },
            { range: '>= -100', label: 'NTR·沉沦' },
          ],
        },
        {
          path: `${charName}.恶堕事件玩家方`,
          zodType: 'z.boolean()',
          description: '隐藏标记：玩家方触发恶堕事件（如主角背叛/伤害女主/主动把她推向他人等），一次性大幅拉低情感天平后锁定，防止重复触发',
          prefix: '$',
          initialValue: false,
        },
        {
          path: `${charName}.被强制恶堕`,
          zodType: 'z.boolean()',
          description: '隐藏标记：女主被胁迫/强制发生恶堕事件（如被下药、被威胁、被强迫等），一次性大幅拉低情感天平后锁定，防止重复触发',
          prefix: '$',
          initialValue: false,
        },
      ],
    }),
    buildRules: (charName: string): MvuUpdateRule[] => [
      {
        path: `${charName}.情感天平`,
        type: 'number',
        range: '-100~100',
        check: [
          '纯爱侧：主角真诚关心/保护/尊重/亲密/共同回忆，或女主主动靠近 → +3~15',
          'NTR侧（敌人受益的"正面"互动）：主角帮情敌/向威胁屈服/牺牲女主利益/让女主单独面对威胁/敌人 → -5~20',
          'NTR侧（主角负面行为）：主角欺骗/背叛/冷落/主动伤害/暴力 → -5~20',
          '缓冲带：当前值在 -20~20 时，日常互动只 ±1~3；只有明确指向纯爱或NTR的情节才允许 ±5~15 跨区',
          `特殊事件：若「玩家方触发恶堕事件（背叛/伤害/主动推向他人）」且 ${charName}.恶堕事件玩家方=false，则一次性 -30~-50 并将 ${charName}.恶堕事件玩家方 设为 true`,
          `特殊事件：若「女主被胁迫/强制发生恶堕事件」且 ${charName}.被强制恶堕=false，则一次性 -30~-50 并将 ${charName}.被强制恶堕 设为 true`,
        ],
      },
      {
        path: `${charName}.恶堕事件玩家方`,
        check: ['初始 false', '仅在「玩家方触发恶堕事件」时设为 true，一次性事件不可恢复'],
      },
      {
        path: `${charName}.被强制恶堕`,
        check: ['初始 false', '仅在「女主被强制恶堕」时设为 true，一次性事件不可恢复'],
      },
    ],
    statusBarTitle: '🔀 情感天平',
    statusBarVars: ['{charName}.情感天平'],
  },
];

/** 语义化颜色常量 */
const C = {
  text: 'var(--text-color)',
  secondary: 'var(--color-text-secondary)',
  muted: 'var(--color-text-muted)',
  border: 'var(--color-border-default)',
  surface: 'var(--color-surface-raised)',
  primary: 'var(--color-primary)',
  info: 'var(--color-info)',
  success: 'var(--color-status-success)',
  warning: 'var(--color-status-warning)',
} as const;
const surfaceA = (n: number) => `color-mix(in srgb, ${C.surface} ${n}%, transparent)`;
const borderA = (n: number) => `color-mix(in srgb, ${C.border} ${n}%, transparent)`;

/** 模板蓝图：描述变量结构（供 AI 参考），与结构化模板保持一致 */
function buildTemplateBlueprint(templateId: string): string {
  if (templateId === 'pure-love') {
    return `变量结构（只允许单一「情感天平」变量，阶段轴用数值阈值型，参考「高考冲刺100天」的情感天平模式）：
- 角色.情感天平 (number 0~100, 初始0)：对主角的情感倾向，0=初识，100=深爱，单调递增（只升不降）。这是【阶段轴变量】，通过 categories 阈值分段实现 6 个阶段：
  - categories: [{"range":">= 90","label":"深爱"},{"range":">= 75","label":"恋人"},{"range":">= 60","label":"暧昧"},{"range":">= 40","label":"朋友"},{"range":">= 20","label":"认识"},{"range":">= 0","label":"陌生人"}]
更新规则要点：情感天平每次+1~3，达到阈值自动推进阶段；阶段只升不降。禁止生成好感度、信任度、心情、回忆点等其他变量。`;
  }
  if (templateId === 'ntr') {
    return `变量结构（只允许单一「情感天平」变量，阶段轴用数值阈值型，参考「高考冲刺100天」的情感天平模式）：
- 角色.情感天平 (number 0~100, 初始0)：情感堕落程度，0=纯洁，100=沉沦，单调递增（只增不减）。这是【阶段轴变量】，通过 categories 阈值分段实现 5 个阶段：
  - categories: [{"range":">= 95","label":"毁灭"},{"range":">= 70","label":"沉沦"},{"range":">= 40","label":"沦陷"},{"range":">= 20","label":"动摇"},{"range":">= 0","label":"压抑"}]
更新规则要点：情感天平每次+1~3，达到阈值自动推进阶段；只增不减。禁止生成堕落度、心理防线、羞耻感、第三者介入等其他变量。`;
  }
  // dual-route：双向情感天平
  return `变量结构（只允许一个可见「情感天平」变量，阶段轴用双向数值阈值型，参考「高考冲刺100天」的「情感天平」模式）：
- 角色.情感天平 (number -100~100, 初始0)：情感倾向核心变量。这是【唯一可见变量】和【阶段轴变量】，通过 categories 阈值分段实现 8 个阶段（负向=NTR，正向=纯爱，0附近为缓冲带）：
  - categories: [{"range":">= 100","label":"纯爱·至死不渝"},{"range":">= 80","label":"纯爱·深爱"},{"range":">= 50","label":"纯爱·恋人"},{"range":">= 20","label":"纯爱·暧昧"},{"range":">= -20","label":"中立·缓冲带"},{"range":">= -50","label":"NTR·动摇"},{"range":">= -80","label":"NTR·沦陷"},{"range":">= -100","label":"NTR·沉沦"}]
- 角色.恶堕事件玩家方 (boolean, $前缀隐藏, 初始false)：玩家方触发恶堕事件（背叛/伤害/主动推向他人）的一次性标记，触发后设为true防止重复大跌
- 角色.被强制恶堕 (boolean, $前缀隐藏, 初始false)：女主被胁迫/强制发生恶堕事件的一次性标记，触发后设为true防止重复大跌
更新规则要点：
  - 纯爱侧：主角真诚关心/保护/尊重/亲密/共同回忆，或女主主动靠近 → +3~15
  - NTR侧（敌人受益的"正面"互动）：主角帮情敌/向威胁屈服/牺牲女主利益/让女主单独面对威胁/敌人 → -5~20
  - NTR侧（主角负面行为）：主角欺骗/背叛/冷落/主动伤害/暴力 → -5~20
  - 缓冲带：当前值在 -20~20 时，日常互动只 ±1~3；只有明确指向纯爱或NTR的情节才允许 ±5~15 跨区
  - 特殊事件：若「玩家方触发恶堕事件（背叛/伤害/主动推向他人）」且 角色.恶堕事件玩家方=false，则一次性 -30~-50 并将 角色.恶堕事件玩家方 设为 true
  - 特殊事件：若「女主被胁迫/强制发生恶堕事件」且 角色.被强制恶堕=false，则一次性 -30~-50 并将 角色.被强制恶堕 设为 true
  - 隐藏标记只由上述特殊事件设置，日常互动不修改
禁止生成好感度、堕落度、路线锁等其他可见变量。`;
}

interface DetectedCharacter {
  name: string;
  comment: string;
  summary: string;
  suitable: boolean;
  /** 用户勾选确认 */
  selected: boolean;
}

interface MultiCharTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 应用生成的 MVU 配置 */
  onApplyMvu: (mvu: MvuConfig) => void;
  /** 应用预生成的阶段轴信息（每个角色的阶段轴，供后续分阶段世界书使用） */
  onApplyStageAxes?: (axes: Array<{ characterName: string; axisPath: string }>, templateId: string) => void;
  cardName: string;
  /** 已有世界书条目（用于 AI 识别角色） */
  lorebookEntries: LorebookEntry[];
}

/** 从 sections 中找出每个角色的阶段轴变量 */
function computeStageAxes(
  sections: MvuSchemaSection[],
  chars: Array<{ name: string }>,
  defaultAxisName: string,
): Array<{ characterName: string; axisPath: string }> {
  return chars.map((c) => {
    const section = sections.find((s) => s.name === c.name);
    const stageVar = section?.variables.find((v) =>
      v.categories && v.categories.length > 0,
    ) || section?.variables.find((v) =>
      v.zodType.startsWith('z.enum(') && (v.path.includes('阶段') || v.path.includes('路线') || v.path.includes('堕落')),
    );
    return { characterName: c.name, axisPath: stageVar?.path || `${c.name}.${defaultAxisName}` };
  });
}

/** 用 sections + rules 重新组装 MvuConfig，并同步生成衍生内容 */
function rebuildMvu(sections: MvuSchemaSection[], updateRules: MvuUpdateRule[], templateId: string): MvuConfig {
  return {
    enabled: true,
    mode: 'beginner',
    beginnerTemplateId: templateId,
    schemaSections: sections,
    updateRules,
    ejsConfigs: [],
    ejsPreprocessContent: buildEjsPreprocess([], sections),
    schemaTsContent: buildSchemaTs(sections),
    initvarYamlContent: buildInitvarYaml(sections),
    updateRulesYamlContent: buildUpdateRulesYaml(updateRules),
    statusBarHtml: '',
    statusBarStyle: 'minimal-dark',
  };
}

export function MultiCharTemplateModal({
  isOpen, onClose, onApplyMvu, onApplyStageAxes, cardName, lorebookEntries,
}: MultiCharTemplateModalProps) {
  const { t } = useTranslation();
  const { detectCharacters, generateMultiCharVariables } = useAIGenerate();
  const { addToast } = useToast();

  const [templateId, setTemplateId] = useState<string>('pure-love');
  const [step, setStep] = useState<'select' | 'detect' | 'preview'>('select');
  const [detecting, setDetecting] = useState(false);
  const [detectStatus, setDetectStatus] = useState<AIProgressStatus>('idle');
  const [characters, setCharacters] = useState<DetectedCharacter[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState<AIProgressStatus>('idle');
  const [previewMvu, setPreviewMvu] = useState<MvuConfig | null>(null);
  const [previewAxes, setPreviewAxes] = useState<Array<{ characterName: string; axisPath: string }>>([]);

  const template = MULTI_CHAR_TEMPLATES.find((t) => t.id === templateId);
  const templateName = TEMPLATE_OPTIONS.find((t) => t.id === templateId)?.name || '';

  /** 构造已有世界书上下文（comment + content 截断） */
  const existingWorldbookContext = (() => {
    if (!lorebookEntries?.length) return '';
    return lorebookEntries
      .map((e) => `【${e.comment || '未命名'}】\n${(e.content || '').slice(0, 200)}`)
      .join('\n\n')
      .slice(0, 4000);
  })();

  /** Step 1: AI 识别角色 */
  const handleDetect = async () => {
    if (!existingWorldbookContext.trim()) {
      addToast('error', t('multiCharTemplate.needWorldbook'));
      return;
    }
    setDetecting(true);
    setDetectStatus('generating');
    try {
      const result = await detectCharacters(cardName, existingWorldbookContext, templateId, templateName);
      if (result.length === 0) {
        addToast('error', t('multiCharTemplate.noCharacters'));
        setDetectStatus('error');
        return;
      }
      // 默认勾选 suitable 的
      setCharacters(result.map((c) => ({ ...c, selected: c.suitable })));
      setStep('detect');
      setDetectStatus('done');
      addToast('success', t('multiCharTemplate.detectDone', { count: String(result.length) }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknownError');
      setDetectStatus('error');
      addToast('error', t('multiCharTemplate.detectFailed') + `: ${msg}`);
    } finally {
      setDetecting(false);
    }
  };

  /** 一键直接套用模板（不调用 AI），为每个已选角色复制模板变量组 */
  const handleCopyTemplate = () => {
    const selected = characters.filter((c) => c.selected);
    if (selected.length === 0) {
      addToast('error', t('multiCharTemplate.needSelect'));
      return;
    }
    if (!template) return;

    const sections: MvuSchemaSection[] = selected.map((c) => template.buildSection(c.name));
    const updateRules: MvuUpdateRule[] = selected.flatMap((c) => template.buildRules(c.name));
    const mvu = rebuildMvu(sections, updateRules, templateId);

    setPreviewMvu(mvu);
    setPreviewAxes(computeStageAxes(sections, selected, template.defaultAxisName));
    setStep('preview');
    addToast('success', t('multiCharTemplate.copyTemplateDone'));
  };

  /** Step 2: 生成多角色变量（AI 方式） */
  const handleGenerate = async () => {
    const selected = characters.filter((c) => c.selected);
    if (selected.length === 0) {
      addToast('error', t('multiCharTemplate.needSelect'));
      return;
    }
    setGenerating(true);
    setGenStatus('generating');
    try {
      const blueprint = buildTemplateBlueprint(templateId);
      const result = await generateMultiCharVariables(
        cardName, templateId, templateName, blueprint,
        selected.map((c) => ({ name: c.name, summary: c.summary })),
      );
      if (!result) {
        addToast('error', t('multiCharTemplate.generateFailed'));
        setGenStatus('error');
        return;
      }
      // 解析 sections
      const sections: MvuSchemaSection[] = (result.sections as Array<Record<string, unknown>>).map((s) => ({
        name: String(s.name || ''),
        variables: ((s.variables as Array<Record<string, unknown>>) || []).map((v) => {
          const type = String(v.type || 'string');
          let zodType = 'z.string()';
          let enumValues: string[] | undefined;
          let range: { min: number; max: number } | undefined;
          let categories: Array<{ range: string; label: string }> | undefined;
          let initialValue: unknown = v.initialValue ?? '';
          if (type === 'number') {
            zodType = 'z.coerce.number()';
            const rm = v.rangeMin != null && v.rangeMax != null
              ? { min: Number(v.rangeMin), max: Number(v.rangeMax) }
              : parseRangeString(v.range);
            range = rm || { min: 0, max: 100 };
            initialValue = isNaN(Number(initialValue)) ? 0 : Number(initialValue);
            // 解析 categories（数值阈值型阶段轴的分段信息）
            if (Array.isArray(v.categories)) {
              categories = (v.categories as Array<Record<string, unknown>>)
                .map((c) => ({
                  range: String(c.range || ''),
                  label: String(c.label || ''),
                }))
                .filter((c) => c.range && c.label);
            }
          } else if (type === 'enum') {
            const ev = Array.isArray(v.enumValues) ? v.enumValues.map(String) : [];
            enumValues = ev;
            zodType = ev.length > 0 ? `z.enum(${JSON.stringify(ev)})` : 'z.string()';
            if (ev.length > 0 && !ev.includes(String(initialValue))) initialValue = ev[0];
          } else if (type === 'boolean') {
            zodType = 'z.boolean()';
            initialValue = initialValue === true || initialValue === 'true';
          }
          return {
            path: String(v.path || ''),
            zodType,
            description: String(v.description || ''),
            prefix: (String(v.prefix || '') as MvuPrefix) || ('' as MvuPrefix),
            initialValue,
            range,
            enumValues,
            categories,
          };
        }),
      }));
      // 解析 updateRules
      const updateRules: MvuUpdateRule[] = (result.updateRules as Array<Record<string, unknown>>).map((r) => ({
        path: String(r.path || ''),
        type: r.type ? String(r.type) : undefined,
        range: r.range ? String(r.range) : undefined,
        check: Array.isArray(r.check) ? r.check.map(String) : undefined,
      }));
      const mvu = rebuildMvu(sections, updateRules, templateId);
      setPreviewMvu(mvu);
      setPreviewAxes(computeStageAxes(sections, selected, template?.defaultAxisName || '情感天平'));
      setStep('preview');
      setGenStatus('done');
      addToast('success', t('multiCharTemplate.generateDone'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknownError');
      setGenStatus('error');
      addToast('error', t('multiCharTemplate.generateFailed') + `: ${msg}`);
    } finally {
      setGenerating(false);
    }
  };

  /** 预览阶段：修改分区名称（同时同步该分区下所有变量路径与更新规则） */
  const updatePreviewSection = (idx: number, updates: Partial<MvuSchemaSection>) => {
    if (!previewMvu) return;
    const oldSection = previewMvu.schemaSections[idx];
    const newName = updates.name ?? oldSection.name;

    let newSections = previewMvu.schemaSections.map((s, i) => (i === idx ? { ...s, ...updates } : s));
    let newRules = previewMvu.updateRules;

    if (updates.name && oldSection.name !== newName) {
      newSections = newSections.map((s, i) => {
        if (i !== idx) return s;
        return {
          ...s,
          variables: s.variables.map((v) => {
            const suffix = v.path.startsWith(`${oldSection.name}.`)
              ? v.path.slice(oldSection.name.length + 1)
              : v.path;
            return { ...v, path: `${newName}.${suffix}` };
          }),
        };
      });
      newRules = previewMvu.updateRules.map((r) => {
        const suffix = r.path.startsWith(`${oldSection.name}.`)
          ? r.path.slice(oldSection.name.length + 1)
          : r.path;
        return { ...r, path: `${newName}.${suffix}` };
      });
    }

    setPreviewMvu(rebuildMvu(newSections, newRules, templateId));
    setPreviewAxes(computeStageAxes(newSections, characters.filter((c) => c.selected), template?.defaultAxisName || '情感天平'));
  };

  /** 预览阶段：修改某个变量 */
  const updatePreviewVariable = (sectionIdx: number, varIdx: number, updates: Partial<MvuVariable>) => {
    if (!previewMvu) return;
    const oldVar = previewMvu.schemaSections[sectionIdx].variables[varIdx];

    const newSections = previewMvu.schemaSections.map((s, si) => {
      if (si !== sectionIdx) return s;
      return {
        ...s,
        variables: s.variables.map((v, vi) => (vi === varIdx ? { ...v, ...updates } : v)),
      };
    });

    let newRules = previewMvu.updateRules;
    if (updates.path && oldVar.path !== updates.path) {
      newRules = previewMvu.updateRules.map((r) =>
        r.path === oldVar.path ? { ...r, path: updates.path as string } : r,
      );
    }

    setPreviewMvu(rebuildMvu(newSections, newRules, templateId));
    setPreviewAxes(computeStageAxes(newSections, characters.filter((c) => c.selected), template?.defaultAxisName || '情感天平'));
  };

  /** 预览阶段：删除某个变量 */
  const removePreviewVariable = (sectionIdx: number, varIdx: number) => {
    if (!previewMvu) return;
    const removed = previewMvu.schemaSections[sectionIdx].variables[varIdx];
    const newSections = previewMvu.schemaSections.map((s, si) => {
      if (si !== sectionIdx) return s;
      return { ...s, variables: s.variables.filter((_, vi) => vi !== varIdx) };
    });
    const newRules = previewMvu.updateRules.filter((r) => r.path !== removed.path);
    setPreviewMvu(rebuildMvu(newSections, newRules, templateId));
    setPreviewAxes(computeStageAxes(newSections, characters.filter((c) => c.selected), template?.defaultAxisName || '情感天平'));
  };

  /** 应用到 MVU 配置 */
  const handleApply = () => {
    if (!previewMvu) return;
    onApplyMvu(previewMvu);
    if (onApplyStageAxes && previewAxes.length) {
      onApplyStageAxes(previewAxes, templateId);
    }
    addToast('success', t('multiCharTemplate.applyDone'));
    onClose();
    // 重置
    setStep('select');
    setCharacters([]);
    setPreviewMvu(null);
    setPreviewAxes([]);
  };

  const fieldCls = 'w-full rounded border border-[var(--input-border)] px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('multiCharTemplate.title')} maxWidth="max-w-3xl">
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {/* 说明 */}
        <div className="rounded-lg border px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: themeAlpha('info', 40), backgroundColor: themeAlpha('info', 20), color: C.info }}>
          {t('multiCharTemplate.intro')}
        </div>

        {/* Step 1: 选模板 + AI 识别角色 */}
        <div className="rounded-lg border p-3 space-y-3" style={{ borderColor: borderA(50) }}>
          <p className="text-xs font-medium" style={{ color: C.text }}>{t('multiCharTemplate.step1Title')}</p>
          <div className="grid grid-cols-3 gap-2">
            {TEMPLATE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTemplateId(opt.id)}
                className={`rounded-lg border p-3 text-center transition ${
                  templateId === opt.id
                    ? 'border-[var(--color-primary)] text-[var(--text-color)]'
                    : 'border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[color-mix(in_srgb,var(--color-border-default)_80%,transparent)]'
                }`}
                style={{ backgroundColor: templateId === opt.id ? themeAlpha('primary', 30) : surfaceA(30) }}
              >
                <div className="text-xl">{opt.icon}</div>
                <div className="text-xs mt-1">{opt.name}</div>
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={handleDetect} disabled={detecting || generating}>
            {detecting ? t('multiCharTemplate.detecting') : `🔍 ${t('multiCharTemplate.detectButton')}`}
          </Button>
          {detectStatus !== 'idle' && detectStatus !== 'done' && (
            <AIProgressPanel status={detectStatus} text="" />
          )}
        </div>

        {/* Step 2: 角色确认 */}
        {step === 'detect' && characters.length > 0 && (
          <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: borderA(50) }}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium" style={{ color: C.text }}>{t('multiCharTemplate.step2Title')}</p>
              <span className="text-[10px]" style={{ color: C.muted }}>
                {t('multiCharTemplate.selectedCount', { count: String(characters.filter((c) => c.selected).length) })}
              </span>
            </div>
            <div className="space-y-1">
              {characters.map((c, idx) => (
                <label
                  key={idx}
                  className={`flex items-start gap-2 p-2 rounded border cursor-pointer ${
                    c.selected
                      ? 'border-[color-mix(in_srgb,var(--color-primary)_50%,transparent)] bg-[color-mix(in_srgb,var(--color-primary)_20%,transparent)]'
                      : 'border-[color-mix(in_srgb,var(--color-border-default)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-surface-raised)_30%,transparent)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={c.selected}
                    onChange={(e) => setCharacters(characters.map((x, i) => i === idx ? { ...x, selected: e.target.checked } : x))}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: C.text }}>{c.name}</span>
                      {!c.suitable && <span className="text-[10px]" style={{ color: C.warning }}>⚠ {t('multiCharTemplate.notSuitable')}</span>}
                    </div>
                    <p className="text-[11px]" style={{ color: C.secondary }}>{c.summary}</p>
                    {c.comment && <p className="text-[10px] mt-0.5" style={{ color: C.muted }}>来源：{c.comment}</p>}
                  </div>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={handleGenerate} disabled={generating}>
                {generating ? t('multiCharTemplate.generating') : `✨ ${t('multiCharTemplate.generateButton')}`}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCopyTemplate} disabled={generating}>
                📋 {t('multiCharTemplate.copyTemplateButton')}
              </Button>
              {genStatus !== 'idle' && genStatus !== 'done' && (
                <AIProgressPanel status={genStatus} text="" />
              )}
            </div>
            <p className="text-[10px]" style={{ color: C.muted }}>
              {t('multiCharTemplate.copyTemplateHint')}
            </p>
          </div>
        )}

        {/* Step 3: 预览 */}
        {step === 'preview' && previewMvu && (
          <div className="rounded-lg border p-3 space-y-3" style={{ borderColor: borderA(50) }}>
            <p className="text-xs font-medium" style={{ color: C.text }}>{t('multiCharTemplate.step3Title')}</p>
            <p className="text-[10px]" style={{ color: C.muted }}>
              {t('multiCharTemplate.editHint')}
            </p>
            {/* 变量预览 / 编辑 */}
            <div className="space-y-2">
              {previewMvu.schemaSections.map((section, sIdx) => (
                <div key={sIdx} className="rounded border p-2" style={{ borderColor: borderA(40), backgroundColor: surfaceA(30) }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px]" style={{ color: C.muted }}>角色分区</span>
                    <input
                      value={section.name}
                      onChange={(e) => updatePreviewSection(sIdx, { name: e.target.value })}
                      className={`${fieldCls} max-w-[200px]`}
                    />
                  </div>
                  <div className="space-y-1">
                    {section.variables.map((v, vIdx) => {
                      const isNumber = v.zodType === 'z.coerce.number()';
                      const isEnum = v.zodType.startsWith('z.enum(');
                      const isBoolean = v.zodType === 'z.boolean()';
                      const typeLabel = isNumber ? 'number' : isEnum ? 'enum' : isBoolean ? 'boolean' : 'string';
                      return (
                        <div key={vIdx} className="rounded border p-2" style={{ borderColor: borderA(30), backgroundColor: surfaceA(20) }}>
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                            <div className="sm:col-span-4">
                              <label className="text-[10px] block mb-0.5" style={{ color: C.muted }}>变量路径</label>
                              <input
                                value={v.path}
                                onChange={(e) => updatePreviewVariable(sIdx, vIdx, { path: e.target.value })}
                                className={fieldCls}
                              />
                            </div>
                            <div className="sm:col-span-5">
                              <label className="text-[10px] block mb-0.5" style={{ color: C.muted }}>描述</label>
                              <input
                                value={v.description}
                                onChange={(e) => updatePreviewVariable(sIdx, vIdx, { description: e.target.value })}
                                className={fieldCls}
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="text-[10px] block mb-0.5" style={{ color: C.muted }}>初始值</label>
                              <input
                                value={String(v.initialValue ?? '')}
                                onChange={(e) => {
                                  let val: unknown = e.target.value;
                                  if (isNumber) {
                                    const parsed = e.target.value === '' ? 0 : Number(e.target.value);
                                    val = Number.isNaN(parsed) ? v.initialValue : parsed;
                                  } else if (isBoolean) val = e.target.value === 'true';
                                  updatePreviewVariable(sIdx, vIdx, { initialValue: val });
                                }}
                                className={fieldCls}
                              />
                            </div>
                            <div className="sm:col-span-1">
                              <Button variant="danger" size="sm" onClick={() => removePreviewVariable(sIdx, vIdx)}>×</Button>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-1.5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: surfaceA(80), color: C.secondary }}>{typeLabel}</span>
                            {v.prefix && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: themeAlpha('warning', 40), color: C.warning }}>{v.prefix}前缀</span>}
                            {isNumber && v.range && (
                              <span className="text-[10px]" style={{ color: C.muted }}>
                                范围 {v.range.min}~{v.range.max}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {/* 阶段轴预览：展示每个角色的阶段轴变量及其 categories 阶段划分 */}
            {previewAxes.length > 0 && (
              <div className="rounded border p-2" style={{ borderColor: themeAlpha('success', 30), backgroundColor: themeAlpha('success', 10) }}>
                <p className="text-[11px] mb-1" style={{ color: C.success }}>{t('multiCharTemplate.stageAxesPreview')}</p>
                {previewAxes.map((a, i) => {
                  const section = previewMvu.schemaSections.find((s) => s.name === a.characterName);
                  const axisVar = section?.variables.find((v) => v.path === a.axisPath);
                  const cats = axisVar?.categories;
                  return (
                    <div key={i} className="text-[11px] mb-1.5" style={{ color: C.secondary }}>
                      <span style={{ color: C.text }}>{a.characterName}</span> → <code style={{ color: C.success }}>{a.axisPath}</code>
                      {axisVar?.range && (
                        <span className="ml-1" style={{ color: C.muted }}>[{axisVar.range.min}~{axisVar.range.max}]</span>
                      )}
                      {cats && cats.length > 0 && (
                        <div className="mt-0.5 ml-3 flex flex-wrap gap-1">
                          {cats.map((c, ci) => (
                            <span key={ci} className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: surfaceA(60) }}>
                              <code style={{ color: C.warning }}>{c.range}</code>
                              <span className="ml-1" style={{ color: C.secondary }}>{c.label}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-[10px]" style={{ color: C.muted }}>{t('multiCharTemplate.previewHint')}</p>
          </div>
        )}

        {/* 底部操作 */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: borderA(40) }}>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={detecting || generating}>{t('common.cancel')}</Button>
          {step === 'preview' && (
            <Button variant="primary" size="sm" onClick={handleApply} disabled={detecting || generating}>
              {t('multiCharTemplate.applyButton')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
