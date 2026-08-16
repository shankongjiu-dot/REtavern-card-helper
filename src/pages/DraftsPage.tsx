/**
 * DraftsPage — manage wizard drafts saved from the create-card flow.
 * Renders drafts as a responsive card grid with replaceable covers.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/shared/Button';
import { TextInput } from '../components/shared/TextInput';
import { Modal } from '../components/shared/Modal';
import { useToast } from '../components/shared/Toast';
import { CardCover } from '../components/shared/CardCover';
import { ViewToolbar } from '../components/shared/ViewToolbar';
import { useViewPrefs } from '../hooks/useViewPrefs';
import { useTranslation } from '../i18n/I18nContext';
import {
  listManualDrafts,
  deleteDraft,
  renameDraft,
  loadDraft,
  updateDraftCover,
  stripTrailingTime,
  autoDraftHasContent,
} from '../services/draft-service';
import type { WizardDraftRecord } from '../db/database';
import { resizeImageToPngBuffer } from '../services/image-processing';
import { FolderOpen, Trash2, Edit2, FileText, Image as ImageIcon, Check, X } from 'lucide-react';

const borderColor = 'var(--color-border-default)';
const mutedText = 'color-mix(in srgb, var(--text-color) 60%, transparent)';
const faintText = 'color-mix(in srgb, var(--text-color) 40%, transparent)';
const cardBgSemiTransparent = 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.4)';

export function DraftsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [drafts, setDrafts] = useState<WizardDraftRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { mode: viewMode, size: viewSize, setMode: setViewMode, setSize: setViewSize } = useViewPrefs('drafts');

  // Grid column classes per size — bigger size = fewer columns.
  const gridColsBySize = {
    sm: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8',
    md: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
    lg: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
  } as const;

  const refreshDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listManualDrafts();
      setDrafts(list);
    } catch {
      setDrafts([]);
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
    // 打开草稿后，创建页的防抖自动保存会把它写入 'new' 自动草稿槽——
    // 若那里还有正在进行的创作，等于静默顶掉。有实质内容时先让用户确认。
    if (await autoDraftHasContent() && !confirm(t('wizard.loadDraftOverwriteConfirm'))) {
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
    // Pre-fill with the time-stripped name so the auto-generated time suffix
    // doesn't clutter the rename input.
    setEditingName(stripTrailingTime(draft.name || ''));
  };

  const handleRename = async () => {
    if (!editingId) return;
    await renameDraft(editingId, editingName);
    setEditingId(null);
    setEditingName('');
    await refreshDrafts();
  };

  const handleChangeCover = useCallback(async (id: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const buffer = await resizeImageToPngBuffer(file, { maxDimension: 600 });
        const blob = new Blob([buffer], { type: 'image/png' });
        await updateDraftCover(id, blob);
        await refreshDrafts();
        addToast('success', t('wizard.coverUpdated'));
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('wizard.coverUpdateFailed');
        addToast('error', msg);
      }
    };
    input.click();
  }, [refreshDrafts, addToast, t]);

  const handleRemoveCover = useCallback(async (id: string) => {
    try {
      await updateDraftCover(id, null);
      await refreshDrafts();
      addToast('info', t('wizard.coverRemoved'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('wizard.coverUpdateFailed');
      addToast('error', msg);
    }
  }, [refreshDrafts, addToast, t]);

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleString('zh-CN', {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="animate-fade-in px-4 py-8">
      <div className="flex items-center gap-3 mb-2">
        <FileText size={24} className="text-primary" />
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-color)' }}>{t('wizard.draftBox')}</h1>
      </div>
      <div className="flex items-center justify-between gap-3 mb-6">
        <p className="text-sm" style={{ color: mutedText }}>{t('wizard.draftsDescription')}</p>
        {drafts.length > 0 && (
          <ViewToolbar
            mode={viewMode}
            size={viewSize}
            onModeChange={setViewMode}
            onSizeChange={setViewSize}
          />
        )}
      </div>

      {drafts.length === 0 && !loading ? (
        <div className="rounded-xl border p-12 text-center" style={{ borderColor, backgroundColor: cardBgSemiTransparent }}>
          <FileText size={48} className="mx-auto mb-4" style={{ color: faintText }} />
          <p style={{ color: mutedText }}>{t('wizard.noDrafts')}</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate('/wizard')}>
            {t('wizard.createNewCard')}
          </Button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className={`grid ${gridColsBySize[viewSize]} gap-4`}>
          {drafts.map((draft) => {
            const draftData = draft.data as { cardName?: string } | null;
            // Strip the auto-generated time suffix from the title; the small
            // subtitle below already shows the save time.
            const displayName = stripTrailingTime(draft.name || '') || draftData?.cardName || t('wizard.unnamedDraft');
            const hasCustomCover = !!draft.coverImageBlob;
            const isEditing = editingId === draft.id;

            return (
              <div
                key={draft.id}
                className="group rounded-xl border overflow-hidden flex flex-col transition-transform hover:-translate-y-0.5 hover:shadow-lg"
                style={{ borderColor, backgroundColor: cardBgSemiTransparent }}
              >
                {/* Cover with hover actions */}
                <div className="relative">
                  <CardCover blob={draft.coverImageBlob ?? null} name={displayName} />

                  {/* Top-right quick actions */}
                  <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startRename(draft)}
                      title={t('wizard.renameDraft')}
                      className="w-7 h-7 rounded-md backdrop-blur-sm bg-black/55 text-white flex items-center justify-center hover:bg-black/75 transition-colors"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => setDeletingId(draft.id)}
                      title={t('wizard.deleteDraft')}
                      className="w-7 h-7 rounded-md backdrop-blur-sm bg-black/55 text-white flex items-center justify-center hover:bg-red-600/80 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Bottom cover-replace action */}
                  <div className="absolute bottom-1.5 left-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleChangeCover(draft.id)}
                      title={t('wizard.changeCover')}
                      className="flex-1 h-7 rounded-md backdrop-blur-sm bg-black/55 text-white text-[11px] flex items-center justify-center gap-1 hover:bg-black/75 transition-colors"
                    >
                      <ImageIcon size={12} />
                      {t('wizard.changeCover')}
                    </button>
                    {hasCustomCover && (
                      <button
                        onClick={() => handleRemoveCover(draft.id)}
                        title={t('wizard.removeCover')}
                        className="w-7 h-7 rounded-md backdrop-blur-sm bg-black/55 text-white flex items-center justify-center hover:bg-black/75 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Body */}
                <div className="p-3 flex-1 flex flex-col">
                  {isEditing ? (
                    <div className="flex gap-1.5">
                      <TextInput
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleRename();
                          } else if (e.key === 'Escape') {
                            setEditingId(null);
                            setEditingName('');
                          }
                        }}
                        autoFocus
                        className="text-xs"
                      />
                      <button
                        onClick={handleRename}
                        className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
                        style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-text-inverse)' }}
                        title={t('common.confirm')}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={() => { setEditingId(null); setEditingName(''); }}
                        className="shrink-0 w-7 h-7 rounded-md border flex items-center justify-center"
                        style={{ borderColor, color: mutedText }}
                        title={t('common.cancel')}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="text-sm font-medium truncate" style={{ color: 'var(--text-color)' }} title={displayName}>
                        {displayName}
                      </div>
                      <div className="text-[10px] mt-1" style={{ color: faintText }}>
                        {formatTime(draft.updatedAt)} · {t('wizard.stepLabel', { step: String(draft.currentStep) })}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-auto pt-2 text-xs w-full"
                        onClick={() => handleLoad(draft.id)}
                      >
                        <FolderOpen size={12} className="mr-1" />
                        {t('wizard.loadDraft')}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List view */
        <div className="flex flex-col gap-2">
          {drafts.map((draft) => {
            const draftData = draft.data as { cardName?: string } | null;
            const displayName = stripTrailingTime(draft.name || '') || draftData?.cardName || t('wizard.unnamedDraft');
            const hasCustomCover = !!draft.coverImageBlob;
            const isEditing = editingId === draft.id;
            const thumbSize = viewSize === 'sm' ? 'w-10 h-12' : viewSize === 'lg' ? 'w-16 h-20' : 'w-12 h-16';
            const rowPad = viewSize === 'sm' ? 'p-2' : viewSize === 'lg' ? 'p-3.5' : 'p-3';

            return (
              <div
                key={draft.id}
                className="group rounded-xl border flex items-center gap-3 transition-colors hover:shadow-md"
                style={{ borderColor, backgroundColor: cardBgSemiTransparent }}
              >
                {/* Thumbnail */}
                <div className="relative shrink-0 ml-2.5 my-2.5">
                  <CardCover
                    blob={draft.coverImageBlob ?? null}
                    name={displayName}
                    aspectClass={thumbSize}
                    roundedClass="rounded-lg"
                  />
                  <div className="absolute inset-0 flex gap-1 items-start justify-end p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleChangeCover(draft.id)}
                      title={t('wizard.changeCover')}
                      className="w-5 h-5 rounded backdrop-blur-sm bg-black/55 text-white flex items-center justify-center hover:bg-black/75"
                    >
                      <ImageIcon size={10} />
                    </button>
                    {hasCustomCover && (
                      <button
                        onClick={() => handleRemoveCover(draft.id)}
                        title={t('wizard.removeCover')}
                        className="w-5 h-5 rounded backdrop-blur-sm bg-black/55 text-white flex items-center justify-center hover:bg-black/75"
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Main content */}
                <div className={`min-w-0 flex-1 ${rowPad} flex items-center gap-3`}>
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="flex gap-1.5">
                        <TextInput
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleRename();
                            } else if (e.key === 'Escape') {
                              setEditingId(null);
                              setEditingName('');
                            }
                          }}
                          autoFocus
                          className="text-xs"
                        />
                        <button
                          onClick={handleRename}
                          className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
                          style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-text-inverse)' }}
                          title={t('common.confirm')}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={() => { setEditingId(null); setEditingName(''); }}
                          className="shrink-0 w-7 h-7 rounded-md border flex items-center justify-center"
                          style={{ borderColor, color: mutedText }}
                          title={t('common.cancel')}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="text-sm font-medium truncate" style={{ color: 'var(--text-color)' }} title={displayName}>
                          {displayName}
                        </div>
                        <div className="text-[10px] mt-0.5" style={{ color: faintText }}>
                          {formatTime(draft.updatedAt)} · {t('wizard.stepLabel', { step: String(draft.currentStep) })}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  {!isEditing && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => startRename(draft)}
                        title={t('wizard.renameDraft')}
                        className="w-7 h-7 rounded-md border flex items-center justify-center transition-colors hover:bg-[color-mix(in_srgb,var(--text-color)_6%,transparent)]"
                        style={{ borderColor, color: mutedText }}
                      >
                        <Edit2 size={14} />
                      </button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="text-xs"
                        onClick={() => handleLoad(draft.id)}
                      >
                        <FolderOpen size={12} className="mr-1" />
                        {t('wizard.loadDraft')}
                      </Button>
                      <button
                        onClick={() => setDeletingId(draft.id)}
                        title={t('wizard.deleteDraft')}
                        className="w-7 h-7 rounded-md border flex items-center justify-center transition-colors hover:bg-red-600/10 hover:border-red-500/50"
                        style={{ borderColor, color: mutedText }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={deletingId !== null}
        onClose={() => setDeletingId(null)}
        title={t('wizard.deleteDraft')}
        maxWidth="max-w-md"
      >
        <p className="text-sm mb-6" style={{ color: 'var(--text-color)' }}>{t('wizard.deleteDraftConfirm')}</p>
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
