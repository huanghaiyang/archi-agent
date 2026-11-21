// OpenAI-compatible client. Works with a local Hy4 deployment (vLLM / SGLang),
// Ollama's /v1 endpoint, llama.cpp server, vLLM with another model, or any
// hosted OpenAI-compatible API — the difference is only base URL + model.

import { config } from '../config.js';

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint(provider, '/models'), { headers: authHeaders(provider), signal: controller.signal });
    if (!res.ok) return { reachable: false, reason: `HTTP ${res.status}` };
    const json = await res.json().catch(() => ({}));
    const models = (json.data || json.models || []).map((m) => m.id || m.name).filter(Boolean);
    return { reachable: true, models, model: provider.model, provider: provider.type, baseUrl: provider.baseUrl };
  } catch (err) {
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
    if (probe.reachable) return probe;
  }
  return primary;
}

export async function chat({ messages, tools, temperature, maxTokens, signal, provider: override }) {
  const provider = override || config.provider;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), provider.timeoutMs || 180000);

  const body = {
    model: provider.model,
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

  let res;
  try {
    res = await fetch(endpoint(provider, '/chat/completions'), {
      method: 'POST',
      headers: authHeaders(provider),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new LLMError(
      err.name === 'AbortError' ? '模型请求超时' : `无法连接模型服务（${provider.baseUrl}）：${err.message}`,
      0,
    );
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LLMError(`模型返回 ${res.status}`, res.status, text.slice(0, 500));
  }
  const json = await res.json();
  const choice = json.choices?.[0]?.message || {};
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

export { LLMError };
