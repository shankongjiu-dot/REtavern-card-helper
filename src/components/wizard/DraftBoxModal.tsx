/**
 * DraftBoxModal — list, load, rename and delete wizard drafts.
 */
import { useState, useEffect, useCallback } from 'react';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';
import { TextInput } from '../shared/TextInput';
import { useTranslation } from '../../i18n/I18nContext';
import {
  listManualDrafts,
  deleteDraft,
  renameDraft,
} from '../../services/draft-service';
import type { WizardDraftRecord } from '../../db/database';
import type { WizardDraft } from '../../constants/defaults';
import { Trash2, Edit2, FolderOpen, Save } from 'lucide-react';

interface DraftBoxModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentDraft: WizardDraft;
  onLoadDraft: (id: string) => Promise<boolean>;
  onSaveDraft: (name?: string) => Promise<boolean>;
}

export function DraftBoxModal({
  isOpen,
  onClose,
  currentDraft,
  onLoadDraft,
  onSaveDraft,
}: DraftBoxModalProps) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<WizardDraftRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [newDraftName, setNewDraftName] = useState('');

  const refreshDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listManualDrafts();
      setDrafts(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      refreshDrafts();
      setNewDraftName(currentDraft.cardName?.trim() || '');
    }
  }, [isOpen, refreshDrafts, currentDraft.cardName]);

  const handleSaveNew = async () => {
    const success = await onSaveDraft(newDraftName.trim() || undefined);
    if (success) {
      setNewDraftName('');
      await refreshDrafts();
    }
  };

  const handleLoad = async (id: string) => {
    const success = await onLoadDraft(id);
    if (success) {
      onClose();
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('wizard.deleteDraftConfirm'))) return;
    await deleteDraft(id);
    await refreshDrafts();
  };

  const startRename = (draft: WizardDraftRecord) => {
    setEditingId(draft.id);
    setEditingName(draft.name || '');
  };

  const handleRename = async () => {
    if (!editingId) return;
    await renameDraft(editingId, editingName);
    setEditingId(null);
    setEditingName('');
    await refreshDrafts();
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('wizard.draftBox')} maxWidth="max-w-2xl">
      <div className="space-y-4">
        {/* Save current as new draft */}
        <div className="flex gap-2">
          <div className="flex-1">
            <TextInput
              placeholder={t('wizard.draftNamePlaceholder')}
              value={newDraftName}
              onChange={(e) => setNewDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveNew();
                }
              }}
            />
          </div>
          <Button variant="secondary" onClick={handleSaveNew} disabled={loading}>
            <Save size={16} className="mr-1.5" />
            {t('wizard.saveAsDraft')}
          </Button>
        </div>

        {/* Draft list */}
        <div
          className="rounded-lg border overflow-hidden"
          style={{
            borderColor: 'var(--color-border-default)',
            backgroundColor: 'var(--color-surface-raised)',
            maxHeight: '60vh',
          }}
        >
          {drafts.length === 0 ? (
            <div className="p-8 text-center text-sm opacity-60">{t('wizard.noDrafts')}</div>
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--color-border-default)' }}>
              {drafts.map((draft) => (
                <li
                  key={draft.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    {editingId === draft.id ? (
                      <div className="flex gap-2">
                        <TextInput
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleRename();
                            }
                          }}
                          autoFocus
                        />
                        <Button size="sm" onClick={handleRename}>
                          {t('common.confirm')}
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="text-sm font-medium truncate" style={{ color: 'var(--text-color)' }}>
                          {draft.name || t('wizard.unnamedDraft')}
                        </div>
                        <div className="text-xs opacity-50 mt-0.5">
                          {formatTime(draft.updatedAt)} · {t('wizard.stepLabel', { step: String(draft.currentStep) })}
                        </div>
                      </>
                    )}
                  </div>

                  {editingId !== draft.id && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startRename(draft)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                        title={t('wizard.renameDraft')}
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(draft.id)}
                        className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                        title={t('wizard.deleteDraft')}
                      >
                        <Trash2 size={15} />
                      </button>
                      <Button size="sm" variant="secondary" onClick={() => handleLoad(draft.id)}>
                        <FolderOpen size={15} className="mr-1" />
                        {t('wizard.loadDraft')}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
