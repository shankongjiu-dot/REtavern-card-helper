/**
 * useAIChat - manages test chat sessions with an AI character.
 * Handles message history, sending messages, and session persistence.
 */
import { useState, useCallback, useEffect } from 'react';
import { db } from '../db/database';
import { callAI } from '../services/ai-service';
import { buildSystemPrompt, buildPostHistoryInstructions } from '../services/prompt-builder';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface CardForChat {
  id?: number;
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    system_prompt: string;
    post_history_instructions: string;
    character_book?: {
      entries: Array<{
        keys: string[];
        content: string;
        name: string;
        enabled: boolean;
        constant: boolean;
        insertion_order: number;
      }>;
    };
  };
}

export function useAIChat(card: CardForChat | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize session when card changes
  useEffect(() => {
    if (!card) {
      setMessages([]);
      setSessionId(null);
      return;
    }

    (async () => {
      try {
        if (!card.id) {
          setMessages(card.data.first_mes ? [{ role: 'assistant', content: card.data.first_mes, timestamp: Date.now() }] : []);
          setSessionId(null);
          return;
        }
        // Try to find existing session for this card
        const existing = await db.chat_sessions
          .where('cardId')
          .equals(card.id)
          .last();

        if (existing) {
          setSessionId(existing.id ?? null);
          setMessages(existing.messages || []);
        } else {
          // Create new session with first message pre-loaded
          const initialMessages: ChatMessage[] = [];
          if (card.data.first_mes) {
            initialMessages.push({
              role: 'assistant',
              content: card.data.first_mes,
              timestamp: Date.now(),
            });
          }
          setMessages(initialMessages);
          setSessionId(null);
        }
      } catch (err) {
        console.error('Failed to load chat session:', err);
        setError('加载对话记录失败');
      }
    })();
  }, [card]);

  // Save session to DB
  const saveSession = useCallback(async (msgs: ChatMessage[]) => {
    if (!card?.id) return;

    try {
      const now = new Date();
      if (sessionId) {
        await db.chat_sessions.update(sessionId, { messages: msgs, updatedAt: now });
      } else {
        const id = await db.chat_sessions.add({
          cardId: card.id,
          messages: msgs,
          createdAt: now,
          updatedAt: now,
        });
        setSessionId(id ?? null);
      }
    } catch {
      // Silently fail session save
    }
  }, [card, sessionId]);

  /** Send a user message and get AI response */
  const sendMessage = useCallback(async (content: string) => {
    if (!card || sending) return;

    setError(null);

    // Add user message
    const userMsg: ChatMessage = { role: 'user', content, timestamp: Date.now() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    setSending(true);
    try {
      // Build system prompt from card
      const systemPrompt = buildSystemPrompt(card);

      // Assemble API messages: system + chat history
      const apiMessages: { role: string; content: string }[] = [
        { role: 'system', content: systemPrompt },
      ];

      // Add chat history (exclude system messages from display)
      for (const msg of updatedMessages) {
        if (msg.role !== 'system') {
          apiMessages.push({ role: msg.role, content: msg.content });
        }
      }

      const postHistoryInstructions = buildPostHistoryInstructions(card);
      if (postHistoryInstructions) {
        apiMessages.push({ role: 'system', content: postHistoryInstructions });
      }

      // Call AI
      const response = await callAI({ messages: apiMessages as { role: 'system' | 'user' | 'assistant'; content: string }[] });

      // Add assistant response
      const assistantMsg: ChatMessage = { role: 'assistant', content: response, timestamp: Date.now() };
      const finalMessages = [...updatedMessages, assistantMsg];
      setMessages(finalMessages);

      // Save session
      await saveSession(finalMessages);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '获取 AI 响应失败';
      setError(msg);
    } finally {
      setSending(false);
    }
  }, [card, messages, sending, saveSession]);

  /** Reset chat session */
  const resetSession = useCallback(async () => {
    if (sessionId) {
      await db.chat_sessions.delete(sessionId);
    }
    setSessionId(null);

    // Re-initialize with first message
    const initialMessages: ChatMessage[] = [];
    if (card?.data.first_mes) {
      initialMessages.push({
        role: 'assistant',
        content: card.data.first_mes,
        timestamp: Date.now(),
      });
    }
    setMessages(initialMessages);
    if (card?.id && initialMessages.length > 0) {
      const sessionData = {
        cardId: card.id,
        messages: initialMessages,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const id = await db.chat_sessions.put(sessionData);
      setSessionId(id ?? null);
    }
  }, [card, sessionId]);

  return { messages, sending, error, sendMessage, resetSession };
}
