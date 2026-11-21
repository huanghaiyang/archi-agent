// Regression test for the browser-side ONNX vision path.
//
//   npm run test:local-vision
//
// Loads the same code the Web Worker uses (web/src/vision/smolVision.js) in
// Node through onnxruntime-node, runs one real architectural screenshot through
// SmolVLM-500M int8 and asserts the model returns parseable JSON. This validates
// the browser model download, the chat-template call and the JSON parser
// without needing a GPU or a browser.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadVision, analyzeWithVision, RawImage } from '../web/src/vision/smolVision.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_ROOT = path.join(ROOT, 'server', 'data', 'models');
const INDEX = path.join(MODEL_ROOT, 'index.json');
const IMAGE = process.argv[2] || path.join(ROOT, 'docs', '01-library-scheme.png');

function fail(msg) {
  console.error('FAILED:', msg);
  process.exit(1);
}

if (!fs.existsSync(INDEX)) fail(`model index missing (${INDEX}) — run: npm run models:vision`);
if (!fs.existsSync(IMAGE)) fail(`test image missing (${IMAGE})`);

const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const entry = index.models?.find((m) => m.model === 'smolvlm-500m');
if (!entry) fail('browser model (smolvlm-500m) not installed — run: npm run models:vision');

console.log(`model: ${entry.repo} (${entry.dtype}/${entry.device})`);
console.log(`image: ${IMAGE}`);

const t0 = Date.now();
const { processor, model } = await loadVision({
  localModelPath: `${MODEL_ROOT}${path.sep}`,
  modelId: entry.dir,
  dtype: entry.dtype,
  device: 'cpu',
  onProgress: (p) => {
    if (p.file && p.loaded && p.total && p.status === 'progress') {
      const pct = ((p.loaded / p.total) * 100).toFixed(0);
      process.stdout.write(`\r  load ${p.file} ${pct}%   `);
    }
  },
});
console.log(`\nloaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const image = await RawImage.read(IMAGE);
const result = await analyzeWithVision({ processor, model, image, maxNewTokens: 220 });
console.log(`inference: ${(result.ms / 1000).toFixed(1)}s`);
console.log('raw:', result.raw.replace(/\s+/g, ' ').slice(0, 400));

const data = result.data;
if (!data) fail('model output was not parseable JSON');
const programmes = ['library', 'office', 'housing', 'museum', 'school', 'community'];
const styles = ['minimal', 'industrial', 'timber', 'tech', 'brick', 'concrete'];
if (data.programme && !programmes.includes(data.programme)) fail(`bad programme: ${data.programme}`);
if (data.style && !styles.includes(data.style)) fail(`bad style: ${data.style}`);
if (!data.description) fail('missing description');
console.log('parsed:', JSON.stringify(data));
console.log('OK — local ONNX vision returns structured JSON');
