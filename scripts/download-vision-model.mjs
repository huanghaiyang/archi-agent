#!/usr/bin/env node
// Download a browser/WASM-friendly vision model for local image understanding.
//
//   npm run models:vision                     # recommended profile for this machine
//   npm run models:vision -- --check         # verify what is already on disk
//   npm run models:vision -- --dry-run       # show plan and sizes, download nothing
//   npm run models:vision -- --dtype q4f16   # smaller WebGPU weights
//
// The weights land in server/data/models/<repo>/ and are served by the API at
// /models/<repo>/..., so the browser reads them from the same origin (no CDN,
// no CORS, works offline). Config files and the ONNX graph are downloaded with
// HTTP Range resume, retries and per-file size verification.
//
// Model choice: Qwen2-VL-2B-Instruct (ONNX community build). It is multilingual
// (Chinese prompts work), understands architectural photos/plan scans, and its
// int8 export runs in the browser with onnxruntime-web on both WASM and WebGPU.
// int8 total is ~2.3 GB; q4f16 total is ~2.5 GB but prefers WebGPU fp16.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.ARCHI_DATA_DIR || path.join(ROOT, 'server', 'data');
const MODEL_ROOT = path.join(DATA_DIR, 'models');

const MIRRORS = ['https://hf-mirror.com', 'https://huggingface.co'];

const MODELS = {
  'smolvlm-500m': {
    repo: 'HuggingFaceTB/SmolVLM-500M-Instruct',
    dir: 'HuggingFaceTB/SmolVLM-500M-Instruct',
    label: 'SmolVLM 500M Instruct（浏览器内运行的轻量图片理解）',
    configs: [
      'config.json',
      'generation_config.json',
      'preprocessor_config.json',
      'processor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'vocab.json',
      'merges.txt',
      'added_tokens.json',
      'special_tokens_map.json',
      'chat_template.json',
    ],
    weights: {
      q8: {
        device: 'wasm',
        approx: 488,
        files: [
          'onnx/vision_encoder_quantized.onnx',
          'onnx/embed_tokens_quantized.onnx',
          'onnx/decoder_model_merged_quantized.onnx',
        ],
      },
    },
  },
  'qwen2-vl-2b': {
    repo: 'onnx-community/Qwen2-VL-2B-Instruct',
    dir: 'onnx-community/Qwen2-VL-2B-Instruct',
    label: 'Qwen2-VL 2B Instruct（中英双语图片理解）',
    configs: [
      'config.json',
      'generation_config.json',
      'preprocessor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'vocab.json',
      'merges.txt',
      'added_tokens.json',
      'chat_template.json',
    ],
    weights: {
      q8: {
        device: 'wasm',
        approx: 2334,
        files: [
          'onnx/vision_encoder_quantized.onnx',
          'onnx/embed_tokens_quantized.onnx',
          'onnx/decoder_model_merged_quantized.onnx',
        ],
      },
      q4f16: {
        device: 'webgpu',
        approx: 2545,
        files: [
          'onnx/vision_encoder_q4f16.onnx',
          'onnx/embed_tokens_q4f16.onnx',
          'onnx/decoder_model_merged_q4f16.onnx',
        ],
      },
    },
  },
};

function parseArgs(argv) {
  const out = { model: 'qwen2-vl-2b', dtype: null, mirror: 'auto', check: false, dryRun: false, force: false };
  for (const arg of argv.slice(2)) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'model' && value) out.model = value;
    else if (key === 'dtype' && value) out.dtype = value;
    else if (key === 'mirror' && value) out.mirror = value;
    else if (key === 'check') out.check = true;
    else if (key === 'dry-run') out.dryRun = true;
    else if (key === 'force') out.force = true;
    else if (key === 'help' || key === '-h') out.help = true;
  }
  return out;
}

function hardware() {
  const cpus = os.cpus();
  const ramGB = os.totalmem() / 1073741824;
  let gpu = null;
  const smi = spawnSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], { encoding: 'utf8', timeout: 5000 });
  if (smi.status === 0 && smi.stdout.trim()) gpu = smi.stdout.trim().split(/\r?\n/)[0];
  let freeGB = null;
  try {
    const st = fs.statfsSync(DATA_DIR);
    freeGB = (st.bavail * st.bsize) / 1073741824;
  } catch { /* not fatal */ }
  return {
    cpu: `${cpus[0]?.model?.trim() || 'unknown'} (${cpus.length} threads)`,
    ramGB: Math.round(ramGB * 10) / 10,
    gpu,
    freeGB: freeGB == null ? null : Math.round(freeGB * 10) / 10,
  };
}

function recommendDtype(hw, model) {
  // int8 (`q8`) is the safest default: onnxruntime-web runs it on both WASM
  // (CPU, no WebGPU required) and WebGPU. `q4f16` is smaller/faster on a
  // discrete GPU but needs WebGPU fp16 support, so it stays opt-in.
  if (model.weights.q8) return 'q8';
  return Object.keys(model.weights)[0];
}

function humanMB(bytes) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1048576)} MB`;
}

async function fetchJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'archi-agent-vision-downloader' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function remoteFiles(mirror, repo) {
  const data = await fetchJson(`${mirror}/api/models/${repo}?blobs=true`);
  const sizes = {};
  for (const s of data.siblings || []) {
    if (s.size) sizes[s.rfilename] = s.size;
    else if (s.lfs?.size) sizes[s.rfilename] = s.lfs.size;
  }
  return sizes;
}

async function headSize(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') || 0);
    return len || null;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadOne({ mirror, repo, rel, target, expected, force }) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const url = `${mirror}/${repo}/resolve/main/${rel.split('/').map(encodeURIComponent).join('/')}`;
  if (!expected) {
    expected = await headSize(url).catch(() => null);
  }

  let have = 0;
  try { have = (await fsp.stat(target)).size; } catch { /* missing */ }
  if (have && expected && have === expected && !force) {
    console.log(`  skip  ${rel} (${humanMB(have)})`);
    return { rel, size: have, skipped: true };
  }

  const part = `${target}.part`;
  let start = 0;
  try { start = (await fsp.stat(part)).size; } catch { /* fresh */ }
  if (force) {
    await fsp.rm(part, { force: true });
    start = 0;
  }
  if (expected && start > expected) {
    await fsp.rm(part, { force: true });
    start = 0;
  }

  const headers = { 'User-Agent': 'archi-agent-vision-downloader' };
  if (start) headers.Range = `bytes=${start}-`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180000);
  let res;
  try {
    res = await fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} for ${rel}`);

  const resumed = res.status === 206 && start > 0;
  const total = expected || (Number(res.headers.get('content-length') || 0) + (resumed ? start : 0));
  const out = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' });
  let written = resumed ? start : 0;
  const sessionStart = written;
  const t0 = Date.now();
  let lastPrint = 0;

  try {
    for await (const chunk of res.body) {
      written += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      const now = Date.now();
      if (now - lastPrint > 4000) {
        lastPrint = now;
        const mb = written / 1048576;
        const speed = (written - sessionStart) / 1048576 / ((now - t0) / 1000);
        const pct = total ? ((written / total) * 100).toFixed(1) : '?';
        const eta = total && speed > 0.2 ? Math.max(0, (total - written) / 1048576 / speed) : 0;
        process.stdout.write(`\r  get   ${rel}  ${pct}%  ${mb.toFixed(0)} MB  ${speed.toFixed(1)} MB/s  ETA ${Math.round(eta)}s   `);
      }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (total && written !== total) throw new Error(`size mismatch ${rel}: got ${written}, expected ${total}`);
  process.stdout.write('\n');
  await fsp.rm(target, { force: true });
  await fsp.rename(part, target);
  return { rel, size: written };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`usage: node scripts/download-vision-model.mjs [options]

  --model=qwen2-vl-2b|smolvlm-500m   model profile (default: qwen2-vl-2b)
  --dtype=q8|q4f16      weight precision (default: recommended for this machine)
  --mirror=auto|hf-mirror|hf
  --check               verify files already on disk, download nothing
  --dry-run             print the plan and total size
  --force               re-download everything`);
    return;
  }

  const model = MODELS[args.model];
  if (!model) throw new Error(`unknown model profile: ${args.model}`);
  const hw = hardware();
  const dtype = args.dtype || recommendDtype(hw, model);
  if (!model.weights[dtype]) throw new Error(`unknown dtype: ${dtype} (available: ${Object.keys(model.weights).join(', ')})`);
  const plan = [...model.configs, ...model.weights[dtype].files];
  const mirrors = args.mirror === 'auto' ? MIRRORS : [args.mirror === 'hf' ? MIRRORS[1] : MIRRORS[0]];

  console.log('machine:');
  console.log(`  cpu   ${hw.cpu}`);
  console.log(`  ram   ${hw.ramGB} GB`);
  console.log(`  gpu   ${hw.gpu || 'none detected'}`);
  console.log(`  disk  ${hw.freeGB == null ? 'unknown' : `${hw.freeGB} GB free`}`);
  console.log(`model: ${model.label}`);
  console.log(`  repo  ${model.repo}`);
  console.log(`  dtype ${dtype} (${model.weights[dtype].device}, ~${model.weights[dtype].approx} MB)`);
  console.log(`  dir   ${path.join(MODEL_ROOT, model.dir)}`);

  let sizes = {};
  let activeMirror = mirrors[0];
  for (const mirror of mirrors) {
    try {
      sizes = await remoteFiles(mirror, model.repo);
      activeMirror = mirror;
      console.log(`  src   ${mirror}`);
      break;
    } catch (err) {
      console.log(`  skip  mirror ${mirror} (${err.message})`);
    }
  }
  const missingInApi = plan.filter((f) => !sizes[f]);
  if (missingInApi.length) console.log(`  note  sizes unavailable for ${missingInApi.length} file(s), will HEAD`);

  if (args.dryRun) {
    let total = 0;
    for (const rel of plan) {
      const size = sizes[rel] || 0;
      total += size;
      console.log(`  ${size ? humanMB(size).padStart(10) : '       ?  '}  ${rel}`);
    }
    console.log(`total ~${humanMB(total)}`);
    return;
  }

  if (args.check) {
    const dir = path.join(MODEL_ROOT, model.dir);
    let ok = true;
    for (const rel of plan) {
      const file = path.join(dir, rel);
      let size = 0;
      try { size = (await fsp.stat(file)).size; } catch { /* missing */ }
      const expected = sizes[rel];
      const good = size > 0 && (!expected || size === expected);
      console.log(`  ${good ? 'ok  ' : 'MISS'} ${rel}${size ? ` (${humanMB(size)})` : ''}`);
      if (!good) ok = false;
    }
    console.log(ok ? 'OK — model files complete' : 'INCOMPLETE — run npm run models:vision');
    process.exit(ok ? 0 : 1);
  }

  const dir = path.join(MODEL_ROOT, model.dir);
  await fsp.mkdir(dir, { recursive: true });
  const installedAt = new Date().toISOString();
  const files = [];
  let bytes = 0;

  for (const rel of plan) {
    const target = path.join(dir, rel);
    let expected = sizes[rel] || null;
    let result;
    try {
      result = await downloadOne({ mirror: activeMirror, repo: model.repo, rel, target, expected, force: args.force });
    } catch (err) {
      // one retry through the other mirror
      const fallback = mirrors.find((m) => m !== activeMirror);
      if (!fallback) throw err;
      console.log(`  retry ${rel} via ${fallback} (${err.message})`);
      result = await downloadOne({ mirror: fallback, repo: model.repo, rel, target, expected, force: true });
      activeMirror = fallback;
    }
    bytes += result.size;
    files.push({ path: rel, bytes: result.size });
  }

  const manifest = {
    model: args.model,
    repo: model.repo,
    dtype,
    device: model.weights[dtype].device,
    label: model.label,
    installedAt,
    totalBytes: bytes,
    files: files.map((f) => ({ path: f.path, bytes: f.bytes })),
    machine: hw,
    apiHint: { localModelPath: '/models/', modelId: model.dir, dtype },
  };
  const manifestPath = path.join(dir, 'manifest.json');
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // keep a top-level index the API can read without scanning every repo
  const indexPath = path.join(MODEL_ROOT, 'index.json');
  let previous = { models: [] };
  try { previous = JSON.parse(await fsp.readFile(indexPath, 'utf8')); } catch { /* first install */ }
  const entry = {
    model: args.model,
    repo: model.repo,
    dir: model.dir,
    dtype,
    device: model.weights[dtype].device,
    label: model.label,
    totalBytes: bytes,
    manifest: path.relative(MODEL_ROOT, manifestPath).replace(/\\/g, '/'),
  };
  const models = (Array.isArray(previous.models) ? previous.models : []).filter((m) => m.model !== args.model);
  models.unshift(entry);
  const index = { updatedAt: installedAt, active: models[0].model, models };
  await fsp.writeFile(indexPath, JSON.stringify(index, null, 2));
  console.log(`done: ${humanMB(bytes)} in ${dir}`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
