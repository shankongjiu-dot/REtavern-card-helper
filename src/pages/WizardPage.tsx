/**
 * WizardPage - Orchestrates the step wizard for creating/editing character cards.
 * Supports both /wizard (new) and /wizard/:id (edit) modes.
 *
 * Architecture: Characters are the source of truth. When generated/edited,
 * their content is auto-injected as world book entries for efficient token usage.
 */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
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
import { StepMvuVariables } from '../components/wizard/StepMvuVariables';
import { StepStagedMode } from '../components/wizard/StepStagedMode';
import { StepPolishExport } from '../components/wizard/StepPolishExport';
import { generateId, createEmptyDraft, createEmptyLorebookEntry, createEmptyMvuConfig, MVU_LOREBOOK_ENTRY_NAMES } from '../constants/defaults';
import type { LorebookEntry, WizardCharacter, WizardDraft, StagedModeConfig } from '../constants/defaults';
import { consumeAnalysisLorebookImport } from '../services/novel-analysis-service';
import { consumeWorkshopLorebookImport, mergeVariableBlueprintsIntoMvu } from '../services/novel-workshop-bridge';
import { findStagedLorebookEntryIndices } from '../services/card-exporter';
import { escapeEjsDoubleQuoted } from '../services/staged-lorebook-builder';
import { useTranslation } from '../i18n/I18nContext';
import { logger } from '../services/logger';

const textPrimaryStyle = { color: 'var(--text-color)' };
const textMutedStyle = { color: 'var(--color-text-muted)' };

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
  t: (key: string, params?: Record<string, string>) => string,
): { entries: LorebookEntry[]; characters: WizardCharacter[] } {
  const allCharEntryIds = new Set<string>();
  for (const c of characters) {
    for (const eid of c.entryIds ?? []) allCharEntryIds.add(eid);
  }

  // Drop old auto-generated role-setting entries (including split chunks) for each
  // named character so that re-syncing a long description doesn't leave stale
  // "(2)" / "(3)" entries behind.
  const roleEntryIdsToReplace = new Set<string>();
  for (const c of characters) {
    if (!c.name?.trim()) continue;
    const prefix = t('wizard.roleSettingEntryName', { name: c.name });
    for (const e of existingEntries) {
      if (e.name.startsWith(prefix)) roleEntryIdsToReplace.add(e.id);
    }
  }

  const syncExistingEntries = existingEntries.filter(e => !roleEntryIdsToReplace.has(e.id));
  const userEntries = syncExistingEntries.filter(e => !allCharEntryIds.has(e.id));

  const newCharEntries: LorebookEntry[] = [];
  const updatedCharacters: WizardCharacter[] = [];

  for (const char of characters) {
    if (!char.name?.trim()) {
      updatedCharacters.push(char);
      continue;
    }

    const charEntryIds: string[] = [];

    if (char.description?.trim()) {
      // Reuse existing entry ID if available; fallback to matching by name/comment
      // so manually deleted duplicates don't cause brand-new entries to be created.
      // Name-based lookup uses existingEntries (not syncExistingEntries) so that
      // role-setting entries filtered into roleEntryIdsToReplace are still found
      // and their IDs/properties reused — preventing ID churn and duplicates on re-edit.
      const expectedName = t('wizard.roleSettingEntryName', { name: char.name });
      const expectedComment = t('wizard.roleSettingComment', { name: char.name });
      const existingById = char.entryIds?.find(id =>
        existingEntries.find(e => e.id === id)
      );
      const existingByName = existingById
        ? undefined
        : existingEntries.find(
            e => e.name === expectedName || e.comment === expectedComment
          );
      const existingId = existingById || existingByName?.id;
      const entryId = existingId || generateId();
      const existing = existingEntries.find(e => e.id === entryId);

      // Split long content (>2000 chars) into multiple entries for better token management
      const content = char.description.trim();
      const maxChunkLen = 2000;

      if (content.length > maxChunkLen) {
        // Split by double-newline paragraphs first, then force-split long paragraphs
        const paragraphs = content.split(/\n\n+/).filter(p => p.trim());
        const chunks: string[] = [];
        let current = '';

        for (const para of paragraphs) {
          if ((current + '\n\n' + para).length > maxChunkLen && current.length > 0) {
            chunks.push(current.trim());
            current = para;
          } else {
            current += (current ? '\n\n' : '') + para;
          }
        }
        if (current.trim()) chunks.push(current.trim());

        // Force-split any remaining oversized chunks
        const finalChunks: string[] = [];
        for (const chunk of chunks) {
          if (chunk.length <= maxChunkLen) {
            finalChunks.push(chunk);
          } else {
            let remaining = chunk;
            while (remaining.length > maxChunkLen) {
              const cutPoint = remaining.lastIndexOf('\n', maxChunkLen);
              const point = cutPoint > maxChunkLen * 0.5 ? cutPoint : maxChunkLen;
              finalChunks.push(remaining.slice(0, point).trim());
              remaining = remaining.slice(point);
            }
            if (remaining.trim()) finalChunks.push(remaining.trim());
          }
        }

        // Create entries for each chunk
        for (let ci = 0; ci < finalChunks.length; ci++) {
          const subEntryId = ci === 0 ? entryId : generateId();
          const subExisting = ci === 0 ? existing : undefined;
          const entry = subExisting ? { ...subExisting } : createEmptyLorebookEntry();
          entry.id = subEntryId;
          entry.name = t('wizard.roleSettingEntryName', { name: char.name }) + (ci > 0 ? ` (${ci + 1})` : '');
          entry.keys = [char.name];
          entry.content = finalChunks[ci];
          entry.constant = true;
          entry.insertion_order = 1;
          entry.priority = 100 - ci; // earlier chunks get higher priority
          entry.comment = t('wizard.roleSettingComment', { name: char.name }) + (ci > 0 ? ` (续${ci + 1})` : '');
          entry.prevent_recursion = true;
          entry.selective = false;
          charEntryIds.push(subEntryId);
          newCharEntries.push(entry);
        }
      } else {
        // Short content: single entry (original behavior)
        const entry = existing ? { ...existing } : createEmptyLorebookEntry();
        entry.id = entryId;
        entry.name = t('wizard.roleSettingEntryName', { name: char.name });
        entry.keys = [char.name];
        entry.content = content;
        entry.constant = true;
        entry.insertion_order = 1;
        entry.priority = 100;
        entry.comment = t('wizard.roleSettingComment', { name: char.name });
        entry.prevent_recursion = true;
        entry.selective = false;
        charEntryIds.push(entryId);
        newCharEntries.push(entry);
      }
    }

    updatedCharacters.push({ ...char, entryIds: charEntryIds });
  }

  // Ensure entries reused by name aren't also kept as user entries.
  const reusedEntryIds = new Set(newCharEntries.map(e => e.id));
  return {
    entries: [...newCharEntries, ...userEntries.filter(e => !reusedEntryIds.has(e.id))],
    characters: updatedCharacters,
  };
}

export function WizardPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const parsedId = id ? parseInt(id) : undefined;
  const editId = parsedId !== undefined && !isNaN(parsedId) ? parsedId : undefined;
  const searchParams = new URLSearchParams(location.search);
  const draftIdFromUrl = searchParams.get('draftId') || undefined;

  const {
    currentStep,
    draft,
    loading,
    saving,
    updateDraft,
    addCharacter,
    removeCharacter,
    updateCharacter,
    goNext,
    goPrev,
    setCurrentStep,
    saveCard,
    saveDraftNow,
    clearDraft,
    isEditMode,
  } = useWizardState(editId, draftIdFromUrl);

  const [stepError, setStepError] = useState<string | null>(null);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [generatingIndex, setGeneratingIndex] = useState<number | null>(null);
  const [modifyingIndex, setModifyingIndex] = useState<number | null>(null);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [pngBuffer, setPngBuffer] = useState<ArrayBuffer | null>(null);
  const { generateCharacterParsedStreaming, modifyCharacterDescription, polishSelection } = useAIGenerate();
  const { addToast } = useToast();

  // ── Streaming chunk callback map — each CharacterEditor registers its own
  //    preview handler keyed by index, so single AND batch generation can route
  //    chunks to the correct editor by looking up the index. ──────────────────
  const streamingChunkCallbackRef = useRef<Map<number, (chunk: string, fullText: string) => void>>(new Map());

  // ── Character generation history ──────────────────────────────────────
  const [characterHistory, setCharacterHistory] = useState<Record<string, CharacterVersion[]>>({});
  // Keep a ref in sync so async callbacks always read the latest history
  const characterHistoryRef = useRef<Record<string, CharacterVersion[]>>({});
  useEffect(() => { characterHistoryRef.current = characterHistory; }, [characterHistory]);

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
    addToast('success', t('wizard.savedAsVersion'));
  }, [addToCharacterHistory, addToast, t]);

  useEffect(() => {
    if (loading || editId) return;
    if (!location.search.includes('fromNovelAnalysis=1')) return;

    const payload = consumeAnalysisLorebookImport();
    if (!payload || payload.entries.length === 0) return;

    // Resolve a stable card name first — used both for the draft and as the
    // bookName argument in the staged-lorebook dispatcher (which we generated
    // with a __NOVEL_ANALYSIS__ placeholder in novel-analysis-service).
    // Escape per EJS double-quoted JS string rules so a `"` or `\` in the card
    // name can't break out of getWorldInfo("bookName", ...) in the dispatcher.
    const resolvedCardName = draft.cardName || payload.title || t('wizard.cardNameFallback');
    const sanitizedBookName = escapeEjsDoubleQuoted(resolvedCardName || t('wizard.cardNameFallback'));
    const finalEntries = payload.entries.map((entry) => ({
      ...entry,
      content: entry.content?.replaceAll('__NOVEL_ANALYSIS__', sanitizedBookName) ?? entry.content,
    }));

    // Convert any MVU variable blueprints (剧情.进度 enum, 彩蛋.{id} booleans)
    // into MvuSchemaSections and merge into the existing MVU config.
    const currentMvu = draft.mvu ?? createEmptyMvuConfig();
    const mergedMvu = mergeVariableBlueprintsIntoMvu(currentMvu, payload.variableBlueprints);

    updateDraft({
      cardName: resolvedCardName,
      lorebookEntries: [...draft.lorebookEntries, ...finalEntries],
      mvu: mergedMvu,
    });
    setCurrentStep(4); // Jump to world book detail (step 4)
    addToast('success', t('wizard.importedNovelSuccess', { count: String(payload.entries.length) }));
    // Use replaceState instead of navigate() to avoid triggering a React Router
    // re-render in the same tick as updateDraft/setCurrentStep. A combined URL +
    // state change can trigger a DOM reconciliation error that the ErrorBoundary
    // catches, causing WizardPage to unmount and remount fresh (losing the draft
    // update, since debounced auto-save hasn't flushed to IndexedDB yet).
    window.history.replaceState({}, '', '/wizard');
  }, [loading, editId, location.search, draft.cardName, draft.lorebookEntries, draft.mvu, updateDraft, setCurrentStep, addToast, t]);

  // ── Consume Workshop lorebook import on mount ──
  useEffect(() => {
    if (loading || editId) return;
    if (!location.search.includes('fromWorkshop=1')) return;

    const payload = consumeWorkshopLorebookImport();
    if (!payload || payload.entries.length === 0) return;

    const mergedEntries = [...draft.lorebookEntries, ...payload.entries];
    const currentMvu = draft.mvu ?? createEmptyMvuConfig();
    const mergedMvu = mergeVariableBlueprintsIntoMvu(currentMvu, payload.variableBlueprints);

    const wsParams = new URLSearchParams(location.search);
    const targetStep = wsParams.get('step') ? parseInt(wsParams.get('step')!) : 5; // Default to MVU step (step 5)

    updateDraft({
      cardName: draft.cardName || payload.title || t('wizard.cardNameFallback'),
      lorebookEntries: mergedEntries,
      mvu: mergedMvu,
    });
    setCurrentStep(targetStep);
    addToast('success', t('wizard.importedWorkshopSuccess', { count: String(payload.entries.length) }));
    // Use replaceState instead of navigate() — see comment in the novel-analysis effect above.
    const targetStepParam = wsParams.get('step');
    window.history.replaceState({}, '', targetStepParam ? `/wizard?step=${targetStepParam}` : '/wizard');
  }, [loading, editId, location.search, draft.cardName, draft.lorebookEntries, draft.mvu, updateDraft, setCurrentStep, addToast, t]);

  // Clear draftId from URL once the draft has been loaded so that auto-save takes over on refresh.
  useEffect(() => {
    if (!loading && draftIdFromUrl) {
      navigate('/wizard', { replace: true });
    }
  }, [loading, draftIdFromUrl, navigate]);

  // Character descriptions summary (for AI prompts in later steps)
  const characterDescriptions = draft.characters
    .filter((c) => c.name)
    .map((c) => `${c.name}: ${c.description || '(no description)'}`)
    .join('\n\n');

  // characterSummaries removed — replaced by characterContext (full descriptions)

  const worldbookContext = draft.lorebookEntries
    .filter(e => e.enabled !== false && (e.name || e.content))
    .map((e, index) => `[${index + 1}] ${e.name || e.comment || t('wizard.unnamedEntry')}
${t('characters.keysLabel', { value: (e.keys || []).join('、') || `(${t('common.none')})` })}
${t('common.type')}: ${e.constant ? t('wizard.entryTypeConstant') : t('wizard.entryTypeTrigger')} · ${t('common.position')}: ${e.position} · ${t('common.priority')}: ${e.priority}
${t('common.content')}:
${e.content || ''}`)
    .join('\n\n---\n\n');

  /** Sync character data to world book entries; recomputed whenever draft changes. */
  const draftWithCharacterEntries = useMemo(() => {
    const { entries, characters } = syncCharacterEntries(draft.characters, draft.lorebookEntries, t);
    return { ...draft, lorebookEntries: entries, characters };
  }, [draft, t]);

  const injectCharacterEntries = useCallback(() => {
    updateDraft(draftWithCharacterEntries);
  }, [draftWithCharacterEntries, updateDraft]);

  /** Navigate to next step, injecting entries when leaving Step 3 (characters). */
  const handleNext = useCallback(() => {
    if (currentStep === 3) {
      injectCharacterEntries();
    }
    const error = goNext();
    setStepError(error);
  }, [currentStep, injectCharacterEntries, goNext]);

  const handleSave = async () => {
    const success = await saveCard(draft);
    if (success) {
      navigate('/library');
    }
  };

  const handleClear = async () => {
    if (window.confirm(t('wizard.clearDraftConfirm'))) {
      await clearDraft();
      setStepError(null);
    }
  };

  /** Reset only the fields belonging to the current wizard step. */
  const handleClearCurrentStep = () => {
    if (!window.confirm(t('wizard.clearCurrentStepConfirm'))) return;

    const empty = createEmptyDraft();
    const updates: Partial<WizardDraft> = {};

    switch (currentStep) {
      case 1:
        updates.cardName = empty.cardName;
        updates.tags = empty.tags;
        break;
      case 2:
        // Skeleton world book — clear entries, rules, and shared UI state
        updates.lorebookEntries = empty.lorebookEntries;
        updates.worldRules = empty.worldRules ?? '';
        updates.skeletonTopic = empty.skeletonTopic ?? '';
        updates.skeletonCount = empty.skeletonCount ?? 8;
        updates.worldbookBatchCount = empty.worldbookBatchCount ?? 8;
        updates.skeletonModeEnabled = empty.skeletonModeEnabled ?? true;
        break;
      case 3:
        // Characters
        updates.characters = empty.characters;
        break;
      case 4:
        // World book detail
        updates.lorebookEntries = empty.lorebookEntries;
        break;
      case 5:
        // MVU variables
        updates.mvu = empty.mvu;
        updates.lorebookEntries = draft.lorebookEntries.filter(
          (e) => !MVU_LOREBOOK_ENTRY_NAMES.includes(e.name) && !MVU_LOREBOOK_ENTRY_NAMES.includes(e.comment || ''),
        );
        break;
      case 6:
        // Staged mode
        updates.stagedMode = empty.stagedMode;
        updates.worldbookNsfw = empty.worldbookNsfw;
        {
          const stagedIndices = findStagedLorebookEntryIndices(draft.lorebookEntries);
          updates.lorebookEntries = draft.lorebookEntries.filter((_, idx) => !stagedIndices.has(idx));
        }
        break;
      case 7:
        // First message
        updates.firstMessage = empty.firstMessage;
        updates.alternate_greetings = empty.alternate_greetings;
        updates.post_history_instructions = empty.post_history_instructions;
        updates.creator_notes = empty.creator_notes;
        break;
      case 8:
      default:
        // 导出页无内部状态需要清空
        return;
    }

    updateDraft(updates);
    setStepError(null);
    addToast('success', t('wizard.clearCurrentStepSuccess'));
  };

  // ── Generate a specific character by index ───────────────
  const handleGenerateCharacter = async (index: number) => {
    const char = draft.characters[index];
    if (!char?.name?.trim()) return;

    setGeneratingIndex(index);
    try {
      const hint = char.description || '';

      // Use ref to read latest history (avoids stale closure)
      const existingHistory = characterHistoryRef.current[char.id] || [];
      if (existingHistory.length === 0) {
        // First generation: save current input as "original"
        if (hint.trim()) {
          addToCharacterHistory(char.id, hint, true);
        }
      } else {
        // Subsequent generations: save current content before replacing
        if (hint.trim() && hint !== existingHistory[existingHistory.length - 1].content) {
          addToCharacterHistory(char.id, hint, false);
        }
      }

      // Build context from other already-created characters
      const otherCharsContext = draft.characters
        .filter((c, i) => i !== index && c.name?.trim() && c.description?.trim())
        .map(c => `### ${c.name}\n${c.description!.slice(0, 2000)}`)
        .join('\n\n');

      const result = await generateCharacterParsedStreaming(
        char.name,
        hint,
        (chunk, fullText) => {
          streamingChunkCallbackRef.current.get(index)?.(chunk, fullText);
        },
        otherCharsContext || undefined,
        char.alignment || undefined,
        char.nsfw ?? false,
      );
      if (typeof result === 'object' && result !== null) {
        const parsed = result as Record<string, unknown>;
        const newDesc = (parsed.description as string)?.trim();
        if (newDesc && newDesc.length > 20) {
          // Update character description directly — fills the textarea.
          // World book sync happens when user clicks "下一步" (handleNext → injectCharacterEntries).
          updateCharacter(index, { description: newDesc });
          addToast('success', t('wizard.generateComplete', { name: char.name }));
        } else {
          logger.warn(`[生成] ${char.name} AI 返回内容为空或过短:`, parsed.description);
          addToast('error', t('wizard.generateEmpty', { name: char.name }));
        }
      } else {
        addToast('error', t('wizard.generateFormatError', { name: char.name }));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknownError');
      addToast('error', t('wizard.generateFailed', { name: char.name, message: msg }));
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

    try {
      for (let i = 0; i < toGenerate.length; i++) {
        const { char, index } = toGenerate[i];
        setBatchProgress({ current: i + 1, total: toGenerate.length });
        setGeneratingIndex(index); // Show loading on individual character editor

        try {
          const hint = char.description || '';

          // Use ref to read latest history (avoids stale closure in async loop)
          const existingHistory = characterHistoryRef.current[char.id] || [];
          if (existingHistory.length === 0) {
            // First generation: save current input as "original"
            if (hint.trim()) {
              addToCharacterHistory(char.id, hint, true);
            }
          } else {
            // Subsequent generations: save current content before replacing
            if (hint.trim() && hint !== existingHistory[existingHistory.length - 1].content) {
              addToCharacterHistory(char.id, hint, false);
            }
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

          logger.log(`[批量生成] 开始生成角色 ${i + 1}/${toGenerate.length}: ${char.name}`);

          const result = await generateCharacterParsedStreaming(
            char.name,
            hint,
            (chunk, fullText) => {
              streamingChunkCallbackRef.current.get(index)?.(chunk, fullText);
            },
            otherCharsContext || undefined,
            char.alignment || undefined,
            char.nsfw ?? false,
          );

          logger.log(`[批量生成] 角色 ${char.name} 生成完成, result type:`, typeof result, result ? 'truthy' : 'falsy');

          if (result && typeof result === 'object') {
            const parsed = result as Record<string, unknown>;
            const newDesc = (parsed.description as string)?.trim();
            if (newDesc && newDesc.length > 20) {
              // Update character description (pre-generation content already saved to history above)
              updateCharacter(index, { description: newDesc });
              // Store in local tracker for subsequent characters in this batch
              generatedDescriptions.set(char.id, newDesc);
              logger.log(`[批量生成] 角色 ${char.name} 描述已更新 (${newDesc.length} chars)`);
              successCount++;
            } else {
              logger.warn(`[批量生成] 角色 ${char.name} AI 返回内容为空或过短:`, parsed.description);
              addToast('error', t('wizard.batchGenerateSkippedEmpty', { name: char.name }));
              errorCount++;
            }
          } else {
            logger.warn(`[批量生成] 角色 ${char.name} 返回格式异常:`, result);
            addToast('error', t('wizard.batchGenerateSkippedFormat', { name: char.name }));
            errorCount++;
          }
        } catch (err: unknown) {
          errorCount++;
          const msg = err instanceof Error ? err.message : t('common.unknownError');
          console.error(`[批量生成] 角色 ${char.name} 生成失败:`, err);
          addToast('error', t('wizard.batchGenerateFailed', { name: char.name, message: msg }));
        } finally {
          setGeneratingIndex(null);
        }

        // Small delay between API calls to avoid rate limiting
        if (i < toGenerate.length - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } catch (unexpectedErr) {
      console.error('[批量生成] 意外错误，循环中断:', unexpectedErr);
      addToast('error', t('wizard.batchGenerateInterrupted'));
    }

    setGeneratingIndex(null);
    setBatchGenerating(false);
    setBatchProgress({ current: 0, total: 0 });

    if (successCount > 0 && errorCount > 0) {
      addToast('success', t('wizard.batchGeneratePartialSuccess', { success: String(successCount), error: String(errorCount) }));
    } else if (successCount > 0) {
      addToast('success', t('wizard.batchGenerateAllSuccess', { count: String(successCount) }));
    }
  };

  // ── Partial modification of character description ──────────────────
  const handleModifyCharacter = async (index: number, instructions: string, currentDescription: string) => {
    const char = draft.characters[index];
    if (!char?.name?.trim() || !currentDescription?.trim()) return;

    setModifyingIndex(index);
    try {
      // Build context from other characters for relationship consistency
      const otherCharsContext = draft.characters
        .filter((c, i) => i !== index && c.name?.trim() && c.description?.trim())
        .map(c => `### ${c.name}\n${c.description!.slice(0, 2000)}`)
        .join('\n\n');

      const modifiedDesc = await modifyCharacterDescription(
        char.name,
        currentDescription,
        instructions,
        otherCharsContext || undefined,
      );

      if (modifiedDesc && modifiedDesc.trim()) {
        // Save current to history before replacing
        addToCharacterHistory(char.id, currentDescription, false);
        // Save modified result to history
        addToCharacterHistory(char.id, modifiedDesc.trim(), false);
        // Update character
        updateCharacter(index, { description: modifiedDesc.trim() });
        addToast('success', t('wizard.modifyComplete', { name: char.name }));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknownError');
      addToast('error', t('wizard.modifyFailed', { name: char.name, message: msg }));
    } finally {
      setModifyingIndex(null);
    }
  };

  // ── Polish selected text within character description ──────────────
  const handlePolishSelection = async (index: number, selectedText: string, fullText: string, selectionStart: number, selectionEnd: number) => {
    const char = draft.characters[index];
    if (!char?.name?.trim() || !selectedText || selectionStart < 0 || selectionEnd <= selectionStart) return;

    setModifyingIndex(index);
    try {
      const polished = await polishSelection(
        char.name,
        fullText,
        selectedText,
      );

      if (polished && polished.trim()) {
        const selectedSlice = fullText.slice(selectionStart, selectionEnd);
        if (selectedSlice !== selectedText) {
          throw new Error('选区内容已变化，请重新选择后再润色');
        }
        const newDesc = `${fullText.slice(0, selectionStart)}${polished.trim()}${fullText.slice(selectionEnd)}`;
        // Save current to history
        addToCharacterHistory(char.id, fullText, false);
        // Save polished result to history
        addToCharacterHistory(char.id, newDesc, false);
        // Update character
        updateCharacter(index, { description: newDesc });
        addToast('success', t('wizard.polishComplete', { name: char.name }));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.unknownError');
      addToast('error', t('wizard.polishFailed', { name: char.name, message: msg }));
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

  /** Full character context (name + description) for world book detail step.
   *  Must be called before any early return to keep hook order stable. */
  const characterContext = useMemo(() => {
    return draft.characters
      .filter(c => c.name && c.description?.trim())
      .map(c => `【${c.name}】\n${c.description!.slice(0, 2000)}`)
      .join('\n\n---\n\n');
  }, [draft.characters]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-3 border-[var(--color-primary)] border-t-transparent rounded-full" />
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
        // ── Step 2: 世界书骨架（角色前，建立世界观框架）──
        // Shared UI state (topic / counts / mode) is persisted to the draft so
        // that navigating to step 4 picks up exactly what the user set up here.
        return (
          <StepWorldBook
            entries={draft.lorebookEntries}
            onEntriesChange={(entries) => updateDraft({ lorebookEntries: entries })}
            worldRules={draft.worldRules ?? ''}
            onWorldRulesChange={(worldRules) => updateDraft({ worldRules })}
            nsfw={draft.worldbookNsfw}
            onNsfwChange={(nsfw) => updateDraft({ worldbookNsfw: nsfw })}
            mode="skeleton"
            cardName={draft.cardName}
            topicValue={draft.skeletonTopic ?? ''}
            onTopicChangePersist={(skeletonTopic) => updateDraft({ skeletonTopic })}
            skeletonCountValue={draft.skeletonCount ?? 8}
            onSkeletonCountPersist={(skeletonCount) => updateDraft({ skeletonCount })}
            batchCountValue={draft.worldbookBatchCount ?? 8}
            onBatchCountPersist={(worldbookBatchCount) => updateDraft({ worldbookBatchCount })}
            skeletonModeValue={draft.skeletonModeEnabled ?? true}
            onSkeletonModePersist={(skeletonModeEnabled) => updateDraft({ skeletonModeEnabled })}
            onJumpToStep={setCurrentStep}
          />
        );
      case 3:
        // ── Step 3: 角色配置（参考骨架世界书生成角色）──
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
            streamingChunkCallbackRef={streamingChunkCallbackRef}
          />
        );
      case 4:
        // ── Step 4: 世界书细节（参考已生成的角色补充细节）──
        // Reads back the shared UI state persisted from step 2 so the topic,
        // counts, and skeleton-mode toggle remain consistent across steps.
        return (
          <StepWorldBook
            entries={draft.lorebookEntries}
            onEntriesChange={(entries) => updateDraft({ lorebookEntries: entries })}
            worldRules={draft.worldRules ?? ''}
            onWorldRulesChange={(worldRules) => updateDraft({ worldRules })}
            nsfw={draft.worldbookNsfw}
            onNsfwChange={(nsfw) => updateDraft({ worldbookNsfw: nsfw })}
            characterContext={characterContext}
            mode="detail"
            cardName={draft.cardName}
            mvu={draft.mvu}
            topicValue={draft.skeletonTopic ?? ''}
            onTopicChangePersist={(skeletonTopic) => updateDraft({ skeletonTopic })}
            skeletonCountValue={draft.skeletonCount ?? 8}
            onSkeletonCountPersist={(skeletonCount) => updateDraft({ skeletonCount })}
            batchCountValue={draft.worldbookBatchCount ?? 8}
            onBatchCountPersist={(worldbookBatchCount) => updateDraft({ worldbookBatchCount })}
            skeletonModeValue={draft.skeletonModeEnabled ?? true}
            onSkeletonModePersist={(skeletonModeEnabled) => updateDraft({ skeletonModeEnabled })}
            onJumpToStep={setCurrentStep}
          />
        );
      case 5:
        return (
          <StepMvuVariables
            mvu={draft.mvu ?? createEmptyMvuConfig()}
            lorebookEntries={draft.lorebookEntries}
            onChange={(mvu) => updateDraft({ mvu })}
            cardName={draft.cardName}
            characterDescriptions={characterDescriptions}
            onApplyStageAxes={(axes, templateId) => {
              const existing = draft.stagedMode?.characters || [];
              const existingMap = new Map(existing.map((c) => [c.name, c]));
              const newCharacters = axes.map((a) => {
                const existingChar = existingMap.get(a.characterName);
                return existingChar
                  ? { ...existingChar, axisPath: a.axisPath }
                  : {
                      name: a.characterName,
                      axisPath: a.axisPath,
                      summary: '',
                      axisType: 'number' as const,
                      stages: [],
                    };
              });
              updateDraft({
                stagedMode: {
                  ...(draft.stagedMode || { enabled: false, templateId: 'pure-love', dispatcherPrefix: '分阶段人设', characters: [] }),
                  templateId: templateId as StagedModeConfig['templateId'],
                  characters: newCharacters,
                },
              });
            }}
          />
        );
      case 6:
        return (
          <StepStagedMode
            stagedMode={draft.stagedMode ?? { enabled: false, templateId: 'pure-love', dispatcherPrefix: '分阶段人设', characters: [] }}
            onChange={(stagedMode) => updateDraft({ stagedMode })}
            cardName={draft.cardName}
            mvu={draft.mvu}
            lorebookEntries={draft.lorebookEntries}
            onApplyEntries={(newEntries) => {
              const prefix = draft.stagedMode?.dispatcherPrefix?.trim() || '分阶段人设';
              const dispatcherNames = new Set(
                (draft.stagedMode?.characters || [])
                  .map((c) => `${c.name?.trim() ?? ''}${prefix}`)
                  .filter(Boolean)
              );
              const isStagedEntry = (comment: string) =>
                [...dispatcherNames].some((dn) => comment === dn || comment.startsWith(`${dn}：`));
              const cleaned = draft.lorebookEntries.filter((e) => !isStagedEntry(e.comment));
              const newNames = new Set(newEntries.map((e) => e.comment));
              const filtered = cleaned.filter((e) => !newNames.has(e.comment));
              updateDraft({ lorebookEntries: [...filtered, ...newEntries] });
            }}
            nsfw={draft.worldbookNsfw}
            onNsfwChange={(nsfw) => updateDraft({ worldbookNsfw: nsfw })}
          />
        );
      case 7:
        return (
          <StepFirstMessage
            firstMessage={draft.firstMessage}
            alternateGreetings={draft.alternate_greetings}
            cardName={draft.cardName}
            characterDescriptions={characterDescriptions}
            worldbookContext={worldbookContext}
            onChange={(msg) => updateDraft({ firstMessage: msg })}
            onAlternateGreetingsChange={(greetings) => updateDraft({ alternate_greetings: greetings })}
            mvu={draft.mvu}
          />
        );
      case 8:
        return (
          <StepPolishExport
            draft={draft}
            cardName={draft.cardName}
            characterDescriptions={characterDescriptions}
            worldbookContext={worldbookContext}
            pngBuffer={pngBuffer}
            onPngFileSelect={setPngBuffer}
            onFixEntries={(entries) => updateDraft({ lorebookEntries: entries })}
            onUpdateDraft={updateDraft}
            onJumpToStep={setCurrentStep}
          />
        );
      default:
        return null;
    }
  };

  // Build extra actions for step 3 (characters)
  const step3ExtraActions = currentStep === 3 && namedCharacterCount > 0 ? (
    <Button
      variant="secondary"
      onClick={handleBatchGenerateCharacters}
      disabled={isGenerating}
    >
      {batchGenerating
        ? t('wizard.batchGenerateInProgress', { current: String(batchProgress.current), total: String(batchProgress.total) })
        : t('wizard.batchGenerateAllCharacters')
      }
    </Button>
  ) : undefined;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1" style={textPrimaryStyle}>
        {isEditMode ? t('wizard.titleEdit') : t('wizard.titleCreate')}
      </h1>
      <p className="text-sm mb-6" style={textMutedStyle}>
        {isEditMode ? t('wizard.subtitleEdit') : t('wizard.subtitleCreate')}
      </p>

      <WizardShell
        currentStep={currentStep}
        onPrev={goPrev}
        onNext={handleNext}
        onSave={handleSave}
        onSaveDraft={isEditMode ? undefined : saveDraftNow}
        onClear={isEditMode ? undefined : handleClear}
        onClearStep={handleClearCurrentStep}
        stepError={stepError}
        saving={saving}
        extraActions={step3ExtraActions}
      >
        {renderStep()}
      </WizardShell>
    </div>
  );
}
