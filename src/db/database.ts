/**
 * Dexie.js database schema for Tavern Card Helper.
 * Tables:
 *   - cards: Character card library (Tavern V2 spec)
 *   - chat_sessions: Test chat conversation history
 *   - ai_settings: AI backend configuration (singleton, id=1)
 */
import Dexie, { type EntityTable } from 'dexie';

interface CardRecord {
  id?: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  /** Soft delete timestamp — null means not deleted */
  deletedAt?: Date | null;
  [key: string]: unknown; // Allow dynamic V2 spec fields
}

interface ChatSession {
  id?: number;
  cardId: number;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: number }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatorChat {
  id?: number;
  title: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AISettings {
  id: number;
  apiUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  /** Whether the key has been verified (models fetched successfully) */
  keyVerified: boolean;
  /** Max retry attempts for transient API failures (0 = no retry) */
  retryCount: number;
}

/** Auto-saved or manually-saved wizard draft (survives page navigation) */
export interface WizardDraftRecord {
  id: string;
  data: unknown;
  currentStep: number;
  version?: number;
  updatedAt: Date;
  /** Display name for manually saved drafts */
  name?: string;
}

export const db = new Dexie('TavernCardHelper') as Dexie & {
  cards: EntityTable<CardRecord, 'id'>;
  chat_sessions: EntityTable<ChatSession, 'id'>;
  ai_settings: EntityTable<AISettings, 'id'>;
  creator_chats: EntityTable<CreatorChat, 'id'>;
  wizard_drafts: EntityTable<WizardDraftRecord, 'id'>;
};

db.version(5).stores({
  cards: '++id, name, updatedAt, createdAt, deletedAt',
  chat_sessions: '++id, cardId',
  ai_settings: 'id',
  creator_chats: '++id, updatedAt',
  wizard_drafts: 'id',
});

/**
 * Mask an API key for display. Shows first 3 + last 4 chars, rest as ••••
 * e.g. "sk-abc123def456xyz" → "sk-••••xyz"
 */
export function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return '••••••••';
  return key.slice(0, 3) + '••••' + key.slice(-4);
}

/**
 * Get or create AI settings singleton.
 */
export async function getAISettings(): Promise<AISettings> {
  let settings = await db.ai_settings.get(1);
  if (!settings) {
    settings = {
      id: 1,
      apiUrl: 'https://api.openai.com/v1/chat/completions',
      apiKey: '',
      model: 'gpt-3.5-turbo',
      maxTokens: 8000, // 提高默认值，避免输出被截断
      temperature: 0.8,
      keyVerified: false,
      retryCount: 3,
    };
    await db.ai_settings.put(settings);
  }
  return settings;
}

/**
 * Save AI settings (updates the singleton record).
 */
export async function saveAISettings(settings: Partial<AISettings>): Promise<AISettings> {
  const current = await getAISettings();
  const updated = { ...current, ...settings };
  await db.ai_settings.put(updated);
  return updated;
}
