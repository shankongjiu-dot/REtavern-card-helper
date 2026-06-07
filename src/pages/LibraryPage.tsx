/**
 * LibraryPage - Character card library management.
 * Lists all saved cards with search, sort, edit, delete, and JSON/PNG export/import.
 */
import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCardLibrary } from '../hooks/useCardLibrary';
import { useAIGenerate } from '../hooks/useAIGenerate';
import { db } from '../db/database';
import { useToast } from '../components/shared/Toast';
import { Button } from '../components/shared/Button';
import { TextInput } from '../components/shared/TextInput';
import { Modal } from '../components/shared/Modal';
import { exportAsJson, exportAsPng, importFromPng } from '../services/card-exporter';

export function LibraryPage() {
  const { cards, trashCards, loading, deleteCard, restoreCard, permanentDelete, emptyTrash, loadCards } = useCardLibrary();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'updatedAt' | 'name'>('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState<number | null>(null);
  const [exportMenuCard, setExportMenuCard] = useState<Record<string, unknown> | null>(null);
  const [translatingId, setTranslatingId] = useState<number | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const { translateCard } = useAIGenerate();

  // Filter and sort cards
  const filteredCards = useMemo(() => {
    let result = [...cards];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((c) => (c.name as string).toLowerCase().includes(q));
    }

    result.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') {
        cmp = ((a.name as string) || '').localeCompare((b.name as string) || '');
      } else {
        cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [cards, searchQuery, sortBy, sortDir]);

  const handleDelete = async (id: number) => {
    await deleteCard(id);
    addToast('success', '卡片已移至回收站');
    setDeleteConfirm(null);
  };

  const handleRestore = async (id: number) => {
    await restoreCard(id);
    addToast('success', '卡片已恢复');
  };

  const handlePermanentDelete = async (id: number) => {
    await permanentDelete(id);
    addToast('success', '卡片已彻底删除');
    setPermanentDeleteConfirm(null);
  };

  const handleEmptyTrash = async () => {
    if (confirm('确定要清空回收站吗？此操作无法撤销。')) {
      await emptyTrash();
      addToast('success', '回收站已清空');
    }
  };

  const handleExportJson = (card: Record<string, unknown>) => {
    try {
      exportAsJson(card as Parameters<typeof exportAsJson>[0]);
      addToast('success', 'JSON 已导出');
    } catch {
      addToast('error', '导出 JSON 失败');
    }
    setExportMenuCard(null);
  };

  const handleExportPng = async (card: Record<string, unknown>) => {
    try {
      await exportAsPng(card as Parameters<typeof exportAsPng>[0]);
      addToast('success', 'PNG 已导出（含嵌入 JSON）');
    } catch {
      addToast('error', '导出 PNG 失败');
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
        addToast('success', 'PNG 已导出（自定义图片 + 嵌入 JSON）');
      } catch {
        addToast('error', '导出 PNG 失败');
      }
    };
    input.click();
    setExportMenuCard(null);
  };

  const handleTranslateCard = useCallback(async (card: Record<string, unknown>, targetLang: 'zh' | 'en') => {
    const cardId = card.id as number;
    setTranslatingId(cardId);
    setExportMenuCard(null);
    try {
      const cardData = (card.data || card) as Record<string, unknown>;
      const translated = await translateCard(cardData, targetLang);
      if (!translated) {
        addToast('error', '卡片内容为空，无法翻译');
        return;
      }

      // Apply translated fields back to card data
      const updatedData = { ...cardData };
      const fields = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
        'system_prompt', 'post_history_instructions', 'creator_notes'];
      for (const key of fields) {
        if (translated[key] && typeof translated[key] === 'string') {
          updatedData[key] = translated[key];
        }
      }

      // Apply translated worldbook entries back
      const wbEntries = translated._worldbook_entries as Array<Record<string, unknown>> | undefined;
      if (wbEntries && updatedData.character_book) {
        const charBook = updatedData.character_book as Record<string, unknown>;
        const entries = charBook.entries as Array<Record<string, unknown>> | undefined;
        if (entries && Array.isArray(entries)) {
          for (let i = 0; i < Math.min(wbEntries.length, entries.length); i++) {
            if (wbEntries[i].name) entries[i].name = wbEntries[i].name;
            if (wbEntries[i].comment) entries[i].comment = wbEntries[i].comment;
            if (wbEntries[i].content) entries[i].content = wbEntries[i].content;
            if (wbEntries[i].keys) entries[i].keys = wbEntries[i].keys;
          }
        }
      }

      // Update the card name at top level too
      const updatedCard = {
        ...card,
        name: (translated.name as string) || card.name,
        data: updatedData,
        updatedAt: new Date(),
      };

      await db.cards.put(updatedCard as Record<string, unknown>);
      await loadCards();
      addToast('success', `卡片「${updatedCard.name}」已翻译为${targetLang === 'zh' ? '中文' : '英文'}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '翻译失败';
      addToast('error', `翻译失败: ${msg}`);
    } finally {
      setTranslatingId(null);
    }
  }, [translateCard, loadCards, addToast]);

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
            addToast('error', 'PNG 中没有找到角色卡数据（需要 SillyTavern 格式）');
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
          name: (cardData.data as Record<string, unknown>)?.name || cardData.name || 'Imported Card',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await db.cards.add(card as Record<string, unknown>);
        await loadCards();
        addToast('success', `卡片「${card.name}」导入成功`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '文件格式无效';
        addToast('error', `导入失败: ${msg}`);
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
            {showTrash ? '回收站' : '卡片库'}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {showTrash
              ? `回收站中有 ${trashCards.length} 张卡片`
              : `库中共有 ${cards.length} 张卡片`}
          </p>
        </div>
        <div className="flex gap-2">
          {!showTrash && (
            <>
              <Button variant="secondary" onClick={handleImport}>📥 导入</Button>
              <Button onClick={() => navigate('/wizard')}>✨ 创建新卡</Button>
            </>
          )}
          <Button
            variant={showTrash ? 'secondary' : 'ghost'}
            onClick={() => setShowTrash(!showTrash)}
          >
            {showTrash ? '📚 返回卡片库' : `🗑️ 回收站 (${trashCards.length})`}
          </Button>
        </div>
      </div>

      {!showTrash && (
        <p className="text-xs text-slate-500 mb-4 -mt-3">
          支持导入 JSON 文件和 SillyTavern 格式的 PNG 角色卡图片
        </p>
      )}

      {/* Trash view */}
      {showTrash && (
        <div className="mb-6">
          {trashCards.length > 0 && (
            <div className="flex items-center gap-3 mb-4">
              <Button variant="danger" size="sm" onClick={handleEmptyTrash}>
                🗑️ 清空回收站
              </Button>
              <span className="text-xs text-slate-500">删除的卡片会进入回收站，可随时恢复</span>
            </div>
          )}
          {trashCards.length === 0 && !loading && (
            <div className="text-center py-16 border border-dashed border-slate-700 rounded-xl">
              <p className="text-slate-400 text-lg mb-2">回收站是空的</p>
              <p className="text-slate-500 text-sm">删除的卡片会出现在这里</p>
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
                      {card.name || 'Untitled'}
                    </h3>
                    <p className="text-xs text-slate-600 mt-1">
                      删除时间: {formatDate(card.deletedAt || card.updatedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleRestore(card.id!)}
                    >
                      ♻️ 恢复
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setPermanentDeleteConfirm(card.id!)}
                    >
                      🗑️ 彻底删除
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
            placeholder="搜索卡片名称..."
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'updatedAt' | 'name')}
          className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200"
        >
          <option value="updatedAt">按日期排序</option>
          <option value="name">按名称排序</option>
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
        <div className="text-center py-12 text-slate-500">加载卡片中...</div>
      )}

      {/* Empty state */}
      {!loading && filteredCards.length === 0 && (
        <div className="text-center py-16 border border-dashed border-slate-700 rounded-xl">
          <p className="text-slate-400 text-lg mb-2">
            {searchQuery ? '没有匹配的卡片' : '卡片库是空的'}
          </p>
          <p className="text-slate-500 text-sm mb-4">
            {searchQuery ? '试试其他搜索词' : '创建你的第一张角色卡吧！'}
          </p>
          {!searchQuery && (
            <Button onClick={() => navigate('/wizard')}>✨ 创建第一张卡片</Button>
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
                  <h3 className="text-lg font-semibold text-white truncate">{card.name || 'Untitled'}</h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                    <span>👤 {charCount} 个角色</span>
                    <span>📖 {lorebookEntries.length} 个设定</span>
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
                    ✏️ 编辑
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
                          📄 导出 JSON
                        </button>
                        <button
                          className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition-colors"
                          onClick={() => handleExportPng(card as unknown as Record<string, unknown>)}
                        >
                          🖼️ 导出 PNG（自动生成）
                        </button>
                        <button
                          className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition-colors"
                          onClick={() => handleExportPngWithImage(card as unknown as Record<string, unknown>)}
                        >
                          🎨 导出 PNG（选择图片）
                        </button>
                        <div className="border-t border-slate-700 my-1" />
                        <button
                          className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-50"
                          onClick={() => handleTranslateCard(card as unknown as Record<string, unknown>, 'zh')}
                          disabled={translatingId === card.id}
                        >
                          🇨🇳 翻译为中文
                        </button>
                        <button
                          className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-50"
                          onClick={() => handleTranslateCard(card as unknown as Record<string, unknown>, 'en')}
                          disabled={translatingId === card.id}
                        >
                          🇬🇧 Translate to English
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
      <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="移至回收站">
        <p className="text-slate-300 mb-4">
          确定要将这张卡片移至回收站吗？你可以在回收站中恢复它。
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>取消</Button>
          <Button variant="danger" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>移至回收站</Button>
        </div>
      </Modal>

      {/* Permanent delete confirmation modal */}
      <Modal isOpen={permanentDeleteConfirm !== null} onClose={() => setPermanentDeleteConfirm(null)} title="彻底删除">
        <p className="text-red-300 mb-4">
          确定要彻底删除这张卡片吗？此操作无法撤销！
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPermanentDeleteConfirm(null)}>取消</Button>
          <Button variant="danger" onClick={() => permanentDeleteConfirm && handlePermanentDelete(permanentDeleteConfirm)}>彻底删除</Button>
        </div>
      </Modal>
    </div>
  );
}
