// Main-thread façade over the SmolVLM worker. The model is loaded once and
// reused for every reference image; progress callbacks drive the UI status line.

import { reportClientError } from '../log.js';

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
    if (msg.type === 'ready') {
      for (const fn of progressListeners) fn({ status: 'ready', progress: 100, message: '模型已就绪' });
      return;
    }
    const item = msg.id != null ? pending.get(msg.id) : null;
    if (msg.type === 'result' && item) {
      pending.delete(msg.id);
      item.resolve({ raw: msg.raw, data: msg.data, ms: msg.ms });
    } else if (msg.type === 'error' && item) {
      pending.delete(msg.id);
      reportClientError('vision', msg.message || '本地视觉推理失败', { stage: msg.stage, id: msg.id });
      item.reject(new Error(msg.message || '本地视觉推理失败'));
    } else if (msg.type === 'error') {
      reportClientError('vision', msg.message || '本地视觉 Worker 失败', { stage: msg.stage });
      for (const fn of progressListeners) fn({ status: 'error', message: msg.message });
    }
  };
  worker.onerror = (event) => {
    reportClientError('vision', event.message || '视觉 Worker 加载失败', { filename: event.filename, line: event.lineno });
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
      reportClientError('vision', '本地视觉推理超时', { timeoutMs });
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
