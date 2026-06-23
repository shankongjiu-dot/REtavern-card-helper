/**
 * ChatPage - Test chat with character cards.
 * Features: Card selection dropdown + chat window with message history.
 * API settings have been moved to /settings page.
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCardLibrary } from '../hooks/useCardLibrary';
import { useAIChat } from '../hooks/useAIChat';
import { Button } from '../components/shared/Button';
import { useTranslation } from '../i18n/I18nContext';

export function ChatPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { cards } = useCardLibrary();
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Get selected card ────────────────────────────────────────────────────
  const selectedCard = selectedCardId
    ? (cards.find((c) => c.id === selectedCardId) as Record<string, unknown> | undefined) || null
    : null;

  // ── Chat hook ────────────────────────────────────────────────────────────
  const { messages, sending, error, sendMessage, resetSession } = useAIChat(
    selectedCard as Parameters<typeof useAIChat>[0],
  );

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!messageInput.trim() || sending) return;
    const msg = messageInput;
    setMessageInput('');
    await sendMessage(msg);
  };

  return (
    <div className="animate-fade-in flex flex-col h-[calc(100dvh-4rem)]">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 shrink-0 flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-white">{t('chat.title')}</h1>
        <div className="flex gap-2 items-center">
          <select
            value={selectedCardId ?? ''}
            onChange={(e) => setSelectedCardId(e.target.value ? parseInt(e.target.value) : null)}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 min-w-[200px]"
          >
            <option value="">{t('chat.selectCard')}</option>
            {cards.map((card) => (
              <option key={card.id} value={card.id}>
                {card.name || t('chat.untitled')}
              </option>
            ))}
          </select>
          {selectedCardId && (
            <Button variant="ghost" size="sm" onClick={resetSession}>
              🔄 {t('chat.reset')}
            </Button>
          )}
        </div>
      </div>

      {/* ── No card selected ───────────────────────────────────────────────── */}
      {!selectedCard && (
        <div className="flex-1 flex items-center justify-center border border-dashed border-slate-700 rounded-xl">
          <div className="text-center">
            <p className="text-slate-400 text-lg mb-2">{t('chat.noCardTitle')}</p>
            <p className="text-slate-500 text-sm mb-4">{t('chat.noCardSubtitle')}</p>
            <button
              onClick={() => navigate('/settings')}
              className="text-xs text-indigo-400 hover:text-indigo-300 underline"
            >
              {t('chat.gotoSettings')}
            </button>
          </div>
        </div>
      )}

      {/* ── Chat window ────────────────────────────────────────────────────── */}
      {selectedCard && (
        <div className="flex-1 flex flex-col min-h-0 rounded-xl border border-slate-700 bg-slate-900/50 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-8 text-slate-500 text-sm">
                {t('chat.emptyMessages')}
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap
                    ${msg.role === 'user'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 border border-slate-700 text-slate-200'
                    }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-400">
                  <span className="animate-pulse">{t('chat.thinking')}</span>
                </div>
              </div>
            )}
            {error && (
              <div className="flex justify-center">
                <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-2 text-sm text-red-300">
                  {t('chat.error', { message: error })}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="shrink-0 border-t border-slate-700 px-4 py-3">
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                placeholder={t('chat.inputPlaceholder')}
                disabled={sending}
              />
              <Button onClick={handleSend} disabled={sending || !messageInput.trim()}>
                {t('chat.send')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
