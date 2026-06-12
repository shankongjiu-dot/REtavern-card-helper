/**
 * WizardPage - Orchestrates the step wizard for creating/editing character cards.
 * Supports both /wizard (new) and /wizard/:id (edit) modes.
 *
 * Architecture: Characters are the source of truth. When generated/edited,
 * their content is auto-injected as world book entries for efficient token usage.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
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
import { consumeAnalysisLorebookImport } from '../services/novel-analysis-service';

/** A single version in the character generation history */
export interface CharacterVersion {
  id: string;
  /** The text content of this version */
  content: string;
  /** When this version was created */
  timestamp: number;
  /** Whether this is the user's original input (not AI-generated) */
  isOriginal: boolean;
}

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
  const location = useLocation();
  const importedNovelRef = useRef(false);
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
    setCurrentStep,
    saveCard,
    isEditMode,
  } = useWizardState(editId);

  const [stepError, setStepError] = useState<string | null>(null);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [generatingIndex, setGeneratingIndex] = useState<number | null>(null);
  const [modifyingIndex, setModifyingIndex] = useState<number | null>(null);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const { generateCharacterParsedStreaming, modifyCharacterDescription, polishSelection } = useAIGenerate();
  const { addToast } = useToast();

  // ── Character generation history ──────────────────────────────────────
  const [characterHistory, setCharacterHistory] = useState<Record<string, CharacterVersion[]>>({});

  /** Get history for a specific character */
  const getCharacterHistory = useCallback((charId: string): CharacterVersion[] => {
    return characterHistory[charId] || [];
  }, [characterHistory]);

  /** Add a version to a character's history and make it the active description */
  const addToCharacterHistory = useCallback((charId: string, content: string, isOriginal: boolean) => {
    setCharacterHistory(prev => {
      const existing = prev[charId] || [];
      const newVersion: CharacterVersion = {
        id: generateId(),
        content,
        timestamp: Date.now(),
        isOriginal,
      };
      return { ...prev, [charId]: [...existing, newVersion] };
    });
  }, []);

  /** Select a version from history, updating the character's description */
  const selectCharacterVersion = useCallback((charIndex: number, charId: string, versionId: string) => {
    const history = characterHistory[charId];
    if (!history) return;
    const version = history.find(v => v.id === versionId);
    if (!version) return;
    updateCharacter(charIndex, { description: version.content });
  }, [characterHistory, updateCharacter]);

  /** Delete a version from history */
  const deleteCharacterVersion = useCallback((charId: string, versionId: string) => {
    setCharacterHistory(prev => {
      const existing = prev[charId] || [];
      const filtered = existing.filter(v => v.id !== versionId);
      if (filtered.length === 0) {
        const next = { ...prev };
        delete next[charId];
        return next;
      }
      return { ...prev, [charId]: filtered };
    });
  }, []);

  /** Save current description as a new manual version */
  const saveCurrentAsVersion = useCallback((charId: string, content: string) => {
    if (!content.trim()) return;
    addToCharacterHistory(charId, content, false);
    addToast('success', '已保存为新版本');
  }, [addToCharacterHistory, addToast]);

  useEffect(() => {
    if (loading || editId || importedNovelRef.current) return;
    if (!location.search.includes('fromNovelAnalysis=1')) return;

    const payload = consumeAnalysisLorebookImport();
    if (!payload || payload.entries.length === 0) return;

    importedNovelRef.current = true;
    updateDraft({
      cardName: draft.cardName || payload.title || '小说分析角色卡',
      lorebookEntries: [...draft.lorebookEntries, ...payload.entries],
    });
    setCurrentStep(3);
    addToast('success', `已导入 ${payload.entries.length} 条小说世界书素材`);
    navigate('/wizard', { replace: true });
  }, [loading, editId, location.search, draft.cardName, draft.lorebookEntries, updateDraft, setCurrentStep, addToast, navigate]);

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
    .map(e => `${e.name}: ${(e.content || '').slice(0, 80)}`)
    .join('\n');

  const worldbookContext = draft.lorebookEntries
    .filter(e => e.enabled !== false && (e.name || e.content))
    .map((e, index) => `[${index + 1}] ${e.name || e.comment || '未命名条目'}
触发词: ${(e.keys || []).join('、') || '(无)'}
类型: ${e.constant ? '常驻' : '触发'} · 位置: ${e.position} · 优先级: ${e.priority}
内容:
${e.content || ''}`)
    .join('\n\n---\n\n');

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

      // Save current description as original if this is the first generation
      const existingHistory = characterHistory[char.id] || [];
      if (existingHistory.length === 0 && hint.trim()) {
        addToCharacterHistory(char.id, hint, true);
      }

      // Build context from other already-created characters
      const otherCharsContext = draft.characters
        .filter((c, i) => i !== index && c.name?.trim() && c.description?.trim())
        .map(c => `### ${c.name}\n${c.description!.slice(0, 2000)}`)
        .join('\n\n');

      const result = await generateCharacterParsedStreaming(
        char.name,
        hint,
        () => {},
        otherCharsContext || undefined,
      );
      if (typeof result === 'object' && result !== null) {
        const parsed = result as Record<string, unknown>;
        if (parsed.description) {
          const newDesc = parsed.description as string;
          // Save AI result to history
          addToCharacterHistory(char.id, newDesc, false);
          // Update character description
          updateCharacter(index, { description: newDesc });
        }
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

    // Track generated descriptions locally so subsequent characters
    // can see earlier ones' results (fixes stale closure over draft.characters)
    const generatedDescriptions = new Map<string, string>();
    // Pre-fill with existing descriptions from draft
    for (const c of draft.characters) {
      if (c.id && c.description?.trim()) {
        generatedDescriptions.set(c.id, c.description);
      }
    }

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < toGenerate.length; i++) {
      const { char, index } = toGenerate[i];
      setBatchProgress({ current: i + 1, total: toGenerate.length });

      try {
        const hint = char.description || '';

        // Save current description as original if this is the first generation
        const existingHistory = characterHistory[char.id] || [];
        if (existingHistory.length === 0 && hint.trim()) {
          addToCharacterHistory(char.id, hint, true);
        }

        // Build context from ALL other characters, using locally tracked
        // generated descriptions (which include results from earlier in this loop)
        const otherCharsContext = draft.characters
          .filter((c, ci) => ci !== index && c.name?.trim())
          .map(c => {
            // Prefer the latest generated description from our local tracker
            const desc = generatedDescriptions.get(c.id) || c.description || '';
            return desc.trim() ? `### ${c.name}\n${desc.slice(0, 2000)}` : null;
          })
          .filter((s): s is string => s !== null)
          .join('\n\n');

        const result = await generateCharacterParsedStreaming(
          char.name,
          hint,
          () => {},
          otherCharsContext || undefined,
        );
        if (typeof result === 'object' && result !== null) {
          const parsed = result as Record<string, unknown>;
          if (parsed.description) {
            const newDesc = parsed.description as string;
            addToCharacterHistory(char.id, newDesc, false);
            updateCharacter(index, { description: newDesc });
            // Store in local tracker for subsequent characters in this batch
            generatedDescriptions.set(char.id, newDesc);
          }
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

  // ── Partial modification of character description ──────────────────
  const handleModifyCharacter = async (index: number, instructions: string) => {
    const char = draft.characters[index];
    if (!char?.name?.trim() || !char.description?.trim()) return;

    setModifyingIndex(index);
    try {
      const currentDesc = char.description;

      // Build context from other characters for relationship consistency
      const otherCharsContext = draft.characters
        .filter((c, i) => i !== index && c.name?.trim() && c.description?.trim())
        .map(c => `### ${c.name}\n${c.description!.slice(0, 2000)}`)
        .join('\n\n');

      const modifiedDesc = await modifyCharacterDescription(
        char.name,
        currentDesc,
        instructions,
        otherCharsContext || undefined,
      );

      if (modifiedDesc && modifiedDesc.trim()) {
        // Save current to history before replacing
        addToCharacterHistory(char.id, currentDesc, false);
        // Save modified result to history
        addToCharacterHistory(char.id, modifiedDesc.trim(), false);
        // Update character
        updateCharacter(index, { description: modifiedDesc.trim() });
        addToast('success', `${char.name} 局部修改完成`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '修改失败';
      addToast('error', `修改「${char.name}」失败：${msg}`);
    } finally {
      setModifyingIndex(null);
    }
  };

  // ── Polish selected text within character description ──────────────
  const handlePolishSelection = async (index: number, selectedText: string, fullText: string) => {
    const char = draft.characters[index];
    if (!char?.name?.trim() || !selectedText) return;

    setModifyingIndex(index);
    try {
      const polished = await polishSelection(
        char.name,
        fullText,
        selectedText,
      );

      if (polished && polished.trim()) {
        // Replace the selected portion in the full text
        const newDesc = fullText.replace(selectedText, polished.trim());
        // Save current to history
        addToCharacterHistory(char.id, fullText, false);
        // Save polished result to history
        addToCharacterHistory(char.id, newDesc, false);
        // Update character
        updateCharacter(index, { description: newDesc });
        addToast('success', `${char.name} 选段润色完成`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '润色失败';
      addToast('error', `润色「${char.name}」失败：${msg}`);
    } finally {
      setModifyingIndex(null);
    }
  };

  // Update lorebook entries from StepCharacters inline editor
  const handleEntriesUpdate = useCallback((entries: LorebookEntry[]) => {
    updateDraft({ lorebookEntries: entries });
  }, [updateDraft]);

  const namedCharacterCount = draft.characters.filter(c => c.name?.trim()).length;
  const isGenerating = batchGenerating || generatingIndex !== null || modifyingIndex !== null;

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
            onModifyCharacter={handleModifyCharacter}
            onPolishSelection={handlePolishSelection}
            onEntriesUpdate={handleEntriesUpdate}
            generatingIndex={generatingIndex}
            modifyingIndex={modifyingIndex}
            characterHistory={characterHistory}
            onSelectVersion={selectCharacterVersion}
            onDeleteVersion={deleteCharacterVersion}
            onSaveVersion={saveCurrentAsVersion}
          />
        );
      case 3:
        return (
          <StepWorldBook
            entries={draft.lorebookEntries}
            cardName={draft.cardName}
            characterSummaries={characterSummaries}
            existingWorldbookContext={worldbookContext}
            onUpdate={(entries) => updateDraft({ lorebookEntries: entries })}
            onNext={handleNext}
          />
        );
      case 4:
        return (
          <StepFirstMessage
            firstMessage={draft.firstMessage}
            cardName={draft.cardName}
            characterDescriptions={characterDescriptions}
            worldbookContext={worldbookContext}
            onChange={(msg) => updateDraft({ firstMessage: msg })}
          />
        );
      case 5:
        return (
          <StepExampleDialogues
            exampleDialogues={draft.exampleDialogues}
            cardName={draft.cardName}
            characterDescriptions={characterDescriptions}
            existingWorldbookContext={worldbookContext}
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
