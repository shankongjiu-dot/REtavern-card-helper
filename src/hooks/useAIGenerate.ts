/**
 * useAIGenerate - hook for AI-powered content generation in the wizard.
 * Handles character, lorebook, and first message generation.
 * Supports both streaming and non-streaming modes.
 *
 * NOTE: Preset injection is handled globally in ai-service.ts (injectPreset).
 * All AI calls automatically include the active writing preset.
 */
import { useCallback } from 'react';
import { useTranslation } from '../i18n/I18nContext';
import { callAIWithPrompt, callAIWithPromptStreaming, type StreamCallback } from '../services/ai-service';
import {
  CHARACTER_GENERATE_PROMPT,
  LOREBOOK_GENERATE_PROMPT,
  LOREBOOK_SKELETON_PROMPT,
  EXPAND_ENTRY_PROMPT,
  FIRST_MESSAGE_PROMPT,
  WORLD_RULES_GENERATE_PROMPT,
  ORGANIZE_ENTRIES_PROMPT,
  GENERATE_KEYS_PROMPT,
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
  const { lang } = useTranslation();

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
    const prompts = CHARACTER_GENERATE_PROMPT(characterName, hint, otherCharactersContext, alignment, nsfw, lang);
    return callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.85, presetMode: 'force' });
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
    const prompts = CHARACTER_GENERATE_PROMPT(characterName, hint, otherCharactersContext, alignment, nsfw, lang);
    return callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.85, presetMode: 'force' });
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
    const prompts = LOREBOOK_SKELETON_PROMPT(cardName, characterSummaries, topic, batchSize, existingTitles, rules, lang);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.9, presetMode: 'force' });
    const parsed = parseAIJson(text) as Array<{ comment?: string; content?: string; keys?: string[]; strategy?: string }> | null;
    return (parsed || []).map((sk) => ({
      comment: sk.comment || '未命名',
      content: sk.content || '(待展开)',
      keys: Array.isArray(sk.keys) ? sk.keys : [],
      strategy: sk.strategy || 'normal',
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
    const prompts = LOREBOOK_SKELETON_PROMPT(cardName, characterSummaries, topic, batchSize, existingTitles, rules, lang);
    const text = await callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.9, presetMode: 'force' });
    const parsed = parseAIJson(text) as Array<{ comment?: string; content?: string; keys?: string[]; strategy?: string }> | null;
    return (parsed || []).map((sk) => ({
      comment: sk.comment || '未命名',
      content: sk.content || '(待展开)',
      keys: Array.isArray(sk.keys) ? sk.keys : [],
      strategy: sk.strategy || 'normal',
    }));
  }, []);

  /**
   * Generate lorebook entries in batch.
   * @returns Raw text response
   */
  const generateLorebook = useCallback(async (cardName: string, characterSummaries: string, topic: string, batchCount: number, rules?: string, nsfw?: boolean): Promise<string> => {
    const prompts = LOREBOOK_GENERATE_PROMPT(cardName, characterSummaries, topic, batchCount, rules, nsfw, lang);
    return callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.8, presetMode: 'force' });
  }, []);

  /**
   * Generate lorebook entries with streaming.
   */
  const generateLorebookStreaming = useCallback(async (
    cardName: string,
    characterSummaries: string,
    topic: string,
    batchCount: number,
    onChunk: StreamCallback,
    rules?: string,
    nsfw?: boolean,
  ): Promise<string> => {
    const prompts = LOREBOOK_GENERATE_PROMPT(cardName, characterSummaries, topic, batchCount, rules, nsfw, lang);
    return callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.8, presetMode: 'force' });
  }, []);

  /**
   * Generate lorebook entries and parse as JSON array.
   * Returns entries with all V2 spec + SillyTavern runtime fields.
   */
  const generateLorebookParsed = useCallback(async (cardName: string, characterSummaries: string, topic: string, batchCount: number, rules?: string, nsfw?: boolean) => {
    const text = await generateLorebook(cardName, characterSummaries, topic, batchCount, rules, nsfw);
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
    batchCount: number,
    onChunk: StreamCallback,
    rules?: string,
    nsfw?: boolean,
  ) => {
    const text = await generateLorebookStreaming(cardName, characterSummaries, topic, batchCount, onChunk, rules, nsfw);
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
    writingRequirements?: string,
  ): Promise<string> => {
    const prompts = FIRST_MESSAGE_PROMPT(cardName, characterDescriptions, sceneHint, targetWordCount, worldbookContext, writingRequirements, lang);
    return callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.9, presetMode: 'force' });
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
    const prompts = FIRST_MESSAGE_PROMPT(cardName, characterDescriptions, sceneHint, targetWordCount, worldbookContext, writingRequirements, lang);
    return callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.9, presetMode: 'force' });
  }, []);

  /** Generate worldview constraints / operation rules */
  const generateWorldRules = useCallback(async (
    cardName: string,
    characterSummaries: string,
    topic?: string,
    existingRules?: string,
    existingWorldbookContext?: string,
    nsfw?: boolean,
  ): Promise<string> => {
    const prompts = WORLD_RULES_GENERATE_PROMPT(cardName, characterSummaries, topic, existingRules, existingWorldbookContext, nsfw, lang);
    return callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.7, presetMode: 'force' });
  }, []);

  /** Generate worldview constraints / operation rules with streaming */
  const generateWorldRulesStreaming = useCallback(async (
    cardName: string,
    characterSummaries: string,
    onChunk: StreamCallback,
    topic?: string,
    existingRules?: string,
    existingWorldbookContext?: string,
    nsfw?: boolean,
  ): Promise<string> => {
    const prompts = WORLD_RULES_GENERATE_PROMPT(cardName, characterSummaries, topic, existingRules, existingWorldbookContext, nsfw, lang);
    return callAIWithPromptStreaming(prompts.system, prompts.user, onChunk, { temperature: 0.7, presetMode: 'force' });
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
    const prompts = ORGANIZE_ENTRIES_PROMPT(entries, lang);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.3, presetMode: 'none' });
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
    const prompts = GENERATE_KEYS_PROMPT(entries, lang);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.5, presetMode: 'none' });
    const parsed = parseAIJson(text) as AIGeneratedKeys[] | null;
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
    const prompts = EXPAND_ENTRY_PROMPT(entry, characterContext, isSkeleton, userRequirement, nsfw, lang);
    const text = await callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.8, presetMode: 'force' });
    const parsed = parseAIJson(text) as { comment?: string; content?: string; keys?: string[]; strategy?: string } | null;

    return {
      comment: parsed?.comment ?? entry.comment,
      content: parsed?.content ?? text,
      keys: parsed?.keys ?? entry.keys,
      strategy: parsed?.strategy ?? entry.strategy,
    };
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

    const prompts = CARD_DIAGNOSIS_PROMPT(lang);
    const userPrompt = prompts.user.replace('{cardContent}', JSON.stringify(diagContent, null, 2));

    const text = await callAIWithPrompt(prompts.system, userPrompt, { temperature: 0.4, presetMode: 'none' });
    return parseAIJson(text) as ReturnType<typeof diagnoseCard> extends Promise<infer T> ? T : never;
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
    const prompts = MODIFY_CHARACTER_PROMPT(characterName, otherCharactersContext, lang);
    const userPrompt = prompts.user
      .replace('{currentDescription}', currentDescription)
      .replace('{instructions}', instructions);
    return callAIWithPrompt(prompts.system, userPrompt, { temperature: 0.8, presetMode: 'force' });
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
    const prompts = POLISH_SELECTION_PROMPT(characterName, fullText, selectedText, lang);
    return callAIWithPrompt(prompts.system, prompts.user, { temperature: 0.8, presetMode: 'force' });
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
    generateWorldRules,
    generateWorldRulesStreaming,
    organizeEntries,
    generateEntryKeys,
    expandLorebookEntry,
    diagnoseCard,
    modifyCharacterDescription,
    polishSelection,
    /** Simple text generation for non-structured prompts (e.g. MVU beginner mode) */
    generateText: useCallback(async (
      systemPrompt: string,
      userPrompt: string,
    ): Promise<string> => {
      return callAIWithPrompt(systemPrompt, userPrompt, { temperature: 0.7, presetMode: 'force' });
    }, []),
  };
}
