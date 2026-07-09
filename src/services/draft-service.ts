/**
 * Draft box service — manages multiple wizard drafts in IndexedDB.
 *
 * Design:
 *   - Auto-save uses the fixed ID 'new' for crash recovery.
 *   - Manual saves create new draft records with random UUIDs and a display name.
 */
import { db, type WizardDraftRecord } from '../db/database';
import type { WizardDraft } from '../constants/defaults';
import { WIZARD_DRAFT_VERSION } from '../constants/defaults';

const AUTO_DRAFT_KEY = 'new';

function generateDraftId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback for environments where randomUUID is unavailable (e.g. non-secure contexts)
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

function defaultDraftName(draft: WizardDraft): string {
  const cardName = draft.cardName?.trim();
  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return cardName ? `${cardName} ${timeStr}` : `未命名草稿 ${timeStr}`;
}

export async function saveManualDraft(
  draft: WizardDraft,
  currentStep: number,
  name?: string,
): Promise<WizardDraftRecord> {
  const record: WizardDraftRecord = {
    id: generateDraftId(),
    data: draft,
    currentStep,
    version: WIZARD_DRAFT_VERSION,
    updatedAt: new Date(),
    name: name?.trim() || defaultDraftName(draft),
  };
  await db.wizard_drafts.put(record);
  return record;
}

export async function listManualDrafts(): Promise<WizardDraftRecord[]> {
  const all = await db.wizard_drafts.toArray();
  return all
    .filter((d) => d.id !== AUTO_DRAFT_KEY)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export async function loadDraft(id: string): Promise<WizardDraftRecord | undefined> {
  return db.wizard_drafts.get(id);
}

export async function deleteDraft(id: string): Promise<void> {
  await db.wizard_drafts.delete(id);
}

export async function renameDraft(id: string, name: string): Promise<void> {
  const draft = await db.wizard_drafts.get(id);
  if (!draft) return;
  await db.wizard_drafts.put({
    ...draft,
    name: name.trim() || draft.name,
    updatedAt: new Date(),
  });
}

export async function saveAutoDraft(draft: WizardDraft, currentStep: number): Promise<void> {
  await db.wizard_drafts.put({
    id: AUTO_DRAFT_KEY,
    data: draft,
    currentStep,
    version: WIZARD_DRAFT_VERSION,
    updatedAt: new Date(),
  });
}

export async function loadAutoDraft(): Promise<WizardDraftRecord | undefined> {
  return db.wizard_drafts.get(AUTO_DRAFT_KEY);
}

export async function clearAutoDraft(): Promise<void> {
  await db.wizard_drafts.delete(AUTO_DRAFT_KEY);
}
