#!/usr/bin/env node
// Hy4 backend weight downloader (ModelScope mirror).
//
//   npm run models:hy4:plan        # show repo size / disk / GPU before any bytes
//   npm run models:hy4:config      # fetch config, tokenizer and shard index (~30 MB)
//   npm run models:hy4             # full weights (refuses when disk cannot hold them)
//   npm run models:hy4:check       # inspect what is already on disk
//
// Why ModelScope: this machine cannot reach huggingface.co (`tencent/Hy4-FP8`),
// while modelscope.cn answers normally. The script is resumable, verifies each
// file size, and writes a status manifest under the model directory.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.ARCHI_DATA_DIR || path.join(ROOT, 'server', 'data');
const MODEL_ROOT = path.join(DATA_DIR, 'models');
const API = 'https://modelscope.cn/api/v1/models';

const MODELS = {
  'hy4-fp8': {
    repo: 'Tencent-Hunyuan/Hy4-FP8',
    dir: 'Hy4-FP8',
    label: 'Hy4 770B-A49B · FP8 指令模型',
  },
  'hy4-flash-fp8': {
    repo: 'Tencent-Hunyuan/Hy4-flash-FP8',
    dir: 'Hy4-flash-FP8',
    label: 'Hy4 flash 224B-A12B · FP8 指令模型',
  },
};

function parseArgs(argv) {
  const out = { model: 'hy4-fp8', mode: 'all', force: false, allowOvercommit: false };
  for (const arg of argv.slice(2)) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'model' && value) out.model = value;
    else if (key === 'plan') out.mode = 'plan';
    else if (key === 'config' || key === 'config-only') out.mode = 'config';
    else if (key === 'check') out.mode = 'check';
    else if (key === 'all') out.mode = 'all';
    else if (key === 'force') out.force = true;
    else if (key === 'allow-overcommit') out.allowOvercommit = true;
    else if (key === 'help' || key === '-h') out.help = true;
  }
  return out;
}

const humanGB = (n) => `${(n / 1024 ** 3).toFixed(2)} GB`;
const human = (n) => (n >= 1024 ** 3 ? humanGB(n) : `${Math.round(n / 1048576)} MB`);

function hardware() {
  const cpus = os.cpus();
  const ramGB = os.totalmem() / 1024 ** 3;
  let gpu = null;
  const smi = spawnSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], { encoding: 'utf8', timeout: 5000 });
  if (smi.status === 0 && smi.stdout.trim()) gpu = smi.stdout.trim().split(/\r?\n/)[0];
  let freeGB = null;
  try {
    const st = fs.statfsSync(DATA_DIR);
    freeGB = (st.bavail * st.bsize) / 1024 ** 3;
  } catch { /* ignore */ }
  return { cpu: cpus[0]?.model?.trim() || 'unknown', threads: cpus.length, ramGB: +ramGB.toFixed(1), gpu, freeGB: freeGB == null ? null : +freeGB.toFixed(1) };
}

async function fetchJson(url, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'archi-agent-hy4-downloader' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function remoteFiles(repo) {
  const url = `${API}/${repo}/repo/files?Revision=master&Root=`;
  const data = await fetchJson(url);
  const rows = data?.Data?.Files || [];
  return rows
    .filter((f) => Number(f.Size) > 0)
    .map((f) => ({ path: f.Path || f.Name, size: Number(f.Size), type: f.Type || '' }));
}

async function downloadOne({ repo, rel, size, target, force }) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  let have = 0;
  try { have = (await fsp.stat(target)).size; } catch { /* missing */ }
  if (have === size && !force) {
    console.log(`  skip   ${rel} (${human(size)})`);
    return { rel, size, skipped: true };
  }

  const part = `${target}.part`;
  let start = 0;
  try { start = (await fsp.stat(part)).size; } catch { /* fresh */ }
  if (force) { await fsp.rm(part, { force: true }); start = 0; }
  if (start > size) { await fsp.rm(part, { force: true }); start = 0; }

  const url = `https://modelscope.cn/models/${repo}/resolve/master/${rel.split('/').map(encodeURIComponent).join('/')}`;
  const headers = { 'User-Agent': 'archi-agent-hy4-downloader' };
  if (start) headers.Range = `bytes=${start}-`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300000);
  let res;
  try {
    res = await fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} for ${rel}`);
  const resumed = res.status === 206 && start > 0;
  if (!resumed) start = 0;

  const stream = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' });
  let written = start;
  try {
    for await (const chunk of res.body) {
      written += chunk.length;
      if (!stream.write(chunk)) await new Promise((resolve) => stream.once('drain', resolve));
      if (size && written % (64 * 1048576) < chunk.length) {
        process.stdout.write(`\r  fetch  ${rel} ${Math.round((written / size) * 100)}%   `);
      }
    }
  } finally {
    await new Promise((resolve) => stream.end(resolve));
  }
  process.stdout.write('\r');
  const finalSize = (await fsp.stat(part)).size;
  if (size && finalSize !== size) throw new Error(`${rel}: expected ${size} bytes, got ${finalSize}`);
  await fsp.rm(target, { force: true });
  await fsp.rename(part, target);
  console.log(`  saved  ${rel} (${human(finalSize)})`);
  return { rel, size: finalSize };
}

function metadataOnly(file) {
  if (/\.safetensors$/i.test(file.path)) return false;
  return /\.(json|jinja|md|txt)$/i.test(file.path) || /^(LICENSE|\.gitattributes|\.gitignore)$/i.test(file.path);
}

async function writeStatus(modelDir, status) {
  await fsp.mkdir(modelDir, { recursive: true });
  await fsp.writeFile(path.join(modelDir, 'download-status.json'), JSON.stringify({
    updatedAt: new Date().toISOString(),
    ...status,
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`usage: node scripts/download-hy4-model.mjs [options]
  --model=hy4-fp8|hy4-flash-fp8
  --plan             show repo + hardware only
  --config           download metadata (config/tokenizer/index)
  --all              full weights (default)
  --check            inspect local files
  --force            re-download existing files
  --allow-overcommit download even if free disk < repo size`);
    return;
  }
  const def = MODELS[args.model];
  if (!def) throw new Error(`unknown model ${args.model}; choose ${Object.keys(MODELS).join(', ')}`);
  const modelDir = path.join(MODEL_ROOT, def.dir);
  const hw = hardware();

  console.log(`\n  ${def.label}`);
  console.log(`  repo     ${def.repo}`);
  console.log(`  target   ${modelDir}`);
  console.log(`  cpu      ${hw.cpu} (${hw.threads} threads / ${hw.ramGB} GB RAM)`);
  console.log(`  gpu      ${hw.gpu || 'not detected'}`);
  console.log(`  disk     ${hw.freeGB == null ? 'unknown' : `${hw.freeGB} GB free`}`);

  if (args.mode === 'check') {
    const statusPath = path.join(modelDir, 'download-status.json');
    const files = await fsp.readdir(modelDir).catch(() => []);
    const weights = files.filter((f) => f.endsWith('.safetensors'));
    let bytes = 0;
    for (const f of files) bytes += (await fsp.stat(path.join(modelDir, f)).catch(() => ({ size: 0 }))).size;
    const status = fs.existsSync(statusPath) ? JSON.parse(await fsp.readFile(statusPath, 'utf8')) : null;
    console.log(`  local    ${files.length} entries, ${human(bytes)}, ${weights.length} weight shards`);
    console.log(`  status   ${status ? (status.complete ? 'COMPLETE' : `INCOMPLETE — ${status.reason || 'partial'}`) : 'no manifest'}\n`);
    return;
  }

  console.log('  querying ModelScope file list…');
  const files = await remoteFiles(def.repo);
  const total = files.reduce((n, f) => n + f.size, 0);
  const weights = files.filter((f) => /\.safetensors$/i.test(f.path));
  console.log(`  files    ${files.length} (${weights.length} weight shards)`);
  console.log(`  size     ${humanGB(total)}`);

  if (args.mode === 'plan') {
    const enough = hw.freeGB != null && hw.freeGB > total / 1024 ** 3 + 8;
    console.log(`  verdict  ${enough ? 'fits on disk' : `NOT feasible: needs ${humanGB(total)}, disk has ${hw.freeGB} GB`}`);
    console.log(`  gpu need  Hy4 FP8 normally needs multiple 80GB GPUs (tensor parallel 8); this host has ${hw.gpu || 'no NVIDIA GPU'}.\n`);
    return;
  }

  if (args.mode === 'all' && !args.allowOvercommit) {
    if (hw.freeGB == null || hw.freeGB < total / 1024 ** 3 + 8) {
      await writeStatus(modelDir, {
        model: def.repo,
        mode: 'all',
        complete: false,
        reason: `磁盘不足：需要 ${humanGB(total)}，当前可用 ${hw.freeGB} GB`,
        totalBytes: total,
        freeBytes: hw.freeGB == null ? null : Math.round(hw.freeGB * 1024 ** 3),
      });
      throw new Error(`拒绝下载：需要 ${humanGB(total)}，当前磁盘仅 ${hw.freeGB} GB 可用。先清理磁盘，或使用 --allow-overcommit，或改用 Hy4 API。`);
    }
  }

  const selected = args.mode === 'config' ? files.filter(metadataOnly) : files;
  const selectedBytes = selected.reduce((n, f) => n + f.size, 0);
  console.log(`  fetching ${selected.length} files (${human(selectedBytes)})\n`);
  const saved = [];
  for (const file of selected) {
    const target = path.join(modelDir, file.path);
    try {
      const result = await downloadOne({ repo: def.repo, rel: file.path, size: file.size, target, force: args.force });
      saved.push(result);
    } catch (err) {
      console.error(`\n  ERROR ${file.path}: ${err.message}`);
      await writeStatus(modelDir, {
        model: def.repo, mode: args.mode, complete: false, reason: err.message,
        totalBytes: total, downloadedBytes: saved.reduce((n, f) => n + f.size, 0), freeBytes: hw.freeGB == null ? null : Math.round(hw.freeGB * 1024 ** 3),
      });
      process.exitCode = 1;
      return;
    }
  }

  const downloaded = saved.reduce((n, f) => n + f.size, 0);
  await writeStatus(modelDir, {
    model: def.repo,
    label: def.label,
    mode: args.mode,
    complete: args.mode === 'all',
    reason: args.mode === 'all' ? '' : '仅下载配置/tokenizer/index，权重组未下载（体积超出本机磁盘与显存）',
    totalBytes: total,
    downloadedBytes: downloaded,
    weightShards: weights.length,
    hardware: hw,
  });
  console.log(`\n  done. ${saved.length} files, ${human(downloaded)}. manifest: ${path.join(modelDir, 'download-status.json')}\n`);
}

main().catch((err) => {
  console.error(`\n  FAILED: ${err.message}\n`);
  process.exitCode = 1;
});
