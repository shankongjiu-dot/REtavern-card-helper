/**
 * Card Exporter - assembles SillyTavern Character Card V2 spec-compliant JSON.
 *
 * V2 Spec: https://github.com/malfoyslastname/character-card-spec-v2
 *
 * Architecture (per SillyTavern conventions):
 *   - `description`: Core character info → ALWAYS in prompt ("Permanent Tokens")
 *   - `personality`: Brief personality summary → ALWAYS in prompt
 *   - `scenario`: Dialogue circumstances → ALWAYS in prompt
 *   - `character_book` (World Book): Detailed character/world info stored as
 *     keyword-triggered entries, dynamically injected when keywords appear in chat.
 *     This is where the bulk of character detail SHOULD live for token efficiency.
 *   - `first_mes`: Opening message (sent once at chat start)
 *   - `mes_example`: Example dialogues (kept until context fills up)
 *
 * The character_book is a character-specific lorebook that stacks with the
 * user's global World Info. It gets embedded in the card on export.
 */
import { generateId, createEmptyMvuConfig } from '../constants/defaults';
import type { WizardDraft, LorebookEntry, LorebookPosition } from '../constants/defaults';

/**
 * Position string → numeric index mapping.
 * SillyTavern uses this numeric value internally for insertion position.
 * Reference: tavern-cards-forge DataReference.md PositionType table.
 *
 * IMPORTANT: The numeric order determines actual insertion order in the prompt:
 *   0=before_char → 1=after_char → 2=before_author → 3=after_author → 4=at_depth → 5=before_example → 6=after_example
 */
const POSITION_INDEX: Record<string, number> = {
  before_char: 0,           // before_character_definition
  after_char: 1,            // after_character_definition
  before_author: 2,         // before_author_note
  after_author: 3,          // after_author_note
  at_depth: 4,              // at_depth (ST runtime)
  before_example: 5,        // before_example_messages
  after_example: 6,         // after_example_messages
};

/**
 * SelectiveLogic string → numeric mapping.
 * Reference: tavern-cards-forge DataReference.md SelectiveLogic table.
 */
const SELECTIVE_LOGIC_INDEX: Record<number, number> = {
  0: 0,  // AND ANY → and_any
  1: 3,  // AND ALL → and_all
  2: 1,  // NOT ALL → not_all
  3: 2,  // NOT ANY → not_any
};

/** Reverse mapping: SillyTavern numeric → our UI index */
const SELECTIVE_LOGIC_REVERSE: Record<number, number> = {
  0: 0,  // and_any → AND ANY
  3: 1,  // and_all → AND ALL
  1: 2,  // not_all → NOT ALL
  2: 3,  // not_any → NOT ANY
};

/**
 * Build SillyTavern runtime extensions object for a lorebook entry.
 * This is the common structure shared by both wizard entries and generated character entries.
 * Format aligned with CardForge createEmptyWorldEntry + SillyTavern world-info.
 */
function buildSTExtensions(overrides: {
  position: string;
  displayIndex: number;
  probability?: number;
  group?: string;
  groupWeight?: number;
  selectiveLogic?: number;
  role?: number;
  depth?: number;
  excludeRecursion?: boolean;
  preventRecursion?: boolean;
  caseSensitive?: boolean | null;
  sticky?: number;
  cooldown?: number;
  delay?: number;
  ignoreBudget?: boolean;
} = {
  position: 'after_char',
  displayIndex: 0,
}): Record<string, unknown> {
  return {
    position: POSITION_INDEX[overrides.position] ?? 1,
    probability: overrides.probability ?? 100,
    useProbability: (overrides.probability ?? 100) < 100,
    group: overrides.group ?? '',
    group_override: false,
    group_weight: overrides.groupWeight ?? 100,
    selectiveLogic: SELECTIVE_LOGIC_INDEX[overrides.selectiveLogic ?? 0] ?? 0,
    role: overrides.role ?? 0,
    depth: overrides.depth ?? 4,
    scan_depth: (overrides.depth ?? 4) > 0 ? (overrides.depth ?? 4) : null,
    exclude_recursion: overrides.excludeRecursion ?? false,
    prevent_recursion: overrides.preventRecursion ?? true,
    delay_until_recursion: false,
    match_whole_words: null,
    use_group_scoring: false,
    case_sensitive: overrides.caseSensitive ?? null,
    automation_id: '',
    sticky: (overrides.sticky ?? 0) > 0 ? overrides.sticky : null,
    cooldown: (overrides.cooldown ?? 0) > 0 ? overrides.cooldown : null,
    delay: (overrides.delay ?? 0) > 0 ? overrides.delay : null,
    match_persona_description: false,
    match_character_description: false,
    match_character_personality: false,
    match_character_depth_prompt: false,
    match_scenario: false,
    match_creator_notes: false,
    triggers: [],
    ignore_budget: overrides.ignoreBudget ?? false,
    vectorized: false,
    display_index: overrides.displayIndex,
  };
}

/**
 * Build a character-based lorebook entry for auto-injection into the world book.
 */
function buildCharacterEntry(charName: string, content: string, order: number) {
  return {
    id: 1000 + order,
    keys: [charName],
    secondary_keys: [],
    content,
    name: `${charName} - 角色设定`,
    enabled: true,
    insertion_order: order,
    case_sensitive: false,
    selective: false,
    constant: true,
    position: 'after_char',
    priority: 100,
    comment: `${charName} 的角色设定`,
    use_regex: false,
    extensions: buildSTExtensions({
      position: 'after_char',
      displayIndex: order,
      preventRecursion: true,
    }),
  };
}

export function assembleCard(draft: WizardDraft, existingId?: number) {
  // ── Export mode: worldbook-first ───────────────────────────────
  // description = "", personality = ""
  // Character content is injected through draft.lorebookEntries, which is
  // synchronized by the wizard before preview/save.

  // ── Build `description` (always empty — content lives in world book) ──
  const description = '';
  const personality = '';

  // ── Build character_book entries (V2 CharacterBook format) ─────────────
  // V2 spec fields go directly on the entry.
  // SillyTavern runtime fields go in `extensions` (preserved by ST on import).
  const entries = draft.lorebookEntries.map((entry, i) => ({
    id: i + 1,
    keys: entry.keys,
    secondary_keys: entry.secondary_keys || [],
    content: entry.content,
    name: entry.name || `Entry ${i + 1}`,
    enabled: entry.enabled,
    insertion_order: entry.insertion_order ?? i,
    case_sensitive: entry.case_sensitive ?? false,
    selective: entry.selective ?? false,
    constant: entry.constant ?? false,
    position: entry.position ?? 'after_char',
    priority: entry.priority ?? 0,
    comment: entry.comment || entry.name || '',
    use_regex: entry.use_regex ?? false,
    extensions: buildSTExtensions({
      position: entry.position ?? 'after_char',
      displayIndex: i,
      probability: entry.probability ?? 100,
      group: entry.group || '',
      groupWeight: entry.group_weight ?? 100,
      selectiveLogic: entry.selectiveLogic ?? 0,
      role: entry.role ?? 0,
      depth: entry.depth ?? 4,
      excludeRecursion: entry.exclude_recursion ?? false,
      preventRecursion: entry.prevent_recursion ?? false,
      caseSensitive: entry.case_sensitive ? true : null,
      sticky: entry.sticky,
      cooldown: entry.cooldown,
      delay: entry.delay,
      ignoreBudget: entry.ignore_budget ?? false,
    }),
  }));

  const now = new Date();

  return {
    // Preserve existing id for edits
    ...(existingId ? { id: existingId } : {}),

    // ── Tavern V2 spec envelope ──────────────────────────────────────────
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      // V1 fields (nested inside data for V2)
      name: draft.cardName,
      description,
      personality,
      scenario: draft.scenario || '',
      first_mes: draft.firstMessage,
      mes_example: draft.exampleDialogues,

      // V2 new fields
      creator_notes: draft.creator_notes || '',
      system_prompt: draft.system_prompt || '',
      post_history_instructions: draft.post_history_instructions || '',
      alternate_greetings: draft.alternate_greetings || [],
      character_book: {
        name: '',
        description: '',
        scan_depth: draft.bookScanDepth ?? 200,
        token_budget: draft.bookTokenBudget ?? 1500,
        recursive_scanning: draft.bookRecursiveScanning ?? false,
        extensions: {},
        entries,
      },
      tags: draft.tags || [],
      creator: draft.creator || '',
      character_version: draft.character_version || '1.0',
      extensions: {},
    },

    // ── App-level metadata (NOT part of Tavern spec, for re-editing) ─────
    _meta: {
      characters: draft.characters.map((c) => ({
        id: c.id || generateId(),
        name: c.name,
        description: c.description,
        entryIds: c.entryIds || [],
      })),
    },

    // Timestamps
    name: draft.cardName,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Download a JSON file to the user's device.
 * Exports with V1 legacy top-level fields + V2 data block.
 * This matches SillyTavern's expected import format AND CardForge's export format.
 */
export function exportAsJson(card: ReturnType<typeof assembleCard>) {
  const d = card.data;
  const exportObj = {
    // V1 legacy fields at top level (for backward compatibility)
    name: d.name,
    description: d.description,
    personality: d.personality,
    scenario: d.scenario,
    first_mes: d.first_mes,
    mes_example: d.mes_example,
    creatorcomment: d.creator_notes,
    avatar: 'none',
    talkativeness: '0.5',
    fav: false,
    tags: d.tags || [],
    // V2 spec envelope
    spec: card.spec,
    spec_version: card.spec_version,
    data: d,
    create_date: new Date().toISOString(),
  };

  const json = JSON.stringify(exportObj, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${d.name || 'character-card'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export card as PNG with embedded JSON (SillyTavern standard format).
 * Optionally uses a user-provided PNG as the base image.
 * If no PNG provided, generates a minimal placeholder PNG.
 */
export async function exportAsPng(
  card: ReturnType<typeof assembleCard>,
  pngBuffer?: ArrayBuffer,
) {
  const { embedJsonInPng, downloadPng } = await import('./png-service');

  // Only embed the Tavern spec portion (no _meta, no timestamps)
  const specData = { spec: card.spec, spec_version: card.spec_version, data: card.data };
  const pngData = embedJsonInPng(pngBuffer || null, specData);
  downloadPng(pngData, card.data.name || 'character-card');
}

/**
 * Import a character card from a PNG file (SillyTavern format).
 * Extracts embedded JSON from the PNG tEXt chunk.
 * @returns The character card object, or null if no data found.
 */
export async function importFromPng(
  pngBuffer: ArrayBuffer,
): Promise<Record<string, unknown> | null> {
  const { extractJsonFromPng } = await import('./png-service');
  return extractJsonFromPng(pngBuffer);
}

/**
 * Convert an existing card's stored data back to wizard draft format (for editing).
 * Handles both V1 and V2 cards.
 */
export function cardToDraft(card: Record<string, unknown>): WizardDraft {
  const data = (card.data || card) as Record<string, unknown>;
  const meta = (card._meta || {}) as Record<string, unknown>;

  // Reconstruct characters from _meta, description, or generated character entries
  let characters: WizardDraft['characters'] = [];
  if (meta.characters && Array.isArray(meta.characters) && (meta.characters as unknown[]).length > 0) {
    characters = (meta.characters as unknown[]).map((c: unknown) => {
      const ch = c as Record<string, unknown>;
      return {
        id: (ch.id as string) || generateId(),
        name: (ch.name as string) || '',
        description: (ch.description as string) || '',
        entryIds: (ch.entryIds as string[]) || [],
      };
    }) as WizardDraft['characters'];
  } else if (data.description) {
    // Fallback: single character from description
    characters = [{
      id: generateId(),
      name: (data.name as string) || '',
      description: (data.description as string) || '',
    }];
  }

  // Reconstruct lorebook entries from character_book
  const charBook = data.character_book as Record<string, unknown> | undefined;
  const rawEntries = (charBook?.entries || []) as Array<Record<string, unknown>>;

  if (characters.length === 0) {
    const generatedCharacterEntries = rawEntries.filter((e) => {
      const name = (e.name as string) || '';
      return e.constant === true && name.endsWith(' - 角色设定') && typeof e.content === 'string';
    });

    characters = generatedCharacterEntries.map((e) => ({
      id: generateId(),
      name: ((e.name as string) || '').replace(/ - 角色设定$/, ''),
      description: (e.content as string) || '',
      entryIds: [(e.id as string) || generateId()],
    }));
  }

  return {
    cardName: (data.name as string) || (card.name as string) || '',
    characters,
    lorebookEntries: rawEntries.map((e, i) => {
      const ext = (e.extensions || {}) as Record<string, unknown>;
      return {
        id: (e.id as string) || generateId(),
        keys: (e.keys as string[]) || [],
        secondary_keys: (e.secondary_keys as string[]) || [],
        content: (e.content as string) || '',
        name: (e.name as string) || `Entry ${i + 1}`,
        enabled: (e.enabled as boolean) ?? true,
        constant: (e.constant as boolean) ?? false,
        selective: (e.selective as boolean) ?? false,
        insertion_order: (e.insertion_order as number) ?? i,
        position: ((e.position as string) || 'after_char') as LorebookPosition,
        priority: (e.priority as number) ?? 0,
        case_sensitive: (e.case_sensitive as boolean) ?? false,
        comment: (e.comment as string) || (e.name as string) || '',
        use_regex: (e.use_regex as boolean) ?? false,
        // ST runtime fields (from extensions, aligned with CardForge format)
        probability: (ext.probability as number) ?? 100,
        group: (ext.group as string) || '',
        group_weight: (ext.group_weight as number) ?? 100,
        selectiveLogic: SELECTIVE_LOGIC_REVERSE[(ext.selectiveLogic as number) ?? 0] ?? 0,
        role: (ext.role as number) ?? 0,
        depth: (ext.depth as number) ?? (ext.scan_depth as number) ?? 4,
        exclude_recursion: (ext.exclude_recursion as boolean) ?? false,
        prevent_recursion: (ext.prevent_recursion as boolean) ?? false,
        match_whole_words: (ext.match_whole_words as boolean) ?? true,
        sticky: (ext.sticky as number) ?? 0,
        cooldown: (ext.cooldown as number) ?? 0,
        delay: (ext.delay as number) ?? 0,
        ignore_budget: (ext.ignore_budget as boolean) ?? false,
      };
    }),
    firstMessage: (data.first_mes as string) || '',
    exampleDialogues: (data.mes_example as string) || '',

    // V2 advanced fields
    scenario: (data.scenario as string) || '',
    system_prompt: (data.system_prompt as string) || '',
    post_history_instructions: (data.post_history_instructions as string) || '',
    alternate_greetings: (data.alternate_greetings as string[]) || [],
    creator_notes: (data.creator_notes as string) || '',
    creator: (data.creator as string) || '',
    character_version: (data.character_version as string) || '',
    tags: (data.tags as string[]) || [],
    bookScanDepth: (charBook?.scan_depth as number) ?? 200,
    bookTokenBudget: (charBook?.token_budget as number) ?? 1500,
    bookRecursiveScanning: (charBook?.recursive_scanning as boolean) ?? false,

    // MVU config (not stored in V2 spec, separate asset files)
    mvu: createEmptyMvuConfig(),
  };
}
