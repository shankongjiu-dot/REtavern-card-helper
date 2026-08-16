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
import { saveVersion } from '../services/version-service';
import {
  loadAutoDraft,
  saveAutoDraft,
  clearAutoDraft,
  saveManualDraft,
  loadDraft as loadDraftRecord,
  migrateDraftRecord,
} from '../services/draft-service';
import { useToast } from '../components/shared/Toast';
import { useTranslation } from '../i18n/I18nContext';

type DraftState = WizardDraft;

const DRAFT_SAVE_DELAY = 500; // ms

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
    liveStreamChat: raw.liveStreamChat ? { ...defaults.liveStreamChat, ...raw.liveStreamChat } : defaults.liveStreamChat,
    worldAnchor: raw.worldAnchor ? { ...defaults.worldAnchor, ...raw.worldAnchor } : defaults.worldAnchor,
    stagedMode: raw.stagedMode ? { ...defaults.stagedMode, ...raw.stagedMode } : defaults.stagedMode,
    // Shared UI state — fall back to defaults for old drafts
    worldbookBatchCount: raw.worldbookBatchCount ?? defaults.worldbookBatchCount,
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
  // Refs mirroring state so the auto-save cleanup always reads the latest values
  // instead of the snapshot captured when the effect was scheduled.
  const draftRef = useRef(draft);
  const stepRef = useRef(currentStep);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { stepRef.current = currentStep; }, [currentStep]);

  // ── Load state on mount ────────────────────────────────────────────────────
  // Edit mode: load from cards table.
  // New mode: restore auto-saved draft from wizard_drafts table.
  useEffect(() => {
    initialized.current = false;
    setLoading(true);
    clearTimeout(saveTimerRef.current);

    let cancelled = false;
    (async () => {
      try {
        if (editId) {
          // Edit mode — load saved card
          const card = await db.cards.get(editId);
          if (cancelled) return;
          if (card) {
            const restored = cardToDraft(card as unknown as Record<string, unknown>);
            setDraft(normalizeDraft(restored));
          }
        } else if (initialDraftId) {
          // New card mode — load a specific draft from the draft box.
          // Manual drafts go through the same migration chain as auto drafts,
          // so bumping WIZARD_DRAFT_VERSION no longer bricks saved drafts.
          const saved = await loadDraftRecord(initialDraftId);
          if (cancelled) return;
          const migrated = saved ? migrateDraftRecord(saved) : null;
          if (migrated) {
            setDraft(normalizeDraft(migrated.data as Partial<DraftState>));
            setCurrentStep(migrated.currentStep);
            if (migrated.migratedFrom) {
              addToast('info', t('wizard.draftMigrated', { oldVersion: migrated.migratedFrom, newVersion: `V${WIZARD_DRAFT_VERSION}` }));
            }
          } else {
            addToast('error', t('wizard.draftLoadFailed'));
            setDraft(createEmptyDraft());
            setCurrentStep(1);
          }
        } else {
          // New card mode — try restoring auto-saved draft
          const saved = await loadAutoDraft();
          if (cancelled) return;
          const migrated = saved ? migrateDraftRecord(saved) : null;
          if (migrated) {
            setDraft(normalizeDraft(migrated.data as Partial<DraftState>));
            setCurrentStep(migrated.currentStep);
            if (migrated.migratedFrom) {
              addToast('info', t('wizard.draftMigrated', { oldVersion: migrated.migratedFrom, newVersion: `V${WIZARD_DRAFT_VERSION}` }));
            }
          } else if (saved) {
            // Stale draft from an older app version with no migration path: discard it.
            await clearAutoDraft();
            if (cancelled) return;
            setDraft(createEmptyDraft());
            setCurrentStep(1);
          } else {
            setDraft(createEmptyDraft());
            setCurrentStep(1);
          }
        }
      } catch {
        if (cancelled) return;
        addToast('error', '加载草稿失败');
        setDraft(createEmptyDraft());
        setCurrentStep(1);
      } finally {
        if (!cancelled) {
          initialized.current = true;
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [editId, initialDraftId, addToast, t]);

  // ── Debounced auto-save (new card mode only) ──────────────────────────────
  useEffect(() => {
    if (!initialized.current || loading || editId) return;

    setIsDraftDirty(true);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await saveAutoDraft(draftRef.current, stepRef.current);
        saveTimerRef.current = undefined;
        setIsDraftDirty(false);
      } catch {
        // Silently ignore save failures (non-critical)
      }
    }, DRAFT_SAVE_DELAY);

    return () => {
      // timer 仍在运行说明 debounce 尚未触发，即最近一次编辑未保存
      const pending = saveTimerRef.current !== undefined;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
      if (pending) {
        // Use refs to save the latest state, not the stale closure snapshot
        saveAutoDraft(draftRef.current, stepRef.current).catch(() => {});
      }
    };
  }, [draft, currentStep, loading, editId]);

  /** Update draft with partial changes or an updater function. */
  const updateDraft = useCallback((partialOrUpdater: Partial<DraftState> | ((prev: DraftState) => DraftState | Partial<DraftState>)) => {
    setDraft((prev) => {
      const updates = typeof partialOrUpdater === 'function' ? partialOrUpdater(prev) : partialOrUpdater;
      return { ...prev, ...updates };
    });
    setIsDraftDirty(true);
  }, []);

  // 注意：三个角色操作都要 setIsDraftDirty(true)。创建模式下自动保存 effect 会兜底标脏，
  // 但编辑模式（editId）该 effect 直接 return——脏标记是 beforeunload 刷新拦截的唯一依据，
  // 漏设会让编辑模式下的角色修改在 F5 时静默丢失。

  /** Add a new character */
  const addCharacter = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      characters: [...prev.characters, createEmptyCharacter()],
    }));
    setIsDraftDirty(true);
  }, []);

  /** Remove a character by index */
  const removeCharacter = useCallback((index: number) => {
    setDraft((prev) => ({
      ...prev,
      characters: prev.characters.filter((_, i) => i !== index),
    }));
    setIsDraftDirty(true);
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
    setIsDraftDirty(true);
  }, []);

  /** Validate the current step */
  const validateStep = useCallback((step: number): string | null => {
    switch (step) {
      case 1:
        return draft.cardName?.trim() ? null : '卡片名称不能为空';
      case 2:
        // Step 2: 锚定世界观 — always optional
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
        // Step 8: Live Stream Chat — optional
        return null;
      case 9:
        // Step 9: Polish & Export — always valid
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
  const saveCard = useCallback(async (draftOverride?: DraftState, source?: string) => {
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

      const putId = await db.cards.put(card);

      // 保存版本快照（source 默认按是否编辑模式推断）
      try {
        await saveVersion(
          (putId ?? editId) as number,
          card as Record<string, unknown>,
          (source || (editId ? 'wizard' : 'import')) as 'wizard' | 'editor' | 'import' | 'rollback' | 'library-edit',
        );
      } catch { /* 版本快照失败不影响主保存流程 */ }

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
    clearDraft,
    isEditMode: !!editId,
  };
}
