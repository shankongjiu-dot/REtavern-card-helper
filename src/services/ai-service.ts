/**
 * AI Service - client-side abstraction for calling the AI API via the Express proxy.
 * All AI calls go through POST /api/ai/chat or /api/ai/chat/stream to avoid CORS issues.
 * API credentials are stored locally and sent to the proxy per-request.
 *
 * URL normalization: Users only need to enter the base URL (e.g., https://api.openai.com/v1).
 * The system automatically appends /chat/completions or /models as needed.
 */
import { getAISettings } from '../db/database';
import { getActivePresetMessages, isPrefillEnabled } from './preset-service';
import { logger } from './logger';

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

// ── 生成取消 ────────────────────────────────────────────────────────────────
// 单点取消设计：所有 AI 请求经 beginCancellableRequest 注册模块级控制器，
// cancelActiveAIRequests() 一键中止全部在途请求——九个生成入口无需各自穿线
// AbortSignal（服务端代理本就实现了超时用的 AbortController，断点只在前端这一处）。

/** 用户主动停止生成时抛出的错误。UI 层可据此与真实失败区分（不弹红色错误）。 */
export class AIGenerationCancelledError extends Error {
  constructor() {
    super('已停止生成');
    this.name = 'AIGenerationCancelledError';
  }
}

const activeControllers = new Set<AbortController>();

// 取消纪元：每次 cancelActiveAIRequests 递增。调用在开始时记录当时纪元，
// 重试退避 sleep 之后复查——否则停止若恰好落在 sleep 期间（429 风暴下大部分
// 墙钟时间都在退避里），abort 打在已消费完的旧 controller 上是空操作，
// 睡醒后会用全新 controller 照常重发请求（「停止失灵」窗口）。
let cancelEpoch = 0;

/** 取消全部在途 AI 请求。返回被取消的请求数。 */
export function cancelActiveAIRequests(): number {
  cancelEpoch++;
  const count = activeControllers.size;
  for (const controller of activeControllers) {
    controller.abort();
  }
  activeControllers.clear();
  return count;
}

/**
 * 开启一次可取消的请求周期。signal 需同时覆盖 fetch 握手与响应体读取
 * （流式 SSE 的 reader.read() 也要能被中止），所以 release 必须在
 * **整个响应消费完毕**后调用，而不是 fetch resolve 时。
 */
function beginCancellableRequest(): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController();
  activeControllers.add(controller);
  return {
    signal: controller.signal,
    release: () => activeControllers.delete(controller),
  };
}
const DEFAULT_MODEL = 'gpt-3.5-turbo';
const MAX_RETRIES_CAP = 8;
const MAX_CONTINUATION_ROUNDS = 4;

const CONTINUE_USER_MSG = `你的回答因为长度限制在上一条被截断了。请**从中断处直接继续输出**，不要重复已经输出过的内容，不要加任何前缀说明，不要重新开始。直接输出剩余部分即可。如果输出的是JSON，请确保最终拼合后是合法的JSON。`;

const CONTINUE_USER_MSG_JSON = `你的回答因为长度限制在上一条被截断了（在JSON中间断开）。请**从中断处直接继续输出剩余的JSON内容**，不要重复已经输出过的内容，不要加任何前缀、解释或markdown代码块标记。直接从断点位置继续输出，确保最终拼合后是一个合法完整的JSON。`;

const CONTINUE_TAIL_SIZE = 800;

/**
 * 道歉前缀检测正则：匹配开头的道歉词或"作为AI"式元评论。
 * 只检测开头（trimStart 后），避免误删正文里 legitimately 出现的道歉词。
 */
const APOLOGY_START_REGEX = /^(?:抱歉|对不起|不好意思|我很抱歉|很抱歉|非常抱歉|十分抱歉|歉意|歉疚|遗憾|作为AI|作为人工智能|作为模型|作为一个AI|I'm sorry|Sorry|Apologies|My apologies|I apologize)[，,。.！!?\s]/i;

/**
 * 检测并剥离开头道歉段落。
 *
 * 模型有时无视预设规则，在正文前加一段"抱歉，我无法..."。
 * 这个函数后处理剥离道歉，让用户看到干净内容，并避免续写时模型看到自己的道歉
 * 而延续姿态（道歉惯性）。
 *
 * 剥离策略（按优先级）：
 * 1. 找到双换行（段落分隔），剥离道歉段落
 * 2. 找到 JSON 起始符 { 或 [
 * 3. 找到 Markdown 标题 ##
 * 4. 找到代码块起始 ```
 * 5. 找到第一个句号（单句道歉）
 *
 * 只有剥离后剩余内容 >50 字符才剥离，避免把整条都是道歉的回复删空。
 * 如果整条都是道歉（无正文），返回原文——有内容比空内容好，由调用方处理。
 */
/** 检测并剥离 AI 回复开头的道歉段落（导出供卡片清理工具复用） */
export function stripApologyPrefix(content: string): string {
  const trimmed = content.trimStart();
  if (!APOLOGY_START_REGEX.test(trimmed)) return content;

  // 在前 500 字符内寻找正文起始边界
  const searchRegion = trimmed.slice(0, 500);

  // 1. 双换行（段落分隔）
  const doubleNl = searchRegion.indexOf('\n\n');
  if (doubleNl !== -1) {
    const after = trimmed.slice(doubleNl + 2).trimStart();
    if (after.length > 50) {
      logger.info(`[AI] 检测到开头道歉，已剥离 ${doubleNl + 2} 字符`);
      return after;
    }
  }

  // 2. JSON 起始符
  const jsonIdx = searchRegion.search(/[{[]/);
  if (jsonIdx > 0) {
    const after = trimmed.slice(jsonIdx);
    if (after.length > 50) {
      logger.info(`[AI] 检测到开头道歉，已剥离 ${jsonIdx} 字符（JSON 边界）`);
      return after;
    }
  }

  // 3. Markdown 标题
  const headerIdx = searchRegion.search(/^##\s/m);
  if (headerIdx > 0) {
    const after = trimmed.slice(headerIdx);
    if (after.length > 50) {
      logger.info(`[AI] 检测到开头道歉，已剥离 ${headerIdx} 字符（标题边界）`);
      return after;
    }
  }

  // 4. 代码块起始
  const codeIdx = searchRegion.search(/^```/m);
  if (codeIdx > 0) {
    const after = trimmed.slice(codeIdx);
    if (after.length > 50) {
      logger.info(`[AI] 检测到开头道歉，已剥离 ${codeIdx} 字符（代码块边界）`);
      return after;
    }
  }

  // 5. 单换行（有些道歉只占一行）
  const singleNl = searchRegion.indexOf('\n');
  if (singleNl > 0 && singleNl < 300) {
    const after = trimmed.slice(singleNl + 1).trimStart();
    if (after.length > 50) {
      logger.info(`[AI] 检测到开头道歉，已剥离 ${singleNl + 1} 字符（单行）`);
      return after;
    }
  }

  // 6. 第一个句号（单句道歉）
  const sentenceEnd = searchRegion.search(/[。.！!]/);
  if (sentenceEnd > 0 && sentenceEnd < 300) {
    const after = trimmed.slice(sentenceEnd + 1).trimStart();
    if (after.length > 50) {
      logger.info(`[AI] 检测到开头道歉，已剥离 ${sentenceEnd + 1} 字符（句号边界）`);
      return after;
    }
  }

  // 无法安全剥离（可能整条都是道歉），返回原文
  logger.warn(`[AI] 检测到开头道歉但无法安全剥离（剩余内容不足 50 字符），保留原文`);
  return content;
}

function buildContinuationMessages(
  originalSystemPrompt: string,
  _fullContent: string,
  lastSegment: string,
  isJson: boolean,
): AIMessage[] {
  // 剥离 tail 开头的道歉：如果上一段以道歉开头，续写时模型会看到自己的道歉先例
  // 而延续姿态（道歉惯性）。剥离后模型只看到正文 tail，不会"接力"道歉。
  const cleanSegment = stripApologyPrefix(lastSegment);
  const tail = cleanSegment.length > CONTINUE_TAIL_SIZE
    ? cleanSegment.slice(-CONTINUE_TAIL_SIZE)
    : cleanSegment;

  const contextHint = isJson
    ? `以下是之前已经生成的JSON内容（末尾可能不完整），请从中断处直接继续输出：\n\n${tail}`
    : `以下是之前已经生成内容的末尾片段，请从中断处直接继续输出，不要重复已有的内容：\n\n${tail}`;

  // 续写时强化反道歉/反元评论：模型看到自己前文（tail）的道歉/警告会延续姿态，
  // 必须显式提醒"即使前文有这些，续写也不得包含"。这是道歉惯性的根因修复。
  const continuationReminder = `\n\n# 续写注意（不可违反）
你正在续写之前被截断的内容。即使前文（tail）出现道歉、警告、元评论或道德说教，本次续写也不得包含这些内容。
- 禁止道歉（"抱歉""对不起""不好意思"等），即使前文已经道歉过。
- 禁止回应或解释前文的道歉。
- 直接从中断处继续输出正文，仿佛道歉从未发生过。`;

  return [
    { role: 'system', content: originalSystemPrompt + continuationReminder },
    { role: 'user', content: contextHint },
    { role: 'assistant', content: tail },
    { role: 'user', content: isJson ? CONTINUE_USER_MSG_JSON : CONTINUE_USER_MSG },
  ];
}

/**
 * 宽松剥离 markdown 代码围栏：开围栏与闭围栏各自独立处理，缺一不可时也能剥离。
 *
 * 注意：这里不能改用 ai-json 的 stripMarkdownFences。那个版本要求开闭围栏成对
 * （`^``` … ```$`），而本文件的职责恰恰是判断「输出是否被截断」——被截断的内容
 * 通常只有开围栏没有闭围栏。成对匹配会让这类内容的围栏残留下来，把后面的括号
 * 配平计数算错，反而破坏截断检测。
 */
function stripLooseFences(text: string): string {
  return text
    .replace(/^```(?:json|JSON)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '');
}

function looksLikeJsonStart(text: string): boolean {
  const trimmed = stripLooseFences(text.trimStart()).trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.includes('"entries"') || trimmed.includes('"content"') || trimmed.includes('"description"');
}

/**
 * Heuristic: check if the content looks incomplete/truncated.
 * Used as a fallback when finish_reason is missing (e.g., connection cut off by timeout).
 */
function looksTruncated(text: string): boolean {
  if (!text || text.length < 50) {
    // 短内容可能是合法的紧凑 JSON，先尝试解析
    if (text) {
      try {
        // 原先这里用 /^```json?\n?/，"json?" 只让结尾的 n 可选，既漏掉裸 ``` 围栏
        // 又会匹配 ```jso 这种不存在的写法，统一到 stripLooseFences 顺带修正。
        JSON.parse(stripLooseFences(text.trim()));
        return false;
      } catch { /* not valid JSON, fall through to truncated */ }
    }
    return true;
  }

  // Strip markdown code fence if present
  const content = stripLooseFences(text.trimEnd()).trimEnd();

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
  const endPunctuation = /[。！？….!?\n"」』"'）)\]】}]/;

  // If ending with a connecting word/punctuation that suggests continuation
  const incompleteEndings = /[，、：；,;:（([{【「『"`…—-]$/;
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
function normalizeApiUrl(baseUrl: string): string {
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
function deriveModelsUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');

  // Remove /chat/completions or /completions if present
  url = url.replace(/\/chat\/completions$/, '');
  url = url.replace(/\/completions$/, '');

  return `${url}/models`;
}

/**
 * Inject active preset rules into the messages array.
 * - system-role prompts → appended to the first system message
 * - assistant-role prompts → inserted as a prefill message after the last user
 *   message (so the model "continues" from the committed stance).
 *
 * Prefill only injected when isPrefillEnabled() returns true, because some
 * providers (notably OpenAI native) don't support true assistant prefill
 * continuation and may echo the prefill text or behave unexpectedly.
 *
 * All AI calls go through this so every request carries preset context.
 */
function injectPreset(messages: AIMessage[], presetMode: AIRequestOptions['presetMode'] = 'force'): AIMessage[] {
  if (presetMode === 'none') return messages;

  const { systemText, prefillText } = getActivePresetMessages();
  if (!systemText && !prefillText) return messages;

  let result = messages;

  // 1. Inject system text into the first system message (or prepend a new one)
  if (systemText) {
    const presetSection = `${PRESET_HEADER}\n\n${systemText}`;
    const firstSystemIndex = result.findIndex(msg => msg.role === 'system');

    if (firstSystemIndex === -1) {
      result = [{ role: 'system', content: presetSection }, ...result];
    } else {
      result = result.map((m, i) => {
        if (i === firstSystemIndex) {
          return { ...m, content: `${m.content}\n\n${presetSection}` };
        }
        return m;
      });
    }
  }

  // 2. Inject assistant prefill after the last user message.
  //    Pattern: [system, ...history, user] → [system, ...history, user, assistant:prefill]
  //    The model treats the trailing assistant message as its own prior commitment
  //    and continues from there, significantly reducing refusal rates on models
  //    that support prefill (Claude / Gemini / GLM via OpenAI-compat proxies).
  if (prefillText && isPrefillEnabled()) {
    // Find the last user message index
    let lastUserIndex = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].role === 'user') {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex !== -1) {
      // Avoid stacking multiple prefills: if the message right after the last user
      // is already an assistant prefill (e.g., from a previous inject on retry),
      // replace it instead of adding another.
      const nextIndex = lastUserIndex + 1;
      const next = result[nextIndex];
      if (next && next.role === 'assistant') {
        result = [
          ...result.slice(0, nextIndex),
          { role: 'assistant', content: prefillText },
          ...result.slice(nextIndex + 1),
        ];
      } else {
        result = [
          ...result.slice(0, lastUserIndex + 1),
          { role: 'assistant', content: prefillText },
          ...result.slice(lastUserIndex + 1),
        ];
      }
    }
  }

  return result;
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
  // 内容审查拦截不可重试——重试只会再次被拒，浪费 token 和时间
  if (isContentPolicyRejection(err)) return false;
  // Retry on API errors that might be transient
  if (err instanceof Error && err.message.includes('AI API 返回错误')) return true;
  return false;
}

/**
 * 检测是否为内容审查拦截（Google/OpenAI 平台层面拒绝，非模型生成）。
 *
 * Google Gemini: "The prompt could not be submitted...sensitive words...use-policy"
 * OpenAI: "content_policy" / "content filter"
 * Gemini API: "prompt_feedback" / "block_reason" / "SAFETY"
 *
 * 这类错误不是模型道歉，而是请求未到达模型即被平台拒绝，
 * stripApologyPrefix 和预设规则都无法绕过。
 */
const CONTENT_POLICY_PATTERNS = [
  /sensitive words/i,
  /use-policy/i,
  /could not be submitted/i,
  /try rephrasing/i,
  /content_policy/i,
  /content filter/i,
  /prompt_feedback/i,
  /block_reason/i,
  /finish_reason.*SAFETY/i,
  /policy violation/i,
  /违规|审查拦截|内容政策/i,
];

function isContentPolicyRejection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return CONTENT_POLICY_PATTERNS.some(pattern => pattern.test(msg));
}

/**
 * 将内容审查拦截错误格式化为友好的中文提示。
 * 保留原始错误消息供调试。
 */
function formatContentPolicyError(originalMsg: string): string {
  // 判断是 Google 系还是 OpenAI 系
  const isGoogle = /sensitive words|use-policy|could not be submitted|google/i.test(originalMsg);
  const platform = isGoogle ? 'Google' : 'AI 平台';

  return `内容审查拦截：${platform} 拒绝了此请求（检测到敏感词）。

这并非预设问题，而是 ${platform} 平台层面的内容审查——请求未到达模型即被拒绝，预设规则和破限无法绕过。

建议：
1. 换用 Claude 或 GLM 模型（审查机制不同，对虚构创作更宽容）
2. 简化或修改角色设定/世界书中的敏感内容
3. 使用中转 API（部分中转会软化敏感词后再转发）

原始错误：${originalMsg.slice(0, 200)}`;
}

/** 如果错误消息匹配内容审查模式，格式化为友好提示；否则原样返回 */
function maybeFormatPolicyError(errMsg: string): string {
  if (CONTENT_POLICY_PATTERNS.some(p => p.test(errMsg))) {
    return formatContentPolicyError(errMsg);
  }
  return errMsg;
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

  const trimmedKey = (settings.apiKey || '').trim();
  // OpenRouter 必须有 Key，提前在客户端拦截
  if (apiUrl.includes('openrouter.ai') && !trimmedKey) {
    throw new Error('使用 OpenRouter 必须填写 API 密钥，请先在设置中保存 Key');
  }

  return {
    payload: {
      messages: injectPreset(options.messages, options.presetMode),
      apiUrl: normalizeApiUrl(apiUrl),
      apiKey: trimmedKey,
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
    const details = typeof parsed.details === 'string' ? parsed.details : '';
    const detail = details ? `：${details.slice(0, 300)}` : '';
    let errorMsg = `${parsed.error || fallback}${detail}`;
    // 401 鉴权失败：给出更具体的提示
    if (response.status === 401) {
      errorMsg += '\n\n请检查：\n1. API 密钥是否正确且未过期\n2. 切换渠道后是否重新输入了新渠道的 Key\n3. 前往设置页面重新保存密钥';
    }
    // 403 地区限制或权限不足
    if (response.status === 403) {
      errorMsg += '\n\n可能原因：\n1. 该模型在你所在地区不可用（如 OpenAI 系列模型在部分地区受限），请换用其他模型（如 deepseek/deepseek-chat）\n2. 你的 API Key 权限不足，无法使用该模型\n3. 该模型需要额外开通或付费';
    }
    return errorMsg;
  } catch {
    return `${fallback}：${raw.slice(0, 300)}`;
  }
}

function textFromContentParts(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
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
  const epochAtStart = cancelEpoch;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 停止发生在上一轮重试退避期间：sleep 醒来后在此拦截，不再重发
    if (cancelEpoch !== epochAtStart) throw new AIGenerationCancelledError();
    const { signal, release } = beginCancellableRequest();
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });

      if (!response.ok) {
        const errMsg = maybeFormatPolicyError(
          await readProxyError(response, `AI API 调用失败 (${response.status})`)
        );

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
        // 检查是否为内容审查导致的无内容（Google 可能返回 200 + prompt_feedback.block_reason）
        const blockReason = typeof data === 'object' && data !== null
          ? (data as Record<string, unknown>)?.prompt_feedback
          : undefined;
        if (blockReason && typeof blockReason === 'object') {
          throw new Error(maybeFormatPolicyError(
            `prompt_feedback: ${JSON.stringify(blockReason)}`
          ));
        }
        throw new Error('AI 响应没有内容，模型可能拒绝了请求');
      }
      return { content, finishReason };
    } catch (err: unknown) {
      // 用户主动取消：不可重试，转为专用错误类型直接抛出
      if (signal.aborted) throw new AIGenerationCancelledError();
      if (attempt < maxRetries && isRetryableError(err)) {
        lastError = err instanceof Error ? err : new Error('网络请求失败');
        await new Promise(r => setTimeout(r, retryDelay(attempt)));
        continue;
      }
      if (err instanceof Error && err.message.includes('请先在')) throw err;
      throw err;
    } finally {
      release();
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
  // 剥离开头道歉：模型可能无视预设规则在正文前加"抱歉，我无法..."
  const cleanFirstContent = stripApologyPrefix(firstResult.content);
  fullContent = cleanFirstContent;
  lastSegment = cleanFirstContent;
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
      logger.info(`[AI] 输出可能被截断（finish_reason=${lastFinishReason || 'unknown'}），自动续写第 ${continuationRounds} 轮...`);
      const result = await callAIOnce(continuePayload, maxRetries);
      // 续写段也可能以道歉开头（模型看到 tail 后试图"缓和"），剥离
      const cleanCont = stripApologyPrefix(result.content);
      fullContent += cleanCont;
      lastSegment = cleanCont;
      lastFinishReason = result.finishReason;
    } catch (err) {
      // 用户主动停止不能吞：半截 JSON 会被调用方 parseAIJson 失败后当纯文本
      // 写进角色描述并计入「成功」。取消必须一路抛给调用方按取消处理。
      if (err instanceof AIGenerationCancelledError) throw err;
      logger.warn(`[AI] 续写第 ${continuationRounds} 轮失败，返回已有内容：`, err);
      break;
    }
  }

  if (shouldContinue(lastFinishReason, fullContent)) {
    logger.warn(`[AI] 已达到最大续写轮数（${MAX_CONTINUATION_ROUNDS}轮），输出可能仍然不完整。建议调大最大Token数或检查网络/超时设置。`);
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
  const epochAtStart = cancelEpoch;
  // 已通过 onChunk 投递给消费者的字符数（跨重试累计）。
  // 重试时模型从头重新生成，这里按长度跳过已投递部分，避免追加式消费者收到重复内容。
  let deliveredLength = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 停止发生在上一轮重试退避期间：sleep 醒来后在此拦截，不再重发
    if (cancelEpoch !== epochAtStart) throw new AIGenerationCancelledError();
    const { signal, release } = beginCancellableRequest();
    try {
      const response = await fetch('/api/ai/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });

      if (!response.ok) {
        const errMsg = maybeFormatPolicyError(
          await readProxyError(response, `AI API 流式调用失败 (${response.status})`)
        );

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
      let finishReason: string | null = null;

      try {
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
                  // Google 可能返回 200 + finish_reason: SAFETY + 空内容
                  if (finishReason && /safety|block|filter/i.test(finishReason)) {
                    throw new Error(maybeFormatPolicyError(
                      `finish_reason: ${finishReason}（内容被安全过滤拦截）`
                    ));
                  }
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
                  throw new Error(maybeFormatPolicyError(`AI API 返回错误：${errMsg}`));
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
                  textFromContentParts(parsed.response) ||
                  textFromContentParts(parsed.choices?.[0]?.message?.content);



                if (content) {
                  fullText += content;
                  if (fullText.length > deliveredLength) {
                    onChunk(fullText.slice(deliveredLength), existingFullText + fullText);
                    deliveredLength = fullText.length;
                  }
                }
              } catch (parseErr) {
                // JSON.parse 失败抛 SyntaxError，直接跳过畸形行；
                // 业务错误（如内容审查拦截、API error）是 Error，必须向上抛出，
                // 不能用消息前缀字符串匹配区分（maybeFormatPolicyError 会改写前缀）。
                if (!(parseErr instanceof SyntaxError)) {
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
      } finally {
        // 确保流式 reader 在任何路径下（成功返回、抛错、重试）都被释放，
        // 避免底层 TCP 连接保持打开状态直至 GC（长时间运行的 SPA 中可能累积资源）
        try {
          // 流处于 errored 状态（如用户点「停止」后 abort）时 cancel() 返回 rejected promise，
          // 必须捕获异步 rejection，否则每次停止都会产生 unhandled rejection
          void reader.cancel().catch(() => {});
        } catch {
          // reader 已关闭或被释放，忽略
        }
      }
    } catch (err: unknown) {
      // 用户主动取消：不可重试（覆盖握手与流读取两个阶段的 abort）
      if (signal.aborted) throw new AIGenerationCancelledError();
      // 已向消费者投递了部分内容后不能重试：模型会从头重新生成，
      // 拼接两次不同生成的内容会产生乱码。
      if (deliveredLength > 0) throw err;
      if (attempt < maxRetries && isRetryableError(err)) {
        lastError = err instanceof Error ? err : new Error('网络请求失败');
        await new Promise(r => setTimeout(r, retryDelay(attempt)));
        continue;
      }
      if (err instanceof Error && err.message.includes('请先在')) throw err;
      throw err;
    } finally {
      release();
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
  // 流式首段也可能以道歉开头，剥离后再存入 fullContent/lastSegment
  // 注意：流式过程中道歉已经投递给 UI，这里剥离的是用于续写判断和 tail 的内容
  const cleanFirstText = stripApologyPrefix(firstResult.fullText);
  fullContent = cleanFirstText;
  lastSegment = cleanFirstText;
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
      logger.info(`[AI] 流式输出可能被截断（finish_reason=${lastFinishReason || 'unknown'}），自动续写第 ${continuationRounds} 轮...`);
      const result = await streamAIOnce(continuePayload, maxRetries, onChunk, fullContent);
      const cleanCont = stripApologyPrefix(result.fullText);
      fullContent += cleanCont;
      lastSegment = cleanCont;
      lastFinishReason = result.finishReason;
    } catch (err) {
      // 同 callAI：用户主动停止必须一路抛出，不能把半截内容当完整结果返回
      if (err instanceof AIGenerationCancelledError) throw err;
      logger.warn(`[AI] 流式续写第 ${continuationRounds} 轮失败，返回已有内容：`, err);
      break;
    }
  }

  if (shouldContinue(lastFinishReason, fullContent)) {
    logger.warn(`[AI] 已达到最大续写轮数（${MAX_CONTINUATION_ROUNDS}轮），输出可能仍然不完整。建议调大最大Token数或检查网络/超时设置。`);
  }

  // 最终剥离：如果开头有道歉（可能在流式过程中投递给了 UI），用剥离后的干净版本
  // 覆盖 UI 显示。onChunk 的第二个参数是 fullText，调用方据此更新状态。
  const finalClean = stripApologyPrefix(fullContent);
  if (finalClean !== fullContent) {
    onChunk('', finalClean);
    return finalClean;
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
  let response: Response;
  try {
    response = await fetch('/api/ai/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiUrl: deriveModelsUrl(apiUrl),
        apiKey,
      }),
    });
  } catch (err) {
    // Network-level error (DNS, connection refused, CORS block)
    throw new Error(`网络请求失败：${err instanceof Error ? err.message : '无法连接到后端代理服务'}`);
  }

  if (!response.ok) {
    const message = await readProxyError(response, `获取模型列表失败 (${response.status})`);
    const isVolcengine = /volces\.com|volcengine|ark/i.test(apiUrl);
    const hint = response.status >= 500
      ? isVolcengine
        ? '\n\n火山方舟的 /models 接口可能不可用，或需要标准地址 `https://ark.cn-beijing.volces.com/api/v3`。可以直接在"模型"输入框手动填写模型 ID 或推理接入点 ID（Endpoint ID），生成接口仍可正常使用。'
        : '\n\n可能原因：该中转站不支持 /models 模型列表接口，或上游服务临时异常。可以直接在"模型"输入框手动填写模型名并保存，聊天/生成接口仍可能正常可用。'
      : '';
    throw new Error(`${message}${hint}`);
  }

  const data = await response.json();
  // The proxy returns the raw upstream /models response ({ object: 'list', data: [...] }).
  if (Array.isArray(data.data)) {
    return data.data.map((m: { id?: string; owned_by?: string }) => ({
      id: m.id || '',
      owned_by: m.owned_by || '',
    }));
  }
  if (Array.isArray(data.models)) {
    return data.models.map((m: string | { id?: string; owned_by?: string }) => (
      typeof m === 'string' ? { id: m, owned_by: '' } : { id: m.id || '', owned_by: m.owned_by || '' }
    ));
  }
  return [];
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
