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
  /** Writing presets are useful for creative generation, but harmful for strict analysis/translation JSON tasks. */
  presetMode?: 'force' | 'none';
}

interface AIRequestPayload {
  messages: AIMessage[];
  apiUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  max_tokens: number;
}

const PRESET_HEADER = '## 写卡预设规则（必须严格遵守）';
const DEFAULT_MODEL = 'gpt-3.5-turbo';
const MAX_RETRIES_CAP = 8;
const MAX_CONTINUATION_ROUNDS = 4;

const CONTINUE_USER_MSG = `你的回答因为长度限制在上一条被截断了。请**从中断处直接继续输出**，不要重复已经输出过的内容，不要加任何前缀说明，不要重新开始。直接输出剩余部分即可。如果输出的是JSON，请确保最终拼合后是合法的JSON。`;

const CONTINUE_USER_MSG_JSON = `你的回答因为长度限制在上一条被截断了（在JSON中间断开）。请**从中断处直接继续输出剩余的JSON内容**，不要重复已经输出过的内容，不要加任何前缀、解释或markdown代码块标记。直接从断点位置继续输出，确保最终拼合后是一个合法完整的JSON。`;

const CONTINUE_TAIL_SIZE = 800;

function buildContinuationMessages(
  originalSystemPrompt: string,
  fullContent: string,
  lastSegment: string,
  isJson: boolean,
): AIMessage[] {
  const tail = lastSegment.length > CONTINUE_TAIL_SIZE
    ? lastSegment.slice(-CONTINUE_TAIL_SIZE)
    : lastSegment;

  const contextHint = isJson
    ? `以下是之前已经生成的JSON内容（末尾可能不完整），请从中断处直接继续输出：\n\n${tail}`
    : `以下是之前已经生成内容的末尾片段，请从中断处直接继续输出，不要重复已有的内容：\n\n${tail}`;

  return [
    { role: 'system', content: originalSystemPrompt },
    { role: 'user', content: contextHint },
    { role: 'assistant', content: tail },
    { role: 'user', content: isJson ? CONTINUE_USER_MSG_JSON : CONTINUE_USER_MSG },
  ];
}

function looksLikeJsonStart(text: string): boolean {
  let trimmed = text.trimStart();
  const fenceMatch = trimmed.match(/^```(?:json|JSON)?\s*\n?/);
  if (fenceMatch) {
    trimmed = trimmed.slice(fenceMatch[0].length).trimStart();
  }
  return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.includes('"entries"') || trimmed.includes('"content"') || trimmed.includes('"description"');
}

/**
 * Heuristic: check if the content looks incomplete/truncated.
 * Used as a fallback when finish_reason is missing (e.g., connection cut off by timeout).
 */
function looksTruncated(text: string): boolean {
  if (!text || text.length < 50) return true;

  let content = text.trimEnd();

  // Strip markdown code fence if present
  const fenceMatch = content.match(/^```(?:json|JSON)?\s*\n?/);
  if (fenceMatch) content = content.slice(fenceMatch[0].length);
  const trailingFence = content.match(/\n?```\s*$/);
  if (trailingFence) content = content.slice(0, -trailingFence[0].length);
  content = content.trimEnd();

  if (!content) return true;

  // Check for unclosed JSON brackets/braces
  if (looksLikeJsonStart(text)) {
    let braceCount = 0;
    let bracketCount = 0;
    let inString = false;
    let escape = false;
    for (const ch of content) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') braceCount++;
      else if (ch === '}') braceCount--;
      else if (ch === '[') bracketCount++;
      else if (ch === ']') bracketCount--;
    }
    // If brackets/braces are not balanced, JSON is incomplete
    if (braceCount > 0 || bracketCount > 0) return true;
  }

  // Check for sentence-incomplete endings (Chinese + English)
  const lastChar = content.slice(-1);
  const endPunctuation = /[。！？….!?\n"」』”’）)\]】}]/;

  // If ending with a connecting word/punctuation that suggests continuation
  const incompleteEndings = /[，、：；,;:（(\[{【「『“`…—\-]$/;
  if (incompleteEndings.test(lastChar)) return true;

  // If not ending with terminal punctuation AND last segment is short (< 20 chars),
  // likely truncated mid-sentence
  if (!endPunctuation.test(lastChar)) {
    const lastSegment = content.split(/\n/).pop() || '';
    if (lastSegment.length < 20) return true;
    // If last line looks like it was cut off mid-word (no ending punctuation in last 50 chars)
    const tail = content.slice(-50);
    if (!endPunctuation.test(tail) && tail.length >= 50) return true;
  }

  return false;
}

function shouldContinue(finishReason: string | null, content: string): boolean {
  if (finishReason === 'length') return true;
  // If no finish_reason received (connection cut), use heuristic
  if (finishReason === null || finishReason === '') {
    return looksTruncated(content);
  }
  return false;
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
function injectPreset(messages: AIMessage[], presetMode: AIRequestOptions['presetMode'] = 'force'): AIMessage[] {
  if (presetMode === 'none') return messages;

  const presetText = getActivePresetsText();
  if (!presetText) return messages;

  const presetSection = `${PRESET_HEADER}\n\n${presetText}`;
  const firstSystemIndex = messages.findIndex(msg => msg.role === 'system');

  if (firstSystemIndex === -1) {
    return [{ role: 'system', content: presetSection }, ...messages];
  }

  return messages.map((m, i) => {
    if (i === firstSystemIndex) {
      return {
        ...m,
        content: `${m.content}\n\n${presetSection}`,
      };
    }
    return m;
  });
}

function clampRetryCount(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) return 3;
  return Math.min(Math.max(Math.floor(value), 0), MAX_RETRIES_CAP);
}

function retryDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 10000);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  // Retry on empty response errors (up to max retries)
  if (err instanceof Error && (
    err.message.includes('AI 返回了空内容') ||
    err.message.includes('AI 响应没有内容')
  )) return true;
  // Retry on API errors that might be transient
  if (err instanceof Error && err.message.includes('AI API 返回错误')) return true;
  return false;
}

function normalizeMaxTokens(maxTokens: number | undefined): number {
  // 默认值提高到 8000，避免输出被截断
  const value = Math.floor(maxTokens ?? 8000);
  return Math.max(1, value);
}

async function buildPayload(options: AIRequestOptions): Promise<{ payload: AIRequestPayload; maxRetries: number }> {
  const settings = await getAISettings();
  const apiUrl = settings.apiUrl?.trim();

  if (!apiUrl) {
    throw new Error('请先在 AI 设置中填写 API 地址');
  }

  return {
    payload: {
      messages: injectPreset(options.messages, options.presetMode),
      apiUrl: normalizeApiUrl(apiUrl),
      apiKey: settings.apiKey,
      model: settings.model?.trim() || DEFAULT_MODEL,
      temperature: options.temperature ?? settings.temperature,
      max_tokens: normalizeMaxTokens(options.max_tokens ?? settings.maxTokens),
    },
    maxRetries: clampRetryCount(settings.retryCount),
  };
}

async function readProxyError(response: Response, fallback: string): Promise<string> {
  const raw = await response.text().catch(() => '');
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as { error?: string; details?: string };
    const detail = parsed.details ? `：${parsed.details.slice(0, 300)}` : '';
    return `${parsed.error || fallback}${detail}`;
  } catch {
    return `${fallback}：${raw.slice(0, 300)}`;
  }
}

function textFromContentParts(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object') {
        const record = part as Record<string, unknown>;
        return typeof record.text === 'string'
          ? record.text
          : typeof record.content === 'string'
            ? record.content
            : '';
      }
      return '';
    })
    .join('');
}

function extractAIContent(data: unknown): string {
  const record = data as Record<string, unknown>;
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const firstChoice = choices[0] as Record<string, unknown> | undefined;
  const message = firstChoice?.message as Record<string, unknown> | undefined;

  const content =
    textFromContentParts(message?.content) ||
    textFromContentParts(firstChoice?.text) ||
    textFromContentParts(record?.output_text) ||
    textFromContentParts((record?.message as Record<string, unknown> | undefined)?.content);

  return content.trim();
}

function extractFinishReason(data: unknown): string | null {
  const record = data as Record<string, unknown>;
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const firstChoice = choices[0] as Record<string, unknown> | undefined;
  const reason = firstChoice?.finish_reason;
  return typeof reason === 'string' ? reason : null;
}

interface SingleCallResult {
  content: string;
  finishReason: string | null;
}

async function callAIOnce(payload: AIRequestPayload, maxRetries: number): Promise<SingleCallResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errMsg = await readProxyError(response, `AI API 调用失败 (${response.status})`);

        if (attempt < maxRetries && isRetryableStatus(response.status)) {
          lastError = new Error(errMsg);
          await new Promise(r => setTimeout(r, retryDelay(attempt)));
          continue;
        }
        throw new Error(errMsg);
      }

      const data = await response.json();
      const content = extractAIContent(data);
      const finishReason = extractFinishReason(data);
      if (!content) {
        throw new Error('AI 响应没有内容，模型可能拒绝了请求');
      }
      return { content, finishReason };
    } catch (err: unknown) {
      if (attempt < maxRetries && isRetryableError(err)) {
        lastError = err instanceof Error ? err : new Error('网络请求失败');
        await new Promise(r => setTimeout(r, retryDelay(attempt)));
        continue;
      }
      if (err instanceof Error && err.message.includes('请先在')) throw err;
      throw err;
    }
  }

  throw lastError || new Error('AI 调用失败，已重试 ' + maxRetries + ' 次');
}

/**
 * Call the AI API through the Express proxy (non-streaming).
 * Credentials are read from IndexedDB and forwarded to the backend proxy.
 * Automatically retries on transient failures (5xx, network errors, 429 rate limit).
 * Automatically continues generation if finish_reason === "length" (token limit hit).
 */
export async function callAI(options: AIRequestOptions): Promise<string> {
  const { payload: initialPayload, maxRetries } = await buildPayload(options);

  const originalSystemPrompt = (initialPayload.messages.find(m => m.role === 'system')?.content) || '';
  let fullContent = '';
  let lastSegment = '';
  let continuationRounds = 0;

  // First call: use full original messages
  const firstResult = await callAIOnce(initialPayload, maxRetries);
  fullContent = firstResult.content;
  lastSegment = firstResult.content;
  let lastFinishReason = firstResult.finishReason;

  while (shouldContinue(lastFinishReason, fullContent) && continuationRounds < MAX_CONTINUATION_ROUNDS) {
    continuationRounds++;
    const isJson = looksLikeJsonStart(fullContent);
    const continueMsgs = buildContinuationMessages(originalSystemPrompt, fullContent, lastSegment, isJson);

    const continuePayload: AIRequestPayload = {
      ...initialPayload,
      messages: continueMsgs,
    };

    try {
      console.info(`[AI] 输出可能被截断（finish_reason=${lastFinishReason || 'unknown'}），自动续写第 ${continuationRounds} 轮...`);
      const result = await callAIOnce(continuePayload, maxRetries);
      fullContent += result.content;
      lastSegment = result.content;
      lastFinishReason = result.finishReason;
    } catch (err) {
      console.warn(`[AI] 续写第 ${continuationRounds} 轮失败，返回已有内容：`, err);
      break;
    }
  }

  if (shouldContinue(lastFinishReason, fullContent)) {
    console.warn(`[AI] 已达到最大续写轮数（${MAX_CONTINUATION_ROUNDS}轮），输出可能仍然不完整。建议调大最大Token数或检查网络/超时设置。`);
  }

  return fullContent;
}

/**
 * Callback for streaming progress.
 */
export type StreamCallback = (chunk: string, fullText: string) => void;

interface StreamCallResult {
  fullText: string;
  finishReason: string | null;
}

async function streamAIOnce(
  payload: AIRequestPayload,
  maxRetries: number,
  onChunk: StreamCallback,
  existingFullText: string = '',
): Promise<StreamCallResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('/api/ai/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errMsg = await readProxyError(response, `AI API 流式调用失败 (${response.status})`);

        if (attempt < maxRetries && isRetryableStatus(response.status)) {
          lastError = new Error(errMsg);
          await new Promise(r => setTimeout(r, retryDelay(attempt)));
          continue;
        }
        throw new Error(errMsg);
      }

      if (!response.body) {
        throw new Error('AI 流式响应为空');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';
      let receivedAnyData = false;
      let finishReason: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trimEnd();
          if (!line) continue;

          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data === '[DONE]') {
              if (!fullText.trim()) {
                throw new Error('AI 返回了空内容（流式响应无数据）');
              }
              return { fullText, finishReason };
            }
            try {
              const parsed = JSON.parse(data);

              if (parsed.error) {
                const errMsg = typeof parsed.error === 'string'
                  ? parsed.error
                  : (parsed.error as Record<string, unknown>)?.message || JSON.stringify(parsed.error);
                throw new Error(`AI API 返回错误：${errMsg}`);
              }

              const choice = parsed.choices?.[0];
              // Capture finish_reason if present
              if (choice?.finish_reason && typeof choice.finish_reason === 'string') {
                finishReason = choice.finish_reason;
              }

              const content =
                textFromContentParts(choice?.delta?.content) ||
                textFromContentParts(choice?.message?.content) ||
                textFromContentParts(choice?.delta?.text) ||
                textFromContentParts(choice?.text) ||
                textFromContentParts(parsed.text) ||
                textFromContentParts(parsed.output_text) ||
                textFromContentParts(parsed.response);

              if (content) {
                receivedAnyData = true;
                fullText += content;
                onChunk(content, existingFullText + fullText);
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message.startsWith('AI API 返回错误')) {
                throw parseErr;
              }
              // skip other malformed JSON
            }
          }
        }
      }

      if (!fullText.trim()) {
        throw new Error('AI 返回了空内容（流结束但无数据）');
      }
      return { fullText, finishReason };
    } catch (err: unknown) {
      if (attempt < maxRetries && isRetryableError(err)) {
        lastError = err instanceof Error ? err : new Error('网络请求失败');
        await new Promise(r => setTimeout(r, retryDelay(attempt)));
        continue;
      }
      if (err instanceof Error && err.message.includes('请先在')) throw err;
      throw err;
    }
  }

  throw lastError || new Error('AI 流式调用失败，已重试 ' + maxRetries + ' 次');
}

/**
 * Call AI with streaming via Server-Sent Events.
 * Returns a Promise that resolves with the full text when streaming completes.
 * The onChunk callback is called with each new token as it arrives.
 * Retries on transient connection failures before the stream starts.
 * Automatically continues generation if finish_reason === "length" (token limit hit).
 */
export async function callAIStreaming(
  options: AIRequestOptions,
  onChunk: StreamCallback,
): Promise<string> {
  const { payload: initialPayload, maxRetries } = await buildPayload(options);

  const originalSystemPrompt = (initialPayload.messages.find(m => m.role === 'system')?.content) || '';
  let fullContent = '';
  let lastSegment = '';
  let continuationRounds = 0;

  // First call: use full original messages
  const firstResult = await streamAIOnce(initialPayload, maxRetries, onChunk, fullContent);
  fullContent = firstResult.fullText;
  lastSegment = firstResult.fullText;
  let lastFinishReason = firstResult.finishReason;

  while (shouldContinue(lastFinishReason, fullContent) && continuationRounds < MAX_CONTINUATION_ROUNDS) {
    continuationRounds++;
    const isJson = looksLikeJsonStart(fullContent);
    const continueMsgs = buildContinuationMessages(originalSystemPrompt, fullContent, lastSegment, isJson);

    const continuePayload: AIRequestPayload = {
      ...initialPayload,
      messages: continueMsgs,
    };

    try {
      console.info(`[AI] 流式输出可能被截断（finish_reason=${lastFinishReason || 'unknown'}），自动续写第 ${continuationRounds} 轮...`);
      const result = await streamAIOnce(continuePayload, maxRetries, onChunk, fullContent);
      fullContent += result.fullText;
      lastSegment = result.fullText;
      lastFinishReason = result.finishReason;
    } catch (err) {
      console.warn(`[AI] 流式续写第 ${continuationRounds} 轮失败，返回已有内容：`, err);
      break;
    }
  }

  if (shouldContinue(lastFinishReason, fullContent)) {
    console.warn(`[AI] 已达到最大续写轮数（${MAX_CONTINUATION_ROUNDS}轮），输出可能仍然不完整。建议调大最大Token数或检查网络/超时设置。`);
  }

  return fullContent;
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
    throw new Error(await readProxyError(response, `获取模型列表失败 (${response.status})`));
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
