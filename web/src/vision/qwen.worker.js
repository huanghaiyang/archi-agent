// Web Worker: keeps the 2.3 GB ONNX session off the UI thread.
// Messages in:  { type: 'init' } | { type: 'analyze', id, dataUrl, prompt }
// Messages out: { type: 'progress' | 'ready' | 'result' | 'error', ... }

import { loadVision, analyzeWithVision, RawImage } from './smolVision.js';

let runtime = null;
let loading = null;

async function boot() {
  if (runtime) return runtime;
  if (loading) return loading;
  loading = loadVision({
    localModelPath: '/models',
    device: 'wasm',
    dtype: 'q8',
    onProgress: (p) => self.postMessage({ type: 'progress', ...p }),
  })
    .then((rt) => {
      runtime = rt;
      self.postMessage({ type: 'ready' });
      return rt;
    })
    .finally(() => { loading = null; });
  return loading;
}

async function toImage(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return RawImage.fromBlob(blob);
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === 'init') {
      await boot();
      return;
    }
    if (msg.type === 'analyze') {
      const rt = await boot();
      self.postMessage({ type: 'progress', status: 'inference', progress: null, file: '' });
      const image = await toImage(msg.dataUrl);
      const result = await analyzeWithVision({ ...rt, image, prompt: msg.prompt || undefined, maxEdge: msg.maxEdge || 768 });
      self.postMessage({ type: 'result', id: msg.id, ...result });
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      id: msg.id || null,
      message: err?.message || String(err),
      stage: msg.type,
    });
  }
};
