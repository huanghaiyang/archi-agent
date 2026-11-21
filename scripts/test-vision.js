// End-to-end check for the reference-image vision path.
//
//   npm run test:vision
//
// Boots scripts/mock-vision.js, starts a throwaway server instance pointed at
// it (separate port + temp data dir, so the real settings are untouched), then
// asserts:
//   1. /api/reference returns analysis.source === 'vision' with the mock model
//   2. the parsed programme/style/floors come from the model JSON
//   3. when the endpoint is unreachable the same call degrades to 'palette'
//      and reports the reason instead of throwing

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK_PORT = Number(process.env.MOCK_VISION_PORT || 8890);
const API_PORT = Number(process.env.TEST_VISION_API_PORT || 8892);
const API = `http://127.0.0.1:${API_PORT}`;
const DATA_DIR = path.join(os.tmpdir(), 'archi-vision-test');

// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const children = [];
function start(name, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${name}!] ${d}`));
  children.push(child);
  return child;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* retry */ }
    await sleep(300);
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function post(p, body) {
  const res = await fetch(`${API}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
    return true;
  }
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

let pass = true;

try {
  start('mock-vision', ['scripts/mock-vision.js'], { MOCK_VISION_PORT: String(MOCK_PORT) });
  start('api', ['server/src/index.js'], {
    PORT: String(API_PORT),
    ARCHI_DATA_DIR: DATA_DIR,
    MODEL_PROVIDER: 'openai',
    MODEL_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
    MODEL_NAME: 'hy4',
    MODEL_VISION: '1',
    MODEL_VISION_MODEL: 'mock-vision-4b',
  });

  await waitFor(`http://127.0.0.1:${MOCK_PORT}/v1/models`);
  await waitFor(`${API}/api/health`);

  const health = await (await fetch(`${API}/api/health`)).json();
  console.log(`health: provider=${health.provider} model=${health.model} vision=${health.vision} visionModel=${health.visionModel}`);
  pass = check('health exposes the vision model', health.visionModel === 'mock-vision-4b', health.visionModel) && pass;

  const vision = await post('/api/reference', {
    image: PNG,
    palette: ['#f2f0eb', '#8c8f93'],
    message: '哈尔滨 36×24m 场地，美术馆',
  });
  const analysis = vision.json?.reference?.analysis || {};
  console.log(`vision analysis: source=${analysis.source} model=${analysis.model} programme=${analysis.programme} style=${analysis.style} floors=${analysis.floors}`);
  pass = check('source is vision', analysis.source === 'vision', analysis.source) && pass;
  pass = check('model name comes from the mock', analysis.model === 'mock-vision-4b', analysis.model) && pass;
  pass = check('programme parsed', analysis.programme === 'museum', analysis.programme) && pass;
  pass = check('style parsed', analysis.style === 'concrete', analysis.style) && pass;
  pass = check('floors parsed', analysis.floors === 3, String(analysis.floors)) && pass;
  pass = check('materials parsed', (analysis.materials || []).length >= 2, JSON.stringify(analysis.materials)) && pass;
  pass = check('brief mentions the parsed programme', /美术馆|museum/.test(vision.json?.brief || ''), 'brief ok') && pass;

  // point the provider at a dead port and confirm graceful degradation
  await post('/api/settings', {
    provider: { type: 'openai', baseUrl: 'http://127.0.0.1:1/v1', model: 'hy4', visionModel: 'mock-vision-4b', vision: true },
  });
  const fallback = await post('/api/reference', { image: PNG, palette: ['#c8a06a', '#4a3a2a'], message: '' });
  const fb = fallback.json?.reference?.analysis || {};
  console.log(`fallback analysis: source=${fb.source} reason=${fb.vision?.reason}`);
  pass = check('falls back to palette', fb.source === 'palette', fb.source) && pass;
  pass = check('fallback keeps a reason', Boolean(fb.vision?.reason), fb.vision?.reason) && pass;
  pass = check('fallback still returns a brief', Boolean(fallback.json?.brief), 'brief ok') && pass;
} catch (err) {
  console.error('FAILED:', err.message);
  pass = false;
} finally {
  for (const child of children) child.kill();
}

console.log(pass ? 'OK — reference-image vision path works' : 'FAILED — vision path broken');
process.exit(pass ? 0 : 1);
