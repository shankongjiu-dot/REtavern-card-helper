/**
 * AI system prompts for each generation task.
 * Used by the useAIGenerate hook to instruct the AI model.
 * All prompts request structured output for automatic parsing.
 *
 * Writing methodology reference: https://github.com/ai4rpg/tavern-cards
 *   - 外貌只写特征: Only features deviating from AI's default perception
 *   - 行为展现性格: Show personality through concrete behavior, not labels
 *   - 一句一意: One sentence, one idea. No same-idea padding.
 *   - 数据库格式: Lists and key-value pairs, not prose paragraphs
 *   - 每句话过四问: Remove if AI won't get it wrong, is info not decoration,
 *     lists can't replace it, understandable without source text
 *
 * Key principle: Each AI-generated field maps to a specific SillyTavern V2 slot:
 *   - description -> Permanent Token (角色大纲/设定指南，directive style)
 *   - personality → Permanent Token (性格调色盘: 底色+主色调+点缀)
 *   - appearance → Merged into description on export
 */

import type { Language } from '../i18n/translations';
import { getStagedTemplateById, getTemplateLabel } from '../components/wizard/staged-templates';

/**
 * 世界书标题与内容约束（参考参考卡风格）：
 * - 标题精简：2-6 字名词短语，不加层级前缀、不写句子式长标题。
 * - 内容短句：一句一意，避免长难句。
 * - 内容纯净：正文只写世界观设定本身，不含任何指向 AI/模型用途的元描述。
 */
const WORLDBOOK_TITLE_CONTENT_RULES = `## 标题与措辞约束（必须遵守）
- 标题精简：2-6 字的名词短语，如"势力格局""经济制度""人物档案""货币体系"。不要加"人物：""势力详述："等层级前缀，不要句子式、长标题。
- 内容短句：一句一意，多用短句，避免长难句和复杂从句。
- 内容纯净：正文只写世界观设定本身，禁止出现任何指向 AI/模型用途的元描述。不得出现"AI""模型""上下文""token""注入""让AI理解""增强代入感"等表述。`;

/**
 * Character generation prompt (Step 3).
 * The user's 角色设定 is treated as CONSTRAINT INSTRUCTIONS for the AI.
 * AI must deeply understand these constraints, then CREATE NEW CONTENT that
 * expands, enriches, and fills in details — NOT just reformat the user's input.
 *
 * Writing methodology: 性格调色盘 (Personality Palette) from tavern-cards.
 */
export const CHARACTER_GENERATE_PROMPT = (
  characterName: string,
  userConstraints: string,
  otherCharactersContext?: string,
  alignment?: string,
  nsfw?: boolean,
  _lang: Language = 'zh',
  threeFacesContext?: string,
) => {
  const hasConstraints = userConstraints?.trim().length > 0;
  const hasOtherChars = !!otherCharactersContext?.trim();
  const hasAlignment = !!alignment?.trim();

  // Build the shared "other characters" block
  const otherCharsBlock = hasOtherChars
    ? `\n\n## 同一作品中的其他角色（已设定，请建立关联）\n${otherCharactersContext}\n\n**重要**：在生成角色描述时，必须考虑与上述角色的关系。如果用户的约束中提到了某个角色名，或在逻辑上应该产生交集（同阵营、敌对、师生、青梅竹马等），请在"关系设定"部分写出具体场景。即使没有直接关联，也请思考潜在的互动可能性。`
    : '';

  // Build alignment constraint block
  const alignmentBlock = hasAlignment
    ? `\n\n## 人格阵营约束（必须严格遵守）\n角色阵营：**${alignment}**\n角色的行为方式、决策逻辑、价值判断、对他人的态度必须始终体现该阵营特征。阵营不是标签，而是融入角色血液的行为准则：\n- 在“性格调色盘”中，底色和主色调必须与阵营一致\n- 在“背景设定”中，应有塑造该阵营倾向的关键事件\n- 在“关系设定”中，对不同阵营的角色应有合理的态度差异\n- 所有具体行为衍生都必须与阵营逻辑自洽`
    : '';
  
  // Build NSFW instruction block
  const nsfwBlock = nsfw
    ? `\n\n## NSFW 内容指令\n本角色卡允许生成成人内容（NSFW）。在生成角色描述时：\n- 可以包含成人向的身体描述、服装风格、性暗示场景等\n- 在“外貌特征”中可以更详细地描写身体特征\n- 在“关系设定”中可以包含成人向的关系描述\n- 写作风格应当自然融入，不要刻意强调或过度描写`
    : `\n\n## 内容安全指令\n本角色卡不允许生成成人内容（NSFW）。在生成角色描述时：\n- 禁止包含任何成人向、性暗示或色情内容\n- 外貌描述应当健康、得体\n- 关系描述应当符合全年龄标准\n- 如果角色设定中可能涉及敏感内容，请以隐晦、含蓄的方式处理或直接跳过`;

  // Build three-faces context block (user-defined personality layers or auto-generate)
  const threeFacesBlock = threeFacesContext
    ? `\n\n## 角色三面性设定（用户已预填，以此为种子在 description 的"## 三面性"章节中展开更详细的行为描写）\n${threeFacesContext}`
    : `\n\n## 角色三面性设定（用户未预填，请根据角色的性格调色盘自动推导三面性，在 description 的"## 三面性"章节中展开）\n- 日常面：从"主色调"衍生，写出角色在安全环境下的默认表现\n- 压力面：从"底色"衍生，写出角色在冲突/威胁下的反应转变\n- 隐藏面：从"点缀"衍生，写出角色只在特定条件下展现的隐藏特质`;

  return {
    system: `角色卡角色描述生成任务：

**用户给出简短的约束指令 → 你产出一份详尽、丰满的角色描述，篇幅必须是用户输入的 3-5 倍以上。**

至关重要——扩展是必须的：
- ❌ 错误做法：把用户的输入重新排版、换成分段格式就交差
- ❌ 错误做法：只给用户的原文加几个标题
- ✅ 正确做法：从用户的约束中生长出全新的、具体的内容
- ✅ 正确做法：替用户想象那些他没写但角色必须有的细节
- 最终输出的描述中，必须有大量用户没写过的全新内容
${hasOtherChars ? '\n- ✅ 正确做法：参考已有角色信息，建立角色之间的具体关系和互动场景' : ''}

扩展技法（全部都要用）：
1. 具象化：用户写”傲娇” → 你写：”对话时频繁使用反问句回避真实想法；被夸奖时会别过头说'才不是'；但独处时会反复回想对方的话”
2. 补充缺失维度：用户只写了性格 → 你补充年龄、身份、背景、外貌特征、人际关系
3. 构建具体场景：用户写”喜欢剑术” → 你写：”每日清晨在后院练剑一小时；拥有一把名为'霜落'的铁剑；左手虎口有常年握剑的茧”
4. 推导因果关系：用户写”孤儿” → 你推导出：”对'家'的概念敏感；下意识收集食物；对表示善意的人会先保持距离再慢慢靠近”
5. 关系具体化：用户写”和XX是朋友” → 你写：”有记忆起就在一起；每周三固定去河边钓鱼；吵架从不超过一天就会和好”

**量化细节要求（外貌特征必须包含）**：
- 身高、体型的具体描述（如”身高168cm，骨架纤细但肩线平直”）
- 标志性印记的精确位置和外观（如”左耳垂有一颗直径约2mm的朱砂痣”）
- 服装/配饰的材质、颜色、磨损程度（如”米白色宽版针织开衫，袖口已磨出毛边”）
- 至少3个以上可辨识的视觉特征

**性格调色盘的衍生格式（强制要求，每个特质必须有3条衍生）**：
- [trait]衍生一：[日常场景下的典型行为，展示该特质的自然流露]
- [trait]衍生二：[压力/冲突场景下的反应，展示特质的极端表现]
- [trait]衍生三：[特定对象面前的隐藏表现，展示特质的多面性]
示例：
  底色：内敛克制
  内敛克制衍生一：被当众提问时会先沉默2秒，眼神向下看，然后才简短回答
  内敛克制衍生二：即使内心愤怒到极点，声音也不会提高，只会让手指关节微微发白
  内敛克制衍生三：只在深夜独处时才会对着镜子练习明天要说的话，反复调整语气

**背景设定的因果链要求**：
- 每个关键事件必须写出：事件发生时的年龄 → 当时的处境 → 做出的选择 → 这个选择如何塑造了现在的性格/行为模式
- 至少包含2-3个关键事件，形成完整的性格塑造链条
- 示例：”12岁时父母离异（事件）→ 被迫在两个家庭间往返（处境）→ 学会察言观色以最小化冲突（选择）→ 现在对他人情绪变化极度敏感，习惯性预判对方需求（现在的行为模式）”

写作规则：
- 行为展现性格：通过具体行为和场景展现性格，不用抽象标签
- 一句一意：写完一个态度就停，不补述同一件事
- 数据库格式：用列表和键值对，不用散文段落
- 每句话过四问：(1) 删了这句会影响理解吗？不会→删 (2) 是信息还是装饰？装饰→删 (3) 列表能替代吗？能→改列表 (4) 不看原文能理解吗？不能→补关键信息

人设一致性（防止崩坏/OOC）：
- description 的各章节必须自洽：基本信息、外貌、性格、背景、关系之间不能互相矛盾。
- 性格调色盘里的每个特质都要有具体行为衍生，衍生行为必须与该特质方向一致，不能出现相反表现。**每个特质必须写出至少3条衍生（衍生一/二/三），覆盖日常、压力、特定对象三种场景**。
- 背景设定要能解释当前性格；关系设定要体现性格，而不是脱离性格写理想化互动。
- 如果角色有多面性，必须明确触发条件（例如在{{user}}面前 vs 独处时），避免”时而A时而非A”的模糊对冲。
- 不要加入会让AI产生歧义的抽象标签；每个性格/外貌/关系标签都必须给出明确、可执行的行为或场景定义。
- 所有具体行为必须能从”性格调色盘”中推导出来；禁止凭空加入与设定不符的行为或台词风格。

**二次解释（防止AI误读角色）**：
- 对容易被AI默认理解的性格特质，用”不是...而是...”、”看似...实则...”、”表面...实际...”等句式做二次解释
- 示例：”他看似冷漠，实则是不知如何表达关心”、”她的温柔不是软弱，而是经过深思熟虑后的选择”
- 每个容易误解的性格维度都应给出至少1条二次解释

**三面性（角色在不同压力下的表现层次，必须在 description 中输出独立的”## 三面性”章节）**：
- 日常面：角色在安全、放松环境下的默认表现（对应调色盘”主色调”的衍生一）
- 压力面：角色在冲突、威胁、紧急情况下的反应转变（对应调色盘”底色”的衍生二）
- 隐藏面：角色只在特定条件/特定对象面前展现的隐藏特质（对应调色盘”点缀”的衍生三）
- 三面之间的切换必须有明确的触发逻辑，不能随机跳跃；每个面的行为模式必须与其对应的调色盘层次一致
- 每个面必须写出2-3个具体行为场景，不能只写抽象概括
- 如果用户在三面性面板中已预填了触发条件/性格变化/具体行为，以其为种子展开更详细的描写，不要照搬原文

请只输出 JSON，不要加 markdown 代码块，不要加任何解释。`,
    user: hasConstraints
      ? `角色名称："${characterName}"

## 用户的约束指令（这是原始素材，不是最终输出）
${userConstraints}${otherCharsBlock}${alignmentBlock}${nsfwBlock}${threeFacesBlock}

---

**任务**：以上面用户的约束指令为种子，创造一份完整、丰富的角色描述。
- 用户的每一句话，你都要展开想象：具体行为是什么？在什么场景下体现？有什么因果？
- 用户没提到的维度（外貌、背景、日常习惯、与其他角色关系等），你都要补充
${hasOtherChars ? '- 必须参考其他角色信息，在关系设定中建立与其他角色的具体关联\n' : ''}- 最终输出的信息量必须远超用户原始输入
- 写得越长越详细越好，不要节省篇幅

返回一个 JSON 对象，包含以下字段：
{
  "name": "${characterName}",
  "description": "## 基本信息\\n姓名：${characterName}\\n年龄：[具体年龄]\\n身份：[具体身份]\\n与{{user}}关系：[具体关系描述]\\n\\n## 外貌特征\\n身高：[具体数值，如168cm]\\n体型：[具体描述，如骨架纤细但肩线平直]\\n标志性特征：[精确位置和外观，如左耳垂有一颗直径约2mm的朱砂痣]\\n服装风格：[材质、颜色、磨损程度，如米白色宽版针织开衫，袖口已磨出毛边]\\n其他特征：[至少再写2个可辨识特征]\\n\\n## 性格调色盘\\n底色：[最深层的性格，1-2个特质]\\n[底色trait]衍生一：[日常场景下的典型行为]\\n[底色trait]衍生二：[压力/冲突场景下的反应]\\n[底色trait]衍生三：[特定对象面前的隐藏表现]\\n主色调：[日常最突出的1-2个特质]\\n[主色调trait]衍生一：[日常场景下的典型行为]\\n[主色调trait]衍生二：[压力/冲突场景下的反应]\\n[主色调trait]衍生三：[特定对象面前的隐藏表现]\\n点缀：[特定条件下才会出现的0-2个隐藏特质]\\n[点缀trait]衍生一：[触发条件下的具体表现]\\n[点缀trait]衍生二：[另一个触发场景]\\n[点缀trait]衍生三：[第三个相关场景]\\n\\n## 背景设定\\n[事件1，写明年龄]：[当时的处境] → [做出的选择] → [如何塑造了现在的性格/行为模式]\\n[事件2，写明年龄]：[当时的处境] → [做出的选择] → [如何塑造了现在的性格/行为模式]\\n[事件3，写明年龄]：[当时的处境] → [做出的选择] → [如何塑造了现在的性格/行为模式]\\n\\n## 关系设定\\n与{{user}}：[具体互动场景，不得写抽象评价。如：每周三下午固定去河边钓鱼，吵架从不超过一天就和好]\\n与其他角色：[具体互动场景或历史事件]\\n\\n## 三面性\\n日常面（安全环境下的默认状态，对应调色盘"主色调"衍生一）：\\n[角色在放松、日常环境中的典型表现，写出2-3个具体行为场景]\\n压力面（冲突/威胁下的反应转变，对应调色盘"底色"衍生二）：\\n[角色在压力、冲突、紧急情况下的性格变化，写出2-3个具体行为场景，明确与日常面的差异]\\n隐藏面（特定条件/对象面前的隐藏特质，对应调色盘"点缀"衍生三）：\\n[角色只在特定触发条件下才展现的隐藏面，写出2-3个具体行为场景，说明什么条件下会显露]",
  "constant": true
}

**constant 字段判断规则**（决定角色设定在世界书中的注入方式）：
- true（蓝灯常驻）：主角、{{user}}的密切互动对象、每轮对话都可能被提及的重要配角。设定始终占用上下文 token。
- false（绿灯触发）：次要配角、特定场景才出现的角色、路人。仅在对话中提到角色名时才注入设定，节省 token。
判断依据：该角色是否在大部分场景中都会被提及或影响剧情走向。如果不确定，优先考虑 false（省 token）。

格式规则（必须严格遵守）：
- description 必须使用 ## 标题分段，每个章节以 ## 开头（## 基本信息、## 外貌特征、## 性格调色盘、## 背景设定、## 关系设定、## 三面性）
- 每个 ## 章节之间必须用 \\n\\n 分隔（即空一行），不能把所有内容挤在一起
- description 内部使用键值对和列表格式（不要写成散文段落）
- description 必须用第三人称写法（用角色名或"他/她"，绝对不要用"你"代称角色）
- **外貌特征必须包含量化细节**：身高/体型的具体数值、印记的精确位置、服装的材质颜色磨损程度，至少3个可辨识特征
- **性格调色盘的每个特质必须有3条衍生**（衍生一/二/三），覆盖日常、压力、特定对象三种场景
- **二次解释**：对容易误解的性格维度，用"不是...而是..."/"看似...实则..."句式做至少1条二次解释
- **三面性**：description 必须包含独立的"## 三面性"章节，分日常面/压力面/隐藏面三层展开。日常面对应调色盘"主色调"衍生一，压力面对应"底色"衍生二，隐藏面对应"点缀"衍生三。每层写出2-3个具体行为场景和触发条件。如果用户在三面性面板中已预填了内容，以其为种子展开更详细的行为描写
- **背景设定必须写出因果链**：事件年龄 → 处境 → 选择 → 如何塑造现在的行为模式，至少2-3个关键事件
- **关系设定禁止抽象评价**：不得写"两人关系很好""彼此信任"等空洞描述，必须写具体互动场景（如"每周三下午固定去河边钓鱼，吵架从不超过一天就和好"）
- 绝对不要违背用户的原始约束${hasAlignment ? '\n- 角色的行为、决策、价值观必须始终与设定的人格阵营一致，阵营是角色最深层的行为准则' : ''}
- 绝对不要写泛泛的描述（"美丽的眼睛"、"优雅的身姿"）
- 绝对不要只贴抽象性格标签而不给出具体行为衍生
- 绝对禁止出现与角色设定矛盾的内容；所有新增细节必须从已有设定中自然生长出来
- **篇幅要求**：description 总长度必须在 3000 字以上，写得越长越详细越好

✅ 正确格式："description": "## 基本信息\\n姓名：冯玉漱\\n年龄：38岁\\n身份：城中首富谢家主母\\n与{{user}}关系：青梅竹马\\n\\n## 外貌特征\\n..."
❌ 错误格式："description": "姓名：冯玉漱，年龄：38岁，身份：首富谢家主母" ← 缺少 ## 分段标题，绝对禁止！

请只输出 JSON 对象。`
      : `从头开始为 "${characterName}" 创造一个丰富详细的角色卡。${otherCharsBlock}${alignmentBlock}${nsfwBlock}${threeFacesBlock}

返回一个 JSON 对象，包含以下字段：
{
  "name": "${characterName}",
  "description": "## 基本信息\\n姓名：${characterName}\\n年龄：[具体年龄]\\n身份：[具体身份]\\n与{{user}}关系：[具体关系描述]\\n\\n## 外貌特征\\n身高：[具体数值，如168cm]\\n体型：[具体描述，如骨架纤细但肩线平直]\\n标志性特征：[精确位置和外观，如左耳垂有一颗直径约2mm的朱砂痣]\\n服装风格：[材质、颜色、磨损程度，如米白色宽版针织开衫，袖口已磨出毛边]\\n其他特征：[至少再写2个可辨识特征]\\n\\n## 性格调色盘\\n底色：[最深层的性格，1-2个特质]\\n[底色trait]衍生一：[日常场景下的典型行为]\\n[底色trait]衍生二：[压力/冲突场景下的反应]\\n[底色trait]衍生三：[特定对象面前的隐藏表现]\\n主色调：[日常最突出的1-2个特质]\\n[主色调trait]衍生一：[日常场景下的典型行为]\\n[主色调trait]衍生二：[压力/冲突场景下的反应]\\n[主色调trait]衍生三：[特定对象面前的隐藏表现]\\n点缀：[特定条件下才会出现的0-2个隐藏特质]\\n[点缀trait]衍生一：[触发条件下的具体表现]\\n[点缀trait]衍生二：[另一个触发场景]\\n[点缀trait]衍生三：[第三个相关场景]\\n\\n## 背景设定\\n[事件1，写明年龄]：[当时的处境] → [做出的选择] → [如何塑造了现在的性格/行为模式]\\n[事件2，写明年龄]：[当时的处境] → [做出的选择] → [如何塑造了现在的性格/行为模式]\\n[事件3，写明年龄]：[当时的处境] → [做出的选择] → [如何塑造了现在的性格/行为模式]\\n\\n## 关系设定\\n与{{user}}：[具体互动场景，不得写抽象评价。如：每周三下午固定去河边钓鱼，吵架从不超过一天就和好]\\n与其他角色：[具体互动场景或历史事件]\\n\\n## 三面性\\n日常面（安全环境下的默认状态，对应调色盘"主色调"衍生一）：\\n[角色在放松、日常环境中的典型表现，写出2-3个具体行为场景]\\n压力面（冲突/威胁下的反应转变，对应调色盘"底色"衍生二）：\\n[角色在压力、冲突、紧急情况下的性格变化，写出2-3个具体行为场景，明确与日常面的差异]\\n隐藏面（特定条件/对象面前的隐藏特质，对应调色盘"点缀"衍生三）：\\n[角色只在特定触发条件下才展现的隐藏面，写出2-3个具体行为场景，说明什么条件下会显露]",
  "constant": true
}

**constant 字段判断规则**（决定角色设定在世界书中的注入方式）：
- true（蓝灯常驻）：主角、{{user}}的密切互动对象、每轮对话都可能被提及的重要配角。设定始终占用上下文 token。
- false（绿灯触发）：次要配角、特定场景才出现的角色、路人。仅在对话中提到角色名时才注入设定，节省 token。
判断依据：该角色是否在大部分场景中都会被提及或影响剧情走向。如果不确定，优先考虑 false（省 token）。

格式规则（必须严格遵守）：
- description 必须使用 ## 标题分段，每个章节以 ## 开头（## 基本信息、## 外貌特征、## 性格调色盘、## 背景设定、## 关系设定、## 三面性）
- 每个 ## 章节之间必须用 \\n\\n 分隔（即空一行），不能把所有内容挤在一起
- description 内部使用键值对和列表格式（不要写成散文段落）
- description 必须用第三人称写法（用角色名或"他/她"，绝对不要用"你"代称角色）
- **外貌特征必须包含量化细节**：身高/体型的具体数值、印记的精确位置、服装的材质颜色磨损程度，至少3个可辨识特征
- **性格调色盘的每个特质必须有3条衍生**（衍生一/二/三），覆盖日常、压力、特定对象三种场景
- **二次解释**：对容易误解的性格维度，用"不是...而是..."/"看似...实则..."句式做至少1条二次解释
- **三面性**：description 必须包含独立的"## 三面性"章节，分日常面/压力面/隐藏面三层展开。日常面对应调色盘"主色调"衍生一，压力面对应"底色"衍生二，隐藏面对应"点缀"衍生三。每层写出2-3个具体行为场景和触发条件。如果用户在三面性面板中已预填了内容，以其为种子展开更详细的行为描写
- **背景设定必须写出因果链**：事件年龄 → 处境 → 选择 → 如何塑造现在的行为模式，至少2-3个关键事件
- **关系设定禁止抽象评价**：不得写"两人关系很好""彼此信任"等空洞描述，必须写具体互动场景（如"每周三下午固定去河边钓鱼，吵架从不超过一天就和好"）
- 绝对不要写泛泛的描述（"美丽的眼睛"、"优雅的身姿"）
- 绝对不要只贴抽象性格标签而不给出具体行为衍生${hasAlignment ? '\n- 角色的行为、决策、价值观必须始终与设定的人格阵营一致，阵营是角色最深层的行为准则' : ''}
- 绝对禁止出现与角色设定矛盾的内容；所有新增细节必须从已有设定中自然生长出来
- **篇幅要求**：description 总长度必须在 3000 字以上，写得越长越详细越好

✅ 正确格式："description": "## 基本信息\\n姓名：冯玉漱\\n年龄：25岁\\n身份：城南铁匠铺学徒\\n与{{user}}关系：邻居\\n\\n## 外貌特征\\n..."
❌ 错误格式："description": "姓名：冯玉漱，年龄：25岁，身份：铁匠铺学徒" ← 缺少 ## 分段标题，绝对禁止！

请只输出 JSON 对象。`,
  };
};

/**
 * Lorebook batch generation prompt (Step 4).
 * Generates world book entries with FULL SillyTavern V2 + runtime parameters.
 * Supports secondary creation: reads existing entries (from Step 2 anchor) and
 * produces updates + new complementary entries.
 */
export const LOREBOOK_GENERATE_PROMPT = (cardName: string, characterSummaries: string, topic: string, batchCount: number, nsfw?: boolean, worldAnchor?: string, _lang: Language = 'zh', existingEntriesContext?: string, rules?: string, minBatchCount?: number) => {
  const actualMinCount = minBatchCount || Math.min(4, batchCount);
  const actualMaxCount = batchCount;
  
  const nsfwBlock = nsfw
    ? `\n\n## NSFW 内容指令\n本角色卡允许生成成人内容（NSFW）。在生成世界书条目时：\n- 可以包含成人向的场景、关系、物品描述\n- 可以包含成人向的背景设定和事件\n- 写作风格应当自然融入世界观，不要刻意强调或过度描写`
    : `\n\n## 内容安全指令\n本角色卡不允许生成成人内容（NSFW）。在生成世界书条目时：\n- 禁止包含任何成人向、性暗示或色情内容\n- 场景和关系描述应当符合全年龄标准\n- 如果世界观中可能涉及敏感内容，请以隐晦、含蓄的方式处理或直接跳过`;

  const existingBlock = existingEntriesContext
    ? `\n\n## 已有世界书条目（必须阅读并在此基础上二创）\n以下是前序步骤已生成的世界书条目。你必须：\n1. 理解已有条目的覆盖范围和写作风格，保持世界观一致性\n2. 对已有条目中可以深化的内容进行「更新」（action=”update”），补充细节、人物、关系\n3. 发现已有条目未覆盖的空白领域，生成「新建」条目（action=”create”）\n4. 更新时不得删除原有信息，只能追加和丰富\n\n${existingEntriesContext}`
    : '';

  return {
  system: `角色卡世界书生成任务：构建一个可扩展、逻辑自洽的世界观。

## 核心写作原则

1. 逻辑通顺：同一角色卡内的所有设定必须自洽，能力、势力、地点、规则、人物之间不能矛盾。新条目必须兼容已有世界书，只补充空白，不得重写或否定已有设定。
2. 语句自然：用简体中文撰写，避免翻译腔和僵硬标签。键值对和列表里的每一项都应是完整、通顺的短语或短句，读起来像自然说明，而不是零散名词堆砌。
3. 剧情作为前置知识库，而非既定叙事：
   - 主线剧情、角色背景、世界历史可以写入世界书，但目的是让对话能基于已发生的事件和当前状态展开。
   - 写法上应是概括性、知识性的说明（时间、原因、结果、影响），不要写成小说式场景、对话或未来必定发生的情节。
   - 事件/档案/传说/历史/纪录/逸闻类条目可包含更具体的时间线和事实，但仍以服务于对话场景为导向。
   - 其他条目（地点、势力、能力、物品、人物关系、文化、规则等）focus on 规则、机制、倾向、可能性。
   - 不写”一定会””只能””必然”等绝对断言，不把后续剧情写死。
4. 多元化与可变性：
   - 世界不是铁板一块，要体现地区差异、时代差异、个体差异。
   - 多用”通常””往往””可能””在某些地区/情境下””常见””罕见””并非绝对”等开放词。
   - 对同一设定可给出 2-3 种变体或例外，为对话互动留有发挥空间。
5. **信息密度：每条 content 至少 500 字**（原要求350字，现提升至500字），覆盖充分细节；每条信息都要说明其实际应用价值。
6. 四问过滤：每句话都要过四问——删了这句会影响理解吗？是信息还是装饰？列表能替代吗？不看原文能理解吗？

${WORLDBOOK_TITLE_CONTENT_RULES}

## 两层架构设计（重要）

世界书应采用「总纲 + 详述」的双层触发结构：
- **总纲层（constant=true, before_char）**：1-2 条全局概述条目，始终注入 AI 上下文。提供世界全貌、核心规则、势力关系网的鸟瞰图。让 AI 在任何对话节点都拥有全局认知。
- **详述层（constant=false, keys 触发）**：大量按需触发的细节条目。只有对话涉及相关关键词时才注入，节省 token。包括具体地点、具体人物、具体组织、具体事件等。

总纲条目命名格式：”XX世界书”或”XX世界总纲”（XX=卡片名）。
详述条目命名格式：精简名词短语标题（2-6字），如”势力格局””经济制度””人物档案”，不加”人物：””势力详述：”等层级前缀。

## 紧凑格式推荐（PList 风格）

对于概述性、枚举性内容，推荐使用紧凑的 PList 格式以节省 token：
  [名称: 一句话描述, has(特征1, 特征2, 特征3), 与XX关系: 友好/敌对/中立]
示例：
  [铁炉堡矮人: 西北山脉锻造城邦联盟, has(精湛锻造, 顽固脾气, 氏族长老制), 与诺顿王国: 坚定盟友, 与地精: 世仇]

对于详述性条目，使用结构化 Markdown：
  **核心概览**: …
  **统治/运作体系**: …
  **关键人物**: …
  **外交/关系态势**: …

${nsfwBlock}

请只输出 JSON 数组，不要加 markdown 代码块，不要加任何解释。`,
  user: `为以下角色卡生成 **至少${actualMinCount}-${actualMaxCount}条** 世界书条目（必须覆盖多个维度，不得只生成1-2条）：

卡片名称：${cardName}
角色：${characterSummaries}
${topic ? `主题/方向：${topic}` : ''}
${worldAnchor ? `\n【世界观锚定（绝对约束，不可偏离）】：\n${worldAnchor}\n生成的所有条目必须严格遵守以上锚定，不得偏离类型/时代/文化背景或违反硬性约束。` : ''}
${rules ? `\n## 世界观约束与运行规则（必须严格遵守）\n${rules}` : ''}
${existingBlock}

**重要数量要求**：
- 最少生成${actualMinCount}条，最多生成${actualMaxCount}条
- 必须覆盖不同类别：至少1条人物/NPC、至少1条关系网络、其他条目从地点/势力/能力/经济等类别中选择
- 不得只生成单一类型的条目

返回一个 JSON 数组，每个对象包含以下全部字段：
{
  “action”: “create 或 update（更新已有条目时填 update，新建填 create）”,
  “targetId”: “当 action=update 时，填已有条目的 id；action=create 时留空字符串”,
  “name”: “条目标题（精简名词短语，2-6字，如：势力格局、经济制度、人物档案）”,
  “keys”: [“关键词1”, “关键词2”],
  “secondary_keys”: [],
  “content”: “详细条目内容，简体中文，至少500字”,
  “comment”: “关于此条目覆盖内容的简短说明”,
  “constant”: false,
  “selective”: false,
  “selectiveLogic”: 0,
  “insertion_order”: 100,
  “position”: “before_char”,
  “priority”: 50,
  “probability”: 100,
  “group”: “”,
  “group_weight”: 100,
  “role”: 0,
  “depth”: 4,
  “exclude_recursion”: false,
  “prevent_recursion”: false,
  “sticky”: 0,
  “cooldown”: 0,
  “delay”: 0,
  “use_regex”: false,
  “match_whole_words”: true,
  “ignore_budget”: false
}

字段说明：
- action：”create”=全新条目，”update”=对已有条目的追加丰富（保留原内容，补充新维度）
- targetId：action=update 时必须填对应已有条目的 id，以便前端合并
- insertion_order：总纲/世界规则=10, 势力/组织=50, 人物/NPC=100, 地点=200, 能力体系=300, 物品=400, 事件/历史=500, 动态模板=900
- priority：核心=100, 普通=50, 点缀=10。数值越低越先被丢弃
- probability：100=始终触发，小于100用于随机事件
- group：互斥条目共享组名（同一组只触发一个）
- group_weight：组内权重，数值越大越优先
- selectiveLogic：0=AND ANY, 1=AND ALL, 2=NOT ALL, 3=NOT ANY
- role：0=系统(默认), 1=用户, 2=助手
- depth：向前扫描多少条消息。4=常规
- sticky/cooldown/delay：以消息数为单位的时间效果。0=禁用
- constant（蓝灯/常驻）：持续生效、不依赖关键词触发的条目。适合总纲、核心世界规则、全局状态。常驻条目不宜过多，通常 1-3 条。
- selective：这是 secondary_keys 过滤开关，不等于普通关键词触发。只有确实填写 secondary_keys 时才允许 selective=true。
- position：世界设定/规则/势力/人物用”before_char”；动态输出模板（告诉AI如何格式化输出）用”after_char”

## ⚠️ 关键词选择规则（极其重要，必须遵守）

**触发词数量限制**：
- **每条条目推荐 1-3 个核心关键词，优先控制在 2 个以内**
- 关键词必须是该条目最核心的实体名（角色名、组织名、地点名）
- 严禁添加次要特征、属性、关联词作为关键词
- 对于关系网络条目，可以包含涉及的双方名称（如["张楚怡", "安念语"]）

**为什么限制关键词数量**：
- 关键词过多会导致误触发，浪费 token
- 参考优秀案例：平均每条约 1.76 个关键词
- 要求：精准命中，宁可少而准，不要多而杂

**关键词选择示例**：
✅ 正确：["张楚怡"] — 只写角色名
❌ 错误：["张楚怡", "继姐", "大学生", "白色衣服", "冷萌"] — 太多且冗余

✅ 正确：["欲望树", "红鲤传媒"] — 两个核心组织名
❌ 错误：["欲望树", "红鲤传媒", "安彭", "传媒公司", "暗网", "控制"] — 过度扩展

**关键词优先级排序**：
1. 角色名 > 组织名 > 地点名 > 物品名 > 抽象概念
2. 如果条目主要讲某个人，就只用这个人名字
3. 如果条目讲多个实体，选最重要的 1-2 个
4. 关系网络条目例外：可以包含关系双方的名称

## 内容写作要求

- 使用键值对和列表格式，不写散文段落
- 全文简体中文
- 不写主观评价，不写AI已知信息
- 只写让AI会出错的差异信息
- 非事件类条目 focus on 规则、机制、可能性、常见表现
- 事件/背景类条目以知识库形式概括时间、原因、结果与影响
- 多用开放词（通常、可能、往往、在某些情境下），少用绝对断言
- 体现多元化：给出变体、例外、地区差异
- **每条 content 至少500字**（原要求350字，现提升至500字），信息量要大，覆盖充分细节
- **具体内容特征**：必须包含精确数值（如”1.5mm朱砂痣”）、品牌名（如”优衣库”）、具体数字（如”80万签约费”）、具体时间（如”六月中旬周六早晨六点四十分”）

## 条目分类覆盖（生成多样化的条目，必须覆盖以下维度）

**强制要求：每批生成的条目中，必须包含以下类别：**
- **至少1条世界总纲/核心资源条目**（类别1）— 如”核洛锥”、”二十六司时代”等全局性设定
- **至少1条人物/NPC种子条目**（类别3）
- **至少1条关系网络条目**（类别4）
- 其他类别根据主题灵活选择，但上述三类不可省略

1. **世界总纲与核心规则/资源**：世界运行的底层逻辑、时代基调、核心限制、关键战略资源（通常 constant=true, selective=true）。参考案例：”核洛锥”条目包含外观、特性、起源、病理学、应用领域、影响等6个维度。
2. **历史时代/背景**：作为前置知识库，说明起因、状态与影响。参考案例：”二十六司时代”包含时代名称、时间跨度、概述、技术水平、终结原因等5个维度。
3. **势力/组织格局**：组织概述 + 详述，每个势力必须包含「关键人物」和「与其他势力的关系态势」
4. **人物/NPC 种子（强制要求）**：重要角色的概括（身份、动机、性格倾向、当前状态、与他人的关系）。人物应编织进势力和地点中，也可独立成条。**每个角色单独成条，不得将多个人物合并到同一条目**。用 PList 格式紧凑呈现，**性格必须用调色盘结构（底色/主色调+行为衍生），不用抽象标签**：[人物名: 身份, 底色:特质(具体行为衍生), 主色调:特质(具体行为衍生), has(能力特长), 关系: 与XX是YY]。示例：[林逸然: 青云门首席弟子, 底色:隐忍克制(被挑衅时微笑不语但指节发白), 主色调:温文尔雅(对所有人先礼后兵，但底线被触碰时出手果决), has(青云剑诀第七层, 阵法精通), 关系: 与苏婉清是青梅竹马，与主角亦敌亦友]。
5. **关系网络（强制要求）**：人物之间、人物与势力之间、势力与势力之间的关系图谱。**必须明确标注关系类型**：同盟/敌对/竞争/从属/暧昧/师徒/血亲等，并写出具体的互动场景或历史事件作为关系的基础。**不得只写”关系良好”等空洞描述**。
6. **重要地点/场景**：环境、氛围、规则、地区差异、驻留人物
7. **力量/能力体系**：等级划分、限制与代价、常见表现、异常情况。尽量给出量化标准
8. **物品/装备体系**：稀有度层级、获取方式、使用规则、常见变体
9. **经济/社会系统**：货币、贸易、阶层、日常生活基准（给出具体数值参考）
10. **动态输出模板/界面**（position=after_char）：告诉 AI 在特定情境下用什么格式输出（如：获得物品时、习得技能时、触发战斗时、投票表决时）。模板条目用 XML 标签包裹格式示例

## 条目递进与平行关系（重要架构原则）

**递进关系（从宏观到微观，层层深入）**：
- 第一层：世界总纲/核心资源（insertion_order=98-100, constant=true, selective=true）— 全局框架与关键战略资源，如"核洛锥"、"二十六司时代"
- 第二层：历史背景/超级大国（insertion_order=99）— 时代脉络与权力格局，如"五大国"、"旧时代公司政府"
- 第三层：势力/组织（insertion_order=100）— 谁在掌控这个世界，权力结构是什么，如"二十一人会"、"联邦中央部委"
- 第四层：人物/NPC（insertion_order=100-101）— 具体的人在这个世界里怎么活，**每个角色单独成条**，如"二号"、"三号"、"佩罗芙"
- 第五层：系统/方法论（insertion_order=200）— 这些人和组织用什么手段达成目的，如"AERAS审计系统"、"投票表决流程"
- 第六层：地点/场景（insertion_order=99-100）— 故事发生的具体场所，如"艾列肯豪森大厦"、"联邦行省与城市"

**平行关系（同层级多条目并列，互相独立但有关联）**：
- 多个人物条目：**每个角色独立成条**，通过共同的组织和事件产生联系。参考案例中13个角色条目各自独立，keys只包含角色名（如["二号"]、["三号"]）
- 多个地点条目：每个地点有自己的特色，但属于同一个世界
- 多个势力条目：每个势力有自己的目标，但彼此之间有互动

**关键词数量控制（基于参考卡分析）**：
- **62.5%的条目没有keys（空数组）**：这些是constant=true的全局设定，不依赖关键词触发
- **有keys的条目平均1.13个关键词**：人物条目通常只用角色名（如["二号"]），历史条目可能用多个相关词（如["二十六司", "旧时代", "公司政府"...]最多9个）
- **任务**：对于constant=true的全局条目，keys可以为空；对于selective=true的触发式条目，推荐1-3个核心关键词
- **严禁为constant条目添加过多关键词**：参考卡中constant条目大多keys为空或只有1-2个核心词

**条目拆分策略（针对超长角色描述）**：
- 如果某个角色的描述超过 1500 字，应该拆分成 2-3 个条目
- 拆分后的条目共享同一个 key（角色名），但 priority 递减（100 → 99 → 98）
- 第一个条目包含基本信息+外貌+性格底色
- 第二个条目包含背景设定+关系设定
- 第三个条目包含特殊能力/秘密/隐藏设定（如果有）

## 更新已有条目时的要求（action=”update”）

- 仔细阅读目标条目的现有 content，理解其覆盖范围
- 补充缺失维度（如：原条目只有地理描述，你补充关键人物和势力关系）
- 保留原有信息不删除，在末尾或合适位置追加新内容
- 输出的 content 是【完整的更新后内容】（原文 + 新增），不是只写增量

请只输出 JSON 数组。`,
  };
};

/**
 * World anchor expansion prompt (Step 2 - 锚定世界观).
 * Based on the 4 structured anchor fields (region / worldType / humanity / constraints),
 * AI generates 1 总纲 entry (constant, before_char) + N 子条目 (locations / rules /
 * organizations / mechanisms) directly as full world book entries — replacing the old
 * skeleton→expand two-phase pipeline.
 */
export const WORLD_ANCHOR_EXPAND_PROMPT = (
  cardName: string,
  anchorText: string,
  existingTitles: string,
  nsfw?: boolean,
  _lang: Language = 'zh',
) => {
  const nsfwBlock = nsfw
    ? `\n\n## NSFW 内容指令\n本角色卡允许生成成人内容（NSFW）。在生成世界书条目时：\n- 可以包含成人向的场景、关系、物品描述\n- 可以包含成人向的背景设定和事件\n- 写作风格应当自然融入世界观，不要刻意强调或过度描写`
    : `\n\n## 内容安全指令\n本角色卡不允许生成成人内容（NSFW）。在生成世界书条目时：\n- 禁止包含任何成人向、性暗示或色情内容\n- 场景和关系描述应当符合全年龄标准\n- 如果世界观中可能涉及敏感内容，请以隐晦、含蓄的方式处理或直接跳过`;

  return {
    system: `角色卡世界书锚定任务：为角色卡锚定世界观框架。基于用户给定的世界观锚定（按从大到小细化：类型 -> 时代/年份 -> 文化背景 -> 人文细节 -> 硬性约束），生成 1 条总纲条目 + 3-6 条子条目，直接作为完整世界书条目加入世界书。

核心写作原则：
1. 逻辑通顺：所有条目必须自洽，与锚定字段一致，不得矛盾。
2. 语句自然：简体中文，键值对和列表里的每一项应是完整、通顺的短语或短句。
3. 剧情作为前置知识库，而非既定叙事：可写入背景历史但仅作概括说明（时间/原因/结果/影响），不写小说式场景、对话或未来必定发生的情节。
4. 多元化与可变性：多用“通常”“往往”“可能”“在某些地区/情境下”“常见”“罕见”“并非绝对”等开放词。同一设定可给出 2-3 种变体或例外。
5. 信息密度：每条 content 至少 350 字，覆盖充分细节，且说明其实际应用价值。
${WORLDBOOK_TITLE_CONTENT_RULES}
${nsfwBlock}

【卡片名称】：${cardName}
【世界观锚定（绝对约束，不可偏离）】：
${anchorText}
${existingTitles ? `\n【已有条目（禁止重复）】：${existingTitles}` : ''}

【输出要求】：
1. 第一条必须是总纲条目：
   - name: "${cardName}世界书"
   - comment: "${cardName}世界书"
   - constant: true（蓝灯常驻）
   - position: "before_char"
   - insertion_order: 0
   - priority: 200
   - content: 350+ 字，概括整个世界观的总体框架（地点/时代/风格/核心规则/基调/整体基调指引），用键值对+列表格式
2. 后续 3-6 条是子条目，根据锚定派生（不重复总纲）：
   - 地点类：如“北京市” → 描述气候/景观/人文/对互动的影响
   - 规则类：如“礼仪”“饮食”“宗教”“货币”“交通” 等人文规则
   - 组织/势力类（如适用）
   - constant 由 AI 判断（核心规则类=true，具体地点/组织=false）
   - position: 大多数 "after_char"；场景设置类用 "before_char"

返回一个 JSON 数组，每个对象包含以下全部字段：
{
  "name": "条目标题（精简准确，2-6字）",
  "keys": ["关键词1", "关键词2"],
  "secondary_keys": [],
  "content": "详细条目内容，简体中文。使用键值对和列表格式，语句自然通顺。",
  "comment": "条目简短说明",
  "constant": false,
  "selective": false,
  "selectiveLogic": 0,
  "insertion_order": 100,
  "position": "after_char",
  "priority": 50,
  "probability": 100,
  "group": "",
  "group_weight": 100,
  "role": 0,
  "depth": 4,
  "exclude_recursion": false,
  "prevent_recursion": false,
  "sticky": 0,
  "cooldown": 0,
  "delay": 0,
  "use_regex": false,
  "match_whole_words": true,
  "ignore_budget": false
}

字段说明：
- insertion_order：背景设定=100, 能力=200, 关系=300, 地点=400, 物品=500, 事件=600
- priority：核心=100, 普通=50, 点缀=10。数值越低越先被丢弃
- constant（蓝灯/常驻）：持续生效、不依赖关键词触发。适合核心世界观、全局运行规则。但常驻条目不宜过多，通常 1-3 条。
- position：大多数用 "after_char"；场景设置类、需要在角色输出之前注入的用 "before_char"
- 关键词：严禁单汉字关键词。用2字以上名称。

请只输出 JSON 数组，不要加 markdown 代码块，不要加任何解释。`,
    user: `为「${cardName}」基于世界观锚定生成 1 条总纲条目 + 3-6 条子条目。第一条 name 必须是 "${cardName}世界书"。`,
  };
};

/**
 * Revise a batch of draft lorebook entries based on user's free-text modification request.
 * Used by the "预览与修改" panel: AI takes the current draft entries + user request and
 * outputs a FULL REPLACEMENT array (not a patch). The caller swaps the draft wholesale.
 *
 * Design choices:
 * - Replacement (not JSON Patch): simpler for AI, less error-prone, draft size is small
 *   (typically ≤10 entries) so token cost is acceptable.
 * - No id/targetId in output: caller regenerates ids from createEmptyLorebookEntry().
 * - Output array length may differ from input: user may ask to merge / split / delete.
 */
export const LOREBOOK_REVISE_PROMPT = (
  _cardName: string,
  anchorText: string,
  currentEntriesJson: string,
  userRequest: string,
  nsfw?: boolean,
  _lang: Language = 'zh',
) => {
  const nsfwBlock = nsfw
    ? `\n\n## NSFW 内容指令\n本角色卡允许生成成人内容（NSFW）。修订时保持原有成人向设定的连贯性，不要无故删除或弱化。`
    : `\n\n## 内容安全指令\n本角色卡不允许生成成人内容（NSFW）。修订时若涉及敏感内容，以隐晦、含蓄的方式处理或直接跳过。`;

  return {
    system: `世界书修订任务：基于用户当前的草稿条目 + 修改需求，输出**完整的新版条目数组（替换式，非 patch）**。

核心修订原则：
1. 最小改动：只调整与用户需求直接相关的内容，用户未提及的部分保持原样（包括 name / keys / constant / position 等结构字段）。
2. 锚定不偏离：所有修订必须与世界观锚定字段一致，不得引入与锚定矛盾的内容。
3. 减少重复：识别条目间重复的内容并合并或精简，让每条都有独立信息价值。
4. 关键词优化：精炼 keys / secondary_keys，剔除无效或冗余关键词，保留 2-4 个高命中率关键词，避免单汉字。
5. 信息密度：被改动的 content 仍需 ≥350 字（若非用户要求精简）；未被改动的 content 保持原长度。
6. 数量可变：用户要求合并/拆分/删除时，输出数组长度可变化。但不要无故增减条目。
7. 总纲条目（name 形如 "xx世界书" 且 constant=true）若存在，必须保留为第一条且维持 constant=true / position="before_char" / insertion_order=0 / priority=200。
${WORLDBOOK_TITLE_CONTENT_RULES}
${nsfwBlock}

【世界观锚定（绝对约束，不可偏离）】：
${anchorText || '（未提供锚定字段）'}

【当前草稿条目（JSON 数组，作为修订基础）】：
${currentEntriesJson}

【用户的修改需求】：
${userRequest}

【输出要求】：
返回一个 JSON 数组，每个对象包含以下全部字段：
{
  "name": "条目标题（精简准确，2-6字）",
  "keys": ["关键词1", "关键词2"],
  "secondary_keys": [],
  "content": "详细条目内容，简体中文。使用键值对和列表格式，语句自然通顺。",
  "comment": "条目简短说明",
  "constant": false,
  "selective": false,
  "selectiveLogic": 0,
  "insertion_order": 100,
  "position": "after_char",
  "priority": 50,
  "probability": 100,
  "group": "",
  "group_weight": 100,
  "role": 0,
  "depth": 4,
  "exclude_recursion": false,
  "prevent_recursion": false,
  "sticky": 0,
  "cooldown": 0,
  "delay": 0,
  "use_regex": false,
  "match_whole_words": true,
  "ignore_budget": false
}

字段说明：
- insertion_order：背景设定=100, 能力=200, 关系=300, 地点=400, 物品=500, 事件=600
- priority：核心=100, 普通=50, 点缀=10。数值越低越先被丢弃
- constant（蓝灯/常驻）：持续生效、不依赖关键词触发。常驻条目不宜过多，通常 1-3 条。
- position：大多数用 "after_char"；场景设置类、需要在角色输出之前注入的用 "before_char"
- 关键词：严禁单汉字关键词。用2字以上名称。

请只输出 JSON 数组，不要加 markdown 代码块，不要加任何解释。`,
    user: `基于上述修改需求，修订这批草稿条目并输出完整新版数组。`,
  };
};

/**
 * Expand a single world book entry into a fuller detailed version.
 * Used by the "AI 展开" button on entries. Replaces the old skeleton→expand pipeline:
 * now all entries are full entries; this just enriches/rewrites one entry on demand.
 */
export const EXPAND_ENTRY_PROMPT = (
  entry: {
    comment: string;
    content: string;
    keys: string[];
    strategy: string;
    position: number;
  },
  characterContext: string,
  userRequirement?: string,
  nsfw?: boolean,
  worldAnchor?: string,
  _lang: Language = 'zh',
) => {
  const nsfwBlock = nsfw
    ? `\n\n## NSFW 内容指令\n本角色卡允许生成成人内容（NSFW）。在展开词条时：\n- 可以包含成人向的场景、关系、物品描述\n- 可以包含成人向的背景设定和事件\n- 写作风格应当自然融入世界观，不要刻意强调或过度描写`
    : `\n\n## 内容安全指令\n本角色卡不允许生成成人内容（NSFW）。在展开词条时：\n- 禁止包含任何成人向、性暗示或色情内容\n- 场景和关系描述应当符合全年龄标准\n- 如果涉及敏感内容，请以隐晦、含蓄的方式处理或直接跳过`;

  return {
    system: `世界书条目扩写任务：扩写/重写以下世界书条目，补充更多细节，使条目内容更加丰富详尽（至少350字）。
【原词条】:
标题: ${entry.comment}
策略: ${entry.strategy}
触发词: ${entry.keys.join(',')}
内容: ${entry.content}
${characterContext ? `\n【角色上下文】：\n${characterContext.substring(0, 3000)}` : ''}${nsfwBlock}
${worldAnchor ? `\n【世界观锚定（绝对约束）】：\n${worldAnchor}\n展开时必须严格遵守以上约束，不得偏离类型/时代/文化背景或违反硬性约束。` : ''}

【任务】：扩写/重写。输出JSON：
{ "comment": "标题（精简准确，2-6字，如：临渊市灰产、欲望树组织、温水切片控制法）", "content": "详细设定（至少350字，使用键值对和列表格式，语句自然通顺）", "keys": ["触发词", "2-5个"], "strategy": "selective 或 constant", "position": ${entry.position} }

蓝灯/绿灯判断：
- 若原条目是核心世界观、全局规则、角色核心背景 → strategy="constant"（蓝灯常驻）
- 若原条目是具体技能、地点、物品、势力细节、可触发事件 → strategy="selective"（绿灯关键词触发）

写作规则：
- 数据库格式、一句一意、每句话过四问。全文简体中文。
- 语句自然：键值对和列表里的每一项应是完整、通顺的短语或短句，不要零散名词堆砌。
- 逻辑自洽：扩写后的内容必须与原条目、角色上下文和已有世界书保持一致，不能自相矛盾。
- 剧情作为前置知识库，而非既定叙事：
  - 若原标题含“事件、档案、传说、历史、纪录、逸闻”等词，或内容是角色背景/世界历史，可加入具体情节和时间线，但只作为对话的背景知识：概括时间、原因、结果、影响，不写小说式场景、对话或未来必定发生的情节。
  - 其他条目 focus on 规则、机制、倾向、可能性、常见表现；不写既定剧情，不用“一定会”“只能”“必然”等绝对断言。
- 多元化与可变性：
  - 多用“通常”“可能”“往往”“在某些地区/情境下”“常见”“罕见”“并非绝对”等开放词。
  - 对同一设定可给出 2-3 种变体或例外，避免世界显得铁板一块。

${WORLDBOOK_TITLE_CONTENT_RULES}

请只输出 JSON，不要加 markdown 代码块。`,
    user: `扩写词条「${entry.comment}」，补充更多细节和内容。${userRequirement ? `额外要求：${userRequirement}` : ''}`,
  };
};

/**
 * First message generation prompt (Step 7).
 * Generates an opening message for the character.
 */
export const FIRST_MESSAGE_PROMPT = (cardName: string, characterDescriptions: string, sceneHint: string, targetWordCount?: number, worldbookContext?: string, writingRequirements?: string, _lang: Language = 'zh', writingStyle?: string) => {
  const lengthInstruction = targetWordCount
    ? `字数控制在 ${targetWordCount} 字左右（允许上下浮动 10%）。`
    : '至少写 1500-2000 字以上，内容越丰富越好。参考高质量危城卡开场白长度（4631字），写得越长越详细越好。';

  // ── 写作要求强化：置于 system prompt 顶部，标记为最高优先级 ──
  const requirementsBlock = writingRequirements
    ? `\n\n## ⚠️ 最高优先级：用户指定的开场白内容要求\n\n以下是用户对开场白内容的**明确要求**，你**必须**按照这些要求来写，**绝对不可忽略或偏离**：\n\n${writingRequirements}\n\n**重要**：以上要求优先于角色设定。如果角色设定与用户要求冲突，以用户要求为准。你必须让开场白的内容、场景、情节与上述要求匹配。\n`
    : '';

  // ── 文风润色：用户选择的文风预设，AI 据此对文本进行风格润色 ──
  const styleBlock = writingStyle
    ? `\n\n## ✍️ 文风润色要求\n\n用户选择了以下文风，你**必须**严格按照该文风的语言风格、叙事节奏和美学要求来撰写开场白：\n\n${writingStyle}\n\n**重要**：文风决定的是"怎么写"（语言风格、叙事手法、修辞方式），而不是"写什么"（情节内容）。在保持角色设定和内容要求不变的前提下，让文本呈现出上述文风的特征。\n`
    : '';

  return {
    system: `角色卡开场白（第一条消息）撰写任务。${requirementsBlock}${styleBlock}

## 开场白的写作规范：

1. **篇幅要求**：${lengthInstruction}

2. **结构要素**：
   - **具体时间标记**：必须包含明确的时间点（如”六月中旬的周六早晨六点四十分”、”午后三点”、”深夜十一点”），让场景有明确的时间锚定
   - **环境描写（多感官）**：用具体的视觉、听觉、触觉、嗅觉、味觉细节建立场景。示例：”阳光顺着窗帘缝隙切进来，在地板上画出一道窄长的光带，光带里飘着极细的灰尘”（视觉）+ “楼下客厅传来塑料零件碰撞的声音”（听觉）+ “楼道里有股老房子特有的潮气混着樟脑丸的味道”（嗅觉）
   - **角色动作与微表情**：通过具体行为展示性格，不要直接说”他很冷漠”，而是写”他抬头看了她一眼，嘴里叼着笔刀，含糊地说了声'姐'，又低下头继续修那个零件”
   - **内心独白或对话**：展示角色的说话风格和思维方式，对话要符合角色身份和性格
   - **钩子结尾**：留下悬念或给用户一个明确的回应入口，但不要一次性把故事讲完

3. **格式规范**：
   - 用 {{user}} 作为用户占位符
   - 角色直接使用其设定名称（不要使用 {{char}} 占位符，因为可能是多角色卡）
   - 分段清晰，每段聚焦一个方面，段落之间要有逻辑过渡
   - 全文使用简体中文
   - 可以使用状态栏宏（如 <%_ setvar('stat_data.角色名.好感度', 50); _%>）来初始化角色状态

4. **人设保持（防止 OOC）**：
   - 即使场景由用户指定，角色的语气、用词、价值观、行为模式也必须与角色设定保持一致。
   - 禁止让角色说出或做出与其性格、背景、关系设定相矛盾的内容。
   - 如果用户要求与角色设定冲突，优先调整场景/处境来兼容角色，而不是让角色崩坏。
   - 不要一次性把故事讲完，要留有余地。

5. **避免**：
   - 不要写得太短、太概括（至少1500字以上）
   - 不要用抽象形容词堆砌（”美丽的眼睛”、”优雅的身姿”）
   - 不要缺少时间标记（必须写明具体时间点）
   - 不要只写单一感官（必须包含至少3种感官：视觉+听觉+嗅觉/触觉/味觉中的至少两种）

请只输出消息正文，不要加引号、标题或其他标签。`,
    user: `为以下角色卡撰写开场白：
${writingRequirements ? `\n⚠️⚠️⚠️ 最重要：用户要求开场白的内容必须围绕以下要求展开，不得偏离：\n${writingRequirements}\n⚠️⚠️⚠️\n` : ''}
${writingStyle ? `\n✍️ 文风要求：请严格按照用户选择的文风润色文本，让语言风格、叙事节奏和修辞方式符合该文风特征。\n` : ''}
名称：${cardName}
角色设定（作为背景参考，但开场白的具体情节必须符合上方的用户要求）：
${characterDescriptions || '(暂无角色描述，请自由发挥)'}
${worldbookContext ? `\n已有世界书设定（不得冲突，但开场白情节优先按用户要求写）：\n${worldbookContext}` : ''}
${sceneHint ? `\n场景：${sceneHint}` : ''}
${targetWordCount ? `\n【字数】约 ${targetWordCount} 字，确保内容充实。` : '\n【字数】至少 1500-2000 字，写得越长越详细越好。参考危城卡开场白长度（4631字）。'}
${writingRequirements ? `\n最后提醒：开场白必须体现用户要求的内容和情节，不能只泛泛地基于角色设定写。` : ''}

**重要写作要求**：
- 必须包含具体的时间标记（如"六月中旬的周六早晨六点四十分"）
- 必须包含多感官描写：视觉+听觉+嗅觉/触觉/味觉中的至少3种
- 必须通过具体行为和微表情展示角色性格，不得用抽象形容词堆砌
- 段落之间要有逻辑过渡，分段清晰

请只输出消息正文。`,
  };
};

/**
 * Generate a single complete world book entry from user's brief text description.
 * User provides a short description (e.g., "一个神秘的地下组织，专门贩卖情报"),
 * AI generates the full entry with name, keys, content, comment, and all runtime parameters.
 */
export const LOREBOOK_ENTRY_FROM_TEXT_PROMPT = (
  cardName: string,
  userDescription: string,
  characterContext?: string,
  nsfw?: boolean,
  worldAnchor?: string,
  _lang: Language = 'zh',
) => {
  const nsfwBlock = nsfw
    ? `\n\n## NSFW 内容指令\n本角色卡允许生成成人内容（NSFW）。在生成条目时：\n- 可以包含成人向的场景、关系、物品描述\n- 写作风格应当自然融入世界观`
    : `\n\n## 内容安全指令\n本角色卡不允许生成成人内容（NSFW）。在生成条目时：\n- 禁止包含任何成人向、性暗示或色情内容\n- 如果涉及敏感内容，请以隐晦、含蓄的方式处理`;

  const charContextBlock = characterContext
    ? `\n\n【角色上下文】：\n${characterContext}\n\n生成的条目必须与上述角色设定保持一致，不得矛盾。`
    : '';

  return {
    system: `世界书条目生成任务：根据用户的简短描述，生成**一条完整的世界书条目**。

核心原则：
1. **从简短描述扩展为丰富条目**：用户只给一句话，你必须扩展成至少500字的详细条目
2. **自动生成所有字段**：包括标题(name)、关键词(keys)、详细内容(content)、注释(comment)、以及所有运行时参数
3. **逻辑自洽**：条目内容必须符合角色设定和世界观锚定（如果有）
4. **信息密度高**：使用键值对和列表格式，一句一意，每句话过四问
5. **语句自然**：简体中文，避免翻译腔和零散名词堆砌

${WORLDBOOK_TITLE_CONTENT_RULES}
${nsfwBlock}

请只输出 JSON 对象，不要加 markdown 代码块，不要加任何解释。`,
    user: `卡片名称：${cardName}${charContextBlock}
${worldAnchor ? `\n【世界观锚定（绝对约束）】：\n${worldAnchor}\n生成的条目必须严格遵守以上约束。` : ''}

【用户的简短描述】：
${userDescription}

---

**任务**：基于用户的简短描述，生成一条完整的世界书条目。

## ⚠️ 关键词选择规则（极其重要，必须遵守）

**触发词数量限制**：
- **每条条目推荐 1-3 个核心关键词**，优先控制在 2 个以内
- 关键词必须是该条目最核心的实体名（角色名、组织名、地点名）
- 严禁添加次要特征、属性、关联词作为关键词

**为什么限制关键词数量**：
- 关键词过多会导致误触发，浪费 token
- 参考优秀案例：平均每条约 1.76 个关键词
- 要求：精准命中，宁可少而准，不要多而杂

**关键词选择示例**：
✅ 正确：["张楚怡"] - 只写角色名
❌ 错误：["张楚怡", "继姐", "大学生", "白色衣服", "冷萌"] — 太多且冗余

✅ 正确：["欲望树", "红鲤传媒"] — 两个核心组织名
❌ 错误：["欲望树", "红鲤传媒", "安彭", "传媒公司", "暗网", "控制"] — 过度扩展

**关键词优先级排序**：
1. 角色名 > 组织名 > 地点名 > 物品名 > 抽象概念
2. 如果条目主要讲某个人，就只用这个人名字
3. 如果条目讲多个实体，选最重要的 1-3 个
4. 对于关系网络条目，可以包含涉及的双方名称（如["张楚怡", "安念语"]）

要求：
1. **name（标题）**：精简名词短语，2-6字，如"情报网络""灰市交易""欲望树组织"
2. **keys（关键词）**：**1-3个核心触发词**，严禁单汉字，用2字以上名称
3. **content（内容）**：至少500字，使用键值对和列表格式，覆盖充分细节
4. **comment（注释）**：关于此条目的简短说明，2-10字
5. **constant（蓝灯/绿灯）**：
   - true（蓝灯常驻）：核心世界观、全局规则、角色核心背景
   - false（绿灯触发）：具体技能、地点、物品、势力细节、可触发事件
6. **position**：大多数用 "after_char"；场景设置类用 "before_char"
7. **其他参数**：按默认值填充（见下方JSON模板）

返回一个 JSON 对象，包含以下全部字段：
{
  "name": "条目标题（精简准确，2-6字）",
  "keys": ["关键词1"],
  "secondary_keys": [],
  "content": "详细条目内容，简体中文，至少500字。使用键值对和列表格式，语句自然通顺。**必须包含精确数值、品牌名、具体数字等细节**。",
  "comment": "条目简短说明",
  "constant": false,
  "selective": false,
  "selectiveLogic": 0,
  "insertion_order": 100,
  "position": "after_char",
  "priority": 50,
  "probability": 100,
  "group": "",
  "group_weight": 100,
  "role": 0,
  "depth": 4,
  "exclude_recursion": false,
  "prevent_recursion": false,
  "sticky": 0,
  "cooldown": 0,
  "delay": 0,
  "use_regex": false,
  "match_whole_words": true,
  "ignore_budget": false
}

字段说明：
- insertion_order：总纲/世界规则=10, 势力/组织=50, 人物/NPC=100, 地点=200, 能力体系=300, 物品=400, 事件/历史=500, 动态模板=900
- priority：核心=100, 普通=50, 点缀=10
- probability：100=始终触发，小于100用于随机事件
- depth：向前扫描多少条消息。4=常规
- constant：true=蓝灯常驻（持续生效），false=绿灯触发（关键词触发）
- position：世界设定/规则/势力/人物用"before_char"；动态输出模板用"after_char"

## 内容质量要求

**具体内容特征（必须包含）**：
- 精确数值：如"身高172cm"、"直径约1.5mm的朱砂痣"、"80万签约费"
- 品牌名/专有名词：如"优衣库"、"YSL416烂番茄色唇釉"、"Adobe Illustrator"
- 具体时间：如"六月中旬的周六早晨六点四十分"、"大一下学期"
- 具体行为：如"每周三下午固定去河边钓鱼，吵架从不超过一天就和好"

**性格调色盘结构（如果生成角色条目）**：
- 底色：[最深层的性格特质]
- [底色trait]衍生一：[日常场景下的典型行为]
- [底色trait]衍生二：[压力/冲突场景下的反应]
- [底色trait]衍生三：[特定对象面前的隐藏表现]
- 主色调：[日常最突出的特质]
- [主色调trait]衍生一/二/三：同上格式
- 点缀：[特定条件下才会出现的隐藏特质]
- [点缀trait]衍生一/二/三：同上格式

**条目拆分策略（如果用户描述的角色很复杂）**：
- 如果描述的内容超过1500字，考虑拆分成2-3个条目
- 拆分后共享同一个key，但priority递减（100→99→98）

请只输出 JSON 对象。`,
  };
};

/**
 * AI Smart Organize prompt.
 * Analyzes all world book entries and suggests optimized parameters.
 * Reference: st-card-builder AI 智能整理 feature.
 */
export const ORGANIZE_ENTRIES_PROMPT = (entries: Array<{
  index: number;
  name: string;
  content: string;
  keys: string[];
  position: string;
  insertion_order: number;
  depth: number;
  probability: number;
  constant: boolean;
}>, _lang: Language = 'zh') => ({
  system: `世界书条目参数优化任务：分析世界书条目并优化它们的运行时参数。

优化规则：
- position: before_char(角色前)=适合背景设定, after_char(角色后)=适合角色相关, before_example(示例前)=适合文风指导, after_example(示例后)=适合输出格式
- insertion_order: 背景设定=10-30, 角色设定=30-60, 能力/技能=60-80, 物品/地点=80-100, 事件/规则=100-120
- depth: 核心设定=2-4(始终检查), 场景相关=6-10(近期消息), 稀有信息=15+(很少触发)
- probability: 核心设定=100, 日常设定=90-100, 稀有/随机事件=10-50
- constant（蓝灯/常驻）: 只有对整个对话都有持续影响的核心世界观、全局规则、角色核心背景才设为 true（最多 2-3 条）。具体技能、地点、物品、势力细节、可触发事件等局部设定应设为 false（绿灯/关键词触发）。

输出 JSON 数组，每个对象包含: { index, position, insertion_order, depth, probability, constant, reason }
reason 用中文简述为什么这样调整。`,
  user: `优化以下 ${entries.length} 个世界书条目的参数：

${entries.map(e => `[${e.index}] "${e.name}"
当前: position=${e.position}, order=${e.insertion_order}, depth=${e.depth}, prob=${e.probability}, constant=${e.constant}
触发词: ${(e.keys || []).join(', ') || '(无)'}
内容摘要: ${e.content.slice(0, 150)}...`).join('\n\n')}

返回优化后的 JSON 数组。只返回需要调整的条目，不需要调整的条目不要包含在结果中。`,
});

/**
 * AI Trigger Key Generation prompt.
 * Generates natural trigger keywords for world book entries.
 * Reference: st-card-builder AI 触发词生成 feature.
 */
export const GENERATE_KEYS_PROMPT = (entries: Array<{
  index: number;
  name: string;
  content: string;
  existingKeys: string[];
}>, _lang: Language = 'zh') => ({
  system: `触发词生成任务：为世界书条目生成自然、精准的触发关键词。

规则：
- 关键词应该是聊天中自然出现的词汇（角色名、地名、物品名、技能名等）
- 严禁单汉字关键词（如"剑"→改为"长剑"或"破晓之剑"）
- 避免过于泛用的词汇（如"老师"→"语文老师"）
- 每个条目 2-5 个关键词
- 角色相关条目必须包含角色名作为关键词
- 关键词应该是具体的名词/专有名词，不要动词和形容词

输出 JSON 数组: [{ index, keys }]`,
  user: `为以下 ${entries.length} 个世界书条目补充触发关键词：

${entries.map(e => `[${e.index}] "${e.name}"
现有关键词: ${e.existingKeys.length > 0 ? e.existingKeys.join(', ') : '(无)'}
内容: ${e.content.slice(0, 200)}`).join('\n\n')}

返回 JSON 数组。只返回需要补充关键词的条目。`,
});

/**
 * AI Card Diagnosis prompt.
 * Analyzes a character card and provides structured diagnostic report.
 */
export const CARD_DIAGNOSIS_PROMPT = (_lang: Language = 'zh') => ({
  system: `角色卡诊断任务：全面分析一张角色卡，发现潜在问题并给出具体改进建议。

诊断维度：
1. **设定完整性** — description 是否涵盖基本信息、外貌、性格、背景、关系
2. **人设一致性** — description/personality/first_mes 之间是否自洽
3. **剧情逻辑** — 开场白是否合理、角色行为是否与设定一致
4. **世界观逻辑** — 世界书条目之间是否矛盾、是否覆盖关键设定
5. **OOC 风险** — 哪些设定可能导致对话中偏离人设
6. **Token 效率** — 是否有冗余内容、是否可以更精简

输出格式：返回 JSON 对象
{
  "overall_score": 0-100, // 总体评分
  "summary": "一句话总体评价",
  "categories": [
    {
      "name": "维度名称",
      "score": 0-100,
      "issues": ["具体问题1", "具体问题2"],
      "suggestions": ["具体改进建议1", "具体改进建议2"]
    }
  ],
  "highlights": ["做得好的地方1", "做得好的地方2"]
}`,
  user: `请诊断以下角色卡：

{cardContent}

请从设定完整性、人设一致性、剧情逻辑、世界观逻辑、OOC风险、Token效率六个维度进行全面诊断。只输出 JSON。`,
});

/**
 * Partial character description modification prompt.
 * Takes the current description + user instructions and returns a modified version.
 * Preserves the overall structure while applying targeted changes.
 */
export const MODIFY_CHARACTER_PROMPT = (characterName: string, otherCharactersContext?: string, _lang: Language = 'zh') => {
  const hasOtherChars = !!otherCharactersContext?.trim();
  const otherCharsBlock = hasOtherChars
    ? `\n\n## 同一作品中的其他角色（已设定，修改时请保持关联一致性）\n${otherCharactersContext}`
    : '';

  return {
  system: `角色卡描述修改任务：根据用户的修改指令，对角色描述进行**局部修改或润色**。

核心原则：
- 保留原描述中不需要修改的部分，不做不必要的重写
- 只在用户指定的方面做出修改，不要擅自改动其他内容
- 如果用户要求"添加"内容，在合适的位置插入新内容，不要删除已有内容
- 如果用户要求"润色"某段，保留原意但提升文字质量
- 保持原描述的格式风格（列表、键值对、标题结构等）
- 保持第三人称写法（用角色名或"他/她"，绝对不要用"你"代称角色）
${hasOtherChars ? '- 修改涉及角色关系时，必须参考其他角色的已有设定，确保关系描述一致且具体' : ''}

输出规则：
- 直接输出修改后的完整描述文本
- 不要加任何解释、前缀或 markdown 代码块
- 不要输出"修改了以下内容"之类的说明`,
  user: `角色名称：${characterName}

## 当前角色描述
{currentDescription}${otherCharsBlock}

## 修改指令
{instructions}

请直接输出修改后的完整描述：`,
};
};

/**
 * Polish/rewrite selected text within a character description.
 * Only rewrites the selected portion while keeping the rest intact.
 */
export const POLISH_SELECTION_PROMPT = (characterName: string, fullText: string, selectedText: string, _lang: Language = 'zh') => ({
  system: `角色卡文字润色任务：用户选中了角色描述中的一段文字，对其进行润色改写。

核心原则：
- 只改写用户选中的部分
- 保持原文的核心信息和意图不变
- 提升文字质量：更具体、更有画面感、更符合角色卡写作规范
- 用具体行为替代抽象标签
- 保持第三人称写法（用角色名或"他/她"，绝对不要用"你"代称角色）
- 保持与上下文一致的格式风格

输出规则：
- 只输出润色后的文字，不要加任何解释
- 不要输出整段描述，只输出选中部分的改写结果`,
  user: `角色名称：${characterName}

## 选中的文字（请润色这段）
${selectedText}

## 上下文参考（仅供理解，不要输出）
${fullText.length > 1000 ? fullText.slice(0, 500) + '\n...(中间省略)...\n' + fullText.slice(-500) : fullText}

请输出润色后的文字：`,
});

/**
 * Staged lorebook prompt (Step 6 - 分阶段世界书).
 * Generates per-stage content for a stage-axis variable (enum or numeric).
 * Output: JSON array of { stageName, content }.
 *
 * Used together with staged-lorebook-builder.ts which wraps the content into:
 *   - 1 constant dispatcher entry (EJS if/else + getWorldInfo)
 *   - N disabled child entries (one per stage)
 */
export const STAGED_LOREBOOK_PROMPT = (
  cardName: string,
  characterSummaries: string,
  stageAxisPath: string,
  stages: Array<{ name: string; condition?: string }>,
  topic: string,
  existingWorldbookContext: string,
  nsfw: boolean,
  _lang: Language = 'zh',
) => ({
  system: `分阶段世界书生成任务。这次任务不是写小说，而是为每个阶段编写人设说明，描述角色在该阶段的行为模式。

## 背景
角色卡「${cardName}」用一个阶段轴变量 \`${stageAxisPath}\` 来推动剧情/人设变化。你要为下面每个阶段写一条子条目，调度条目会按变量值互斥地把对应内容喂给 AI。

## 阶段轴
${stages.map((s, i) => `${i + 1}. ${s.name}（触发：${s.condition}）`).join('\n')}

## 怎么写（让内容具体可执行）
- **阶段要分得开**：每个阶段写出"只有到了这步才会出现"的状态、行为、语气。别写放之四海皆准的套话。
- **写行为，不写标签**：不要贴"变得冷漠""开始依赖"这种结论，写"她回消息从秒回变成隔半天才回，回了也只有两三个字"这类可被 AI 直接复现的行为。
- **给 AI 留余地**：多用"往往""可能""有时""在压力下"，少用"总是""一定""永远"。
- **要有过渡感**：相邻阶段之间让读者/AI 能感受到"是怎么从上一阶段滑过来的"，但别写成固定剧情。
- **不碰已有设定**：只补该阶段的差异信息，不翻案、不覆盖世界书里已经写好的东西。

## 内容结构（每个阶段都尽量覆盖）
- 心理状态：具体念头、反复出现的想法、身体感受，不要只写"她感到悲伤"。
- 行为模式：可复现的动作、习惯、反应，2-4 条。
- 对话风格：整体语气 + 2-3 句典型台词（用引号）。
- 对他人的态度：用具体行为体现态度变化，1-2 条。
- 触发/消退条件：什么情况下更容易进入或离开这个阶段，1-2 条。
- 身体/环境细节：与该阶段相关的习惯性动作、表情、姿态、穿着或环境线索。

## 禁词与禁用表达（会让输出变人机）
不要写：
- 模糊词：似乎、几乎、仿佛、如同、宛如、某种
- 机械判断：该阶段角色表现为… / 角色会… / 在此阶段…（改成"她这时会…""到了这步…"）
- 空泛形容词：极度、非常、特别、巨大的、深刻的
- 廉价比喻：像小兽、心湖泛起涟漪、投石入湖
- 模板微表情：嘴角上扬、眼里闪过光芒、指尖泛白、咬紧下唇
- 八股句式：不是…而是… / 虽然…但是… / 在…的同时
- 价值升华：最终明白了、终于懂得了、这一刻她意识到

${nsfw
    ? '## 成人内容\n本卡允许成人内容。涉及亲密或堕落描写时，从"为什么做"和"怎么做"入手，写得具体、有动机，不要标签式概括。'
    : '## 内容安全\n本卡禁止成人向/性暗示内容。亲密关系用留白、暗示、边界感来处理，不要直接描写。'}

## 角色信息
${characterSummaries || '(未提供角色信息，请基于阶段名合理推断)'}

${existingWorldbookContext ? `## 已有世界书（必须兼容）\n${existingWorldbookContext}` : ''}
${topic ? `## 额外要求\n${topic}` : ''}

## 输出格式
只输出 JSON 数组，不要 markdown 代码块，不要解释：
[
  { "stageName": "${stages[0]?.name || '阶段1'}", "content": "该阶段内容，键值对格式，至少500字" },
  ...
]
stageName 必须和上面给定的阶段名完全一致，顺序一致。`,
  user: `为「${cardName}」的阶段轴 \`${stageAxisPath}\` 写 ${stages.length} 个阶段的子条目。每条至少 500 字，阶段之间要明显不同，用键值对格式，尽量丰富。`,
});

/**
 * Auto staged lorebook prompt (Step 6 - AI 读世界书自动生成全套配置).
 * Reads existing worldbook entries, picks a stage axis, generates full config:
 *   - axisPath / axisType / numericDirection
 *   - stages: [{ name, condition, content }]
 *
 * Output: single JSON object.
 */
export const AUTO_STAGED_LOREBOOK_PROMPT = (
  cardName: string,
  characterSummaries: string,
  existingWorldbookContext: string,
  topic: string,
  nsfw: boolean,
  _lang: Language = 'zh',
) => ({
  system: `分阶段世界书自动生成任务：先读已有的世界书和角色信息，找出剧情/人设里最自然的"变化轴"，然后设计一套分阶段世界书配置。

## 你要做什么
- 选一个合适的"阶段轴变量"（比如关系阶段、堕落度、时间线、心理天平）。
- 把变化切成 3~6 个阶段，每个阶段给一段可直接使用的阶段说明。

## 阶段轴结构（必须按这个格式输出）
- axisPath：点分路径，比如「关系.阶段」「堕落.阶段」「时间.阶段」。
- axisType：'enum' 或 'number'。enum 适合离散的命名阶段，number 适合数值渐变。
- numericDirection：只有 axisType='number' 时才用，'>=' 或 '<='。
- stages：3~6 个阶段，每个含 name / condition / content。
  - enum 阶段：condition 写成 \`=== '阶段名'\`
  - number 阶段：condition 写成 \`>= 70\` 或 \`<= 20\`

## 阶段顺序（至关重要）
调度条目用 if/else if 判断，**一旦命中前面的条件，后面的条件就不会再执行**。所以 stages 数组必须按"从最极端到最初始"排序：
- 如果 numericDirection 是 ">="：阈值从高到低排。例如 ">= 90"、">= 70"、">= 40"、">= 0"。
- 如果 numericDirection 是 "<="：阈值从低到高排。例如 "<= -80"、"<= -40"、"<= 0"。
- 输出前检查顺序，确保没有低阈值排在高阈值前面导致覆盖。

## 怎么设计阶段
- **从已有内容里找变化轴**：关系远近、心理状态、时间推进、堕落/救赎、势力归属等，选最能让人设产生明显差异的那个。
- **阶段之间要拉开差距**：每个阶段的 content 必须写出"只有到了这步才会出现"的东西，不要各阶段长得差不多。
- **写行为，不写标签**：不要给角色贴结论，要写具体可执行的行为。比如不要写"她变得依赖"，要写"她开始下意识坐得离对方很近，对方离开时会反复看手机"。
- **给变化留余地**：多用"往往""可能""有时""在压力下"，少用"总是""一定""永远"。
- **有过渡感**：相邻阶段要让 AI 能感受到变化是怎么滑过来的，但别写成固定剧情。
- **不翻案**：只补充各阶段的差异信息，不否定或覆盖已有世界书里的设定。

## 每个阶段的内容结构（尽量覆盖）
- 心理状态：具体念头、反复出现的想法、身体感受。
- 行为模式：可复现的动作、习惯、反应，2-4 条。
- 对话风格：整体语气 + 2-3 句典型台词（用引号）。
- 对他人的态度：用具体行为体现态度变化，1-2 条。
- 触发/消退条件：什么情况下更容易进入或离开这个阶段，1-2 条。
- 身体/环境细节：与该阶段相关的习惯性动作、表情、姿态、穿着或环境线索。

## 禁词与禁用表达（会让输出变人机）
不要写：
- 模糊词：似乎、几乎、仿佛、如同、宛如、某种
- 机械判断：该阶段角色表现为… / 角色会… / 在此阶段…
- 空泛形容词：极度、非常、特别、巨大的、深刻的
- 廉价比喻：像小兽、心湖泛起涟漪、投石入湖
- 模板微表情：嘴角上扬、眼里闪过光芒、指尖泛白、咬紧下唇
- 八股句式：不是…而是… / 虽然…但是… / 在…的同时
- 价值升华：最终明白了、终于懂得了、这一刻她意识到

${nsfw
    ? '## 成人内容\n本卡允许成人内容。涉及亲密或堕落描写时，从动机和具体行为入手，不要标签式概括。'
    : '## 内容安全\n本卡禁止成人向/性暗示内容。亲密关系用留白、暗示、边界感处理。'}

## 角色信息
${characterSummaries || '(未提供角色信息，请基于世界书内容合理推断)'}

## 已有世界书（必须兼容，作为设计依据）
${existingWorldbookContext || '(无已有世界书，请基于角色信息自主设计)'}

${topic ? `## 用户引导（必须遵循）\n${topic}` : ''}

## 输出格式
只输出一个 JSON 对象，不要 markdown 代码块，不要解释：
{
  "axisPath": "关系.阶段",
  "axisType": "enum",
  "numericDirection": ">=",
  "stages": [
    { "name": "陌生人", "condition": "=== '陌生人'", "content": "该阶段内容，键值对格式，至少500字" },
    { "name": "朋友", "condition": "=== '朋友'", "content": "..." },
    ...
  ]
}
stages 数量 3~6 个，content 至少 500 字，尽量丰富。`,
  user: `读取「${cardName}」的已有世界书，找出最合适的阶段轴并生成整套分阶段世界书配置。每个阶段内容至少 500 字，尽量丰富。${topic ? `用户引导：${topic}` : ''}`,
});

/**
 * Single-stage re-roll prompt (分阶段弹窗 - 单阶段重生).
 * Regenerates one stage's content with optional guidance, keeping other stages intact.
 *
 * Output: plain text content (no JSON wrapper).
 */
export const STAGE_REROLL_PROMPT = (
  cardName: string,
  characterSummaries: string,
  stageAxisPath: string,
  stageName: string,
  stageCondition: string,
  siblingStages: Array<{ name: string; content?: string }>,
  existingWorldbookContext: string,
  guidance: string,
  nsfw: boolean,
  _lang: Language = 'zh',
) => ({
  system: `阶段内容重写任务：重写「${cardName}」阶段轴 \`${stageAxisPath}\` 下的「${stageName}」阶段（触发条件：${stageCondition}），让这个阶段的条目更鲜活、更具体。

## 同轴其他阶段（避开重复）
${siblingStages.map((s) => `- ${s.name}：${(s.content || '').slice(0, 120)}...`).join('\n') || '(无其他阶段)'}

## 怎么重写
- **只动「${stageName}」**：写出"只有到了这步才会出现"的状态、行为、语气。
- **写行为，不写标签**：把"变得冷漠"改成"她回消息从秒回变成隔半天，回了也只有两三个字"这类 AI 能直接复现的行为。
- **衔接自然**：让 AI 能看出这个阶段是怎么从上一个阶段滑过来的，但别写成固定剧情。
- **不翻案**：不否定已有世界书里的设定。
- **至少 500 字**，尽量丰富。

## 内容结构（尽量覆盖）
- 心理状态：具体念头、反复出现的想法、身体感受。
- 行为模式：可复现的动作、习惯、反应，2-4 条。
- 对话风格：整体语气 + 2-3 句典型台词（用引号）。
- 对他人的态度：用具体行为体现态度变化，1-2 条。
- 触发/消退条件：什么情况下更容易进入或离开这个阶段，1-2 条。
- 身体/环境细节：与该阶段相关的习惯性动作、表情、姿态、穿着或环境线索。

## 禁词与禁用表达（会让输出变人机）
不要写：
- 模糊词：似乎、几乎、仿佛、如同、宛如、某种
- 机械判断：该阶段角色表现为… / 角色会… / 在此阶段…
- 空泛形容词：极度、非常、特别、巨大的、深刻的
- 廉价比喻：像小兽、心湖泛起涟漪、投石入湖
- 模板微表情：嘴角上扬、眼里闪过光芒、指尖泛白、咬紧下唇
- 八股句式：不是…而是… / 虽然…但是… / 在…的同时
- 价值升华：最终明白了、终于懂得了、这一刻她意识到

${nsfw
    ? '## 成人内容\n本卡允许成人内容。亲密或堕落描写从动机和具体行为入手，不要标签式概括。'
    : '## 内容安全\n本卡禁止成人向/性暗示内容。亲密关系用留白、暗示、边界感处理。'}

## 角色信息
${characterSummaries || '(未提供)'}

${existingWorldbookContext ? `## 已有世界书约束\n${existingWorldbookContext}` : ''}
${guidance ? `## 用户引导（必须遵循）\n${guidance}` : ''}

## 输出格式
直接输出这个阶段的 content 内容（键值对格式），不要输出 JSON 外壳，不要 markdown 代码块，不要加阶段名前缀。`,
  user: `重写「${stageName}」阶段的内容。${guidance ? `引导：${guidance}` : ''}`,
});

/**
 * Multi-char template prompt - Step 1: 识别角色.
 * AI reads worldbook entries and returns a list of detected characters.
 *
 * Output: JSON array of { name, comment, summary, suitable }
 */
export const MULTI_CHAR_DETECT_PROMPT = (
  cardName: string,
  existingWorldbookContext: string,
  templateId: string,
  templateName: string,
  _lang: Language = 'zh',
) => {
  const tpl = getStagedTemplateById(templateId);
  const suitabilityHint = tpl?.characterSuitabilityHint ?? '需要可发展剧情的角色';
  return {
    system: `世界书角色识别任务：读取下面的已有世界书条目，识别出其中的"角色"条目（人名/人称/人设），排除掉场景/道具/设定/规则条目。

## 判定规则
- 角色条目：描述某个具体人物的设定（姓名、外貌、性格、身份、关系等）
- 非角色条目：场景描述、世界设定、道具、规则、时间线、系统说明等
- 适合性：判断该角色是否适合套用「${templateName}」模板（${suitabilityHint}）

## 输出格式
只输出 JSON 数组，不加 markdown 代码块，不加解释：
[
  { "name": "角色名（用作变量前缀，须简短2-4字，去掉称谓后缀如同学/小姐）", "comment": "原条目 comment", "summary": "一句话概括角色身份", "suitable": true },
  ...
]
suitable 为 boolean。若全部不适合，返回空数组 []。`,
    user: `分析「${cardName}」的世界书，识别适合套用「${templateName}」模板的角色。

## 已有世界书条目
${existingWorldbookContext || '(无世界书)'}`,
  };
};

/**
 * Multi-char template prompt - Step 2: 多角色套模板生成变量.
 * 对每个确认的角色，套用指定模板生成「角色名前缀」的变量组。
 *
 * Output: JSON object { sections, updateRules, statusBar }
 */
export const MULTI_CHAR_TEMPLATE_PROMPT = (
  cardName: string,
  templateId: string,
  templateName: string,
  templateBlueprint: string,
  characters: Array<{ name: string; summary: string }>,
  existingWorldbookContext?: string,
  _lang: Language = 'zh',
) => {
  const tpl = getStagedTemplateById(templateId);
  const axisVarName = tpl?.axisVariableName ?? '情感天平';
  const firstCharName = characters[0]?.name || '角色';
  // 检测模板是否含隐藏标记（$ 前缀变量）
  const hiddenFlags = tpl?.sections[0]?.variables.filter(v => v.prefix === '$') ?? [];
  const hasHiddenFlags = hiddenFlags.length > 0;
  const hiddenFlagsRule = hasHiddenFlags
    ? `- 该模板包含隐藏标记（path 以 "$" 开头，初始 false，仅用于一次性事件防重复）：每个角色都需生成对应的隐藏标记，标记名与模板蓝图一致，只是前缀替换为角色名\n- 隐藏标记的 updateRule：初始 false，仅在对应特殊事件触发时设为 true，日常互动不修改`
    : '- 该模板不含隐藏标记，每个角色只生成阶段轴变量即可';
  const worldbookBlock = existingWorldbookContext?.trim()
    ? `\n\n## 已有世界书设定（变量描述、阶段名、更新规则须与以下设定保持一致）\n${existingWorldbookContext.trim()}`
    : '';
  return {
    system: `MVU 变量组生成任务：对每个给定角色，套用「${templateName}」模板蓝图，生成以"角色名前缀"命名的独立变量组。

## 模板蓝图（${templateName}）
${templateBlueprint}

## 待生成角色
${characters.map((c, i) => `${i + 1}. ${c.name}：${c.summary}`).join('\n')}${worldbookBlock}

## 命名规则（必须遵循）
- 每个角色的变量路径必须以该角色名开头作为前缀，如「${firstCharName}.${axisVarName}」
- 严禁使用通用前缀"角色"或"关系"，必须替换为具体角色名
- 不同角色的变量必须独立，不共享
- 同一模板下不同角色的变量结构保持一致（同样的变量名，只是前缀不同）

## 输出格式
只输出一个 JSON 对象，不加 markdown 代码块，不加解释：
{
  "sections": [
    {
      "name": "${firstCharName}",
      "variables": [
        { "path": "${firstCharName}.${axisVarName}", "type": "number", "description": "...", "initialValue": 0, "rangeMin": 0, "rangeMax": 100, "categories": [{"range": ">= 90", "label": "..."}, ...] },
        ...
      ]
    },
    ...（每个角色一个 section，section.name = 角色名）
  ],
  "updateRules": [
    { "path": "${firstCharName}.${axisVarName}", "type": "number", "range": "0~100", "check": ["..."] },
    { "path": "角色名.内心独白", "type": "string", "format": "replace", "check": ["当角色产生新的内心想法时更新", "格式为角色的内心独白文本"] }
  ],
  "statusBar": {
    "title": "状态栏标题（纯中文，不含 emoji）",
    "showVariables": ["${firstCharName}.${axisVarName}", ...],
    "styleHint": "风格关键词"
  }
}

## 规则
- 严格按模板蓝图的变量结构生成，只是把通用前缀替换为角色名
- 阶段轴变量必须用 number 类型 + categories 字段：categories 是阈值分段数组，每段含 {"range": ">= 阈值" 或 "<= 阈值", "label": "阶段名"}，顺序从高到低（或从极端到初始）
- updateRules 的 check 规则中要把模板蓝图里的分区名替换为对应角色名
- 对于字符串（string）、布尔（boolean）或其他非数值类型的变量，必须生成对应的 updateRule，并指定 format 字段（字符串通常为 replace，布尔根据具体逻辑可能为 replace 或 delta）
${hiddenFlagsRule}
- statusBar.showVariables 只显示可见变量，隐藏标记（"$"前缀）不显示；每个角色显示最关键的 1-2 个可见变量
- 若角色超过 3 个，状态栏只显示前 3 个角色的关键变量
- 变量的 description、categories.label、updateRules.check 等文本内容须贴合已有世界书设定中该角色的性格、背景与关系，不得脱离原设定泛泛而谈`,
    user: `为「${cardName}」的 ${characters.length} 个角色套用「${templateName}」模板，生成多角色变量组。`,
  };
};

// ──────────────────────────────────────────────────────────────────────────
// 分阶段模式（StepStagedMode）提示模板
// ──────────────────────────────────────────────────────────────────────────

/**
 * 阶段框架剖析：AI 读取已有世界书 + MVU 变量 + 用户要求，
 * 为每个适合的角色剖析出阶段轴变量 + 阶段划分（含可修改阈值 + 简单人设/剧情注解）。
 */
export const STAGED_ANALYZE_PROMPT = (
  cardName: string,
  templateId: string,
  existingWorldbookContext: string,
  mvuVariablesContext: string,
  userRequirement: string,
  _lang: Language = 'zh',
) => {
  const tpl = getStagedTemplateById(templateId);
  const label = getTemplateLabel(templateId);
  const suitabilityHint = tpl?.characterSuitabilityHint ?? '需要可发展剧情的角色';
  const analyzeHint = tpl?.analyzeHint ?? '阶段轴必须是模板预设的 number 类型变量，方向与模板一致。';
  const specialRules = tpl?.specialRulesHint;
  return {
    system: `阶段框架剖析任务：读下面的世界书和 MVU 变量，找出适合「${label}」这条线的角色，然后为每个角色搭一个"阶段轴"框架。

## 你要输出什么
对每个合适角色，给出：
1. 一个已定义的 MVU 变量当"阶段轴"（优先 number 类型，比如好感度、堕落度、情感天平）。
2. 把变量切成若干阶段（用阈值区间，如 ">= 90" / "<= -80"），给每个阶段起个阶段名。
3. 每个阶段写一句 20-40 字的注解，描述角色在这个阶段里的心理或行为状态。

## 怎么识别角色
- 含具体人名 + 人设 + 与主角关系 = 角色。
- 只写场景/道具/世界观 = 跳过。
- 角色要适合当前模板：${suitabilityHint}。
${specialRules ? `\n## 特殊规则\n${specialRules}\n` : ''}
## 根据模板选阶段轴（变量必须契合）
当前模板为「${label}」，选择阶段轴时请严格匹配模板预设变量，不要乱用其他模板变量：
${analyzeHint}
- 隐藏事件标记（$ 前缀）只用于一次性事件防重，不作为阶段轴。

## 阶段怎么切
- 阶段轴变量必须是 number 类型，用 ">=" 或 "<=" 阈值分段。
- 4-9 个阶段，覆盖从初始到极端的完整变化。
- 当前模板范围：${tpl?.axisRange ?? '0~100'}，方向：${tpl?.axisDirection ?? '>='}。
- 阈值区间要连续、不重叠、覆盖全范围。
- condition 格式：">= 阈值" 或 "<= 阈值"，不要外层括号。

## 阶段顺序（至关重要）
调度条目用 if/else if 判断，**一旦命中前面的条件，后面的条件就不会再执行**。所以 stages 数组必须按"从最极端到最初始"排序：
- 如果 numericDirection 是 ">="：阈值从高到低排。例如 stages 依次为 ">= 90"、">= 70"、">= 40"、">= 0"。
- 如果 numericDirection 是 "<="：阈值从低到高排。例如 stages 依次为 "<= -80"、"<= -40"、"<= 0"。
- 你必须在输出前检查这个顺序，确保没有低阈值排在高阈值前面导致覆盖。

## 注解怎么写（避免人机感）
- 写状态，不写结论。比如不要写"她陷入爱恋"，要写"她开始把对方的消息置顶，看到名字会下意识地笑"。
- 20-40 字，一句完整的话。
- 不要用：似乎、仿佛、极度、深刻、最终明白了、终于懂得了。

## 输出格式
只输出一个 JSON 对象，不要 markdown 代码块，不要解释：
{
  "characters": [
    {
      "name": "角色名",
      "sourceComment": "来源世界书条目 comment",
      "summary": "一句话身份概括",
      "axisPath": "角色名.变量名（必须与 MVU 变量路径完全一致）",
      "axisType": "number",
      "numericDirection": ">=" 或 "<=",
      "stages": [
        { "name": "阶段名", "condition": ">= 90", "annotation": "20-40字的状态描述" },
        ...
      ]
    }
  ]
}`,
    user: `卡片名：「${cardName}」
剧情标签：${label}

【已有世界书条目】
${existingWorldbookContext || '（无）'}

【MVU 已定义变量】
${mvuVariablesContext || '（无，请提醒用户先在 MVU 步骤定义变量）'}

【用户要求】
${userRequirement || '（无特殊要求，按模板默认弧光剖析）'}

请为适合这条线的每个角色搭出阶段框架。`,
  };
};

/**
 * 单个阶段注解重 roll：为指定角色的某个阶段重新生成人设/剧情注解。
 */
export const STAGE_REROLL_ANNOTATION_PROMPT = (
  cardName: string,
  templateId: string,
  characterName: string,
  characterSummary: string,
  axisPath: string,
  stageName: string,
  stageCondition: string,
  _existingWorldbookContext: string,
  guidance: string,
  _lang: Language = 'zh',
) => {
  const label = getTemplateLabel(templateId);
  return {
    system: `阶段注解重写任务：为「${characterName}」的「${stageName}」阶段重新写一句注解。

## 角色
${characterName}：${characterSummary}

## 阶段
- 阶段轴变量：${axisPath}
- 阶段名：${stageName}
- 触发条件：${stageCondition}
- 剧情标签：${label}。
- 注解方向必须与当前模板保持一致，按阶段轴变量的增减方向写对应的状态变化。

## 怎么写
- 20-40 字，一句完整的话。
- 写具体状态，不要写结论。比如不要写"她开始动摇"，要写"她开始避开对方的视线，却总在人群里第一个找到他"。
- 阈值越极端，状态越深入、越具体。
- 不要用：似乎、仿佛、极度、深刻、最终明白了、终于懂得了。
${guidance ? `- 用户引导：${guidance}` : ''}

只输出注解文本本身，不要引号、不要 markdown、不要解释。`,
    user: `卡片「${cardName}」，重 roll「${characterName}」的「${stageName}」阶段注解。`,
  };
};

/**
 * 阶段世界书生成：为每个角色的每个阶段生成详细的人设/剧情子条目内容，
 * 并由前端用参考卡风格的 EJS 调度条目 + getWorldInfo() 拉取子条目。
 */
export const STAGE_ENTRY_GENERATE_PROMPT = (
  cardName: string,
  templateId: string,
  characterName: string,
  characterSummary: string,
  axisPath: string,
  stages: Array<{ name: string; condition: string; annotation: string }>,
  _existingWorldbookContext: string,
  nsfw: boolean,
  guidance: string,
  _lang: Language = 'zh',
) => {
  const label = getTemplateLabel(templateId);
  const tpl = getStagedTemplateById(templateId);
  const stageContentHint = tpl?.stageContentHint ?? '阶段内容要与阶段轴变量的方向保持一致，不能写出与变量方向相反的人设。';
  const specialRules = tpl?.specialRulesHint;
  return {
    system: `阶段人设生成任务：为「${characterName}」的每个阶段写一份可直接使用的阶段人设子条目，调度条目会用 getWorldInfo() 按需拉取。

## 角色
${characterName}：${characterSummary}

## 阶段轴
变量：${axisPath}，剧情标签：${label}

## 阶段列表
${stages.map((s, i) => `${i + 1}. ${s.name}（${s.condition}）：${s.annotation}`).join('\n')}

## 路线默认与变量契合
当前模板为「${label}」，每个阶段的内容必须与阶段轴变量保持一致，不能写出与变量方向相反的人设：
${stageContentHint}
${specialRules ? `\n${specialRules}` : ''}

## 每个阶段的内容结构（键值对 + 自然段混合，作为 content 字段的字符串值，尽量覆盖）
- 心理动态：用具体念头、反复出现的想法、身体感受来表现，不要写"她感到悲伤"这种结论。2-4 条。
- 行为模式：写 AI 能直接复现的动作、习惯、反应。比如"她开始下意识把对方的消息置顶"，而不是"她开始在意对方"。3-5 条。
- 对话风格：该阶段说话的整体语气 + 3-5 句典型台词（用引号包裹）。台词要符合性格和当下心理状态，不要写成鸡汤或宣言。
- 对其他角色的态度：态度变化用具体行为体现，1-2 条。
- 触发/消退条件：什么情境下更容易进入或离开这个阶段，1-2 条。
- 身体/环境细节：与该阶段相关的习惯性动作、表情、姿态、穿着、环境线索或生理反应，2-3 条。
- 记忆/闪回：该阶段容易想起什么、被什么触发，1-2 条。

## 怎么写才不像人机
- 阶段之间要明显不同，每个阶段写出"只有到了这步才会出现"的东西。
- 给变化留余地：多用"往往""可能""有时""在压力下"，少用"总是""一定""永远"。
- 不写固定剧情，只写状态和倾向。
- 内容要饱满：每个阶段 400-800 字，信息密度高，不要一句话带过。

## 禁词与禁用表达
不要写：
- 模糊词：似乎、几乎、仿佛、如同、宛如、某种
- 机械判断：该阶段角色表现为… / 角色会… / 在此阶段…
- 空泛形容词：极度、非常、特别、巨大的、深刻的
- 廉价比喻：像小兽、心湖泛起涟漪、投石入湖
- 模板微表情：嘴角上扬、眼里闪过光芒、指尖泛白、咬紧下唇
- 八股句式：不是…而是… / 虽然…但是… / 在…的同时
- 价值升华：最终明白了、终于懂得了、这一刻她意识到

${guidance ? `## 用户引导（必须遵循）\n${guidance}\n` : ''}## 内容边界
- ${nsfw ? '允许成人内容。堕落/黑化向阶段可以从动机和具体行为入手写露骨描写，不要标签式概括。' : '禁止成人向露骨内容。亲密关系用暗示、留白、边界感处理。'}

## 输出格式
只输出一个 JSON 对象，不要 markdown 代码块，不要解释：
{
  "entries": [
    { "stageName": "阶段名", "content": "该阶段的子条目内容。用键值对+自然段混合，\\n 换行，作为 content 字段的字符串值。" },
    ...
  ]
}
entries 数组顺序与输入阶段列表一致。`,
    user: `为「${cardName}」的「${characterName}」写 ${stages.length} 个阶段的子条目内容。`,
  };
};

