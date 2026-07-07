import { describe, it, expect } from 'vitest';
import type { WizardDraft } from '../constants/defaults';
import {
  parseCardChatEdits,
  computeCardChatDiffs,
  applyCardChatPatch,
} from './card-chat-optimizer';

function emptyDraft(overrides: Partial<WizardDraft> = {}): WizardDraft {
  return {
    cardName: 'Test Card',
    characters: [{ id: 'char-1', name: 'Alice', description: 'A brave knight.' }],
    lorebookEntries: [
      {
        id: 'entry-1',
        name: 'Background',
        comment: 'Background',
        keys: ['past'],
        secondary_keys: [],
        content: 'She was born in a small village.',
        enabled: true,
        constant: false,
        selective: false,
        insertion_order: 100,
        position: 'after_char',
        priority: 50,
        case_sensitive: false,
        use_regex: false,
        probability: 100,
        group: '',
        group_weight: 100,
        selectiveLogic: 0,
        role: 0,
        depth: 4,
        exclude_recursion: false,
        prevent_recursion: false,
        match_whole_words: false,
        sticky: 0,
        cooldown: 0,
        delay: 0,
        ignore_budget: false,
      },
    ],
    firstMessage: 'Hello there.',
    scenario: 'A fantasy world.',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    creator_notes: '',
    creator: '',
    character_version: '',
    tags: ['fantasy'],
    bookScanDepth: 50,
    bookTokenBudget: 2000,
    bookRecursiveScanning: false,
    ...overrides,
  };
}

describe('parseCardChatEdits', () => {
  it('parses a markdown-fenced JSON with proposedChanges', () => {
    const text = '```json\n{"proposedChanges":[{"field":"firstMessage","value":"你好。"}]}\n```';
    const result = parseCardChatEdits(text);
    expect(result).not.toBeNull();
    expect(result!.proposedChanges).toHaveLength(1);
    expect(result!.proposedChanges[0]).toMatchObject({ field: 'firstMessage', value: '你好。' });
  });

  it('parses plain JSON without fences', () => {
    const text = '{"proposedChanges":[{"field":"cardName","value":"New Name"}]}';
    const result = parseCardChatEdits(text);
    expect(result).not.toBeNull();
    expect(result!.proposedChanges[0]).toMatchObject({ field: 'cardName', value: 'New Name' });
  });

  it('returns null for normal chat reply', () => {
    const text = '我觉得你可以把开场白改得更温柔一些。';
    expect(parseCardChatEdits(text)).toBeNull();
  });

  it('returns null when proposedChanges is missing', () => {
    const text = '{"foo":"bar"}';
    expect(parseCardChatEdits(text)).toBeNull();
  });

  it('parses lorebook add/replace/delete changes', () => {
    const text = JSON.stringify({
      proposedChanges: [
        { field: 'lorebookEntries', action: 'replace' as const, comment: 'Background', content: 'New content', keys: ['past', 'village'] },
        { field: 'lorebookEntries', action: 'add' as const, comment: 'New Entry', content: 'New entry content', keys: ['magic'] },
        { field: 'lorebookEntries', action: 'delete' as const, comment: 'Background' },
      ],
    });
    const result = parseCardChatEdits(text);
    expect(result).not.toBeNull();
    expect(result!.proposedChanges).toHaveLength(3);
  });

  it('parses character changes', () => {
    const text = JSON.stringify({
      proposedChanges: [
        { field: 'characters', action: 'replace' as const, id: 'char-1', description: 'A kind healer.' },
        { field: 'characters', action: 'add' as const, name: 'Bob', description: 'A rogue.' },
      ],
    });
    const result = parseCardChatEdits(text);
    expect(result).not.toBeNull();
    expect(result!.proposedChanges).toHaveLength(2);
  });
});

describe('computeCardChatDiffs', () => {
  it('computes diff for scalar field change', () => {
    const draft = emptyDraft();
    const proposals = { proposedChanges: [{ field: 'firstMessage' as const, value: '你好。' }] };
    const diffs = computeCardChatDiffs(draft, proposals);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].hasChange).toBe(true);
    expect(diffs[0].before).toBe('Hello there.');
    expect(diffs[0].after).toBe('你好。');
  });

  it('detects unchanged scalar field', () => {
    const draft = emptyDraft();
    const proposals = { proposedChanges: [{ field: 'cardName' as const, value: 'Test Card' }] };
    const diffs = computeCardChatDiffs(draft, proposals);
    expect(diffs[0].hasChange).toBe(false);
  });

  it('computes diff for lorebook entry replace', () => {
    const draft = emptyDraft();
    const proposals = { proposedChanges: [{ field: 'lorebookEntries' as const, action: 'replace' as const, comment: 'Background', content: 'Modified content', keys: ['past'] }] };
    const diffs = computeCardChatDiffs(draft, proposals);
    expect(diffs[0].hasChange).toBe(true);
  });

  it('ignores lorebook replace for missing comment', () => {
    const draft = emptyDraft();
    const proposals = { proposedChanges: [{ field: 'lorebookEntries' as const, action: 'replace' as const, comment: 'Missing', content: 'x' }] };
    const diffs = computeCardChatDiffs(draft, proposals);
    expect(diffs[0].hasChange).toBe(false);
  });
});

describe('applyCardChatPatch', () => {
  it('applies scalar field change', () => {
    const draft = emptyDraft();
    const proposals = { proposedChanges: [{ field: 'firstMessage' as const, value: '你好。' }] };
    const next = applyCardChatPatch(draft, proposals);
    expect(next.firstMessage).toBe('你好。');
  });

  it('replaces character description', () => {
    const draft = emptyDraft();
    const proposals = { proposedChanges: [{ field: 'characters' as const, action: 'replace' as const, id: 'char-1', description: 'A kind healer.' }] };
    const next = applyCardChatPatch(draft, proposals);
    expect(next.characters[0].description).toBe('A kind healer.');
  });

  it('adds a new lorebook entry', () => {
    const draft = emptyDraft();
    const proposals = { proposedChanges: [{ field: 'lorebookEntries' as const, action: 'add' as const, comment: 'Magic', content: 'She can cast spells.', keys: ['magic'] }] };
    const next = applyCardChatPatch(draft, proposals);
    expect(next.lorebookEntries).toHaveLength(2);
    expect(next.lorebookEntries[1].comment).toBe('Magic');
  });

  it('deletes a lorebook entry', () => {
    const draft = emptyDraft();
    const proposals = { proposedChanges: [{ field: 'lorebookEntries' as const, action: 'delete' as const, comment: 'Background' }] };
    const next = applyCardChatPatch(draft, proposals);
    expect(next.lorebookEntries).toHaveLength(0);
  });
});
