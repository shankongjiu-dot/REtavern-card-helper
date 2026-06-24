/**
 * AI API Proxy Route — OpenAI-compatible
 *
 * POST /api/ai/models  - List available models from the user's API endpoint
 * POST /api/ai/chat    - Proxy a chat completion request
 *
 * Both endpoints accept a full API URL from the frontend (already normalized).
 * The backend acts purely as a CORS proxy — no keys are stored server-side.
 */
import { Router } from 'express';

const router = Router();
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

// ─── POST /api/ai/models ──────────────────────────────────────────────────────
// Fetch available models from the user's OpenAI-compatible endpoint.
// Body: { apiUrl, apiKey } — apiUrl is already the /models endpoint
// Returns: { models: [{ id, owned_by }] }
router.post('/models', async (req, res) => {
  try {
    const { apiUrl, apiKey } = req.body;

    if (!apiUrl) {
      return res.status(400).json({ error: '请填写 API 地址' });
    }

    const response = await fetchWithTimeout(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    }, MODEL_LIST_TIMEOUT_MS);

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: `API 返回错误 ${response.status}`,
        details: errorText,
      });
    }

    const data = await response.json();
    // OpenAI format: { data: [{ id, owned_by, ... }] }
    const models = (data.data || []).map((m) => ({
      id: m.id,
      owned_by: m.owned_by || '',
    }));

    res.json({ models });
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: '请求超时，请检查 API 地址是否正确' });
    }
    console.error('[Models Error]', err.message);
    res.status(500).json({ error: '获取模型列表失败', details: err.message });
  }
});

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
// Proxy an OpenAI-compatible chat completion request.
// Body: { messages, apiUrl, apiKey, model, temperature, max_tokens }
// apiUrl is already the /chat/completions endpoint
router.post('/chat', async (req, res) => {
  try {
    const { messages, apiUrl, apiKey, model, temperature, max_tokens } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: '缺少 messages 数组' });
    }
    if (!apiUrl) {
      return res.status(400).json({ error: '请填写 API 地址' });
    }

    const requestBody = {
      model: model || 'gpt-3.5-turbo',
      messages,
      temperature: temperature ?? 0.8,
      max_tokens: max_tokens ?? 8000,
    };

    const response = await fetchWithTimeout(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(requestBody),
    }, timeoutForTokens(max_tokens, CHAT_TIMEOUT_BASE_MS, CHAT_TIMEOUT_MAX_MS));

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: `AI API 返回错误 ${response.status}`,
        details: errorText,
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'AI API 请求超时' });
    }
    console.error('[AI Proxy Error]', err.message);
    res.status(500).json({ error: 'AI 代理请求失败', details: err.message });
  }
});

// ─── POST /api/ai/chat/stream ─────────────────────────────────────────────────
// Streaming chat completion via Server-Sent Events.
// Same body as /chat, returns SSE stream with { choices: [{ delta: { content } }] }
router.post('/chat/stream', async (req, res) => {
  try {
    const { messages, apiUrl, apiKey, model, temperature, max_tokens } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: '缺少 messages 数组' });
    }
    if (!apiUrl) {
      return res.status(400).json({ error: '请填写 API 地址' });
    }

    const requestBody = {
      model: model || 'gpt-3.5-turbo',
      messages,
      temperature: temperature ?? 0.8,
      max_tokens: max_tokens ?? 8000,
      stream: true,
    };

    const response = await fetchWithTimeout(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(requestBody),
    }, timeoutForTokens(max_tokens, STREAM_TIMEOUT_BASE_MS, STREAM_TIMEOUT_MAX_MS));

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: `AI API 返回错误 ${response.status}`,
        details: errorText,
      });
    }

    if (!response.body) {
      return res.status(502).json({ error: 'AI API 未返回流式响应体' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Pipe the upstream SSE stream to the client
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trimEnd();
          if (line.startsWith('data:')) {
            res.write(line + '\n\n');
            if (line.slice(5).trim() === '[DONE]') {
              res.end();
              return;
            }
          }
        }
      }
    } catch (streamErr) {
      console.error('[Stream Error]', streamErr.message);
    }

    // Final close if not already closed
    if (!res.writableEnded) {
      const lastLine = buffer.trim();
      if (lastLine.startsWith('data:') && lastLine.slice(5).trim() !== '[DONE]') {
        res.write(lastLine + '\n\n');
      }
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'AI API 请求超时' });
    }
    console.error('[AI Stream Proxy Error]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'AI 代理流式请求失败', details: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

export default router;
