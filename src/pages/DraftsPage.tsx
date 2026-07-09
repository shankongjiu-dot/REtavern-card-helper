/**
 * DraftsPage — manage wizard drafts saved from the create-card flow.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/shared/Button';
import { TextInput } from '../components/shared/TextInput';
import { Modal } from '../components/shared/Modal';
import { useToast } from '../components/shared/Toast';
import { useTranslation } from '../i18n/I18nContext';
import {
  listManualDrafts,
  deleteDraft,
  renameDraft,
  loadDraft,
} from '../services/draft-service';
import type { WizardDraftRecord } from '../db/database';
import { FolderOpen, Trash2, Edit2, FileText } from 'lucide-react';

export function DraftsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [drafts, setDrafts] = useState<WizardDraftRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    refreshDrafts();
  }, [refreshDrafts]);

  const handleLoad = async (id: string) => {
    const draft = await loadDraft(id);
    if (!draft) {
      addToast('error', t('wizard.draftLoadFailed'));
      return;
    }
    navigate(`/wizard?draftId=${id}`);
  };

  const confirmDelete = async () => {
    if (!deletingId) return;
    try {
      await deleteDraft(deletingId);
      addToast('success', t('wizard.draftDeleted'));
      await refreshDrafts();
    } catch {
      addToast('error', t('wizard.draftDeleteFailed'));
    } finally {
      setDeletingId(null);
    }
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
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="animate-fade-in max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-2">
        <FileText size={24} className="text-primary" />
        <h1 className="text-2xl font-bold text-white">{t('wizard.draftBox')}</h1>
      </div>
      <p className="text-sm text-slate-400 mb-6">{t('wizard.draftsDescription')}</p>

      {drafts.length === 0 && !loading ? (
        <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-12 text-center">
          <FileText size={48} className="mx-auto text-slate-600 mb-4" />
          <p className="text-slate-400">{t('wizard.noDrafts')}</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate('/wizard')}>
            {t('wizard.createNewCard')}
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border-default)' }}>
          <ul className="divide-y" style={{ borderColor: 'var(--color-border-default)' }}>
            {drafts.map((draft) => (
              <li
                key={draft.id}
                className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-white/5 transition-colors"
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
                      <div className="text-base font-medium truncate" style={{ color: 'var(--text-color)' }}>
                        {draft.name || t('wizard.unnamedDraft')}
                      </div>
                      <div className="text-xs opacity-50 mt-1">
                        {formatTime(draft.updatedAt)} · {t('wizard.stepLabel', { step: String(draft.currentStep) })}
                      </div>
                    </>
                  )}
                </div>

                {editingId !== draft.id && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => startRename(draft)}
                      className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                      title={t('wizard.renameDraft')}
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => setDeletingId(draft.id)}
                      className="p-2 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                      title={t('wizard.deleteDraft')}
                    >
                      <Trash2 size={16} />
                    </button>
                    <Button variant="secondary" size="sm" onClick={() => handleLoad(draft.id)}>
                      <FolderOpen size={16} className="mr-1.5" />
                      {t('wizard.loadDraft')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        isOpen={deletingId !== null}
        onClose={() => setDeletingId(null)}
        title={t('wizard.deleteDraft')}
        maxWidth="max-w-md"
      >
        <p className="text-sm text-slate-300 mb-6">{t('wizard.deleteDraftConfirm')}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeletingId(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={confirmDelete}>
            {t('common.delete')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
