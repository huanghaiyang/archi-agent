// Browser-side image understanding with a local ONNX vision model.
//
// Everything here runs on onnxruntime-web through transformers.js: no API key,
// no network round-trip, weights are fetched from the same-origin /models/
// directory that scripts/download-vision-model.mjs fills.
//
// The exported pieces are deliberately framework-free so the worker and the
// Node regression test share one code path.

import {
  AutoProcessor,
  AutoModelForImageTextToText,
  RawImage,
  env,
} from '@huggingface/transformers';

export const VISION_MODEL_ID = 'onnx-community/Qwen2-VL-2B-Instruct';
export const VISION_DTYPE = 'q8'; // int8: runs on WASM and WebGPU
export const VISION_DEVICE = 'wasm';

export const VISION_PROMPT = `看这张建筑参考图，给出你的判断，只输出一个 JSON 对象。
字段要求：programme 从 library/office/housing/museum/school/community 里选一个；style 从 minimal/industrial/timber/tech/brick/concrete 里选一个；floors 是 1-12 的整数；materials 是最多 6 个英文材质名；description 是一句不超过 40 字的中文。
示例输出：{"programme":"museum","style":"concrete","floors":3,"materials":["white_concrete","glass"],"description":"三层清水混凝土美术馆，横向长窗。"}
现在输出这张图的 JSON，不要照抄示例，不要解释，不要重复字段说明。`;

export const PROGRAMMES = ['library', 'office', 'housing', 'museum', 'school', 'community'];
export const STYLES = ['minimal', 'industrial', 'timber', 'tech', 'brick', 'concrete'];

function pickEnum(value, list) {
  const raw = String(value ?? '').toLowerCase();
  const exact = list.find((item) => raw === item);
  if (exact) return exact;
  // Small models often answer "library/office" or "concrete 之一": take the
  // first listed option that actually appears in the answer.
  let best = null;
  let bestAt = Infinity;
  for (const item of list) {
    const at = raw.indexOf(item);
    if (at >= 0 && at < bestAt) {
      best = item;
      bestAt = at;
    }
  }
  return best;
}

/** Coerce a loose model answer into the enums the server expects. */
export function normalizeVisionData(data) {
  if (!data || typeof data !== 'object') return null;
  const programme = pickEnum(data.programme ?? data.program ?? data.type, PROGRAMMES);
  const style = pickEnum(data.style ?? data.architecture_style, STYLES);
  if (!programme || !style) return null;
  const floors = Math.min(12, Math.max(1, Math.round(Number.parseInt(data.floors ?? data.floors_count, 10) || 1)));
  let materials = data.materials ?? data.material ?? [];
  if (typeof materials === 'string') materials = materials.split(/[,，;；]/);
  materials = (Array.isArray(materials) ? materials : [])
    .map((item) => String(item || '').trim().toLowerCase().replace(/\s+/g, '_'))
    .filter(Boolean)
    .slice(0, 6);
  const description = String(data.description ?? data.desc ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return { programme, style, floors, materials, description };
}

/** Extract the first JSON object from a model answer that may include prose. */
export function parseVisionJson(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/```json/gi, '```')
    .replace(/<\|[^>]*\|>/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return normalizeVisionData(JSON.parse(cleaned.slice(start, i + 1)));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function createProgressBridge(onProgress) {
  let last = 0;
  return (event) => {
    if (!event || typeof event !== 'object') return;
    const now = Date.now();
    const isFile = event.status === 'progress' || event.status === 'download' || event.status === 'progress_total';
    if (isFile && now - last < 400) return;
    last = now;
    onProgress?.({
      status: event.status,
      file: event.file || event.name || '',
      loaded: event.loaded || 0,
      total: event.total || 0,
      progress: Number.isFinite(event.progress) ? event.progress : null,
    });
  };
}

/**
 * Load processor + model from a local directory.
 * @param {object} opts
 * @param {string} opts.localModelPath  '/models' in the browser, absolute dir in Node
 * @param {string} [opts.modelId]
 * @param {'q8'|'q4f16'} [opts.dtype]
 * @param {'wasm'|'webgpu'} [opts.device]
 */
export async function loadVision({
  localModelPath = '/models',
  modelId = VISION_MODEL_ID,
  dtype = VISION_DTYPE,
  device = VISION_DEVICE,
  onProgress,
} = {}) {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = localModelPath;
  if (env.backends?.onnx?.wasm) {
    // Threads need SharedArrayBuffer (COOP/COEP). Without it ORT would still
    // spin up extra workers and multiply the WASM heap, so stay single-threaded.
    env.backends.onnx.wasm.numThreads = globalThis.crossOriginIsolated
      ? Math.min(8, (globalThis.navigator?.hardwareConcurrency || 8))
      : 1;
  }

  const progress_callback = createProgressBridge(onProgress);
  onProgress?.({ status: 'stage', file: 'processor', progress: null });
  const processor = await AutoProcessor.from_pretrained(modelId, { progress_callback });
  onProgress?.({ status: 'stage', file: 'model', progress: null });
  const model = await AutoModelForImageTextToText.from_pretrained(modelId, {
    dtype,
    device,
    progress_callback,
  });
  onProgress?.({ status: 'stage', file: 'ready', progress: null });
  return { processor, model, modelId, dtype, device };
}

/** Downscale before the processor: Qwen2-VL keeps native resolution, and a
 *  1600px screenshot becomes ~1900 vision tokens (multi-GB attention buffers).
 *  896px keeps facade detail while staying inside WASM/browser memory. */
export async function fitImage(image, maxEdge = 896) {
  const long = Math.max(image.width, image.height);
  if (!long || long <= maxEdge) return image;
  const scale = maxEdge / long;
  return image.resize(Math.round(image.width * scale), Math.round(image.height * scale), { resample: 2 });
}

/** Run one image through the model and return raw text plus parsed JSON. */
export async function analyzeWithVision({ processor, model, image, prompt = VISION_PROMPT, maxNewTokens = 280, maxEdge = 896 }) {
  const messages = [
    { role: 'system', content: [{ type: 'text', text: '你是建筑视觉分析助手。回答只包含一个 JSON 对象，不要解释。' }] },
    { role: 'user', content: [{ type: 'image' }, { type: 'text', text: prompt }] },
  ];
  const scaled = await fitImage(image, maxEdge);
  const text = processor.apply_chat_template(messages, { add_generation_prompt: true });
  const inputs = await processor(text, scaled);
  const t0 = Date.now();
  const output = await model.generate({
    ...inputs,
    max_new_tokens: maxNewTokens,
    do_sample: false,
    repetition_penalty: 1.05,
  });
  // generate() returns prompt + continuation; decode only the new tokens so the
  // prompt's JSON schema can never be mistaken for the model's answer.
  const promptLength = inputs.input_ids?.dims?.[1] || 0;
  const generated = promptLength && output.dims?.[1] > promptLength
    ? output.slice(null, [promptLength, null])
    : output;
  const decoded = processor.batch_decode(generated, { skip_special_tokens: true })[0] || '';
  return {
    raw: decoded,
    data: parseVisionJson(decoded),
    ms: Date.now() - t0,
  };
}

export { RawImage };

