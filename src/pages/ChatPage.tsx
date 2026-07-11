/**
 * ChatPage - Test chat with character cards.
 * Features: Card selection dropdown + chat window with message history.
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

  const selectedCard = selectedCardId
    ? (cards.find((c) => c.id === selectedCardId) as Record<string, unknown> | undefined) || null
    : null;

  const { messages, sending, error, sendMessage, resetSession } = useAIChat(
    selectedCard as Parameters<typeof useAIChat>[0],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!messageInput.trim() || sending) return;
    const msg = messageInput;
    setMessageInput('');
    await sendMessage(msg);
  };

  const borderColor = 'var(--color-border-default)';
  const mutedText = 'color-mix(in srgb, var(--text-color) 60%, transparent)';
  const faintText = 'color-mix(in srgb, var(--text-color) 40%, transparent)';

  return (
    <div className="animate-fade-in flex flex-col h-[calc(100dvh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0 flex-wrap gap-2">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-color)' }}>{t('chat.title')}</h1>
        <div className="flex gap-2 items-center">
          <select
            value={selectedCardId ?? ''}
            onChange={(e) => setSelectedCardId(e.target.value ? parseInt(e.target.value) : null)}
            className="rounded-lg border px-3 py-2 text-sm min-w-[200px]"
            style={{ borderColor, backgroundColor: 'var(--input-bg)', color: 'var(--text-color)' }}
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

      {/* No card selected */}
      {!selectedCard && (
        <div className="flex-1 flex items-center justify-center border border-dashed rounded-xl" style={{ borderColor }}>
          <div className="text-center">
            <p className="text-lg mb-2" style={{ color: mutedText }}>{t('chat.noCardTitle')}</p>
            <p className="text-sm mb-4" style={{ color: faintText }}>{t('chat.noCardSubtitle')}</p>
            <button
              onClick={() => navigate('/settings')}
              className="text-xs text-primary-muted hover:text-primary-bright underline"
            >
              {t('chat.gotoSettings')}
            </button>
          </div>
        </div>
      )}

      {/* Chat window */}
      {selectedCard && (
        <div
          className="flex-1 flex flex-col min-h-0 rounded-xl border"
          style={{ borderColor, backgroundColor: 'color-mix(in srgb, var(--color-surface-base) 50%, transparent)' }}
        >
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-8 text-sm" style={{ color: faintText }}>
                {t('chat.emptyMessages')}
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={`${msg.timestamp}-${msg.role}-${i}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-primary text-inverse'
                      : 'border'
                  }`}
                  style={msg.role !== 'user' ? {
                    backgroundColor: 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.8)',
                    borderColor,
                    color: 'var(--text-color)',
                  } : undefined}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div
                  className="rounded-xl border px-4 py-3 text-sm"
                  style={{
                    backgroundColor: 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.8)',
                    borderColor,
                    color: mutedText,
                  }}
                >
                  <span className="animate-pulse">{t('chat.thinking')}</span>
                </div>
              </div>
            )}
            {error && (
              <div className="flex justify-center">
                <div className="rounded-lg px-4 py-2 text-sm" style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-status-danger) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-status-danger) 35%, transparent)',
                  color: 'var(--color-status-danger)',
                }}>
                  {t('chat.error', { message: error })}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="shrink-0 border-t px-4 py-3" style={{ borderColor }}>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                style={{
                  borderColor,
                  backgroundColor: 'var(--input-bg)',
                  color: 'var(--text-color)',
                }}
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
