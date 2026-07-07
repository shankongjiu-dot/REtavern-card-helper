/**
 * CardEditorChatPage - AI-assisted character card editor via chat.
 *
 * Workflow:
 *   1. Import a JSON or PNG character card.
 *   2. Chat with AI about changes (e.g. "turn NTR plot into pure love").
 *   3. AI returns structured edit proposals.
 *   4. Review diffs and apply them.
 *   5. Save to library or export PNG/JSON.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Button } from '../components/shared/Button';
import { Modal } from '../components/shared/Modal';
import { useToast } from '../components/shared/Toast';
import { useTranslation } from '../i18n/I18nContext';
import { useCardLibrary } from '../hooks/useCardLibrary';
import { callAIStreaming } from '../services/ai-service';
import { importFromPng, exportAsPng, exportAsJson, cardToDraft, assembleCard } from '../services/card-exporter';
import { resizeImageToPngBuffer } from '../services/image-processing';
import {
  buildCardChatPrompt,
  parseCardChatEdits,
  computeCardChatDiffs,
  applyCardChatPatch,
  fieldLabel,
  type CardChatProposals,
  type ChangeDiff,
} from '../services/card-chat-optimizer';
import type { WizardDraft, LorebookEntry } from '../constants/defaults';
import type { AIMessage } from '../services/ai-service';
import { Upload, Save, Download, FileJson, Image as ImageIcon, Trash2, Check, X, ChevronDown, ChevronUp, History } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const borderColor = 'var(--color-border-default)';
const mutedText = 'color-mix(in srgb, var(--text-color) 60%, transparent)';
const faintText = 'color-mix(in srgb, var(--text-color) 40%, transparent)';

export function CardEditorChatPage() {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const { saveCard } = useCardLibrary();

  const [draft, setDraft] = useState<WizardDraft | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [pendingProposals, setPendingProposals] = useState<CardChatProposals | null>(null);
  const [changeDiffs, setChangeDiffs] = useState<ChangeDiff[]>([]);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [coverImageBuffer, setCoverImageBuffer] = useState<ArrayBuffer | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [coverSource, setCoverSource] = useState<'imported' | 'custom' | 'default'>('default');
  const [expandedDiffs, setExpandedDiffs] = useState<Set<number>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isTouchDevice = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' });
  }, [messages, streamingText, isStreaming]);

  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  const updateCoverImage = useCallback((buffer: ArrayBuffer | null, source: 'imported' | 'custom' | 'default') => {
    setCoverPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return buffer ? URL.createObjectURL(new Blob([buffer], { type: 'image/png' })) : null;
    });
    setCoverImageBuffer(buffer);
    setCoverSource(source);
  }, []);

  const handleImport = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.png,image/png,application/json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        let cardData: Record<string, unknown>;
        if (file.name.endsWith('.png') || file.type === 'image/png') {
          const buffer = await file.arrayBuffer();
          const extracted = await importFromPng(buffer);
          if (!extracted) {
            addToast('error', '无法从 PNG 中读取角色卡数据');
            return;
          }
          cardData = extracted;
          updateCoverImage(buffer, 'imported');
        } else {
          const text = await file.text();
          cardData = JSON.parse(text);
          updateCoverImage(null, 'default');
        }
        const parsedDraft = cardToDraft(cardData);
        setDraft(parsedDraft);
        setImportedFileName(file.name);
        setMessages([]);
        setInputValue('');
        setPendingProposals(null);
        setChangeDiffs([]);
        setShowDiffModal(false);
        addToast('success', '卡片导入成功，开始和 AI 对话修改吧');
      } catch (err) {
        const msg = err instanceof Error ? err.message : '导入失败';
        addToast('error', msg);
      }
    };
    input.click();
  }, [addToast, updateCoverImage]);

  const handleSend = useCallback(async () => {
    if (!draft || !inputValue.trim() || isStreaming) return;

    const userMsg: ChatMessage = { role: 'user', content: inputValue.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputValue('');
    setIsStreaming(true);
    setStreamingText('');

    try {
      const prompt = buildCardChatPrompt(draft, userMsg.content, updatedMessages);
      const apiMessages: AIMessage[] = [
        { role: 'system', content: prompt.system },
        ...updatedMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: prompt.user },
      ];

      let fullText = '';
      await callAIStreaming({ messages: apiMessages }, (chunk) => {
        fullText += chunk;
        setStreamingText(fullText);
      });

      const assistantMsg: ChatMessage = { role: 'assistant', content: fullText };
      const finalMessages = [...updatedMessages, assistantMsg];
      setMessages(finalMessages);
      setStreamingText('');

      // Check if AI returned structured edits
      const proposals = parseCardChatEdits(fullText);
      if (proposals) {
        setPendingProposals(proposals);
        const diffs = computeCardChatDiffs(draft, proposals);
        setChangeDiffs(diffs);
        setExpandedDiffs(new Set(diffs.map((_, i) => i)));
        setShowDiffModal(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI 响应失败';
      addToast('error', msg);
    } finally {
      setIsStreaming(false);
      setStreamingText('');
    }
  }, [draft, inputValue, isStreaming, messages, addToast]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isTouchDevice) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend, isTouchDevice]);

  const textareaResizeRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    }
  }, []);

  const applyChanges = useCallback(() => {
    if (!draft || !pendingProposals) return;
    const nextDraft = applyCardChatPatch(draft, pendingProposals);
    setDraft(nextDraft);
    setPendingProposals(null);
    setChangeDiffs([]);
    setShowDiffModal(false);
    addToast('success', '修改已应用');
  }, [draft, pendingProposals, addToast]);

  const discardChanges = useCallback(() => {
    setPendingProposals(null);
    setChangeDiffs([]);
    setShowDiffModal(false);
    addToast('info', '已放弃本次修改');
  }, [addToast]);

  const handleSaveToLibrary = useCallback(async () => {
    if (!draft) return;
    try {
      const id = await saveCard(draft);
      addToast('success', `已保存到卡库（ID: ${id}）`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      addToast('error', msg);
    }
  }, [draft, saveCard, addToast]);

  const openExportModal = useCallback(() => {
    if (!draft) return;
    setShowExportModal(true);
  }, [draft]);

  const handleChooseCoverImage = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const buffer = await resizeImageToPngBuffer(file, { maxDimension: 1536 });
        updateCoverImage(buffer, 'custom');
        addToast('success', '封面图片已更换');
      } catch (err) {
        const msg = err instanceof Error ? err.message : '图片处理失败';
        addToast('error', msg);
      }
    };
    input.click();
  }, [addToast, updateCoverImage]);

  const handleUseDefaultCover = useCallback(() => {
    updateCoverImage(null, 'default');
    addToast('info', '已改为默认白图封装');
  }, [addToast, updateCoverImage]);

  const handleExportPng = useCallback(async () => {
    if (!draft) return;
    try {
      const card = assembleCard(draft);
      await exportAsPng(card, coverImageBuffer || undefined);
      setShowExportModal(false);
      addToast('success', 'PNG 导出成功');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '导出失败';
      addToast('error', msg);
    }
  }, [draft, coverImageBuffer, addToast]);

  const handleExportJson = useCallback(async () => {
    if (!draft) return;
    try {
      const card = assembleCard(draft);
      exportAsJson(card);
      setShowExportModal(false);
      addToast('success', 'JSON 导出成功');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '导出失败';
      addToast('error', msg);
    }
  }, [draft, addToast]);

  const toggleDiff = useCallback((idx: number) => {
    setExpandedDiffs((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const quickPrompts = [
    '把剧情从 NTR 改成纯爱',
    '让角色性格更温柔一些',
    '改一下开场白，让主角更主动',
    '增加一条关于身世的世界书条目',
  ];

  if (!draft) {
    return (
      <div className="animate-fade-in flex flex-col items-center justify-center h-[calc(100dvh-4rem)] px-4">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-white mb-2">AI 卡片编辑室</h1>
          <p className="text-sm mb-6" style={{ color: mutedText }}>
            导入 JSON 或 PNG 角色卡，通过对话让 AI 帮你修改剧情、人设、世界书等内容。
          </p>
          <Button variant="primary" size="lg" onClick={handleImport} className="gap-2">
            <Upload size={18} />
            导入角色卡
          </Button>
          <p className="text-xs mt-4" style={{ color: faintText }}>
            支持 .json 文件和 SillyTavern 格式的 .png 卡片
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in flex flex-col h-[calc(100dvh-7rem)] md:h-[calc(100dvh-4rem)]">
      {/* Header */}
      <div className="shrink-0 px-4 sm:px-6 py-3 border-b flex flex-wrap items-center justify-between gap-3" style={{ borderColor }}>
        <div className="min-w-0 flex items-center gap-3">
          <button
            onClick={() => { setDraft(null); setMessages([]); setImportedFileName(null); }}
            className="text-xs px-2 py-1 rounded border hover:bg-slate-800 transition-colors"
            style={{ borderColor, color: mutedText }}
          >
            重新导入
          </button>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold text-white truncate">
              {draft.cardName || '未命名卡片'}
            </h1>
            <p className="text-xs truncate" style={{ color: faintText }}>
              {importedFileName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={handleSaveToLibrary} className="gap-1">
            <Save size={14} />
            保存到卡库
          </Button>
          <Button variant="primary" size="sm" onClick={openExportModal} className="gap-1">
            <ImageIcon size={14} />
            导出
          </Button>
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-4 space-y-3 sm:space-y-4">
          {messages.length === 0 && !isStreaming && (
            <div className="text-center py-12 sm:py-16">
              <p className="text-sm mb-4 sm:mb-6" style={{ color: mutedText }}>
                描述你想做的修改，例如“把剧情从 NTR 改成纯爱”。
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg mx-auto px-2">
                {quickPrompts.map((hint) => (
                  <button
                    key={hint}
                    onClick={() => { setInputValue(hint); textareaRef.current?.focus(); }}
                    className="text-left text-sm px-3 py-2 rounded-lg border border-slate-700
                      bg-slate-800/50 text-slate-400 hover:text-slate-200 hover:border-slate-600
                      transition-colors cursor-pointer"
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] sm:max-w-[85%] rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-white'
                  : 'bg-slate-800 border border-slate-700 text-slate-200'
              }`}>
                {msg.content}
              </div>
            </div>
          ))}

          {isStreaming && (
            <div className="flex justify-start">
              <div className="max-w-[90%] sm:max-w-[85%] rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-sm bg-slate-800 border border-slate-700 text-slate-200 whitespace-pre-wrap leading-relaxed">
                {streamingText || <span className="text-slate-400 animate-pulse">思考中...</span>}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-slate-700 px-3 sm:px-4 py-2.5 sm:py-3">
          <div className="flex gap-2 items-end">
            <textarea
              ref={(el) => { textareaResizeRef(el); (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el; }}
              className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 sm:px-4 py-2 sm:py-2.5 text-sm text-slate-100
                placeholder-slate-500 focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]
                resize-none min-h-[38px] sm:min-h-[42px] max-h-[160px]"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                textareaResizeRef(e.currentTarget);
              }}
              onKeyDown={handleKeyDown}
              placeholder={isTouchDevice ? '输入修改需求...' : '输入修改需求，按 Enter 发送，Shift+Enter 换行'}
              disabled={isStreaming}
              rows={1}
            />
            <Button onClick={handleSend} disabled={!inputValue.trim() || isStreaming}>
              {isStreaming ? '...' : '发送'}
            </Button>
          </div>
        </div>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <Modal isOpen={showExportModal} onClose={() => setShowExportModal(false)} title="导出角色卡" maxWidth="max-w-3xl">
          <div className="space-y-4">
            <div className="text-xs" style={{ color: mutedText }}>
              可更换封装封面图片。导入自 PNG 的角色卡默认保留原图；导入自 JSON 的角色卡可上传新图，或直接使用默认白图。
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <div className="shrink-0 mx-auto sm:mx-0">
                <div
                  className="w-40 h-56 rounded-lg border flex items-center justify-center overflow-hidden bg-slate-900"
                  style={{ borderColor }}
                >
                  {coverPreviewUrl ? (
                    <img src={coverPreviewUrl} alt="cover preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center px-3">
                      <ImageIcon size={32} style={{ color: faintText }} className="mx-auto mb-2" />
                      <span className="text-xs" style={{ color: faintText }}>默认白图</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 space-y-3">
                <div className="text-sm font-medium text-white">封面图片</div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={handleChooseCoverImage} className="gap-1">
                    <Upload size={14} />
                    更换图片
                  </Button>
                  {coverSource !== 'default' && (
                    <Button variant="ghost" size="sm" onClick={handleUseDefaultCover}>
                      使用默认白图
                    </Button>
                  )}
                </div>
                <div className="text-xs" style={{ color: faintText }}>
                  {coverSource === 'imported' && '当前使用原 PNG 的封面，可继续保留或更换。'}
                  {coverSource === 'custom' && '当前使用你上传的封面图片。'}
                  {coverSource === 'default' && '当前使用默认白图作为导出占位图。'}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor }}>
              <Button variant="ghost" size="sm" onClick={() => setShowExportModal(false)}>
                取消
              </Button>
              <Button variant="secondary" size="sm" onClick={handleExportJson} className="gap-1">
                <FileJson size={14} />
                导出 JSON
              </Button>
              <Button variant="primary" size="sm" onClick={handleExportPng} className="gap-1">
                <ImageIcon size={14} />
                导出 PNG
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Diff Modal */}
      {showDiffModal && (
        <Modal isOpen={showDiffModal} onClose={discardChanges} title="AI 修改建议" maxWidth="max-w-4xl">
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <p className="text-xs" style={{ color: mutedText }}>
              AI 提出了以下修改，请确认是否应用。应用后可以继续对话进一步修改。
            </p>
            {changeDiffs.length === 0 ? (
              <p className="text-sm text-slate-400">没有检测到有效改动。</p>
            ) : (
              changeDiffs.map((diff, idx) => (
                <div key={idx} className="rounded-lg border border-slate-700 bg-slate-900/40">
                  <div
                    className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
                    onClick={() => toggleDiff(idx)}
                  >
                    <div className="flex items-center gap-2">
                      {expandedDiffs.has(idx) ? <ChevronUp size={14} style={{ color: faintText }} /> : <ChevronDown size={14} style={{ color: faintText }} />}
                      <span className="text-sm font-medium text-white">{fieldLabel(diff.change.field)}</span>
                      {diff.hasChange ? (
                        <span className="text-[10px] text-amber-400">有改动</span>
                      ) : (
                        <span className="text-[10px] text-slate-500">无变化</span>
                      )}
                    </div>
                  </div>
                  {expandedDiffs.has(idx) && (
                    <div className="px-3 pb-3 border-t border-slate-700/50 space-y-2">
                      <DiffValue label="修改前" value={diff.before} />
                      <DiffValue label="修改后" value={diff.after} />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-700">
            <Button variant="ghost" onClick={discardChanges} className="gap-1">
              <X size={14} />
              放弃
            </Button>
            <Button variant="primary" onClick={applyChanges} disabled={changeDiffs.every((d) => !d.hasChange)} className="gap-1">
              <Check size={14} />
              应用修改
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DiffValue({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <div>
        <div className="text-[10px] mb-1" style={{ color: faintText }}>{label}</div>
        <div className="text-xs text-slate-500 italic">（无）</div>
      </div>
    );
  }

  let text = '';
  if (typeof value === 'string') {
    text = value;
  } else {
    text = JSON.stringify(value, null, 2);
  }

  return (
    <div>
      <div className="text-[10px] mb-1" style={{ color: faintText }}>{label}</div>
      <pre className="text-xs whitespace-pre-wrap break-words rounded bg-slate-950/50 p-2 border border-slate-800 text-slate-300 max-h-[200px] overflow-y-auto">
        {text}
      </pre>
    </div>
  );
}
