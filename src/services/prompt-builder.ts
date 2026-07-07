/**
 * Prompt Builder - assembles system prompts for test chat,
 * following SillyTavern's prompt construction conventions.
 *
 * SillyTavern context build order (permanent tokens):
 *   1. Main System Prompt (or character's system_prompt override)
 *   2. Character Description (permanent)
 *   3. Character Personality (permanent)
 *   4. Scenario (permanent)
 *   5. World Book / Character Book entries (dynamic, keyword-triggered)
 *   6. Example Dialogues (pushed out as context fills)
 *   7. Chat History
 *   8. Post-History Instructions (jailbreak)
 *
 * For test chat we approximate this by building a single system prompt
 * that includes all permanent + relevant world book info.
 *
 * Placeholders: {{char}} = character name, {{user}} = "You"
 */

interface CardData {
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    system_prompt: string;
    post_history_instructions: string;
    character_book?: {
      entries: Array<{
        keys: string[];
        content: string;
        name: string;
        enabled: boolean;
        constant: boolean;
        insertion_order: number;
        position?: string;
      }>;
    };
  };
}

/**
 * Build a system prompt from card data for test chat.
 * Approximates SillyTavern's prompt construction.
 */
export function buildSystemPrompt(card: CardData): string {
  const data = card.data;

  // If the card has a system_prompt override, use it
  // (with {{original}} placeholder support)
  if (data.system_prompt?.trim()) {
    const defaultPrompt = buildDefaultSystemPrompt(card);
    return data.system_prompt.replace(/\{\{original\}\}/g, defaultPrompt);
  }

  return buildDefaultSystemPrompt(card);
}

/**
 * Build the default system prompt from card fields.
 * Follows SillyTavern's permanent token structure.
 */
function buildDefaultSystemPrompt(card: CardData): string {
  const data = card.data;
  const charName = data.name || 'Character';
  const sections: string[] = [];

  // 1. Character Description (permanent token - always sent)
  if (data.description?.trim()) {
    sections.push(data.description);
  }

  // 2. Personality summary (permanent token)
  if (data.personality?.trim()) {
    sections.push(`Personality: ${data.personality}`);
  }

  // 3. Scenario (permanent token)
  if (data.scenario?.trim()) {
    sections.push(`Scenario: ${data.scenario}`);
  }

  // 4. World Book constant entries (always included regardless of keywords)
  // In SillyTavern, non-constant entries are dynamically inserted when
  // their keywords appear in chat. For test chat we include constant entries
  // in the system prompt since we don't have a full WI engine.
  if (data.character_book?.entries) {
    const constantEntries = data.character_book.entries
      .filter((e) => e.constant && e.enabled)
      .sort((a, b) => a.insertion_order - b.insertion_order);

    if (constantEntries.length > 0) {
      const worldInfo = constantEntries
        .map((e) => e.content)
        .join('\n\n');
      sections.push(`[World Information]\n${worldInfo}`);
    }
  }

  // 5. Example dialogues (in SillyTavern these are kept until context fills)
  if (data.mes_example?.trim()) {
    // Replace {{char}} and {{user}} placeholders
    const examples = data.mes_example
      .replace(/\{\{char\}\}/gi, charName)
      .replace(/\{\{user\}\}/gi, 'You');
    sections.push(`Example conversations:\n${examples}`);
  }

  // 6. Character instruction (stay in character)
  sections.push(
    `You are ${charName}. Stay in character at all times. ` +
    `Respond using ${charName}'s speech patterns and mannerisms. ` +
    `Use *asterisks* for actions and narration.`
  );

  return sections.join('\n\n');
}

/**
 * Build the post-history instructions (jailbreak).
 * In SillyTavern this is sent after chat history, before the AI generates.
 * For test chat we append it to the system prompt.
 */
export function buildPostHistoryInstructions(card: CardData): string {
  const data = card.data;
  if (!data.post_history_instructions?.trim()) return '';
  return data.post_history_instructions;
}
