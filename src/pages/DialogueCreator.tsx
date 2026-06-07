/**
 * DialogueCreator — AI creative assistant with conversation history.
 * Users chat with AI to brainstorm, review, and improve their cards.
 * All conversations are saved locally and can be revisited anytime.
 * Mobile: collapsible history panel, full-width chat.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '../components/shared/Button';
import { useToast } from '../components/shared/Toast';
import { callAIStreaming } from '../services/ai-service';
import { db, type CreatorChat } from '../db/database';
import { useLiveQuery } from 'dexie-react-hooks';
import { History, X } from 'lucide-react';
import type { AIMessage } from '../services/ai-service';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `你是一位经验丰富的 SillyTavern 角色卡创作助手。你的工作是帮助创作者完成以下任务：

1. **灵感激发**：根据创作者的模糊想法，提出具体的角色设定、世界观、剧情走向建议
2. **内容打磨**：帮助润色和优化角色描述、世界书条目、开场白、示例对话等文本
3. **问题诊断**：分析角色卡中可能存在的问题（如性格标签化、设定矛盾、触发词遗漏等）并给出修改建议
4. **创意建议**：提供写作技巧、灵感来源、参考作品方向等

你的回答风格：
- 用中文回答
- 直接、具体、有建设性，避免空泛的建议
- 给出示例时尽量贴合创作者的具体场景
- 当创作者的想法不够完善时，温和地指出并提供改进方向
- 可以使用 markdown 格式组织回答（标题、列表、加粗等）

请记住：你是在跟「创作者」对话，不是在扮演角色卡中的角色。`;

const LAST_CHAT_KEY = 'dialogue_creator_last_chat';

export function DialogueCreator() {
  const { addToast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Conversation history from DB ──────────────────────────────────────────
  const allChats = useLiveQuery(() =>
    db.creator_chats.orderBy('updatedAt').reverse().toArray()
  ) ?? [];

  const [currentChatId, setCurrentChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [restored, setRestored] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isNewMessage, setIsNewMessage] = useState(false);

  // ── Restore last viewed chat on mount ──────────────────────────────────────
  useEffect(() => {
    if (restored) return;
    const lastId = localStorage.getItem(LAST_CHAT_KEY);
    if (lastId) {
      const id = parseInt(lastId, 10);
      if (!isNaN(id)) {
        db.creator_chats.get(id).then((chat) => {
          if (chat) {
            setCurrentChatId(id);
            setMessages(chat.messages);
          }
          setRestored(true);
        }).catch((err) => {
          console.error('Failed to restore chat:', err);
          setRestored(true);
        });
        return;
      }
    }
    setRestored(true);
  }, [restored]);

  // ── Persist last viewed chat ID ────────────────────────────────────────────
  useEffect(() => {
    if (currentChatId != null) {
      localStorage.setItem(LAST_CHAT_KEY, String(currentChatId));
    } else {
      localStorage.removeItem(LAST_CHAT_KEY);
    }
  }, [currentChatId]);

  // ── Load chat from DB ─────────────────────────────────────────────────────
  const loadChat = useCallback(async (chatId: number) => {
    const chat = await db.creator_chats.get(chatId);
    if (chat) {
      setCurrentChatId(chatId);
      setMessages(chat.messages);
      setInputValue('');
      setHistoryOpen(false);
      setIsNewMessage(false);
    }
  }, []);

  // ── Save chat to DB ───────────────────────────────────────────────────────
  const saveChat = useCallback(async (chatId: number | null, chatMessages: ChatMessage[], title?: string) => {
    const now = new Date();
    const autoTitle = title || chatMessages.find(m => m.role === 'user')?.content.slice(0, 30) || '新对话';

    if (chatId) {
      await db.creator_chats.update(chatId, { messages: chatMessages, updatedAt: now });
    } else {
      const newId = await db.creator_chats.add({
        title: autoTitle,
        messages: chatMessages,
        createdAt: now,
        updatedAt: now,
      });
      setCurrentChatId(newId ?? null);
    }
  }, []);

  // ── New conversation ──────────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    setCurrentChatId(null);
    setMessages([]);
    setInputValue('');
    setStreamingText('');
    setHistoryOpen(false);
  }, []);

  // ── Delete conversation ───────────────────────────────────────────────────
  const handleDeleteChat = useCallback(async (chatId: number) => {
    await db.creator_chats.delete(chatId);
    if (currentChatId === chatId) {
      handleNewChat();
    }
    addToast('success', '对话已删除');
  }, [currentChatId, handleNewChat, addToast]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    const behavior: ScrollBehavior = isNewMessage ? 'smooth' : 'auto';
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, [messages, streamingText, isNewMessage]);

  // ── Auto-resize textarea ──────────────────────────────────────────────────
  const textareaRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const content = inputValue.trim();
    if (!content || isStreaming) return;

    const userMsg: ChatMessage = { role: 'user', content };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputValue('');
    setIsStreaming(true);
    setStreamingText('');
    setIsNewMessage(true);

    try {
      const apiMessages: AIMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...updatedMessages.map(m => ({ role: m.role, content: m.content })),
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

      await saveChat(currentChatId, finalMessages);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI 回复失败';
      addToast('error', msg);
    } finally {
      setIsStreaming(false);
      setStreamingText('');
      setIsNewMessage(false);
    }
  }, [inputValue, isStreaming, messages, currentChatId, saveChat, addToast]);

  // ── Clear all chats ───────────────────────────────────────────────────────
  const handleClearAll = useCallback(async () => {
    if (confirm('确定要清空所有对话记录吗？')) {
      await db.creator_chats.clear();
      handleNewChat();
      addToast('success', '所有对话已清空');
    }
  }, [handleNewChat, addToast]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const quickPrompts = [
    '帮我设计一个有反差感的角色',
    '这个角色描述怎么更有层次感？',
    '世界书条目应该怎么写触发词？',
    '帮我写一段体现性格的示例对话',
  ];

  return (
    <div className="animate-fade-in flex h-[calc(100dvh-7rem)] md:h-[calc(100dvh-4rem)] relative">
      {/* ── Mobile history overlay ─────────────────────────────────────────── */}
      {historyOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setHistoryOpen(false)}
        />
      )}

      {/* ── Sidebar: History ────────────────────────────────────────────────── */}
      <aside
        className={`
          w-64 shrink-0 border-r border-slate-700 flex flex-col bg-slate-900/60
          max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40
          max-md:transition-transform max-md:duration-300 max-md:ease-in-out
          ${historyOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}
          md:translate-x-0 md:relative
        `}
      >
        <div className="p-3 border-b border-slate-700 flex items-center justify-between gap-2">
          <Button variant="primary" size="sm" className="flex-1" onClick={handleNewChat}>
            + 新对话
          </Button>
          <button
            onClick={() => setHistoryOpen(false)}
            className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {allChats.length === 0 && (
            <p className="text-xs text-slate-500 text-center py-4">暂无对话记录</p>
          )}
          {allChats.map((chat) => (
            <div
              key={chat.id}
              className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors
                ${currentChatId === chat.id
                  ? 'bg-indigo-600/20 border border-indigo-500/30'
                  : 'hover:bg-slate-800/50 border border-transparent'
                }`}
              onClick={() => loadChat(chat.id!)}
            >
              <span className={`flex-1 text-sm truncate ${
                currentChatId === chat.id ? 'text-indigo-300' : 'text-slate-400'
              }`}>
                {chat.title}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteChat(chat.id!); }}
                className="opacity-0 group-hover:opacity-100 max-md:opacity-60 text-red-400 hover:text-red-300 text-xs transition-opacity"
                title="删除"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {allChats.length > 0 && (
          <div className="p-2 border-t border-slate-700">
            <button
              onClick={handleClearAll}
              className="w-full text-xs text-red-400 hover:text-red-300 py-1.5 rounded hover:bg-red-900/20 transition-colors"
            >
              清空所有记录
            </button>
          </div>
        )}
      </aside>

      {/* ── Main: Chat ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="shrink-0 px-4 sm:px-6 py-3 border-b border-slate-700 flex items-center gap-3">
          {/* Mobile: history toggle */}
          <button
            onClick={() => setHistoryOpen(true)}
            className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="历史记录"
          >
            <History size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold text-white truncate">
              {currentChatId ? allChats.find(c => c.id === currentChatId)?.title || '对话' : 'AI 创作助手'}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5 hidden sm:block">
              和 AI 助手聊天，收集灵感、打磨设定、优化内容
            </p>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-4 space-y-3 sm:space-y-4">
            {messages.length === 0 && !isStreaming && (
              <div className="text-center py-12 sm:py-16">
                <p className="text-slate-500 text-sm mb-4 sm:mb-6">向 AI 助手提问关于角色卡创作的任何问题</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg mx-auto px-2">
                  {quickPrompts.map((hint) => (
                    <button
                      key={hint}
                      onClick={() => { setInputValue(hint); inputRef.current?.focus(); }}
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
                    ? 'bg-indigo-600 text-white'
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
                ref={(el) => { textareaRef(el); (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el; }}
                className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 sm:px-4 py-2 sm:py-2.5 text-sm text-slate-100
                  placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
                  resize-none min-h-[38px] sm:min-h-[42px] max-h-[160px]"
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  textareaRef(e.currentTarget);
                }}
                onKeyDown={handleKeyDown}
                placeholder="说说你的创作问题，Shift+Enter 换行..."
                disabled={isStreaming}
                rows={1}
              />
              <Button
                onClick={handleSend}
                disabled={!inputValue.trim() || isStreaming}
              >
                {isStreaming ? '...' : '发送'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
