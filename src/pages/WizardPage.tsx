/**
 * WizardPage - Orchestrates the step wizard for creating/editing character cards.
 * Supports both /wizard (new) and /wizard/:id (edit) modes.
 *
 * Architecture: Characters are the source of truth. When generated/edited,
 * their content is auto-injected as world book entries for efficient token usage.
 */
import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWizardState } from '../hooks/useWizardState';
import { useAIGenerate } from '../hooks/useAIGenerate';
import { useToast } from '../components/shared/Toast';
import { Button } from '../components/shared/Button';
import { WizardShell } from '../components/wizard/WizardShell';
import { StepCardName } from '../components/wizard/StepCardName';
import { StepCharacters } from '../components/wizard/StepCharacters';
import { StepWorldBook } from '../components/wizard/StepWorldBook';
import { StepFirstMessage } from '../components/wizard/StepFirstMessage';
import { StepExampleDialogues } from '../components/wizard/StepExampleDialogues';
import { StepBeautify } from '../components/wizard/StepBeautify';
import { StepReview } from '../components/wizard/StepReview';
import { generateId, createEmptyLorebookEntry } from '../constants/defaults';
import type { LorebookEntry, WizardCharacter } from '../constants/defaults';

/**
 * Sync character data → world book entries.
 * For each character with content, creates or updates a "角色设定" entry.
 * Returns the updated entries array and the updated characters (with entryIds).
 */
function syncCharacterEntries(
  characters: WizardCharacter[],
  existingEntries: LorebookEntry[],
): { entries: LorebookEntry[]; characters: WizardCharacter[] } {
  const allCharEntryIds = new Set<string>();
  for (const c of characters) {
    for (const eid of c.entryIds ?? []) allCharEntryIds.add(eid);
  }

  const userEntries = existingEntries.filter(e => !allCharEntryIds.has(e.id));

  const newCharEntries: LorebookEntry[] = [];
  const updatedCharacters: WizardCharacter[] = [];

  for (const char of characters) {
    if (!char.name?.trim()) {
      updatedCharacters.push(char);
      continue;
    }

    const charEntryIds: string[] = [];

    if (char.description?.trim()) {
      // Reuse existing entry ID if available
      const existingId = char.entryIds?.find(id =>
        existingEntries.find(e => e.id === id)
      );
      const entryId = existingId || generateId();
      const existing = existingEntries.find(e => e.id === entryId);

      const entry = existing || createEmptyLorebookEntry();
      entry.id = entryId;
      entry.name = `${char.name} - 角色设定`;
      entry.keys = [char.name];
      entry.content = char.description;
      entry.constant = true;
      entry.insertion_order = 1;
      entry.priority = 100;
      entry.comment = `${char.name} 的角色设定`;
      entry.prevent_recursion = true;
      charEntryIds.push(entryId);
      newCharEntries.push(entry);
    }

    updatedCharacters.push({ ...char, entryIds: charEntryIds });
  }

  return {
    entries: [...newCharEntries, ...userEntries],
    characters: updatedCharacters,
  };
}

export function WizardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const parsedId = id ? parseInt(id) : undefined;
  const editId = parsedId !== undefined && !isNaN(parsedId) ? parsedId : undefined;

  const {
    currentStep,
    draft,
    loading,
    saving,
    updateDraft,
    addCharacter,
    removeCharacter,
    updateCharacter,
    validateStep,
    goNext,
    goPrev,
    saveCard,
    isEditMode,
  } = useWizardState(editId);

  const [stepError, setStepError] = useState<string | null>(null);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [generatingIndex, setGeneratingIndex] = useState<number | null>(null);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const { generateCharacterParsedStreaming } = useAIGenerate();
  const { addToast } = useToast();

  // Character descriptions summary (for AI prompts in later steps)
  const characterDescriptions = draft.characters
    .filter((c) => c.name)
    .map((c) => `${c.name}: ${c.description || '(no description)'}`)
    .join('\n\n');

  const characterSummaries = draft.characters
    .filter((c) => c.name)
    .map((c) => c.name)
    .join(', ');

  // World book summary for MVU prompts
  const worldbookSummary = draft.lorebookEntries
    .filter(e => e.name)
    .map(e => `${e.name}: ${e.content.slice(0, 80)}`)
    .join('\n');

  /** Sync character data to world book entries and update draft */
  const getDraftWithCharacterEntries = useCallback(() => {
    const { entries, characters } = syncCharacterEntries(draft.characters, draft.lorebookEntries);
    return { ...draft, lorebookEntries: entries, characters };
  }, [draft]);

  const injectCharacterEntries = useCallback(() => {
    updateDraft(getDraftWithCharacterEntries());
  }, [getDraftWithCharacterEntries, updateDraft]);

  /** Navigate to next step, injecting entries when leaving Step 2 */
  const handleNext = useCallback(() => {
    if (currentStep === 2) {
      injectCharacterEntries();
    }
    const error = goNext();
    setStepError(error);
  }, [currentStep, injectCharacterEntries, goNext]);

  const handleSave = async () => {
    const success = await saveCard(getDraftWithCharacterEntries());
    if (success) {
      navigate('/library');
    }
  };

  // ── Generate a specific character by index ───────────────
  const handleGenerateCharacter = async (index: number) => {
    const char = draft.characters[index];
    if (!char?.name?.trim()) return;

    setGeneratingIndex(index);
    try {
      const hint = char.description || '';
      const result = await generateCharacterParsedStreaming(
        char.name,
        hint,
        () => {},
      );
      if (typeof result === 'object' && result !== null) {
        const parsed = result as Record<string, unknown>;
        const updates: Record<string, unknown> = {};
        if (parsed.description) updates.description = parsed.description as string;
        updateCharacter(index, updates);
        addToast('success', `${char.name} 生成完成`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '生成失败';
      addToast('error', `生成「${char.name}」失败：${msg}`);
    } finally {
      setGeneratingIndex(null);
    }
  };

  // ── Batch generate all named characters (sequentially, one API call per character) ──
  const handleBatchGenerateCharacters = async () => {
    const toGenerate = draft.characters
      .map((c, i) => ({ char: c, index: i }))
      .filter(({ char }) => char.name?.trim());
    if (toGenerate.length === 0) return;

    setBatchGenerating(true);
    setBatchProgress({ current: 0, total: toGenerate.length });

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < toGenerate.length; i++) {
      const { char, index } = toGenerate[i];
      setBatchProgress({ current: i + 1, total: toGenerate.length });

      try {
        // Pass the full 角色设定 as constraint instructions for AI expansion
        const hint = char.description || '';
        const result = await generateCharacterParsedStreaming(
          char.name,
          hint,
          () => {},
        );
        if (typeof result === 'object' && result !== null) {
          const parsed = result as Record<string, unknown>;
          const updates: Record<string, unknown> = {};
          if (parsed.description) updates.description = parsed.description as string;
          updateCharacter(index, updates);
        }
        successCount++;
      } catch (err: unknown) {
        errorCount++;
        const msg = err instanceof Error ? err.message : '未知错误';
        addToast('error', `「${char.name}」生成失败：${msg}`);
      }
    }

    setBatchGenerating(false);
    setBatchProgress({ current: 0, total: 0 });

    if (successCount > 0 && errorCount > 0) {
      addToast('success', `批量生成完成：${successCount} 成功，${errorCount} 失败`);
    } else if (successCount > 0) {
      addToast('success', `${successCount} 个角色全部生成完成`);
    }
  };

  // Update lorebook entries from StepCharacters inline editor
  const handleEntriesUpdate = useCallback((entries: LorebookEntry[]) => {
    updateDraft({ lorebookEntries: entries });
  }, [updateDraft]);

  const namedCharacterCount = draft.characters.filter(c => c.name?.trim()).length;
  const isGenerating = batchGenerating || generatingIndex !== null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <StepCardName
            cardName={draft.cardName}
            tags={draft.tags}
            onNameChange={(cardName) => updateDraft({ cardName })}
            onTagsChange={(tags) => updateDraft({ tags })}
          />
        );
      case 2:
        return (
          <StepCharacters
            characters={draft.characters}
            entries={draft.lorebookEntries}
            onAdd={addCharacter}
            onRemove={removeCharacter}
            onUpdate={updateCharacter}
            onGenerateCharacter={handleGenerateCharacter}
            onEntriesUpdate={handleEntriesUpdate}
            generatingIndex={generatingIndex}
          />
        );
      case 3:
        return (
          <StepWorldBook
            entries={draft.lorebookEntries}
            cardName={draft.cardName}
            characterSummaries={characterSummaries}
            onUpdate={(entries) => updateDraft({ lorebookEntries: entries })}
          />
        );
      case 4:
        return (
          <StepFirstMessage
            firstMessage={draft.firstMessage}
            cardName={draft.cardName}
            characterDescriptions={characterDescriptions}
            onChange={(msg) => updateDraft({ firstMessage: msg })}
          />
        );
      case 5:
        return (
          <StepExampleDialogues
            exampleDialogues={draft.exampleDialogues}
            cardName={draft.cardName}
            characterDescriptions={characterDescriptions}
            onChange={(d) => updateDraft({ exampleDialogues: d })}
          />
        );
      case 6:
        return (
          <StepBeautify
            mvu={draft.mvu}
            cardName={draft.cardName}
            characterSummaries={characterSummaries}
            worldbookSummary={worldbookSummary}
            firstMessageExcerpt={draft.firstMessage}
            onChange={(mvu) => updateDraft({ mvu })}
          />
        );
      case 7:
        return <StepReview draft={getDraftWithCharacterEntries()} />;
      default:
        return null;
    }
  };

  // Build extra actions for step 2
  const step2ExtraActions = currentStep === 2 && namedCharacterCount > 0 ? (
    <Button
      variant="secondary"
      onClick={handleBatchGenerateCharacters}
      disabled={isGenerating}
    >
      {batchGenerating
        ? `生成中 ${batchProgress.current}/${batchProgress.total}...`
        : 'AI 生成全部角色'
      }
    </Button>
  ) : undefined;

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-1">
        {isEditMode ? '编辑角色卡' : '创建角色卡'}
      </h1>
      <p className="text-sm text-slate-400 mb-6">
        {isEditMode ? '修改卡片内容并保存。' : '按步骤创建新的酒馆 AI 角色卡。'}
      </p>

      <WizardShell
        currentStep={currentStep}
        onPrev={goPrev}
        onNext={handleNext}
        onSave={handleSave}
        stepError={stepError}
        saving={saving}
        extraActions={step2ExtraActions}
      >
        {renderStep()}
      </WizardShell>
    </div>
  );
}
