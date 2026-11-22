// OpenAI-compatible client. Works with a local Hy4 deployment (vLLM / SGLang),
// Ollama's /v1 endpoint, llama.cpp server, vLLM with another model, or any
// hosted OpenAI-compatible API — the difference is only base URL + model.

import { config } from '../config.js';
import { logger, requestId } from '../logger.js';

class LLMError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.body = body;
  }
}

const trimBase = (url) => String(url || '').replace(/\/+$/, '');

function endpoint(provider, path) {
  return `${trimBase(provider.baseUrl)}${path}`;
}

function authHeaders(provider) {
  const h = { 'Content-Type': 'application/json' };
  if (provider.apiKey) h.Authorization = `Bearer ${provider.apiKey}`;
  return h;
}

export async function probeProvider(provider = config.provider, timeoutMs = 2500) {
  if (!provider || provider.type === 'local' || config.mode === 'local') {
    return { reachable: false, reason: '已选择本地设计引擎（不调用大模型）' };
  }
  if (!provider.baseUrl) return { reachable: false, reason: '未配置 baseUrl' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  const rid = requestId();
  try {
    logger.debug('llm', 'probe start', { rid, provider: provider.type, baseUrl: provider.baseUrl, model: provider.model, timeoutMs });
    const res = await fetch(endpoint(provider, '/models'), { headers: authHeaders(provider), signal: ctrl.signal });
    if (!res.ok) {
      logger.warn('llm', 'probe failed', { rid, provider: provider.type, baseUrl: provider.baseUrl, status: res.status, ms: Date.now() - t0 });
      return { reachable: false, reason: `HTTP ${res.status}` };
    }
    const json = await res.json().catch(() => ({}));
    const models = (json.data || json.models || []).map((m) => m.id || m.name).filter(Boolean);
    logger.info('llm', 'probe ok', { rid, provider: provider.type, baseUrl: provider.baseUrl, model: provider.model, models: models.slice(0, 6), ms: Date.now() - t0 });
    return { reachable: true, models, model: provider.model, provider: provider.type, baseUrl: provider.baseUrl };
  } catch (err) {
    logger.warn('llm', 'probe error', {
      rid, provider: provider.type, baseUrl: provider.baseUrl,
      reason: err.name === 'AbortError' ? `timeout ${timeoutMs}ms` : err.message,
      ms: Date.now() - t0,
    });
    return {
      reachable: false,
      reason: err.name === 'AbortError' ? '连接超时' : err.message,
      provider: provider.type,
      baseUrl: provider.baseUrl,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe the configured endpoint; in auto mode also try known local candidates. */
export async function probeModel() {
  const local = config.mode === 'local' || config.provider.type === 'local';
  if (local) return { reachable: false, reason: '本地设计引擎模式', provider: 'local' };

  const primary = await probeProvider(config.provider);
  if (primary.reachable) return primary;
  if (config.provider.type !== 'auto') return primary;

  for (const cand of config.candidates) {
    const probe = await probeProvider(cand);
    if (probe.reachable) {
      logger.info('llm', 'auto mode selected candidate', { candidate: cand.type, baseUrl: cand.baseUrl, model: cand.model });
      return probe;
    }
  }
  logger.warn('llm', 'no model provider reachable', { primary: config.provider.baseUrl, candidates: config.candidates.map((c) => c.baseUrl) });
  return primary;
}

export async function chat({ messages, tools, temperature, maxTokens, signal, provider: override, model }) {
  const provider = override || config.provider;
  const modelName = model || provider.model;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), provider.timeoutMs || 180000);
  const rid = requestId();
  const t0 = Date.now();
  const imageParts = messages.reduce((n, m) => n + (Array.isArray(m.content) ? m.content.filter((c) => c.type === 'image_url').length : 0), 0);

  const body = {
    model: modelName,
    messages,
    temperature: temperature ?? provider.temperature,
    top_p: provider.topP,
    max_tokens: maxTokens ?? provider.maxTokens,
    stream: false,
  };
  // Hy4's chat template switch; other runtimes ignore / reject it, so only send
  // it for the Hy4 provider.
  if ((provider.type === 'hy4' || provider.type === 'auto') && provider.reasoning) {
    body.chat_template_kwargs = { reasoning_effort: provider.reasoning };
  }
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  logger.info('llm', 'chat request', {
    rid,
    provider: provider.type,
    baseUrl: provider.baseUrl,
    model: modelName,
    messages: messages.length,
    images: imageParts,
    tools: tools?.map((t) => t.function?.name).filter(Boolean).slice(0, 20) || [],
    maxTokens: body.max_tokens,
    temperature: body.temperature,
    promptChars: messages.reduce((n, m) => n + String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')).length, 0),
  });

  let res;
  try {
    res = await fetch(endpoint(provider, '/chat/completions'), {
      method: 'POST',
      headers: authHeaders(provider),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const message = err.name === 'AbortError' ? '模型请求超时' : `无法连接模型服务（${provider.baseUrl}）：${err.message}`;
    logger.error('llm', 'chat failed', { rid, provider: provider.type, baseUrl: provider.baseUrl, model: modelName, ms: Date.now() - t0, reason: message });
    throw new LLMError(message, 0);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.error('llm', 'chat http error', { rid, provider: provider.type, baseUrl: provider.baseUrl, model: modelName, status: res.status, ms: Date.now() - t0, body: text.slice(0, 300) });
    throw new LLMError(`模型返回 ${res.status}`, res.status, text.slice(0, 500));
  }
  const json = await res.json();
  const choice = json.choices?.[0]?.message || {};
  const toolNames = (choice.tool_calls || []).map((t) => t.function?.name).filter(Boolean);
  logger.info('llm', 'chat response', {
    rid, provider: provider.type, model: modelName, status: res.status, ms: Date.now() - t0,
    usage: json.usage || null,
    contentChars: String(choice.content || '').length,
    reasoningChars: String(choice.reasoning_content || choice.reasoning || '').length,
    toolCalls: toolNames,
  });
  return {
    content: choice.content || '',
    reasoning: choice.reasoning_content || choice.reasoning || '',
    toolCalls: choice.tool_calls || [],
    usage: json.usage || null,
  };
}

/** True when the active provider is expected to accept image_url content. */
export function supportsVision() {
  return Boolean(config.provider.vision) && config.provider.type !== 'local' && config.mode !== 'local';
}

/** Provider clone pointed at the dedicated vision model, if one is configured. */
export function visionProvider(provider = config.provider) {
  return { ...provider, model: provider.visionModel || provider.model };
}

export { LLMError };
