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
 *   - description → Permanent Token (角色大纲/扮演指南，directive style)
 *   - personality → Permanent Token (性格调色盘: 底色+主色调+点缀)
 *   - appearance → Merged into description on export
 *   - scenario → Permanent Token (dialogue circumstances, user-filled)
 *   - character_book.entries → Dynamic keyword-triggered entries (World Book)
 */

/**
 * Character generation prompt (Step 2).
 * The user's 角色设定 is treated as CONSTRAINT INSTRUCTIONS for the AI.
 * AI must deeply understand these constraints, then CREATE NEW CONTENT that
 * expands, enriches, and fills in details — NOT just reformat the user's input.
 *
 * Writing methodology: 性格调色盘 (Personality Palette) from tavern-cards.
 */
export const CHARACTER_GENERATE_PROMPT = (characterName: string, userConstraints: string) => {
  const hasConstraints = userConstraints?.trim().length > 0;

  return {
    system: `你是一位资深的 SillyTavern 角色卡作者。你的核心工作：

**用户给出简短的约束指令 → 你产出一份详尽、丰满的角色描述，篇幅必须是用户输入的 3-5 倍以上。**

至关重要——扩展是必须的：
- ❌ 错误做法：把用户的输入重新排版、换成分段格式就交差
- ❌ 错误做法：只给用户的原文加几个标题
- ✅ 正确做法：从用户的约束中生长出全新的、具体的内容
- ✅ 正确做法：替用户想象那些他没写但角色必须有的细节
- 最终输出的描述中，必须有大量用户没写过的全新内容

扩展技法（全部都要用）：
1. 具象化：用户写"傲娇" → 你写："对话时频繁使用反问句回避真实想法；被夸奖时会别过头说'才不是'；但独处时会反复回想对方的话"
2. 补充缺失维度：用户只写了性格 → 你补充年龄、身份、背景、外貌特征、人际关系
3. 构建具体场景：用户写"喜欢剑术" → 你写："每日清晨在后院练剑一小时；拥有一把名为'霜落'的铁剑；左手虎口有常年握剑的茧"
4. 推导因果关系：用户写"孤儿" → 你推导出："对'家'的概念敏感；下意识收集食物；对表示善意的人会先保持距离再慢慢靠近"
5. 关系具体化：用户写"和XX是朋友" → 你写："有记忆起就在一起；每周三固定去河边钓鱼；吵架从不超过一天就会和好"

写作规则：
- 行为展现性格：通过具体行为和场景展现性格，不用抽象标签
- 一句一意：写完一个态度就停，不补述同一件事
- 数据库格式：用列表和键值对，不用散文段落
- 每句话过四问：(1) 删了这句AI会错吗？不会→删 (2) 是信息还是装饰？装饰→删 (3) 列表能替代吗？能→改列表 (4) 不看原文能理解吗？不能→补关键信息

请只输出 JSON，不要加 markdown 代码块，不要加任何解释。`,
    user: hasConstraints
      ? `角色名称："${characterName}"

## 用户的约束指令（这是原始素材，不是最终输出）
${userConstraints}

---

**你的任务**：以上面用户的约束指令为种子，创造一份完整、丰富的角色描述。
- 用户的每一句话，你都要展开想象：具体行为是什么？在什么场景下体现？有什么因果？
- 用户没提到的维度（外貌、背景、日常习惯、与其他角色关系等），你都要补充
- 最终输出的信息量必须远超用户原始输入
- 写得越长越详细越好，不要节省篇幅

返回一个 JSON 对象，包含以下字段：
{
  "name": "${characterName}",
  "description": "## 基本信息\\n姓名/年龄/身份/与{{user}}关系（键值对格式）\\n\\n## 外貌特征\\n只写有辨识度的特征。聚焦于特殊印记、标志性配饰、令人印象深刻的细节。\\n\\n## 性格调色盘\\n底色：[最深层的性格，1-2个特质]\\n主色调：[日常最突出的1-2个特质]\\n点缀：[特定条件下才会出现的0-2个隐藏特质]\\n[trait]衍生一：[具体场景下的行为表现]\\n[trait]衍生二：[另一个具体行为表现]\\n\\n## 背景设定\\n只写塑造了角色「现在」的关键事件。\\n\\n## 关系设定\\n写具体场景，不写抽象评价。"
}

格式规则：
- description 必须使用 ## 标题和列表/键值对格式（不要写成散文段落）
- description 必须用指令式写法（"你说话时……"而不是"她说话时……"）
- 绝对不要违背用户的原始约束
- 绝对不要写泛泛的描述（"美丽的眼睛"、"优雅的身姿"）
- 绝对不要只贴抽象性格标签而不给出具体行为衍生

请只输出 JSON 对象。`
      : `从头开始为 "${characterName}" 创造一个丰富详细的角色卡。

返回一个 JSON 对象，包含以下字段：
{
  "name": "${characterName}",
  "description": "## 基本信息\\n姓名/年龄/身份/与{{user}}关系（键值对格式）\\n\\n## 外貌特征\\n只写有辨识度的特征。聚焦于特殊印记、标志性配饰、令人印象深刻的细节。\\n\\n## 性格调色盘\\n底色：[最深层的性格，1-2个特质]\\n主色调：[日常最突出的1-2个特质]\\n点缀：[特定条件下才会出现的0-2个隐藏特质]\\n[trait]衍生一：[具体场景下的行为表现]\\n[trait]衍生二：[另一个具体行为表现]\\n\\n## 背景设定\\n只写塑造了角色「现在」的关键事件。\\n\\n## 关系设定\\n写具体场景，不写抽象评价。"
}

格式规则：
- description 必须使用 ## 标题和列表/键值对格式（不要写成散文段落）
- description 必须用指令式写法（"你说话时……"而不是"她说话时……"）
- 绝对不要写泛泛的描述（"美丽的眼睛"、"优雅的身姿"）
- 绝对不要只贴抽象性格标签而不给出具体行为衍生
- 写得越长越详细越好

请只输出 JSON 对象。`,
  };
};

/**
 * Lorebook batch generation prompt (Step 3).
 * Generates world book entries with FULL SillyTavern V2 + runtime parameters.
 */
export const LOREBOOK_GENERATE_PROMPT = (cardName: string, characterSummaries: string, topic: string, rules?: string) => ({
  system: `你是一位 SillyTavern 世界书作者。为角色卡生成详尽的世界书条目，包含完整的 SillyTavern 参数。

写作规则（参考 tavern-cards 方法论）：
- 每句话过四问：
  1. 删了这句AI会错吗？不会→删
  2. 是信息还是装饰？装饰→删
  3. 列表能替代吗？能→改列表
  4. 不看原文能理解吗？不能→补关键信息
- 数据库格式：用列表和键值对，不用散文段落
- 连接词用冒号/逗号替代
- 不写主观评价
- 不写AI已知信息
- 只写让AI会出错的差异信息
- 全文简体中文

内容格式示例：
  地点: 修仙界华东区
  管辖: 修仙协会华东分部
  特征:
    - 灵气浓度最高
    - 禁止飞行(城区)
    - 灵石交易所三处

每条内容要写得详细丰富，不要节省篇幅。

请只输出 JSON，不要加 markdown 代码块，不要加任何解释。`,
  user: `为以下角色卡生成 6 条世界书条目：

卡片名称：${cardName}
角色：${characterSummaries}
${topic ? `主题/方向：${topic}` : ''}
${rules ? `\n## 世界观约束与运行规则（必须严格遵守）\n${rules}` : ''}

返回一个 JSON 数组，每个对象包含以下全部字段：
{
  "name": "条目标题（仅供人类参考）",
  "keys": ["关键词1", "关键词2", "关键词3"],
  "secondary_keys": [],
  "content": "详细条目内容，简体中文。使用键值对和列表格式。示例：\\n地点: XX城\\n特征:\\n  - 特征1\\n  - 特征2\\n关系: 与XX的关系描述（具体场景）",
  "comment": "关于此条目覆盖内容的简短说明",
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
- probability：100=始终触发，小于100用于随机事件
- group：互斥条目共享组名（同一组只触发一个）
- group_weight：组内权重，数值越大越优先
- selectiveLogic：0=AND ANY, 1=AND ALL, 2=NOT ALL, 3=NOT ANY
- role：0=系统(默认), 1=用户, 2=助手
- depth：向前扫描多少条消息。4=常规
- sticky/cooldown/delay：以消息数为单位的时间效果。0=禁用
- constant：只有1-2条核心条目设为true，其余为false（关键词触发）
- position：大多数用"after_char"，场景设置类用"before_char"
- 关键词：严禁单汉字关键词。用2字以上名称（"小樱"不是"樱"）。避免过于泛用的词

内容写作要求：
- 使用键值对和列表格式，不要写散文段落
- 全文简体中文
- 不写主观评价，不写AI已知信息
- 只写让AI会出错的差异信息
- 每句话必须过四问
- 每条内容至少150字，越详细越好

生成多样化的条目，覆盖：
1. 角色背景/历史
2. 角色能力或技能
3. 关键人物关系（具体场景，不要抽象评价）
4. 重要地点/场景
5. 值得注意的物品或道具
6. 世界事件或传说

请只输出 JSON 数组。`,
});

/**
 * Lorebook skeleton prompt (Step 3 - 骨架模式).
 * Generates world book entry skeletons for fast iteration.
 * Inspired by st-card-builder's 骨架生成 pipeline.
 * Each skeleton is: title + detailed outline + keywords.
 * User expands skeletons individually later with AI 展开.
 */
export const LOREBOOK_SKELETON_PROMPT = (
  cardName: string,
  characterSummaries: string,
  topic: string,
  batchSize: number,
  existingTitles: string,
  rules?: string,
) => ({
  system: `你是一个 SillyTavern 世界书骨架生成器。产出【${batchSize}条】详细骨架。

每条包含：
- comment：标题（=== 标题 === 格式）
- content：详细设定概要（120-250字），用键值对格式（如"地点: XX\\n特征: - A - B"），不要写散文
- keys：2-4个触发词
- strategy："selective"（触发型）或 "constant"（常驻型）

【角色】：${characterSummaries}
${existingTitles ? `\n【已有条目（禁止重复）】：${existingTitles}` : ''}
${topic ? `\n【方向】：${topic}` : ''}
${rules ? `\n【世界观约束】：${rules.substring(0, 500)}` : ''}

【输出】：JSON数组 [{ "comment":"===标题===", "content":"详细设定概要(120-250字)", "keys":["词","词"], "strategy":"selective" }, ...]

要求：信息密集丰富、不重复、覆盖多维度（地点/人物/组织/物品/事件/规则/能力）。写得越详细越好，不要吝啬篇幅。

请只输出 JSON 数组，不要加 markdown 代码块。`,
  user: `为「${cardName}」生成 ${batchSize} 条世界书骨架。信息丰富详细，每条 120-250 字。`,
});

/**
 * Expand a skeleton world book entry into a full detailed entry.
 * Used by the "AI 展开" button on short entries.
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
  isSkeleton: boolean,
  userRequirement?: string,
) => ({
  system: `你是一个 SillyTavern 词条润色大师。${isSkeleton ? '原条目是骨架概要，请展开为完整详细的世界书设定词条（至少350字），保留方向但大幅扩充，写成一个完整、详尽的设定条目。' : '修改一个已存在的词条。'}
【原词条】:
标题: ${entry.comment}
策略: ${entry.strategy}
触发词: ${entry.keys.join(',')}
内容: ${entry.content}
${characterContext ? `\n【角色上下文】：\n${characterContext.substring(0, 800)}` : ''}

【任务】：重写。输出JSON：
{ "comment": "标题", "content": "详细设定（至少350字，使用键值对和列表格式，写得详细不要节省篇幅）", "keys": ["触发词", "2-5个"], "strategy": "selective 或 constant", "position": ${entry.position} }

写作规则：数据库格式、一句一意、行为展现性格、每句话过四问。全文简体中文。

请只输出 JSON，不要加 markdown 代码块。`,
  user: isSkeleton
    ? `将骨架「${entry.comment}」展开为完整详细设定。${userRequirement ? `额外要求：${userRequirement}` : ''}`
    : `修改词条「${entry.comment}」：${userRequirement || '优化内容'}`,
});

/**
 * First message generation prompt (Step 4).
 * Generates an opening message for the character.
 */
export const FIRST_MESSAGE_PROMPT = (cardName: string, characterDescriptions: string, sceneHint: string, targetWordCount?: number) => {
  const lengthInstruction = targetWordCount
    ? `字数控制在 ${targetWordCount} 字左右（允许上下浮动 10%）。`
    : '至少写 500 字以上，内容越丰富越好。';
  return {
    system: `你正在为 AI 角色扮演角色撰写开场白（第一条消息）。

## 开场白的写作要求：

1. **篇幅要求**：${lengthInstruction}
2. **结构要素**：
   - 环境描写：用具体的视觉、听觉、触觉、嗅觉细节建立场景
   - 角色动作：通过行为展示性格，不要直接说"他很冷漠"，而是写具体行为
   - 内心独白或对话：展示角色的说话风格和思维方式
   - 钩子结尾：留下悬念或给用户一个明确的回应入口

3. **格式规范**：
   - 用 {{user}} 作为用户占位符
   - 角色直接使用其设定名称（不要使用 {{char}} 占位符，因为可能是多角色卡）
   - 分段清晰，每段聚焦一个方面
   - 全文使用简体中文

4. **避免**：
   - 不要写得太短、太概括
   - 不要用抽象形容词堆砌
   - 不要一次性把故事讲完，要留有余地

请只输出消息正文，不要加引号、标题或其他标签。`,
    user: `为以下角色卡撰写开场白：

名称：${cardName}
角色：
${characterDescriptions || '(暂无角色描述，请自由发挥)'}
${sceneHint ? `\n场景：${sceneHint}` : ''}
${targetWordCount ? `\n【重要】字数要求约 ${targetWordCount} 字，请确保内容充实详细。` : '\n【重要】请写长一些，至少 500 字，包含丰富的场景描写和角色互动。'}

请只输出消息正文。`,
  };
};

/**
 * Example dialogues generation prompt (Step 5).
 * Generates 2-3 example conversation exchanges.
 */
export const EXAMPLE_DIALOGUES_PROMPT = (cardName: string, characterDescriptions: string) => ({
  system: `你正在为 AI 角色扮演角色卡撰写示例对话。示例对话是教 AI 如何扮演角色的最重要素材——AI 会模仿这里的语气、用词、行为模式来回复用户。

## 写作要求：

1. **数量**：写 3-4 段独立的对话场景
2. **每段长度**：每段至少 200 字，包含角色的动作描写、心理活动、对话台词，不要只写干巴巴的一句话回复
3. **多样性**：不同场景展示角色的不同侧面——比如日常、冲突、温情、幽默等
4. **角色还原**：对话必须体现角色独特的说话风格（口癖、语气词、句式习惯）
5. **格式规范**：
   - 每段以 <START> 开头
   - 用户消息用 {{user}}: 开头
   - 角色回复用角色的实际名称开头（如 角色名: ），不要使用 {{char}} 占位符
   - 角色回复中可以穿插动作描写（用 *斜体* 或直接描写）
6. 全文使用简体中文

【重要】写得越详细越好，不要节省篇幅。每段对话要像小说片段一样有画面感。`,
  user: `为以下角色生成 3-4 段示例对话：

名称：${cardName}
角色：
${characterDescriptions || '(暂无角色描述，请自由发挥)'}

格式示例：
<START>
{{user}}: 用户说了一句话
角色名: *角色的动作描写* 角色台词...更多台词和描写...

<START>
{{user}}: 另一个场景的用户消息
角色名: *动作* 台词...

【重要】每段对话至少 200 字，展示不同情绪和场景。请只输出对话正文。`,
});

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
}>) => ({
  system: `你是一个 SillyTavern 世界书优化专家。分析世界书条目并优化它们的运行时参数。

优化规则：
- position: before_char(角色前)=适合背景设定, after_char(角色后)=适合角色相关, before_example(示例前)=适合文风指导, after_example(示例后)=适合输出格式
- insertion_order: 背景设定=10-30, 角色设定=30-60, 能力/技能=60-80, 物品/地点=80-100, 事件/规则=100-120
- depth: 核心设定=2-4(始终检查), 场景相关=6-10(近期消息), 稀有信息=15+(很少触发)
- probability: 核心设定=100, 日常设定=90-100, 稀有/随机事件=10-50
- constant: 只有真正的背景规则才设为true(最多2-3条), 其他设为false

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
}>) => ({
  system: `你是一个 SillyTavern 触发词专家。为世界书条目生成自然、精准的触发关键词。

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
 * MVU Variable Suggestion prompt (Step 6).
 * Analyzes card content and suggests MVU variables for state tracking.
 * Based on world-book-mcp v5 MVU methodology.
 */
export const MVU_VARIABLES_PROMPT = (
  cardName: string,
  characterSummaries: string,
  worldbookSummary: string,
  firstMessageExcerpt: string,
) => ({
  system: `你是一个 SillyTavern MVU (Model-View-Update) 变量设计专家。根据角色卡内容，设计合理的状态追踪变量。

设计原则（来自 world-book-mcp v5）：
- 变量应追踪会影响剧情走向的状态：好感度、关系阶段、地点、时间、任务进度等
- 数字变量使用 number 类型，可设 min/max 范围
- 阶段/状态变量使用 enum 类型，列出所有可能取值
- 文本变量使用 string 类型
- 集合/背包等使用 record 类型
- 只读派生变量标记 readonly（AI 可见但不应更新）
- 隐藏运行时变量标记 hidden（AI 不可见）
- 变量路径使用中文键名，如 ["角色A", "好感度"]
- 不要滥用变量，只追踪真正影响剧情的状态
- 通常 5-15 个变量即可覆盖大多数场景

输出 JSON 数组，不要加 markdown 代码块。`,
  user: `为以下角色卡设计 MVU 状态追踪变量：

卡片名称: ${cardName}
角色: ${characterSummaries}
${worldbookSummary ? `世界书概要: ${worldbookSummary}` : ''}
${firstMessageExcerpt ? `开场白摘要: ${firstMessageExcerpt.slice(0, 300)}` : ''}

返回 JSON 数组，每个变量包含：
{
  "path": ["主体", "变量名"],
  "kind": "number" | "string" | "boolean" | "enum" | "record",
  "defaultValue": 默认值,
  "description": "变量用途说明（中文）",
  "enumValues": ["仅enum类型", "列出取值"],
  "min": 最小值(仅number),
  "max": 最大值(仅number),
  "hidden": false,
  "readonly": false
}

典型变量结构参考：
- 世界: { 日期, 时间段, 地点 }
- 角色: { 好感度(0-100), 关系阶段(enum), 当前状态(string) }
- 主角: { 物品栏(record) }

请只输出 JSON 数组。`,
});

/**
 * Card Translation prompt.
 * Translates all text fields of a character card between Chinese and English.
 */
export const TRANSLATE_CARD_PROMPT = (targetLang: 'zh' | 'en') => ({
  system: `你是一位专业的角色卡翻译。将角色卡内容翻译为${targetLang === 'zh' ? '简体中文' : 'English'}。

翻译规则：
- 保持原文的格式结构（## 标题、列表、键值对等）
- 专有名词保持原文或在括号中注明（如“霜落(Frostfall)”）
- {{user}} 占位符保持不变
- 角色的实际名称保持不变
- 对话示例中的 <START> 标记保持不变
- 翻译要自然流畅，不要机翻味
- 保持原文的信息密度和长度

返回 JSON 对象，包含翻译后的所有文本字段。`,
  user: `将以下角色卡内容翻译为${targetLang === 'zh' ? '简体中文' : 'English'}：

{cardContent}

返回同样结构的 JSON 对象，所有文本字段翻译为${targetLang === 'zh' ? '简体中文' : 'English'}。只输出 JSON。`,
});

/**
 * AI Card Diagnosis prompt.
 * Analyzes a character card and provides structured diagnostic report.
 */
export const CARD_DIAGNOSIS_PROMPT = () => ({
  system: `你是一位资深的 SillyTavern 角色卡诊断师。你的任务是全面分析一张角色卡，发现潜在问题并给出具体改进建议。

诊断维度：
1. **设定完整性** — description 是否涵盖基本信息、外貌、性格、背景、关系
2. **人设一致性** — description/personality/first_mes 之间是否自洽
3. **剧情逻辑** — 开场白是否合理、示例对话是否体现人设
4. **世界观逻辑** — 世界书条目之间是否矛盾、是否覆盖关键设定
5. **OOC 风险** — 哪些设定可能导致 AI 扮演时偏离人设
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
 * Utility: strip markdown code fences from AI responses.
 * AI models often wrap JSON in ```json ... ``` blocks.
 */
export function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json|JSON)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

/**
 * Sanitize common JSON issues in AI responses before parsing:
 * - Trailing commas before } or ]
 * - Single quotes instead of double quotes (simple heuristic)
 * - Unescaped newlines inside string values
 */
function sanitizeJsonString(raw: string): string {
  let s = raw;
  // Remove trailing commas: ,} or ,]
  s = s.replace(/,\s*([}\]])/g, '$1');
  // Replace single-quoted keys/values with double-quoted (simple cases)
  // Only if the string has no double quotes at all (heuristic to avoid breaking valid JSON)
  if (!s.includes('"') && s.includes("'")) {
    s = s.replace(/'([^']*)'/g, '"$1"');
  }
  return s;
}

/**
 * Attempt to parse AI response as JSON with multi-layer fallback.
 *
 * Strategy:
 * 1. Strip markdown fences, direct parse
 * 2. Sanitize common AI quirks (trailing commas, single quotes), retry
 * 3. Extract first JSON object/array substring, sanitize and retry
 * 4. Try to find multiple JSON objects/arrays and return the largest
 * 5. Return null if all attempts fail
 */
export function parseAIJson(text: string): unknown | null {
  const cleaned = stripMarkdownFences(text);

  // Attempt 1: Direct parse
  try {
    return JSON.parse(cleaned);
  } catch { /* continue */ }

  // Attempt 2: Sanitize and retry
  const sanitized = sanitizeJsonString(cleaned);
  try {
    return JSON.parse(sanitized);
  } catch { /* continue */ }

  // Attempt 3: Extract first JSON object or array
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  const candidates = [objMatch?.[0], arrMatch?.[0]].filter(Boolean) as string[];

  // Sort by length descending — prefer larger matches
  candidates.sort((a, b) => b.length - a.length);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch { /* try sanitized */ }
    try {
      return JSON.parse(sanitizeJsonString(candidate));
    } catch { /* continue */ }
  }

  // Attempt 4: Find all JSON objects/arrays and pick the largest valid one
  const allMatches = [
    ...cleaned.matchAll(/\{[\s\S]*?\}/g),
    ...cleaned.matchAll(/\[[\s\S]*?\]/g),
  ]
    .map(m => m[0])
    .sort((a, b) => b.length - a.length);

  for (const m of allMatches.slice(0, 5)) {
    try {
      return JSON.parse(m);
    } catch { /* skip */ }
    try {
      return JSON.parse(sanitizeJsonString(m));
    } catch { /* skip */ }
  }

  return null;
}
