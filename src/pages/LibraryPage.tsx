/**
 * LibraryPage - Character card library management.
 * Lists all saved cards with search, sort, edit, delete, and JSON/PNG export/import.
 */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCardLibrary } from '../hooks/useCardLibrary';
import { db } from '../db/database';
import { useToast } from '../components/shared/Toast';
import { Button } from '../components/shared/Button';
import { TextInput } from '../components/shared/TextInput';
import { Modal } from '../components/shared/Modal';
import { useTranslation } from '../i18n/I18nContext';
import { exportAsJson, exportAsPng, importFromPng } from '../services/card-exporter';

export function LibraryPage() {
  const { t } = useTranslation();
  const { cards, trashCards, loading, deleteCard, restoreCard, permanentDelete, emptyTrash, loadCards } = useCardLibrary();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'updatedAt' | 'name'>('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState<number | null>(null);
  const [exportMenuCard, setExportMenuCard] = useState<Record<string, unknown> | null>(null);
  const [showTrash, setShowTrash] = useState(false);

  // Filter and sort cards
  const filteredCards = useMemo(() => {
    let result = [...cards];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((c) => ((c.name as string) || '').toLowerCase().includes(q));
    }

    result.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') {
        const aName = (a.name as string) || '';
        const bName = (b.name as string) || '';
        cmp = aName.localeCompare(bName);
      } else {
        cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [cards, searchQuery, sortBy, sortDir]);

  const handleDelete = async (id: number) => {
    await deleteCard(id);
    addToast('success', t('library.trashed'));
    setDeleteConfirm(null);
  };

  const handleRestore = async (id: number) => {
    await restoreCard(id);
    addToast('success', t('library.restored'));
  };

  const handlePermanentDelete = async (id: number) => {
    await permanentDelete(id);
    addToast('success', t('library.permanentDeleteSuccess'));
    setPermanentDeleteConfirm(null);
  };

  const handleEmptyTrash = async () => {
    if (confirm(t('library.deleteConfirmPrompt'))) {
      await emptyTrash();
      addToast('success', t('library.trashCleared'));
    }
  };

  const handleExportJson = (card: Record<string, unknown>) => {
    try {
      exportAsJson(card as Parameters<typeof exportAsJson>[0]);
      addToast('success', t('library.exportJsonSuccess'));
    } catch {
      addToast('error', t('library.exportJsonError'));
    }
    setExportMenuCard(null);
  };

  const handleExportPng = async (card: Record<string, unknown>) => {
    try {
      await exportAsPng(card as Parameters<typeof exportAsPng>[0]);
      addToast('success', t('library.exportPngSuccess'));
    } catch {
      addToast('error', t('library.exportPngError'));
    }
    setExportMenuCard(null);
  };

  const handleExportPngWithImage = async (card: Record<string, unknown>) => {
    // Let user pick a PNG image to use as the base
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.png,image/png';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const buffer = await file.arrayBuffer();
        await exportAsPng(card as Parameters<typeof exportAsPng>[0], buffer);
        addToast('success', t('library.exportPngCustomSuccess'));
      } catch {
        addToast('error', t('library.exportPngError'));
      }
    };
    input.click();
    setExportMenuCard(null);
  };

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.png,image/png';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        let cardData: Record<string, unknown>;

        if (file.name.endsWith('.png') || file.type === 'image/png') {
          // PNG import: extract embedded JSON
          const buffer = await file.arrayBuffer();
          const extracted = await importFromPng(buffer);
          if (!extracted) {
            addToast('error', t('library.importPngError'));
            return;
          }
          cardData = extracted;
        } else {
          // JSON import
          const text = await file.text();
          cardData = JSON.parse(text);
        }

        // Strip id to avoid overwriting existing cards in DB
        const { id: _discardId, ...cardWithoutId } = cardData;
        const card = {
          ...cardWithoutId,
          name: (cardData.data as Record<string, unknown>)?.name || cardData.name || t('library.importedCardName'),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await db.cards.add(card as Record<string, unknown>);
        await loadCards();
        addToast('success', t('library.importSuccess', { name: String(card.name) }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : t('common.unknownError');
        addToast('error', t('library.importError', { message: msg }));
      }
    };
    input.click();
  };

  const formatDate = (date: Date | string) => {
    try {
      return new Date(date).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return 'Unknown';
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {showTrash ? t('library.trashTitle') : t('library.title')}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {showTrash
              ? t('library.trashCount', { count: String(trashCards.length) })
              : t('library.cardCount', { count: String(cards.length) })}
          </p>
        </div>
        <div className="flex gap-2">
          {!showTrash && (
            <>
              <Button variant="secondary" onClick={handleImport}>📥 {t('library.importButton')}</Button>
              <Button onClick={() => navigate('/wizard')}>✨ {t('library.createNewCard')}</Button>
            </>
          )}
          <Button
            variant={showTrash ? 'secondary' : 'ghost'}
            onClick={() => setShowTrash(!showTrash)}
          >
            {showTrash ? `📚 ${t('library.backToLibrary')}` : `🗑️ ${t('common.trash')} (${trashCards.length})`}
          </Button>
        </div>
      </div>

      {!showTrash && (
        <p className="text-xs text-slate-500 mb-4 -mt-3">
          {t('library.importHint')}
        </p>
      )}

      {/* Trash view */}
      {showTrash && (
        <div className="mb-6">
          {trashCards.length > 0 && (
            <div className="flex items-center gap-3 mb-4">
              <Button variant="danger" size="sm" onClick={handleEmptyTrash}>
                🗑️ {t('library.emptyTrash')}
              </Button>
              <span className="text-xs text-slate-500">{t('library.trashHint')}</span>
            </div>
          )}
          {trashCards.length === 0 && !loading && (
            <div className="text-center py-16 border border-dashed border-slate-700 rounded-xl">
              <p className="text-slate-400 text-lg mb-2">{t('library.trashEmptyTitle')}</p>
              <p className="text-slate-500 text-sm">{t('library.trashEmptySubtitle')}</p>
            </div>
          )}
          <div className="space-y-3">
            {trashCards.map((card) => (
              <div
                key={card.id}
                className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 opacity-70"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-slate-400 truncate">
                      {card.name || t('library.untitled')}
                    </h3>
                    <p className="text-xs text-slate-600 mt-1">
                      {t('library.deletedAt')}: {formatDate(card.deletedAt || card.updatedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleRestore(card.id!)}
                    >
                      ♻️ {t('library.restore')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setPermanentDeleteConfirm(card.id!)}
                    >
                      🗑️ {t('library.permanentDelete')}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Normal card view (only when not in trash) */}
      {!showTrash && (<>

      {/* Search and sort bar */}
      <div className="flex gap-3 mb-6">
        <div className="flex-1">
          <TextInput
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('library.searchPlaceholder')}
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'updatedAt' | 'name')}
          className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200"
        >
          <option value="updatedAt">{t('library.sortByDate')}</option>
          <option value="name">{t('library.sortByName')}</option>
        </select>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
        >
          {sortDir === 'asc' ? '↑' : '↓'}
        </Button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="text-center py-12 text-slate-500">{t('library.loading')}</div>
      )}

      {/* Empty state */}
      {!loading && filteredCards.length === 0 && (
        <div className="text-center py-16 border border-dashed border-slate-700 rounded-xl">
          <p className="text-slate-400 text-lg mb-2">
            {searchQuery ? t('library.emptySearchTitle') : t('library.emptyLibraryTitle')}
          </p>
          <p className="text-slate-500 text-sm mb-4">
            {searchQuery ? t('library.emptySearchSubtitle') : t('library.emptyLibrarySubtitle')}
          </p>
          {!searchQuery && (
            <Button onClick={() => navigate('/wizard')}>✨ {t('library.createFirstCard')}</Button>
          )}
        </div>
      )}

      {/* Card list */}
      <div className="space-y-3">
        {filteredCards.map((card) => {
          const data = (card.data || {}) as Record<string, unknown>;
          const meta = (card._meta || {}) as Record<string, unknown>;
          const charCount = Array.isArray(meta.characters) ? meta.characters.length : 1;
          const lorebookEntries = ((data.character_book as Record<string, unknown>)?.entries as unknown[]) || [];
          const cardTags = (data.tags as string[]) || [];

          return (
            <div
              key={card.id}
              className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 hover:border-slate-600 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold text-white truncate">{card.name || t('library.untitled')}</h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                    <span>👤 {t('library.characterCount', { count: String(charCount) })}</span>
                    <span>📖 {t('library.entryCount', { count: String(lorebookEntries.length) })}</span>
                    <span>🕐 {formatDate(card.updatedAt)}</span>
                  </div>
                  {cardTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {cardTags.slice(0, 6).map((tag, i) => (
                        <span key={i} className="px-1.5 py-0.5 bg-slate-700 text-slate-400 text-[10px] rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {(data.description as string) && (
                    <p className="mt-2 text-sm text-slate-400 line-clamp-2">{data.description as string}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <Button variant="secondary" size="sm" onClick={() => navigate(`/wizard/${card.id}`)}>
                    ✏️ {t('common.edit')}
                  </Button>
                  {/* Export dropdown */}
                  <div className="relative">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExportMenuCard(
                        exportMenuCard?.id === card.id ? null : (card as unknown as Record<string, unknown>),
                      )}
                    >
                      📤
                    </Button>
                    {exportMenuCard?.id === card.id && (
                      <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-slate-600 bg-slate-800 shadow-xl z-10 py-1">
                        <button
                          className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition-colors"
                          onClick={() => handleExportJson(card as unknown as Record<string, unknown>)}
                        >
                          📄 {t('library.exportJson')}
                        </button>
                        <button
                          className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition-colors"
                          onClick={() => handleExportPng(card as unknown as Record<string, unknown>)}
                        >
                          🖼️ {t('library.exportPngAuto')}
                        </button>
                        <button
                          className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition-colors"
                          onClick={() => handleExportPngWithImage(card as unknown as Record<string, unknown>)}
                        >
                          🎨 {t('library.exportPngChoose')}
                        </button>
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(card.id!)}>
                    🗑️
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      </>)}

      {/* Delete confirmation modal (soft delete → trash) */}
      <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title={t('library.deleteTitle')}>
        <p className="text-slate-300 mb-4">
          {t('library.deleteConfirm')}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>{t('library.deleteAction')}</Button>
        </div>
      </Modal>

      {/* Permanent delete confirmation modal */}
      <Modal isOpen={permanentDeleteConfirm !== null} onClose={() => setPermanentDeleteConfirm(null)} title={t('library.permanentDeleteTitle')}>
        <p className="text-red-300 mb-4">
          {t('library.permanentDeleteConfirm')}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPermanentDeleteConfirm(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={() => permanentDeleteConfirm && handlePermanentDelete(permanentDeleteConfirm)}>{t('library.permanentDelete')}</Button>
        </div>
      </Modal>
    </div>
  );
}
