/**
 * useWizardState - manages the step wizard state, navigation, and validation.
 * Handles both create mode and edit mode (loading existing card).
 *
 * Drafts are auto-saved to IndexedDB so navigating away and back preserves state.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { createEmptyDraft, createEmptyCharacter, createEmptyLorebookEntry, WIZARD_STEPS, WIZARD_DRAFT_VERSION } from '../constants/defaults';
import type { WizardDraft } from '../constants/defaults';
import { cardToDraft, assembleCard } from '../services/card-exporter';
import { db } from '../db/database';
import {
  loadAutoDraft,
  saveAutoDraft,
  clearAutoDraft,
  saveManualDraft,
  loadDraft as loadDraftRecord,
} from '../services/draft-service';
import { useToast } from '../components/shared/Toast';
import { useTranslation } from '../i18n/I18nContext';

type DraftState = WizardDraft;

const DRAFT_SAVE_DELAY = 500; // ms

/**
 * Migrate a V4 draft step number to V5 (8-step) step number.
 *
 * V4 flow (7 steps): name(1) → chars(2) → worldbook(3) → mvu(4) → staged(5) → firstmsg(6) → export(7)
 * V5 flow (8 steps): name(1) → skeleton(2) → chars(3) → detail(4) → mvu(5) → staged(6) → firstmsg(7) → export(8)
 */
function migrateStepV4ToV5(oldStep: number, _draft: Partial<WizardDraft>): number {
  // If the old draft already has world book entries but no characters,
  // they were on step 3 (worldbook). In V5 this maps to step 4 (detail).
  // If they have characters but no entries yet, they were on step 2.
  const stepMap: Record<number, number> = { 1: 1, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8 };
  return stepMap[oldStep] ?? Math.min(oldStep, 1);
}

/**
 * Normalize a loaded draft by merging with defaults.
 * Handles data from older versions or IndexedDB deserialization where
 * fields may be missing or undefined.
 */
function normalizeDraft(raw: Partial<DraftState>): DraftState {
  const defaults = createEmptyDraft();
  const merged: DraftState = {
    ...defaults,
    ...raw,
    // Ensure array fields are always arrays (not undefined from deserialization)
    characters: (raw.characters ?? defaults.characters).map((c) => ({
      ...createEmptyCharacter(),
      ...c,
      name: c.name ?? '',
      description: c.description ?? '',
    })),
    lorebookEntries: (raw.lorebookEntries ?? defaults.lorebookEntries).map((e) => ({
      ...createEmptyLorebookEntry(),
      ...e,
      content: e.content ?? '',
      name: e.name ?? '',
      keys: e.keys ?? [],
      secondary_keys: e.secondary_keys ?? [],
    })),
    tags: raw.tags ?? defaults.tags,
    alternate_greetings: raw.alternate_greetings ?? defaults.alternate_greetings,
    mvu: raw.mvu ? { ...defaults.mvu, ...raw.mvu } : defaults.mvu,
    useMvuExport: raw.useMvuExport ?? defaults.useMvuExport,
    worldRules: raw.worldRules ?? defaults.worldRules,
    // Shared UI state between Step 2 & Step 4 — fall back to defaults for old drafts
    skeletonTopic: raw.skeletonTopic ?? defaults.skeletonTopic,
    skeletonCount: raw.skeletonCount ?? defaults.skeletonCount,
    worldbookBatchCount: raw.worldbookBatchCount ?? defaults.worldbookBatchCount,
    skeletonModeEnabled: raw.skeletonModeEnabled ?? defaults.skeletonModeEnabled,
  };
  return merged;
}

export function useWizardState(editId?: number, initialDraftId?: string) {
  const [currentStep, setCurrentStep] = useState(1);
  const [draft, setDraft] = useState<DraftState>(createEmptyDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDraftDirty, setIsDraftDirty] = useState(false);
  const { addToast } = useToast();
  const { t } = useTranslation();

  // Track whether the initial load has completed (prevents auto-save during load)
  const initialized = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Load state on mount ────────────────────────────────────────────────────
  // Edit mode: load from cards table.
  // New mode: restore auto-saved draft from wizard_drafts table.
  useEffect(() => {
    initialized.current = false;
    setLoading(true);
    clearTimeout(saveTimerRef.current);

    (async () => {
      try {
        if (editId) {
          // Edit mode — load saved card
          const card = await db.cards.get(editId);
          if (card) {
            const restored = cardToDraft(card as unknown as Record<string, unknown>);
            setDraft(normalizeDraft(restored));
          }
        } else if (initialDraftId) {
          // New card mode — load a specific draft from the draft box
          const saved = await loadDraftRecord(initialDraftId);
          if (saved && saved.version === WIZARD_DRAFT_VERSION) {
            setDraft(normalizeDraft(saved.data as Partial<DraftState>));
            setCurrentStep(saved.currentStep || 1);
          } else {
            addToast('error', t('wizard.draftLoadFailed'));
            setDraft(createEmptyDraft());
            setCurrentStep(1);
          }
        } else {
          // New card mode — try restoring auto-saved draft
          const saved = await loadAutoDraft();
          if (saved && saved.version === WIZARD_DRAFT_VERSION) {
            setDraft(normalizeDraft(saved.data as Partial<DraftState>));
            setCurrentStep(saved.currentStep || 1);
          } else if (saved && saved.version === 4) {
            // V4 → V5 migration: remap steps and add worldRules
            const migratedData = saved.data as Partial<DraftState>;
            const oldStep = saved.currentStep || 1;
            const newStep = migrateStepV4ToV5(oldStep, migratedData);
            setDraft(normalizeDraft({ ...migratedData, worldRules: migratedData.worldRules ?? '' }));
            setCurrentStep(newStep);
            addToast('info', t('draftMigrated', { oldVersion: 'V4', newVersion: 'V5' }));
          } else if (saved) {
            // Stale draft from an older app version: discard it to avoid shape mismatches.
            await clearAutoDraft();
            setDraft(createEmptyDraft());
            setCurrentStep(1);
          } else {
            setDraft(createEmptyDraft());
            setCurrentStep(1);
          }
        }
      } catch {
        addToast('error', '加载草稿失败');
        setDraft(createEmptyDraft());
        setCurrentStep(1);
      } finally {
        initialized.current = true;
        setLoading(false);
      }
    })();
  }, [editId, initialDraftId, addToast, t]);

  // ── Debounced auto-save (new card mode only) ──────────────────────────────
  useEffect(() => {
    if (!initialized.current || loading || editId) return;

    setIsDraftDirty(true);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await saveAutoDraft(draft, currentStep);
        setIsDraftDirty(false);
      } catch {
        // Silently ignore save failures (non-critical)
      }
    }, DRAFT_SAVE_DELAY);

    return () => clearTimeout(saveTimerRef.current);
  }, [draft, currentStep, loading, editId]);

  /** Update draft with partial changes or an updater function. */
  const updateDraft = useCallback((partialOrUpdater: Partial<DraftState> | ((prev: DraftState) => DraftState | Partial<DraftState>)) => {
    setDraft((prev) => {
      const updates = typeof partialOrUpdater === 'function' ? partialOrUpdater(prev) : partialOrUpdater;
      return { ...prev, ...updates };
    });
    setIsDraftDirty(true);
  }, []);

  /** Add a new character */
  const addCharacter = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      characters: [...prev.characters, createEmptyCharacter()],
    }));
  }, []);

  /** Remove a character by index */
  const removeCharacter = useCallback((index: number) => {
    setDraft((prev) => ({
      ...prev,
      characters: prev.characters.filter((_, i) => i !== index),
    }));
  }, []);

  /** Update a character at a specific index */
  const updateCharacter = useCallback((index: number, updates: Partial<DraftState['characters'][0]>) => {
    const safeUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    );
    setDraft((prev) => ({
      ...prev,
      characters: prev.characters.map((c, i) => (i === index ? { ...c, ...safeUpdates } : c)),
    }));
  }, []);

  /** Validate the current step */
  const validateStep = useCallback((step: number): string | null => {
    switch (step) {
      case 1:
        return draft.cardName?.trim() ? null : '卡片名称不能为空';
      case 2:
        // Step 2: Skeleton world book — always optional
        return null;
      case 3: {
        // Step 3: Characters — at least one named character required
        const hasValidChar = draft.characters.some((c) => c.name?.trim());
        return hasValidChar ? null : '至少需要一个有名称的角色';
      }
      case 4:
        // Step 4: Detail world book — optional
        return null;
      case 5:
        // Step 5: MVU Variables — always optional
        return null;
      case 6:
        // Step 6: Staged mode — optional
        return null;
      case 7:
        // Step 7: First message — required
        return draft.firstMessage?.trim() ? null : '开场白不能为空';
      case 8:
        // Step 8: Polish & Export — always valid
        return null;
      default:
        return null;
    }
  }, [draft]);

  /** Go to next step (validates current step first) */
  const goNext = useCallback((): string | null => {
    const error = validateStep(currentStep);
    if (error) return error;
    if (currentStep < WIZARD_STEPS.length) {
      setCurrentStep((s) => s + 1);
    }
    return null;
  }, [currentStep, validateStep]);

  /** Go to previous step */
  const goPrev = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  /** Go to a specific step */
  const goToStep = useCallback((step: number): string | null => {
    if (step < currentStep) {
      setCurrentStep(step);
      return null;
    }
    // Validate all steps from current to target
    for (let s = currentStep; s < step; s++) {
      const error = validateStep(s);
      if (error) {
        setCurrentStep(s);
        return error;
      }
    }
    setCurrentStep(step);
    return null;
  }, [currentStep, validateStep]);

  /** Save the card to IndexedDB */
  const saveCard = useCallback(async (draftOverride?: DraftState) => {
    setSaving(true);
    try {
      const sourceDraft = draftOverride ?? draft;
      const card = assembleCard(sourceDraft, editId);

      if (editId) {
        const existing = await db.cards.get(editId);
        if (existing) {
          // Preserve original timestamps and soft-delete status
          card.createdAt = (existing as Record<string, Date>).createdAt;
          card.deletedAt = (existing as Record<string, Date | null | undefined>).deletedAt ?? null;
        }
      }

      await db.cards.put(card);

      // Clear auto-saved draft after successful save
      if (!editId) {
        await clearAutoDraft();
      }

      setIsDraftDirty(false);
      addToast('success', editId ? '卡片已更新！' : '卡片已保存到库！');
      return true;
    } catch (err: unknown) {
      addToast('error', `保存失败: ${err instanceof Error ? err.message : '未知错误'}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, editId, addToast]);

  /** Save the current draft as a new manual draft box entry (new card mode only). */
  const saveDraftNow = useCallback(async (name?: string) => {
    if (editId) return false;
    try {
      const safeName = typeof name === 'string' ? name : undefined;
      await saveManualDraft(draft, currentStep, safeName);
      addToast('success', t('wizard.draftSaved'));
      return true;
    } catch (err: unknown) {
      addToast('error', `${t('wizard.draftSaveFailed')}: ${err instanceof Error ? err.message : '未知错误'}`);
      return false;
    }
  }, [draft, currentStep, editId, addToast, t]);

  /** Load a draft from the draft box into the current editor (new card mode only). */
  const loadDraft = useCallback(async (id: string) => {
    if (editId) return false;
    try {
      const saved = await loadDraftRecord(id);
      if (!saved || saved.version !== WIZARD_DRAFT_VERSION) {
        addToast('error', t('wizard.draftLoadFailed'));
        return false;
      }
      setDraft(normalizeDraft(saved.data as Partial<DraftState>));
      setCurrentStep(saved.currentStep || 1);
      setIsDraftDirty(false);
      addToast('success', t('wizard.draftLoaded'));
      return true;
    } catch {
      addToast('error', t('wizard.draftLoadFailed'));
      return false;
    }
  }, [editId, addToast, t]);

  /** Reset the wizard to a blank state and clear the auto-saved draft. */
  const clearDraft = useCallback(async () => {
    setDraft(createEmptyDraft());
    setCurrentStep(1);
    setIsDraftDirty(false);
    if (!editId) {
      try {
        await clearAutoDraft();
      } catch {
        // Non-critical cleanup failure
      }
    }
    addToast('info', t('wizard.draftCleared'));
  }, [editId, addToast, t]);

  // Warn before closing/refreshing the page if there are unsaved changes.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDraftDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDraftDirty]);

  return {
    currentStep,
    draft,
    loading,
    saving,
    isDraftDirty,
    updateDraft,
    addCharacter,
    removeCharacter,
    updateCharacter,
    validateStep,
    goNext,
    goPrev,
    goToStep,
    setCurrentStep,
    saveCard,
    saveDraftNow,
    loadDraft,
    clearDraft,
    isEditMode: !!editId,
  };
}
