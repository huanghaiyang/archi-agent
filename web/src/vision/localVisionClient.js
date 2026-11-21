// Main-thread façade over the vision worker. The 2B model is loaded once and
// reused for every reference image; progress callbacks drive the UI status line.

let worker = null;
let seq = 0;
const pending = new Map();
const progressListeners = new Set();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./qwen.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.type === 'progress') {
      for (const fn of progressListeners) fn(msg);
      return;
    }
    const item = msg.id != null ? pending.get(msg.id) : null;
    if (msg.type === 'result' && item) {
      pending.delete(msg.id);
      item.resolve({ raw: msg.raw, data: msg.data, ms: msg.ms });
    } else if (msg.type === 'error' && item) {
      pending.delete(msg.id);
      item.reject(new Error(msg.message || '本地视觉推理失败'));
    } else if (msg.type === 'error') {
      for (const fn of progressListeners) fn({ status: 'error', message: msg.message });
    }
  };
  worker.onerror = (event) => {
    for (const item of pending.values()) item.reject(new Error(event.message || '视觉 Worker 加载失败'));
    pending.clear();
  };
  return worker;
}

export function onVisionProgress(fn) {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

/** Analyze an image data URL entirely in the browser. */
export function analyzeImageLocally(dataUrl, { prompt, timeoutMs = 3 * 60 * 1000 } = {}) {
  const w = ensureWorker();
  const id = `v${++seq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('本地视觉推理超时'));
    }, timeoutMs);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (err) => { clearTimeout(timer); reject(err); },
    });
    w.postMessage({ type: 'analyze', id, dataUrl, prompt });
  });
}

export function warmupVision() {
  ensureWorker().postMessage({ type: 'init' });
}
