/**
 * useAIGenerate - hook for AI-powered content generation in the wizard.
 * Handles character, lorebook, first message, and example dialogue generation.
 * Supports both streaming and non-streaming modes.
 *
 * NOTE: Preset injection is handled globally in ai-service.ts (injectPreset).
 * All AI calls automatically include the active writing preset.
 */
import { useCallback } from 'react';
import { callAIWithPrompt, callAIWithPromptStreaming, type StreamCallback } from '../services/ai-service';
import {
  CHARACTER_GENERATE_PROMPT,
  LOREBOOK_GENERATE_PROMPT,
  LOREBOOK_SKELETON_PROMPT,
  EXPAND_ENTRY_PROMPT,
  MVU_CORRECTION_PROMPT,
  CUSTOM_STATUS_BAR_PROMPT,
  FIRST_MESSAGE_PROMPT,
  EXAMPLE_DIALOGUES_PROMPT,
  ORGANIZE_ENTRIES_PROMPT,
  GENERATE_KEYS_PROMPT,
  MVU_VARIABLES_PROMPT,
  TRANSLATE_CARD_PROMPT,
  CARD_DIAGNOSIS_PROMPT,
  MODIFY_CHARACTER_PROMPT,
  POLISH_SELECTION_PROMPT,
  parseAIJson,
} from '../constants/prompts';
import type {
  AIGeneratedCharacter,
  AIGeneratedLorebookEntry,
  AIOrganizeSuggestion,
  AIGeneratedKeys,
  AIGeneratedMvuVariable,
} from '../constants/defaults';

/**
 * Post-process AI-generated character to fix common format issues:
 * - Ensure description has proper ## section headers
 * - Add missing ## headers when sections exist but are unlabeled
 * - Ensure proper newline separation between sections
 */
function sanitizeCharacterResult(
  _characterName: string,
  result: { name?: string; description?: string },
): { name?: string; description?: string } {
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

  return { name: result.name, description };
}

export function useAIGenerate() {
  /**
   * Generate a character profile (non-streaming).
   * @param otherCharactersContext - Optional context about other already-created characters
   * @returns Parsed character object or raw text if parse fails
   */
  const generateCharacter = useCallback(async (
    characterName: string,
    hint: string,
    otherCharactersContext?: string,
    alignment?: string,
    nsfw?: boolean,
  ): Promise<string> => {
    const prompts = CHARACTER_GENERATE_PROMPT(characterName, hint, otherCharactersContext, alignment, nsfw);
    return callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.85, max_tokens: 4000, presetMode: 'force' });
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
  ): Promise<string> => {
    const prompts = CHARACTER_GENERATE_PROMPT(characterName, hint, otherCharactersContext, alignment, nsfw);
    return callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.85, max_tokens: 4000, presetMode: 'force' });
  }, []);

  /**
   * Generate character and parse as JSON.
   * Returns parsed object with name and description.
   */
  const generateCharacterParsed = useCallback(async (
    characterName: string,
    hint: string,
    otherCharactersContext?: string,
    alignment?: string,
    nsfw?: boolean,
  ) => {
    const text = await generateCharacter(characterName, hint, otherCharactersContext, alignment, nsfw);
    const parsed = parseAIJson(text) as AIGeneratedCharacter | null;

    if (!parsed) return { description: text };

    return sanitizeCharacterResult(characterName, {
      name: parsed.name,
      description: parsed.description,
    });
  }, [generateCharacter]);

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
  ) => {
    const text = await generateCharacterStreaming(characterName, hint, onChunk, otherCharactersContext, alignment, nsfw);
    const parsed = parseAIJson(text) as AIGeneratedCharacter | null;

    if (!parsed) return { description: text };

    return sanitizeCharacterResult(characterName, {
      name: parsed.name,
      description: parsed.description,
    });
  }, [generateCharacterStreaming]);

  /**
   * Generate lorebook skeleton entries in batch.
   * Returns ultra-compressed entries for fast iteration.
   */
  const generateLorebookSkeleton = useCallback(async (
    cardName: string,
    characterSummaries: string,
    topic: string,
    batchSize: number,
    existingTitles: string,
    rules?: string,
  ): Promise<Array<{ comment: string; content: string; keys: string[]; strategy: string }>> => {
    const prompts = LOREBOOK_SKELETON_PROMPT(cardName, characterSummaries, topic, batchSize, existingTitles, rules);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.9, max_tokens: 6000, presetMode: 'force' });
    const parsed = parseAIJson(text) as Array<{ comment?: string; content?: string; keys?: string[]; strategy?: string }> | null;
    return (parsed || []).map((sk) => ({
      comment: sk.comment || '未命名',
      content: sk.content || '(待展开)',
      keys: Array.isArray(sk.keys) ? sk.keys : [],
      strategy: sk.strategy || 'selective',
    }));
  }, []);

  /**
   * Generate lorebook skeleton entries in batch with streaming.
   * Avoids Vercel serverless timeout by establishing SSE connection early.
   */
  const generateLorebookSkeletonStreaming = useCallback(async (
    cardName: string,
    characterSummaries: string,
    topic: string,
    batchSize: number,
    existingTitles: string,
    onChunk: StreamCallback,
    rules?: string,
  ): Promise<Array<{ comment: string; content: string; keys: string[]; strategy: string }>> => {
    const prompts = LOREBOOK_SKELETON_PROMPT(cardName, characterSummaries, topic, batchSize, existingTitles, rules);
    const text = await callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.9, max_tokens: 6000, presetMode: 'force' });
    const parsed = parseAIJson(text) as Array<{ comment?: string; content?: string; keys?: string[]; strategy?: string }> | null;
    return (parsed || []).map((sk) => ({
      comment: sk.comment || '未命名',
      content: sk.content || '(待展开)',
      keys: Array.isArray(sk.keys) ? sk.keys : [],
      strategy: sk.strategy || 'selective',
    }));
  }, []);

  /**
   * Generate lorebook entries in batch.
   * @returns Raw text response
   */
  const generateLorebook = useCallback(async (cardName: string, characterSummaries: string, topic: string, rules?: string, nsfw?: boolean): Promise<string> => {
    const prompts = LOREBOOK_GENERATE_PROMPT(cardName, characterSummaries, topic, rules, nsfw);
    return callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.8, max_tokens: 8000, presetMode: 'force' });
  }, []);

  /**
   * Generate lorebook entries with streaming.
   */
  const generateLorebookStreaming = useCallback(async (
    cardName: string,
    characterSummaries: string,
    topic: string,
    onChunk: StreamCallback,
    rules?: string,
    nsfw?: boolean,
  ): Promise<string> => {
    const prompts = LOREBOOK_GENERATE_PROMPT(cardName, characterSummaries, topic, rules, nsfw);
    return callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.8, max_tokens: 8000, presetMode: 'force' });
  }, []);

  /**
   * Generate lorebook entries and parse as JSON array.
   * Returns entries with all V2 spec + SillyTavern runtime fields.
   */
  const generateLorebookParsed = useCallback(async (cardName: string, characterSummaries: string, topic: string, rules?: string, nsfw?: boolean) => {
    const text = await generateLorebook(cardName, characterSummaries, topic, rules, nsfw);
    const parsed = parseAIJson(text) as AIGeneratedLorebookEntry[] | null;
    return parsed || [];
  }, [generateLorebook]);

  /**
   * Generate lorebook entries with streaming and parse as JSON array.
   */
  const generateLorebookParsedStreaming = useCallback(async (
    cardName: string,
    characterSummaries: string,
    topic: string,
    onChunk: StreamCallback,
    rules?: string,
    nsfw?: boolean,
  ) => {
    const text = await generateLorebookStreaming(cardName, characterSummaries, topic, onChunk, rules, nsfw);
    const parsed = parseAIJson(text) as AIGeneratedLorebookEntry[] | null;
    return parsed || [];
  }, [generateLorebookStreaming]);

  /** Generate first message */
  const generateFirstMessage = useCallback(async (
    cardName: string,
    characterDescriptions: string,
    sceneHint: string,
    targetWordCount?: number,
    worldbookContext?: string,
  ): Promise<string> => {
    const prompts = FIRST_MESSAGE_PROMPT(cardName, characterDescriptions, sceneHint, targetWordCount, worldbookContext);
    const maxTokens = targetWordCount ? Math.max(4000, targetWordCount * 3) : 4000;
    return callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.9, max_tokens: maxTokens, presetMode: 'force' });
  }, []);

  /** Generate first message with streaming */
  const generateFirstMessageStreaming = useCallback(async (
    cardName: string,
    characterDescriptions: string,
    sceneHint: string,
    onChunk: StreamCallback,
    targetWordCount?: number,
    worldbookContext?: string,
    writingRequirements?: string,
  ): Promise<string> => {
    const prompts = FIRST_MESSAGE_PROMPT(cardName, characterDescriptions, sceneHint, targetWordCount, worldbookContext, writingRequirements);
    const maxTokens = targetWordCount ? Math.max(4000, targetWordCount * 3) : 4000;
    return callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.9, max_tokens: maxTokens, presetMode: 'force' });
  }, []);

  /** Generate example dialogues */
  const generateExampleDialogues = useCallback(async (cardName: string, characterDescriptions: string, worldbookContext?: string): Promise<string> => {
    const prompts = EXAMPLE_DIALOGUES_PROMPT(cardName, characterDescriptions, worldbookContext);
    return callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.85, max_tokens: 6000, presetMode: 'force' });
  }, []);

  /** Generate example dialogues with streaming */
  const generateExampleDialoguesStreaming = useCallback(async (
    cardName: string,
    characterDescriptions: string,
    onChunk: StreamCallback,
    worldbookContext?: string,
  ): Promise<string> => {
    const prompts = EXAMPLE_DIALOGUES_PROMPT(cardName, characterDescriptions, worldbookContext);
    return callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.85, max_tokens: 6000, presetMode: 'force' });
  }, []);

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
    const prompts = ORGANIZE_ENTRIES_PROMPT(entries);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.3, max_tokens: 6000, presetMode: 'none' });
    const parsed = parseAIJson(text) as AIOrganizeSuggestion[] | null;
    return parsed || [];
  }, []);

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
    const prompts = GENERATE_KEYS_PROMPT(entries);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.5, max_tokens: 4000, presetMode: 'none' });
    const parsed = parseAIJson(text) as AIGeneratedKeys[] | null;
    return parsed || [];
  }, []);

  /**
   * AI MVU Variable Suggestion: Analyze card content and suggest variables.
   * Based on world-book-mcp v5 MVU methodology.
   */
  const generateMvuVariables = useCallback(async (
    cardName: string,
    characterSummaries: string,
    worldbookSummary: string,
    firstMessageExcerpt: string,
  ) => {
    const prompts = MVU_VARIABLES_PROMPT(cardName, characterSummaries, worldbookSummary, firstMessageExcerpt);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.6, max_tokens: 5000, presetMode: 'none' });
    const parsed = parseAIJson(text) as AIGeneratedMvuVariable[] | null;
    return parsed || [];
  }, []);

  /**
   * Expand a skeleton world book entry into a full detailed entry.
   * Detects skeleton (content < 60 chars) and automatically adds expansion hint.
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
  ) => {
    const isSkeleton = (entry.content || '').length < 120;
    const prompts = EXPAND_ENTRY_PROMPT(entry, characterContext, isSkeleton, userRequirement, nsfw);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.8, max_tokens: 6000, presetMode: 'force' });
    const parsed = parseAIJson(text) as { comment?: string; content?: string; keys?: string[]; strategy?: string } | null;

    return {
      comment: parsed?.comment ?? entry.comment,
      content: parsed?.content ?? text,
      keys: parsed?.keys ?? entry.keys,
      strategy: parsed?.strategy ?? entry.strategy,
    };
  }, []);

  /**
   * Translate a character card's text fields between Chinese and English.
   * @param cardData - The card's data object containing text fields
   * @param targetLang - 'zh' for Chinese, 'en' for English
   * @returns Translated card data object
   */
  const translateCard = useCallback(async (
    cardData: Record<string, unknown>,
    targetLang: 'zh' | 'en',
  ): Promise<Record<string, unknown> | null> => {
    // Extract translatable fields
    const translatable: Record<string, unknown> = {};
    const fields = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
      'system_prompt', 'post_history_instructions', 'creator_notes'];

    for (const key of fields) {
      if (cardData[key] && typeof cardData[key] === 'string' && (cardData[key] as string).trim()) {
        translatable[key] = cardData[key];
      }
    }

    // Also translate world book entry content/comments
    const charBook = cardData.character_book as Record<string, unknown> | undefined;
    if (charBook?.entries && Array.isArray(charBook.entries)) {
      translatable._worldbook_entries = (charBook.entries as Array<Record<string, unknown>>).map(e => ({
        name: e.name || '',
        comment: e.comment || '',
        content: e.content || '',
        keys: e.keys || [],
      }));
    }

    if (Object.keys(translatable).length === 0) return null;

    const prompts = TRANSLATE_CARD_PROMPT(targetLang);
    const userPrompt = prompts.user.replace('{cardContent}', JSON.stringify(translatable, null, 2));

    const text = await callAIWithPrompt(prompts.system, userPrompt, { temperature: 0.3, max_tokens: 12000, presetMode: 'none' });
    const parsed = parseAIJson(text) as Record<string, unknown> | null;
    return parsed;
  }, []);

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

    const prompts = CARD_DIAGNOSIS_PROMPT();
    const userPrompt = prompts.user.replace('{cardContent}', JSON.stringify(diagContent, null, 2));

    const text = await callAIWithPrompt(prompts.system, userPrompt, { temperature: 0.4, max_tokens: 4000, presetMode: 'none' });
    return parseAIJson(text) as ReturnType<typeof diagnoseCard> extends Promise<infer T> ? T : never;
  }, []);

  /**
   * AI MVU config correction — analyze variables for semantic issues.
   */
  const correctMvuConfig = useCallback(async (
    cardName: string,
    variables: Array<{ path: string; kind: string; defaultValue: unknown; description: string }>,
    existingIssues: string,
  ) => {
    const prompts = MVU_CORRECTION_PROMPT(cardName, variables, existingIssues);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.3, max_tokens: 2000, presetMode: 'none' });
    const parsed = parseAIJson(text) as Array<{
      path: string;
      action: string;
      reason: string;
      suggestion: Record<string, unknown>;
    }> | null;
    return parsed || [];
  }, []);

  /**
   * Generate custom status bar HTML + CSS based on user's visual style requirements.
   */
  const generateCustomStatusBar = useCallback(async (
    styleDescription: string,
    variables: Array<{ path: string; kind: string; label: string; defaultValue: unknown }>,
    mode: 'safe_macro' | 'dynamic_js',
  ) => {
    const prompts = CUSTOM_STATUS_BAR_PROMPT(styleDescription, variables, mode);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.7, max_tokens: 4000, presetMode: 'none' });
    const parsed = parseAIJson(text) as { html?: string; css?: string } | null;
    return {
      html: parsed?.html || '',
      css: parsed?.css || '',
    };
  }, []);

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
    const prompts = MODIFY_CHARACTER_PROMPT(characterName, otherCharactersContext);
    const userPrompt = prompts.user
      .replace('{currentDescription}', currentDescription)
      .replace('{instructions}', instructions);
    return callAIWithPrompt(prompts.system, userPrompt, { temperature: 0.8, max_tokens: 4000, presetMode: 'force' });
  }, []);

  /**
   * Polish/rewrite a selected portion of text within a character description.
   * Returns only the rewritten selection, not the full description.
   */
  const polishSelection = useCallback(async (
    characterName: string,
    fullText: string,
    selectedText: string,
  ): Promise<string> => {
    const prompts = POLISH_SELECTION_PROMPT(characterName, fullText, selectedText);
    return callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.8, max_tokens: 2000, presetMode: 'force' });
  }, []);

  return {
    generateCharacter,
    generateCharacterStreaming,
    generateCharacterParsed,
    generateCharacterParsedStreaming,
    generateLorebook,
    generateLorebookStreaming,
    generateLorebookParsed,
    generateLorebookParsedStreaming,
    generateLorebookSkeleton,
    generateLorebookSkeletonStreaming,
    generateFirstMessage,
    generateFirstMessageStreaming,
    generateExampleDialogues,
    generateExampleDialoguesStreaming,
    organizeEntries,
    generateEntryKeys,
    generateMvuVariables,
    expandLorebookEntry,
    translateCard,
    diagnoseCard,
    correctMvuConfig,
    generateCustomStatusBar,
    modifyCharacterDescription,
    polishSelection,
  };
}
