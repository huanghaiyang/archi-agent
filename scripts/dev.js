// Dev runner: starts the agent server and the Vite dev server together.
// Zero dependencies — just child_process with prefixed logs.

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const procs = [];
function run(name, cmd, args, cwd, color) {
  const child = spawn(cmd, args, { cwd, shell: process.platform === 'win32', env: process.env });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m`;
  for (const stream of ['stdout', 'stderr']) {
    child[stream].on('data', (chunk) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) console.log(`${prefix} ${line}`);
      }
    });
  }
  child.on('exit', (code) => console.log(`${prefix} exited (${code})`));
  procs.push(child);
  return child;
}

console.log('启动 筑野 ARCHI-AGENT …\n');
run('server', process.execPath, ['server/src/index.js'], ROOT, '33');
setTimeout(() => {
  run('vite', npm, ['run', 'dev'], path.join(ROOT, 'web'), '36');
}, 600);

const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
