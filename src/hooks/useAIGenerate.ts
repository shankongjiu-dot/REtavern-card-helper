/**
 * useAIGenerate - hook for AI-powered content generation in the wizard.
 * Handles character, lorebook, and first message generation.
 * Supports both streaming and non-streaming modes.
 *
 * NOTE: Preset injection is handled globally in ai-service.ts (injectPreset).
 * All AI calls automatically include the active writing preset.
 */
import { useCallback, useEffect } from 'react';
import { useTranslation } from '../i18n/I18nContext';
import { callAIWithPrompt, callAIWithPromptStreaming, cancelActiveAIRequests, type StreamCallback } from '../services/ai-service';
import {
  CHARACTER_GENERATE_PROMPT,
  LOREBOOK_GENERATE_PROMPT,
  LOREBOOK_ENTRY_FROM_TEXT_PROMPT,
  WORLD_ANCHOR_EXPAND_PROMPT,
  LOREBOOK_REVISE_PROMPT,
  EXPAND_ENTRY_PROMPT,
  FIRST_MESSAGE_PROMPT,
  ORGANIZE_ENTRIES_PROMPT,
  GENERATE_KEYS_PROMPT,
  CARD_DIAGNOSIS_PROMPT,
  MODIFY_CHARACTER_PROMPT,
  POLISH_SELECTION_PROMPT,
  STAGED_LOREBOOK_PROMPT,
  AUTO_STAGED_LOREBOOK_PROMPT,
  STAGE_REROLL_PROMPT,
  MULTI_CHAR_DETECT_PROMPT,
  MULTI_CHAR_TEMPLATE_PROMPT,
  STAGED_ANALYZE_PROMPT,
  STAGE_REROLL_ANNOTATION_PROMPT,
  STAGE_ENTRY_GENERATE_PROMPT,
} from '../constants/prompts';
import { stripMarkdownFences, parseAIJson, extractStringFieldFromRaw } from '../services/ai-json';
import { type StageDefinition, sortStagesByDirection } from '../services/staged-lorebook-builder';
import type {
  AIGeneratedCharacter,
  AIGeneratedLorebookEntry,
  AIOrganizeSuggestion,
  AIGeneratedKeys,
  LorebookEntry,
} from '../constants/defaults';

/**
 * Strip runtime-only fields (id, fromAnchor, expandNsfw, uiFlags, …) from a LorebookEntry
 * before sending it to the AI in LOREBOOK_REVISE_PROMPT. Keeps only spec-relevant fields so
 * the AI focuses on content, not internal bookkeeping.
 */
function sanitizeEntryForRevisePrompt(e: LorebookEntry) {
  return {
    name: e.name || '',
    keys: e.keys || [],
    secondary_keys: e.secondary_keys || [],
    content: e.content || '',
    comment: e.comment || '',
    constant: e.constant ?? false,
    selective: e.selective ?? false,
    selectiveLogic: e.selectiveLogic ?? 0,
    insertion_order: e.insertion_order ?? 100,
    position: e.position ?? 'after_char',
    priority: e.priority ?? 50,
    probability: e.probability ?? 100,
    group: e.group || '',
    group_weight: e.group_weight ?? 100,
    role: e.role ?? 0,
    depth: e.depth ?? 4,
    exclude_recursion: e.exclude_recursion ?? false,
    prevent_recursion: e.prevent_recursion ?? false,
    sticky: e.sticky ?? 0,
    cooldown: e.cooldown ?? 0,
    delay: e.delay ?? 0,
    use_regex: e.use_regex ?? false,
    match_whole_words: e.match_whole_words ?? true,
    ignore_budget: e.ignore_budget ?? false,
  };
}

/**
 * Post-process AI-generated character to fix common format issues:
 * - Ensure description has proper ## section headers
 * - Add missing ## headers when sections exist but are unlabeled
 * - Ensure proper newline separation between sections
 */
function sanitizeCharacterResult(
  _characterName: string,
  result: { name?: string; description?: string; constant?: boolean },
): { name?: string; description?: string; constant?: boolean } {
  let description = result.description;

  if (description) {
    // Fix: if description has no ## headers at all but contains known section keywords,
    // prepend ## headers to create proper structure
    const hasNoHeaders = !description.includes('## ');
    if (hasNoHeaders) {
      const sectionPatterns: [RegExp, string][] = [
        [/^(基本信息|姓名[：:]|年龄[：:]|身份[：:])/m, '## 基本信息\n'],
        [/^(外貌|外貌特征|外表|长相)/m, '\n\n## 外貌特征\n'],
        [/^(性格|性格调色盘|性情|脾气)/m, '\n\n## 性格调色盘\n'],
        [/^(背景|背景设定|身世|过往|历史)/m, '\n\n## 背景设定\n'],
        [/^(关系|关系设定|人际|与.*关系)/m, '\n\n## 关系设定\n'],
      ];
      for (const [pattern, header] of sectionPatterns) {
        if (pattern.test(description) && !description.includes(header.trim())) {
          description = description.replace(pattern, header + '$1');
        }
      }
    }

    // Fix: ensure sections are separated by double newlines before ## headers
    description = description.replace(/\n(## )/g, '\n\n$1');

    // Fix: collapse triple+ newlines into double
    description = description.replace(/\n{3,}/g, '\n\n');
  }

  return { name: result.name, description, constant: result.constant };
}

export function useAIGenerate() {
  const { lang } = useTranslation();

  // 组件卸载时中止进行中的流式 AI 请求，避免后台继续消耗 token + 对已卸载组件 setState
  useEffect(() => {
    return () => { cancelActiveAIRequests(); };
  }, []);

  /**
   * Generate a character profile with streaming.
   * Calls onChunk for each token as it arrives.
   * @returns Full text when complete
   */
  const generateCharacterStreaming = useCallback(async (
    characterName: string,
    hint: string,
    onChunk: StreamCallback,
    otherCharactersContext?: string,
    alignment?: string,
    nsfw?: boolean,
    threeFacesContext?: string,
  ): Promise<string> => {
    const prompts = CHARACTER_GENERATE_PROMPT(characterName, hint, otherCharactersContext, alignment, nsfw, lang, threeFacesContext);
    return callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.85, presetMode: 'force', max_tokens: 12000 });
  }, [lang]);

  /**
   * Generate character with streaming and parse as JSON.
   * Returns parsed object with name, description, personality (string), appearance.
   */
  const generateCharacterParsedStreaming = useCallback(async (
    characterName: string,
    hint: string,
    onChunk: StreamCallback,
    otherCharactersContext?: string,
    alignment?: string,
    nsfw?: boolean,
    threeFacesContext?: string,
  ) => {
    const text = await generateCharacterStreaming(characterName, hint, onChunk, otherCharactersContext, alignment, nsfw, threeFacesContext);
    const parsed = parseAIJson(text) as AIGeneratedCharacter | null;

    if (!parsed) {
      // JSON 解析失败——尝试从截断/畸形文本中结构化提取 description 字段
      // （处理 AI 在 JSON 字符串值中生成未转义引号的常见情况）
      const extracted = extractStringFieldFromRaw(text, 'description');
      if (extracted && extracted.length > 20) {
        return sanitizeCharacterResult(characterName, { description: extracted });
      }
      // 最终兜底：剥离 markdown 围栏后保留全部原文，避免内容丢失
      const cleanText = stripMarkdownFences(text).trim();
      if (cleanText.length > 20) {
        return sanitizeCharacterResult(characterName, { description: cleanText });
      }
      return { description: text };
    }

    return sanitizeCharacterResult(characterName, {
      name: parsed.name,
      description: parsed.description,
      constant: parsed.constant,
    });
  }, [generateCharacterStreaming]);

  /**
   * Generate world-anchor-based world book entries (Step 2 - 锚定世界观).
   * Replaces the old skeleton pipeline: AI directly produces 1 总纲 entry +
   * N 子条目 as full lorebook entries, based on the 4 anchor fields.
   * Returns parsed AIGeneratedLorebookEntry[] (caller maps to LorebookEntry).
   */
  const generateWorldAnchorEntriesStreaming = useCallback(async (
    cardName: string,
    anchorText: string,
    existingTitles: string,
    onChunk: StreamCallback,
    nsfw?: boolean,
  ): Promise<AIGeneratedLorebookEntry[]> => {
    const prompts = WORLD_ANCHOR_EXPAND_PROMPT(cardName, anchorText, existingTitles, nsfw, lang);
    const text = await callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.85, presetMode: 'force' });
    const parsed = parseAIJson(text) as AIGeneratedLorebookEntry[] | null;
    return parsed || [];
  }, [lang]);

  /**
   * Revise a batch of draft lorebook entries based on the user's free-text modification
   * request. Used by the "预览与修改" panel in Step 2 / Step 4: AI takes the current
   * draft (LorebookEntry[]) + user request and outputs a FULL REPLACEMENT array.
   * Caller regenerates ids and merges into draft state.
   */
  const reviseLorebookEntriesStreaming = useCallback(async (
    cardName: string,
    anchorText: string,
    currentEntries: LorebookEntry[],
    userRequest: string,
    onChunk: StreamCallback,
    nsfw?: boolean,
  ): Promise<AIGeneratedLorebookEntry[]> => {
    const sanitizedJson = JSON.stringify(
      currentEntries.map(sanitizeEntryForRevisePrompt),
      null,
      2,
    );
    const prompts = LOREBOOK_REVISE_PROMPT(cardName, anchorText, sanitizedJson, userRequest, nsfw, lang);
    const text = await callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.7, presetMode: 'force' });
    const parsed = parseAIJson(text) as AIGeneratedLorebookEntry[] | null;
    return parsed || [];
  }, [lang]);

  /**
   * Generate lorebook entries with streaming.
   */
  const generateLorebookStreaming = useCallback(async (
    cardName: string,
    characterSummaries: string,
    topic: string,
    batchCount: number,
    onChunk: StreamCallback,
    nsfw?: boolean,
    worldAnchor?: string,
    existingEntriesContext?: string,
    rules?: string,
  ): Promise<string> => {
    const prompts = LOREBOOK_GENERATE_PROMPT(cardName, characterSummaries, topic, batchCount, nsfw, worldAnchor, lang, existingEntriesContext, rules);
    return callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.8, presetMode: 'force' });
  }, [lang]);

  /**
   * Generate lorebook entries with streaming and parse as JSON array.
   */
  const generateLorebookParsedStreaming = useCallback(async (
    cardName: string,
    characterSummaries: string,
    topic: string,
    batchCount: number,
    onChunk: StreamCallback,
    nsfw?: boolean,
    worldAnchor?: string,
    existingEntriesContext?: string,
    rules?: string,
  ) => {
    const text = await generateLorebookStreaming(cardName, characterSummaries, topic, batchCount, onChunk, nsfw, worldAnchor, existingEntriesContext, rules);
    const parsed = parseAIJson(text) as AIGeneratedLorebookEntry[] | null;
    return parsed || [];
  }, [generateLorebookStreaming]);



  /** Generate first message with streaming */
  const generateFirstMessageStreaming = useCallback(async (
    cardName: string,
    characterDescriptions: string,
    sceneHint: string,
    onChunk: StreamCallback,
    targetWordCount?: number,
    worldbookContext?: string,
    writingRequirements?: string,
    writingStyle?: string,
  ): Promise<string> => {
    const prompts = FIRST_MESSAGE_PROMPT(cardName, characterDescriptions, sceneHint, targetWordCount, worldbookContext, writingRequirements, lang, writingStyle);
    return callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.9, presetMode: 'force', max_tokens: 12000 });
  }, [lang]);

  /**
   * AI Smart Organize: Analyze entries and suggest optimized parameters.
   * Reference: st-card-builder AI 智能整理.
   */
  const organizeEntries = useCallback(async (entries: Array<{
    index: number;
    name: string;
    content: string;
    keys: string[];
    position: string;
    insertion_order: number;
    depth: number;
    probability: number;
    constant: boolean;
  }>) => {
    const prompts = ORGANIZE_ENTRIES_PROMPT(entries, lang);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.3, presetMode: 'none' });
    const parsed = parseAIJson(text) as AIOrganizeSuggestion[] | null;
    return parsed || [];
  }, [lang]);

  /**
   * AI Key Generation: Generate trigger keywords for entries.
   * Reference: st-card-builder AI 触发词生成.
   */
  const generateEntryKeys = useCallback(async (entries: Array<{
    index: number;
    name: string;
    content: string;
    existingKeys: string[];
  }>) => {
    const prompts = GENERATE_KEYS_PROMPT(entries, lang);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.5, presetMode: 'none' });
    const parsed = parseAIJson(text) as AIGeneratedKeys[] | null;
    return parsed || [];
  }, [lang]);

  /**
   * Generate a single complete world book entry from brief user description.
   * User provides a short text, AI generates full entry with all fields.
   */
  const generateEntryFromText = useCallback(async (
    cardName: string,
    userDescription: string,
    characterContext?: string,
    nsfw?: boolean,
    worldAnchor?: string,
  ): Promise<AIGeneratedLorebookEntry | null> => {
    const prompts = LOREBOOK_ENTRY_FROM_TEXT_PROMPT(cardName, userDescription, characterContext, nsfw, worldAnchor, lang);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.7, presetMode: 'force' });
    const parsed = parseAIJson(text) as AIGeneratedLorebookEntry | null;
    return parsed;
  }, [lang]);

  /**
   * Expand / rewrite a single world book entry into a fuller detailed version.
   * Used by the "AI 展开" button on entries (no longer skeleton-specific).
   */
  const expandLorebookEntry = useCallback(async (
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
  ) => {
    const prompts = EXPAND_ENTRY_PROMPT(entry, characterContext, userRequirement, nsfw, worldAnchor, lang);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.8, presetMode: 'force' });
    const parsed = parseAIJson(text) as { comment?: string; content?: string; keys?: string[]; strategy?: string } | null;

    return {
      comment: parsed?.comment ?? entry.comment,
      content: parsed?.content ?? text,
      keys: parsed?.keys ?? entry.keys,
      strategy: parsed?.strategy ?? entry.strategy,
    };
  }, [lang]);

  /**
   * Diagnose a character card using AI.
   * Returns a structured diagnosis report with scores, issues, and suggestions.
   */
  const diagnoseCard = useCallback(async (
    cardData: Record<string, unknown>,
  ): Promise<{
    overall_score: number;
    summary: string;
    categories: Array<{
      name: string;
      score: number;
      issues: string[];
      suggestions: string[];
    }>;
    highlights: string[];
  } | null> => {
    // Build a concise summary of the card for diagnosis
    const diagContent: Record<string, unknown> = {};
    const fields = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
      'system_prompt', 'post_history_instructions'];

    for (const key of fields) {
      if (cardData[key] && typeof cardData[key] === 'string') {
        // Truncate very long fields to save tokens
        const val = cardData[key] as string;
        diagContent[key] = val.length > 2000 ? val.slice(0, 2000) + '...(截断)' : val;
      }
    }

    // Include worldbook summary
    const charBook = cardData.character_book as Record<string, unknown> | undefined;
    if (charBook?.entries && Array.isArray(charBook.entries)) {
      diagContent._worldbook_count = (charBook.entries as unknown[]).length;
      diagContent._worldbook_entries = (charBook.entries as Array<Record<string, unknown>>).slice(0, 10).map(e => ({
        name: e.name || '',
        comment: e.comment || '',
        content: ((e.content as string) || '').slice(0, 300),
        keys: e.keys || [],
        constant: e.constant || false,
      }));
    }

    const prompts = CARD_DIAGNOSIS_PROMPT(lang);
    const userPrompt = prompts.user.replace('{cardContent}', JSON.stringify(diagContent, null, 2));

    const text = await callAIWithPrompt(prompts.system, userPrompt, { temperature: 0.4, presetMode: 'none' });
    return parseAIJson(text) as ReturnType<typeof diagnoseCard> extends Promise<infer T> ? T : never;
  }, [lang]);

  /**
   * Partially modify a character description based on user instructions.
   * Preserves the overall structure while applying targeted changes.
   */
  const modifyCharacterDescription = useCallback(async (
    characterName: string,
    currentDescription: string,
    instructions: string,
    otherCharactersContext?: string,
  ): Promise<string> => {
    const prompts = MODIFY_CHARACTER_PROMPT(characterName, otherCharactersContext, lang);
    const userPrompt = prompts.user
      .replace('{currentDescription}', currentDescription)
      .replace('{instructions}', instructions);
    const text = await callAIWithPrompt(prompts.system, userPrompt, { temperature: 0.5, presetMode: 'none' });
    return stripMarkdownFences(text).trim();
  }, [lang]);

  /**
   * Polish/rewrite a selected portion of text within a character description.
   * Returns only the rewritten selection, not the full description.
   */
  const polishSelection = useCallback(async (
    characterName: string,
    fullText: string,
    selectedText: string,
  ): Promise<string> => {
    const prompts = POLISH_SELECTION_PROMPT(characterName, fullText, selectedText, lang);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.5, presetMode: 'none' });
    return stripMarkdownFences(text).trim();
  }, [lang]);

  return {
    generateCharacterStreaming,
    generateCharacterParsedStreaming,
    generateWorldAnchorEntriesStreaming,
    reviseLorebookEntriesStreaming,
    generateLorebookStreaming,
    generateLorebookParsedStreaming,
    generateEntryFromText,
    generateFirstMessageStreaming,
    organizeEntries,
    generateEntryKeys,
    expandLorebookEntry,
    diagnoseCard,
    modifyCharacterDescription,
    polishSelection,
    /**
     * 生成分阶段世界书的各阶段子条目内容（不含调度条目）。
     * 调用方拿到 [{stageName, content}] 后，用 staged-lorebook-builder 组装最终条目。
     */
    generateStagedLorebook: useCallback(async (
      cardName: string,
      characterSummaries: string,
      axisPath: string,
      stages: StageDefinition[],
      topic: string,
      existingWorldbookContext: string,
      nsfw: boolean,
      onChunk?: StreamCallback,
    ): Promise<Array<{ stageName: string; content: string }>> => {
      const prompts = STAGED_LOREBOOK_PROMPT(
        cardName, characterSummaries, axisPath, stages, topic, existingWorldbookContext, nsfw, lang,
      );
      const text = onChunk
        ? await callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.85, presetMode: 'force' })
        : await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.85, presetMode: 'force' });
      const parsed = parseAIJson(text) as Array<{ stageName?: string; content?: string }> | null;
      if (!parsed) return [];
      // 按 stageName 对齐回输入顺序（AI 可能乱序）
      const byName = new Map(parsed.map((p) => [p.stageName, p.content || '']));
      return stages.map((s) => ({ stageName: s.name, content: byName.get(s.name) || '' }));
    }, [lang]),
    /**
     * AI reads existing worldbook and auto-generates full staged lorebook config
     * (axisPath / axisType / numericDirection / stages with content).
     */
    autoGenerateStagedLorebook: useCallback(async (
      cardName: string,
      characterSummaries: string,
      existingWorldbookContext: string,
      topic: string,
      nsfw: boolean,
      onChunk?: StreamCallback,
    ): Promise<{
      axisPath: string;
      axisType: 'enum' | 'number';
      numericDirection: '>=' | '<=';
      stages: StageDefinition[];
    } | null> => {
      const prompts = AUTO_STAGED_LOREBOOK_PROMPT(cardName, characterSummaries, existingWorldbookContext, topic, nsfw, lang);
      const text = onChunk
        ? await callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.8, presetMode: 'force' })
        : await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.8, presetMode: 'force' });
      const parsed = parseAIJson(text) as {
        axisPath?: string;
        axisType?: 'enum' | 'number';
        numericDirection?: '>=' | '<=';
        stages?: Array<{ name?: string; condition?: string; content?: string }>;
      } | null;
      if (!parsed?.axisPath || !parsed?.stages?.length) return null;
      return {
        axisPath: parsed.axisPath,
        axisType: parsed.axisType === 'number' ? 'number' : 'enum',
        numericDirection: parsed.numericDirection === '<=' ? '<=' : '>=',
        stages: parsed.stages.map((s) => ({
          name: s.name || '阶段',
          condition: s.condition || '',
          content: s.content || '',
        })),
      };
    }, [lang]),
    /**
     * Re-roll a single stage's content with optional guidance.
     * Returns the new content string (plain text, not JSON).
     */
    rerollStage: useCallback(async (
      cardName: string,
      characterSummaries: string,
      stageAxisPath: string,
      stageName: string,
      stageCondition: string,
      siblingStages: Array<{ name: string; content?: string }>,
      existingWorldbookContext: string,
      guidance: string,
      nsfw: boolean,
      onChunk?: StreamCallback,
    ): Promise<string> => {
      const prompts = STAGE_REROLL_PROMPT(cardName, characterSummaries, stageAxisPath, stageName, stageCondition, siblingStages, existingWorldbookContext, guidance, nsfw, lang);
      const text = onChunk
        ? await callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.85, presetMode: 'force' })
        : await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.85, presetMode: 'force' });
      return stripMarkdownFences(text).trim();
    }, [lang]),
    /** Simple text generation for non-structured prompts (e.g. MVU beginner mode) */
    generateText: useCallback(async (
      systemPrompt: string,
      userPrompt: string,
    ): Promise<string> => {
      return callAIWithPrompt(systemPrompt, userPrompt, { temperature: 0.7, presetMode: 'force' });
    }, []),
    generateTextWithoutPresetStreaming: useCallback(async (
      systemPrompt: string,
      userPrompt: string,
      onChunk: StreamCallback,
    ): Promise<string> => {
      return callAIWithPromptStreaming(systemPrompt, userPrompt, onChunk, { temperature: 0.7, presetMode: 'none', max_tokens: 12000 });
    }, []),
    /**
     * Step 1 of multi-char template: AI reads worldbook and detects characters.
     * Returns list of { name, comment, summary, suitable }.
     */
    detectCharacters: useCallback(async (
      cardName: string,
      existingWorldbookContext: string,
      templateId: string,
      templateName: string,
    ): Promise<Array<{ name: string; comment: string; summary: string; suitable: boolean }>> => {
      const prompts = MULTI_CHAR_DETECT_PROMPT(cardName, existingWorldbookContext, templateId, templateName, lang);
      const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.4, presetMode: 'force' });
      const parsed = parseAIJson(text) as Array<{ name?: string; comment?: string; summary?: string; suitable?: boolean }> | null;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((p) => p?.name)
        .map((p) => ({
          name: String(p.name),
          comment: String(p.comment || ''),
          summary: String(p.summary || ''),
          suitable: p.suitable !== false,
        }));
    }, [lang]),
    /**
     * Step 2 of multi-char template: generate variables for confirmed characters.
     * Returns { sections, updateRules, statusBar } raw AI output (unparsed to MvuConfig).
     */
    generateMultiCharVariables: useCallback(async (
      cardName: string,
      templateId: string,
      templateName: string,
      templateBlueprint: string,
      characters: Array<{ name: string; summary: string }>,
      existingWorldbookContext?: string,
    ): Promise<{
      sections: unknown[];
      updateRules: unknown[];
      statusBar?: { title?: string; showVariables?: string[]; styleHint?: string };
    } | null> => {
      const prompts = MULTI_CHAR_TEMPLATE_PROMPT(cardName, templateId, templateName, templateBlueprint, characters, existingWorldbookContext, lang);
      const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.5, presetMode: 'force' });
      const parsed = parseAIJson(text) as { sections?: unknown[]; updateRules?: unknown[]; statusBar?: unknown } | null;
      if (!parsed?.sections) return null;
      return {
        sections: parsed.sections,
        updateRules: parsed.updateRules || [],
        statusBar: parsed.statusBar as { title?: string; showVariables?: string[]; styleHint?: string } | undefined,
      };
    }, [lang]),

    /** 分阶段模式：AI 剖析角色阶段框架 */
    analyzeStages: useCallback(async (
      cardName: string,
      templateId: string,
      existingWorldbookContext: string,
      mvuVariablesContext: string,
      userRequirement: string,
    ): Promise<Array<{
      name: string;
      sourceComment?: string;
      summary: string;
      axisPath: string;
      axisType: 'number' | 'enum';
      numericDirection?: '>=' | '<=';
      stages: Array<{ name: string; condition: string; annotation: string }>;
    }> | null> => {
      const prompts = STAGED_ANALYZE_PROMPT(cardName, templateId, existingWorldbookContext, mvuVariablesContext, userRequirement, lang);
      const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.5, presetMode: 'force' });
      const parsed = parseAIJson(text) as { characters?: Array<{ name?: string; sourceComment?: string; summary?: string; axisPath?: string; axisType?: string; numericDirection?: string; stages?: Array<{ name?: string; condition?: string; annotation?: string }> }> } | null;
      if (!parsed?.characters) return null;
      return parsed.characters
        .filter((c) => c.name && c.axisPath && Array.isArray(c.stages) && c.stages.length > 0)
        .map((c) => ({
          name: String(c.name),
          sourceComment: c.sourceComment ? String(c.sourceComment) : undefined,
          summary: String(c.summary || ''),
          axisPath: String(c.axisPath),
          axisType: (c.axisType === 'enum' ? 'enum' : 'number') as 'number' | 'enum',
          numericDirection: (c.numericDirection === '<=' ? '<=' : '>=') as '>=' | '<=',
          stages: sortStagesByDirection(
            c.stages!
              .filter((s) => s.name && s.condition)
              .map((s) => ({
                name: String(s.name),
                condition: String(s.condition),
                annotation: String(s.annotation || ''),
              })),
            c.axisType === 'enum' ? 'enum' : 'number',
            c.numericDirection === '<=' ? '<=' : '>=',
          ),
        }));
    }, [lang]),

    /** 分阶段模式：重 roll 单个阶段的注解 */
    rerollStageAnnotation: useCallback(async (
      cardName: string,
      templateId: string,
      characterName: string,
      characterSummary: string,
      axisPath: string,
      stageName: string,
      stageCondition: string,
      existingWorldbookContext: string,
      guidance: string,
    ): Promise<string | null> => {
      const prompts = STAGE_REROLL_ANNOTATION_PROMPT(cardName, templateId, characterName, characterSummary, axisPath, stageName, stageCondition, existingWorldbookContext, guidance, lang);
      const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.9, presetMode: 'force' });
      const clean = stripMarkdownFences(text).trim();
      return clean || null;
    }, [lang]),

    /** 分阶段模式：为单个角色的所有阶段生成子条目内容 */
    generateStageEntries: useCallback(async (
      cardName: string,
      templateId: string,
      characterName: string,
      characterSummary: string,
      axisPath: string,
      stages: Array<{ name: string; condition: string; annotation: string }>,
      existingWorldbookContext: string,
      nsfw: boolean,
      guidance: string,
      onChunk?: StreamCallback,
    ): Promise<Array<{ stageName: string; content: string }>> => {
      const prompts = STAGE_ENTRY_GENERATE_PROMPT(cardName, templateId, characterName, characterSummary, axisPath, stages, existingWorldbookContext, nsfw, guidance, lang);
      const text = onChunk
        ? await callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.85, presetMode: 'force' })
        : await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.85, presetMode: 'force' });
      const parsed = parseAIJson(text) as { entries?: Array<{ stageName?: string; content?: string }> } | null;
      if (!parsed?.entries) return [];
      return stages.map((s) => {
        const found = parsed.entries!.find((e) => e.stageName === s.name);
        return { stageName: s.name, content: found?.content || '' };
      });
    }, [lang]),
  };
}
