#!/usr/bin/env node
// One-shot project bootstrap:
//   1. verify the Node version
//   2. install viewer dependencies
//   3. download the browser/WASM vision model if it is missing (resumable)
//   4. build the Vue viewer
//
//   npm run init
//   npm run init -- --skip-model      # weights already on disk / CI
//   npm run init -- --skip-build
//
// The download step is idempotent: an existing complete model is verified and
// skipped, a partial one resumes from the .part files.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = new Set(process.argv.slice(2));
const skipModel = flags.has('--skip-model');
const skipBuild = flags.has('--skip-build');
const skipInstall = flags.has('--skip-install');

const step = (n, text) => console.log(`\n[${n}/4] ${text}`);

function run(cmd, args, cwd = ROOT) {
  // npm is a .cmd shim on Windows, which Node cannot spawn directly (EINVAL).
  // shell:true routes it through cmd.exe; arguments here are fixed literals only.
  const isNpm = cmd === 'npm';
  const actual = isNpm && process.platform === 'win32' ? 'npm.cmd' : cmd;
  const res = spawnSync(actual, args, { cwd, stdio: 'inherit', env: process.env, shell: isNpm && process.platform === 'win32' });
  if (res.status !== 0) {
    console.error(`\nFAILED: ${cmd} ${args.join(' ')}${res.error ? ` (${res.error.message})` : ''}`);
    process.exit(res.status || 1);
  }
  return res;
}

step(1, 'check runtime');
const major = Number(process.versions.node.split('.')[0]);
console.log(`  node ${process.version} · ${process.arch}`);
if (major < 20) {
  console.error('  Node 20+ is required.');
  process.exit(1);
}
console.log(`  data  ${path.join(ROOT, 'server', 'data')}`);
if (!fs.existsSync(path.join(ROOT, 'server', 'data', 'models'))) {
  fs.mkdirSync(path.join(ROOT, 'server', 'data', 'models'), { recursive: true });
}

step(2, 'install viewer dependencies');
if (skipInstall) console.log('  skipped (--skip-install)');
else {
  const webPkg = path.join(ROOT, 'web', 'package.json');
  if (!fs.existsSync(path.join(ROOT, 'web', 'node_modules')) || !fs.existsSync(webPkg)) {
    run('npm', ['--prefix', 'web', 'install']);
  } else {
    console.log('  web/node_modules present, running npm install to sync');
    run('npm', ['--prefix', 'web', 'install']);
  }
}

step(3, 'local vision models (SmolVLM 500M browser + Qwen2-VL 2B server)');
if (skipModel) console.log('  skipped (--skip-model)');
else {
  for (const model of ['smolvlm-500m', 'qwen2-vl-2b']) {
    const check = spawnSync(process.execPath, ['scripts/download-vision-model.mjs', '--model', model, '--check'], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
    if (check.status === 0) {
      console.log(`  ${model}: already installed`);
    } else {
      console.log(`  ${model}: missing or incomplete, starting download (resumable)`);
      run(process.execPath, ['scripts/download-vision-model.mjs', '--model', model, ...(flags.has('--force') ? ['--force'] : [])]);
    }
  }
}

step(4, 'build the viewer');
if (skipBuild) console.log('  skipped (--skip-build)');
else run('npm', ['--prefix', 'web', 'run', 'build']);

console.log('\nDone. Next:');
console.log('  npm start           # serve http://127.0.0.1:8787');
console.log('  npm run models:check');
console.log('  npm run test:local-vision   # real inference smoke test (CPU, slow)');
