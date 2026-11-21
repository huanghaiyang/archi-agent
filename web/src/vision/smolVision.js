// Browser-side image understanding with SmolVLM-500M.
//
// Qwen2-VL-2B is great on the server (Node has no 4 GB WASM ceiling), but its
// 2.3 GB int8 weights plus activations overflow the browser's 32-bit WASM heap.
// SmolVLM-500M int8 is ~0.5 GB and runs comfortably in a Worker, so the browser
// path uses it while the server keeps Qwen for higher-quality analysis.

import {
  AutoProcessor,
  AutoModelForVision2Seq,
  RawImage,
  env,
} from '@huggingface/transformers';
import { createProgressBridge, fitImage, parseVisionJson } from './qwenVision.js';

export const VISION_MODEL_ID = 'HuggingFaceTB/SmolVLM-500M-Instruct';
export const VISION_DTYPE = 'q8';
export const VISION_DEVICE = 'wasm';

export const VISION_PROMPT = `Classify the building in this image and continue the JSON object that already starts below.
programme must be one of library, office, housing, museum, school, community.
style must be one of minimal, industrial, timber, tech, brick, concrete.
floors is an integer 1-12. materials is up to 6 English material names.
description is one short sentence in Chinese. Output JSON only, no explanation.`;
const JSON_SEED = '{"programme":"';

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
    // Already inside a dedicated Worker: a nested ORT proxy worker can deadlock
    // during session creation on some Chrome builds.
    env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.numThreads = globalThis.crossOriginIsolated
      ? Math.min(8, (globalThis.navigator?.hardwareConcurrency || 8))
      : 1;
  }

  const progress_callback = createProgressBridge(onProgress);
  onProgress?.({ status: 'stage', file: 'processor', progress: null });
  const processor = await AutoProcessor.from_pretrained(modelId, { progress_callback });
  onProgress?.({ status: 'stage', file: 'model', progress: null });
  const model = await AutoModelForVision2Seq.from_pretrained(modelId, {
    dtype,
    device,
    progress_callback,
  });
  onProgress?.({ status: 'stage', file: 'ready', progress: null });
  return { processor, model, modelId, dtype, device };
}

export async function analyzeWithVision({ processor, model, image, prompt = VISION_PROMPT, maxNewTokens = 220, maxEdge = 768 }) {
  const scaled = await fitImage(image, maxEdge);
  const messages = [{
    role: 'user',
    content: [{ type: 'image' }, { type: 'text', text: prompt }],
  }];
  const text = processor.apply_chat_template(messages, { add_generation_prompt: true }) + JSON_SEED;
  const inputs = await processor(text, scaled);
  const t0 = Date.now();
  const output = await model.generate({
    ...inputs,
    max_new_tokens: maxNewTokens,
    do_sample: false,
    repetition_penalty: 1.05,
  });
  const promptLength = inputs.input_ids?.dims?.[1] || 0;
  const generated = promptLength && output.dims?.[1] > promptLength
    ? output.slice(null, [promptLength, null])
    : output;
  const decoded = JSON_SEED + (processor.batch_decode(generated, { skip_special_tokens: true })[0] || '');
  return { raw: decoded, data: parseVisionJson(decoded), ms: Date.now() - t0 };
}

export { RawImage };
