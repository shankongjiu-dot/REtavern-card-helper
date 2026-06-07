/**
 * useWizardState - manages the step wizard state, navigation, and validation.
 * Handles both create mode and edit mode (loading existing card).
 *
 * Drafts are auto-saved to IndexedDB so navigating away and back preserves state.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { createEmptyDraft, createEmptyCharacter, WIZARD_STEPS } from '../constants/defaults';
import type { WizardDraft } from '../constants/defaults';
import { cardToDraft, assembleCard } from '../services/card-exporter';
import { db } from '../db/database';
import { useToast } from '../components/shared/Toast';

type DraftState = WizardDraft;

const DRAFT_KEY_NEW = 'new';
const DRAFT_SAVE_DELAY = 500; // ms

export function useWizardState(editId?: number) {
  const [currentStep, setCurrentStep] = useState(1);
  const [draft, setDraft] = useState<DraftState>(createEmptyDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  // Track whether the initial load has completed (prevents auto-save during load)
  const initialized = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Load state on mount ────────────────────────────────────────────────────
  // Edit mode: load from cards table.
  // New mode: restore auto-saved draft from wizard_drafts table.
  useEffect(() => {
    (async () => {
      try {
        if (editId) {
          // Edit mode — load saved card
          const card = await db.cards.get(editId);
          if (card) {
            const restored = cardToDraft(card as unknown as Record<string, unknown>);
            setDraft(restored);
          }
        } else {
          // New card mode — try restoring unsaved draft
          const saved = await db.wizard_drafts.get(DRAFT_KEY_NEW);
          if (saved) {
            setDraft(saved.data as DraftState);
            setCurrentStep(saved.currentStep || 1);
          }
        }
      } catch {
        addToast('error', '加载草稿失败');
      } finally {
        initialized.current = true;
        setLoading(false);
      }
    })();
  }, [editId, addToast]);

  // ── Debounced auto-save (new card mode only) ──────────────────────────────
  useEffect(() => {
    if (!initialized.current || loading || editId) return;

    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await db.wizard_drafts.put({
          id: DRAFT_KEY_NEW,
          data: draft,
          currentStep,
          updatedAt: new Date(),
        });
      } catch {
        // Silently ignore save failures (non-critical)
      }
    }, DRAFT_SAVE_DELAY);

    return () => clearTimeout(saveTimerRef.current);
  }, [draft, currentStep, loading, editId]);

  /** Update draft with partial changes */
  const updateDraft = useCallback((partial: Partial<DraftState>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
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
      case 2: {
        const hasValidChar = draft.characters.some((c) => c.name?.trim());
        return hasValidChar ? null : '至少需要一个有名称的角色';
      }
      case 3: {
        // Optional, but if entries exist they must be valid
        for (const entry of draft.lorebookEntries) {
          // Constant entries don't need keys; keyword entries need at least one
          if (!entry.constant && entry.keys.length === 0 && entry.content.trim()) {
            return '每个关键词触发条目需要至少一个触发关键词';
          }
        }
        return null;
      }
      case 4:
        // First message can be empty (user may generate later)
        return null;
      case 5:
        return null; // Optional
      case 6:
        return null; // Optional: MVU & Beautification
      case 7:
        return null; // Review step
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
        if (existing) card.createdAt = (existing as Record<string, Date>).createdAt;
      }

      await db.cards.put(card);

      // Clear auto-saved draft after successful save
      if (!editId) {
        await db.wizard_drafts.delete(DRAFT_KEY_NEW);
      }

      addToast('success', editId ? '卡片已更新！' : '卡片已保存到库！');
      return true;
    } catch (err: unknown) {
      addToast('error', `保存失败: ${err instanceof Error ? err.message : '未知错误'}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, editId, addToast]);

  return {
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
    goToStep,
    saveCard,
    isEditMode: !!editId,
  };
}
