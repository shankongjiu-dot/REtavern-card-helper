/**
 * AI Service - client-side abstraction for calling the AI API via the Express proxy.
 * All AI calls go through POST /api/ai/chat or /api/ai/chat/stream to avoid CORS issues.
 * API credentials are stored locally and sent to the proxy per-request.
 *
 * URL normalization: Users only need to enter the base URL (e.g., https://api.openai.com/v1).
 * The system automatically appends /chat/completions or /models as needed.
 */
import { getAISettings } from '../db/database';
import { getActivePresetsText } from './preset-service';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIRequestOptions {
  messages: AIMessage[];
  temperature?: number;
  max_tokens?: number;
}

/**
 * Normalize an API URL by ensuring it ends with /chat/completions.
 * Handles various input formats:
 * - https://api.openai.com/v1 → https://api.openai.com/v1/chat/completions
 * - https://api.openai.com/v1/chat/completions → unchanged
 * - https://api.deepseek.com → https://api.deepseek.com/chat/completions
 */
export function normalizeApiUrl(baseUrl: string): string {
  const url = baseUrl.trim().replace(/\/+$/, ''); // remove trailing slashes

  // Already has the full path
  if (url.endsWith('/chat/completions')) {
    return url;
  }

  // Already has /completions (some APIs use this)
  if (url.endsWith('/completions')) {
    return url;
  }

  // Append /chat/completions
  return `${url}/chat/completions`;
}

/**
 * Derive the /models endpoint from a base URL.
 * - https://api.openai.com/v1 → https://api.openai.com/v1/models
 * - https://api.openai.com/v1/chat/completions → https://api.openai.com/v1/models
 */
export function deriveModelsUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');

  // Remove /chat/completions or /completions if present
  url = url.replace(/\/chat\/completions$/, '');
  url = url.replace(/\/completions$/, '');

  return `${url}/models`;
}

/**
 * Inject active preset rules into the first system message.
 * All AI calls go through this so every request carries writing preset context.
 */
function injectPreset(messages: AIMessage[]): AIMessage[] {
  const presetText = getActivePresetsText();
  if (!presetText) return messages;

  return messages.map((m, i) => {
    if (m.role === 'system' && i === messages.findIndex(msg => msg.role === 'system')) {
      return {
        ...m,
        content: `${m.content}\n\n## 写卡预设规则（必须严格遵守）\n\n${presetText}`,
      };
    }
    return m;
  });
}

/**
 * Call the AI API through the Express proxy (non-streaming).
 * Credentials are read from IndexedDB and forwarded to the backend proxy.
 * Automatically retries on transient failures (5xx, network errors, 429 rate limit).
 */
export async function callAI(options: AIRequestOptions): Promise<string> {
  const settings = await getAISettings();

  if (!settings.apiUrl) {
    throw new Error('请先在 AI 设置中填写 API 地址');
  }

  const messages = injectPreset(options.messages);
  const maxRetries = settings.retryCount ?? 3;

  const payload = {
    messages,
    apiUrl: normalizeApiUrl(settings.apiUrl),
    apiKey: settings.apiKey,
    model: settings.model,
    temperature: options.temperature ?? settings.temperature,
    max_tokens: options.max_tokens ?? settings.maxTokens,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        const errMsg = err.error || `AI API 调用失败 (${response.status})`;

        // Retry on 429 (rate limit) and 5xx (server errors)
        if (attempt < maxRetries && (response.status === 429 || response.status >= 500)) {
          lastError = new Error(errMsg);
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(errMsg);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('AI 响应没有内容，模型可能拒绝了请求');
      }
      return content;
    } catch (err: unknown) {
      // Retry on network errors (TypeError: Failed to fetch, etc.)
      if (attempt < maxRetries && err instanceof TypeError) {
        lastError = err;
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      // Don't retry on non-transient errors
      if (err instanceof Error && err.message.includes('请先在')) throw err;
      throw err;
    }
  }

  throw lastError || new Error('AI 调用失败，已重试 ' + maxRetries + ' 次');
}

/**
 * Callback for streaming progress.
 */
export type StreamCallback = (chunk: string, fullText: string) => void;

/**
 * Call AI with streaming via Server-Sent Events.
 * Returns a Promise that resolves with the full text when streaming completes.
 * The onChunk callback is called with each new token as it arrives.
 * Retries on transient connection failures before the stream starts.
 */
export async function callAIStreaming(
  options: AIRequestOptions,
  onChunk: StreamCallback,
): Promise<string> {
  const settings = await getAISettings();

  if (!settings.apiUrl) {
    throw new Error('请先在 AI 设置中填写 API 地址');
  }

  const messages = injectPreset(options.messages);
  const maxRetries = settings.retryCount ?? 3;

  const payload = {
    messages,
    apiUrl: normalizeApiUrl(settings.apiUrl),
    apiKey: settings.apiKey,
    model: settings.model,
    temperature: options.temperature ?? settings.temperature,
    max_tokens: options.max_tokens ?? settings.maxTokens,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('/api/ai/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        const errMsg = err.error || `AI API 流式调用失败 (${response.status})`;

        if (attempt < maxRetries && (response.status === 429 || response.status >= 500)) {
          lastError = new Error(errMsg);
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(errMsg);
      }

      // Stream established — no more retries from here
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              return fullText;
            }
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullText += content;
                onChunk(content, fullText);
              }
            } catch {
              // skip malformed JSON
            }
          }
        }
      }

      return fullText;
    } catch (err: unknown) {
      if (attempt < maxRetries && err instanceof TypeError) {
        lastError = err;
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (err instanceof Error && err.message.includes('请先在')) throw err;
      throw err;
    }
  }

  throw lastError || new Error('AI 流式调用失败，已重试 ' + maxRetries + ' 次');
}

/**
 * Fetch available models from the user's API endpoint (via backend proxy).
 * @returns Array of model objects { id, owned_by }
 */
export async function fetchModels(
  apiUrl: string,
  apiKey: string,
): Promise<Array<{ id: string; owned_by: string }>> {
  const response = await fetch('/api/ai/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiUrl: deriveModelsUrl(apiUrl),
      apiKey,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(err.error || `获取模型列表失败 (${response.status})`);
  }

  const data = await response.json();
  return data.models || [];
}

/**
 * Call AI with system + user message convenience wrapper.
 */
export async function callAIWithPrompt(
  system: string,
  user: string,
  options?: Partial<AIRequestOptions>,
): Promise<string> {
  return callAI({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...options,
  });
}

/**
 * Call AI with system + user message using streaming.
 * Returns full text and calls onChunk for each token.
 */
export async function callAIWithPromptStreaming(
  system: string,
  user: string,
  onChunk: StreamCallback,
  options?: Partial<AIRequestOptions>,
): Promise<string> {
  return callAIStreaming(
    {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...options,
    },
    onChunk,
  );
}
