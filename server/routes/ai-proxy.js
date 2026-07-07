/**
 * AI API Proxy Route — OpenAI-compatible
 *
 * POST /api/ai/models       - List available models from the user's API endpoint
 * POST /api/ai/chat         - Proxy a chat completion request (non-streaming)
 * POST /api/ai/chat/stream  - Proxy a chat completion request (SSE streaming)
 *
 * Both endpoints accept a full API URL from the frontend (already normalized).
 * The backend acts purely as a CORS proxy — no keys are stored server-side.
 *
 * This module runs on both Cloudflare Workers (Web APIs) and Node.js (@hono/node-server).
 */
import { Hono } from 'hono';

const router = new Hono();

const MODEL_LIST_TIMEOUT_MS = 15_000;
const CHAT_TIMEOUT_BASE_MS = 120_000;
const STREAM_TIMEOUT_BASE_MS = 180_000;
const CHAT_TIMEOUT_MAX_MS = 10 * 60_000;
const STREAM_TIMEOUT_MAX_MS = 20 * 60_000;

function timeoutForTokens(maxTokens, baseMs, maxMs) {
  const tokenBudget = Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : 2000;
  const scaledMs = Math.ceil(tokenBudget * 90);
  return Math.min(Math.max(baseMs, scaledMs), maxMs);
}

/**
 * fetch with timeout — aborts if the upstream doesn't respond within timeoutMs.
 * The timeout covers time-to-first-byte only; streaming continues without timeout.
 */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Build upstream request headers. Trims the key and adds OpenRouter-specific headers. */
function buildUpstreamHeaders(apiKey, upstreamUrl, { includeContentType = true } = {}) {
  const key = (apiKey || '').trim();
  const headers = {};
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  // OpenRouter recommends these headers for model ranking and identification.
  if (upstreamUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://tavern-card-helper.tavern-helper.workers.dev';
    headers['X-Title'] = 'Tavern Card Helper';
  }
  return headers;
}

/** Validate that OpenRouter always has a non-empty API key. */
function validateOpenRouterKey(apiKey, upstreamUrl) {
  const key = (apiKey || '').trim();
  if (upstreamUrl.includes('openrouter.ai') && !key) {
    return { ok: false, error: '使用 OpenRouter 必须填写 API 密钥，请先在设置中保存 Key' };
  }
  return { ok: true, key };
}

/** Return a JSON error response (used only for upstream errors or exceptions). */
function jsonError(c, message, details, status) {
  return c.json({ error: message, details }, status);
}

/**
 * Wrap an upstream fetch Response so Hono can safely mutate its headers
 * (e.g. for CORS). Directly returning upstream responses causes
 * "TypeError: immutable" on Node because undici Response headers are frozen.
 *
 * Also strips hop-by-hop headers (Connection, Keep-Alive, Transfer-Encoding)
 * to avoid confusing downstream proxies such as Vite's dev server.
 */
function passThrough(response) {
  const headers = new Headers(response.headers);
  // Hop-by-hop headers must not be forwarded by proxies.
  const hopByHop = ['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'proxy-authorization', 'proxy-authenticate', 'upgrade'];
  hopByHop.forEach((name) => headers.delete(name));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ─── POST /models ─────────────────────────────────────────────────────────────
// Fetch available models from the user's OpenAI-compatible endpoint.
// Body: { apiUrl, apiKey } — apiUrl is already the /models endpoint
// Returns: upstream /models JSON response, passed through unchanged.
//
// Passing the response body straight through avoids JSON.parse() inside the
// Worker, which is the main cause of CPU-time-limit errors on the free tier.
router.post('/models', async (c) => {
  try {
    const { apiUrl, apiKey } = await c.req.json();

    if (!apiUrl) {
      return c.json({ error: '请填写 API 地址' }, 400);
    }

    const validation = validateOpenRouterKey(apiKey, apiUrl);
    if (!validation.ok) {
      return c.json({ error: validation.error }, 400);
    }

    const hasKey = Boolean(validation.key);
    console.log(`[Models Proxy] ${apiUrl} (key=${hasKey ? 'present' : 'missing'}, contentType=false)`);

    const response = await fetchWithTimeout(apiUrl, {
      method: 'GET',
      headers: buildUpstreamHeaders(validation.key, apiUrl, { includeContentType: false }),
    }, MODEL_LIST_TIMEOUT_MS);

    console.log(`[Models Proxy] ${apiUrl} -> status ${response.status}`);

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`[Models Proxy] ${apiUrl} -> error body:`, responseText.slice(0, 1000));
      return jsonError(c, `API 返回错误 ${response.status}`, responseText, response.status);
    }

    return c.body(responseText, response.status, {
      'Content-Type': response.headers.get('content-type') || 'application/json',
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return c.json({ error: '请求超时，请检查 API 地址是否正确' }, 504);
    }
    console.error('[Models Error]', err.message);
    return c.json({ error: '获取模型列表失败', details: err.message }, 500);
  }
});

// ─── POST /chat ───────────────────────────────────────────────────────────────
// Proxy an OpenAI-compatible chat completion request (non-streaming).
// Body: { messages, apiUrl, apiKey, model, temperature, max_tokens }
// Returns: upstream /chat/completions JSON response, passed through unchanged.
router.post('/chat', async (c) => {
  try {
    const { messages, apiUrl, apiKey, model, temperature, max_tokens } = await c.req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return c.json({ error: '缺少 messages 数组' }, 400);
    }
    if (!apiUrl) {
      return c.json({ error: '请填写 API 地址' }, 400);
    }

    const validation = validateOpenRouterKey(apiKey, apiUrl);
    if (!validation.ok) {
      return c.json({ error: validation.error }, 400);
    }

    const requestBody = {
      model: model || 'gpt-3.5-turbo',
      messages,
      temperature: temperature ?? 0.8,
      max_tokens: max_tokens ?? 8000,
    };

    const response = await fetchWithTimeout(apiUrl, {
      method: 'POST',
      headers: buildUpstreamHeaders(validation.key, apiUrl),
      body: JSON.stringify(requestBody),
    }, timeoutForTokens(max_tokens, CHAT_TIMEOUT_BASE_MS, CHAT_TIMEOUT_MAX_MS));

    const responseText = await response.text();

    if (!response.ok) {
      return jsonError(c, `AI API 返回错误 ${response.status}`, responseText, response.status);
    }

    return c.body(responseText, response.status, {
      'Content-Type': response.headers.get('content-type') || 'application/json',
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return c.json({ error: 'AI API 请求超时' }, 504);
    }
    console.error('[AI Proxy Error]', err.message);
    return c.json({ error: 'AI 代理请求失败', details: err.message }, 500);
  }
});

// ─── POST /chat/stream ────────────────────────────────────────────────────────
// Streaming chat completion via Server-Sent Events.
// Same body as /chat, returns upstream SSE stream, passed through unchanged.
//
// We avoid Hono's stream() helper and manual heartbeat logic. The upstream SSE
// stream is returned directly, so the Worker does almost no per-chunk work.
router.post('/chat/stream', async (c) => {
  try {
    const { messages, apiUrl, apiKey, model, temperature, max_tokens } = await c.req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return c.json({ error: '缺少 messages 数组' }, 400);
    }
    if (!apiUrl) {
      return c.json({ error: '请填写 API 地址' }, 400);
    }

    const validation = validateOpenRouterKey(apiKey, apiUrl);
    if (!validation.ok) {
      return c.json({ error: validation.error }, 400);
    }

    const requestBody = {
      model: model || 'gpt-3.5-turbo',
      messages,
      temperature: temperature ?? 0.8,
      max_tokens: max_tokens ?? 8000,
      stream: true,
    };

    console.log(`[Stream Proxy] url=${apiUrl} model=${model} key=${validation.key ? 'present' : 'missing'} msgs=${messages.length}`);

    const response = await fetchWithTimeout(apiUrl, {
      method: 'POST',
      headers: buildUpstreamHeaders(validation.key, apiUrl),
      body: JSON.stringify(requestBody),
    }, timeoutForTokens(max_tokens, STREAM_TIMEOUT_BASE_MS, STREAM_TIMEOUT_MAX_MS));

    console.log(`[Stream Proxy] url=${apiUrl} -> status ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Stream Proxy] url=${apiUrl} -> error body:`, errorText.slice(0, 1000));
      return jsonError(c, `AI API 返回错误 ${response.status}`, errorText, response.status);
    }

    // Pass upstream SSE stream straight through.
    // The Worker only sets up the pipe; no per-chunk parsing or heartbeats.
    return passThrough(response);
  } catch (err) {
    if (err.name === 'AbortError') {
      return c.json({ error: 'AI API 请求超时' }, 504);
    }
    console.error('[AI Stream Proxy Error]', err.message);
    return c.json({ error: 'AI 代理流式请求失败', details: err.message }, 500);
  }
});

export default router;
