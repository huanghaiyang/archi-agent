// Central runtime configuration. Env vars give the first-run defaults; anything
// changed from the UI is persisted to server/data/settings.json and overrides
// them on the next start, so a local deployment can be pointed at vLLM,
// SGLang, Ollama or any OpenAI-compatible endpoint without editing files.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.ARCHI_DATA_DIR || path.resolve(__dirname, '../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const env = process.env;

const defaults = {
  mode: (env.AGENT_MODE || 'auto').toLowerCase(),
  provider: {
    // 'auto' picks the first reachable endpoint; 'local' never calls a model.
    type: (env.MODEL_PROVIDER || 'auto').toLowerCase(),
    baseUrl: env.MODEL_BASE_URL || env.HY4_BASE_URL || 'http://127.0.0.1:8000/v1',
    apiKey: env.MODEL_API_KEY || env.HY4_API_KEY || 'EMPTY',
    model: env.MODEL_NAME || env.HY4_MODEL || 'hy4',
    temperature: Number(env.MODEL_TEMPERATURE || env.HY4_TEMPERATURE || 0.9),
    topP: Number(env.MODEL_TOP_P || env.HY4_TOP_P || 1.0),
    maxTokens: Number(env.MODEL_MAX_TOKENS || env.HY4_MAX_TOKENS || 4096),
    reasoning: env.MODEL_REASONING || env.HY4_REASONING || 'no_think',
    timeoutMs: Number(env.MODEL_TIMEOUT_MS || env.HY4_TIMEOUT_MS || 180000),
    vision: (env.MODEL_VISION || '1') !== '0',
    // optional separate vision model (e.g. qwen2.5vl / llava on Ollama);
    // empty means "reuse provider.model"
    visionModel: env.MODEL_VISION_MODEL || '',
    // use the downloaded browser/WASM model for reference images instead of
    // asking the text provider. "auto" (the default) turns this on as soon as
    // server/data/models/index.json exists.
    localVision: env.MODEL_LOCAL_VISION
      ? env.MODEL_LOCAL_VISION === '1'
      : fs.existsSync(path.join(DATA_DIR, 'models', 'index.json')),
  },
  maxSteps: Number(env.AGENT_MAX_STEPS || 12),
  // candidate endpoints probed in order when provider.type === 'auto'
  candidates: [
    { type: 'hy4', baseUrl: env.HY4_BASE_URL || 'http://127.0.0.1:8000/v1', model: env.HY4_MODEL || 'hy4' },
    { type: 'ollama', baseUrl: env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1', model: env.OLLAMA_MODEL || 'qwen2.5:7b' },
  ],
};

function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

const saved = readSettings();

export const config = {
  port: Number(env.PORT || 8787),
  mode: saved.mode || defaults.mode,
  provider: { ...defaults.provider, ...(saved.provider || {}) },
  candidates: defaults.candidates,
  maxSteps: Number(saved.maxSteps || defaults.maxSteps),
  dataDir: DATA_DIR,
};

/** Backwards-compatible view: config.hy4 mirrors the active provider. */
Object.defineProperty(config, 'hy4', {
  enumerable: true,
  get() {
    const p = config.provider;
    return {
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
      temperature: p.temperature,
      topP: p.topP,
      maxTokens: p.maxTokens,
      reasoningEffort: p.reasoning,
      timeoutMs: p.timeoutMs,
    };
  },
});

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'refs'), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'thumbs'), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'sessions'), { recursive: true });
}

ensureDataDir();

export function saveSettings(patch = {}) {
  if (patch.mode) config.mode = String(patch.mode).toLowerCase();
  if (patch.maxSteps) config.maxSteps = Math.min(24, Math.max(2, Number(patch.maxSteps)));
  if (patch.provider && typeof patch.provider === 'object') {
    const p = patch.provider;
    for (const key of ['type', 'baseUrl', 'apiKey', 'model', 'reasoning', 'visionModel']) {
      if (typeof p[key] === 'string') {
        // visionModel may deliberately be cleared to fall back to the main model
        if (key === 'visionModel' || p[key].trim()) config.provider[key] = p[key].trim();
      }
    }
    for (const key of ['temperature', 'topP', 'maxTokens', 'timeoutMs']) {
      if (p[key] != null && !Number.isNaN(Number(p[key]))) config.provider[key] = Number(p[key]);
    }
    if (typeof p.vision === 'boolean') config.provider.vision = p.vision;
    if (typeof p.localVision === 'boolean') config.provider.localVision = p.localVision;
  }
  const payload = { mode: config.mode, provider: config.provider, maxSteps: config.maxSteps };
  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
  return payload;
}

export function publicSettings() {
  return {
    mode: config.mode,
    provider: { ...config.provider, apiKey: config.provider.apiKey ? '••••' : '' },
    hasKey: Boolean(config.provider.apiKey),
    candidates: config.candidates,
    maxSteps: config.maxSteps,
    dataDir: DATA_DIR,
  };
}

export function hy4Configured() {
  return Boolean(config.provider.baseUrl);
}
