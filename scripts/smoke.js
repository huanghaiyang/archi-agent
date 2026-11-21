// End-to-end smoke test: boots the server, runs a design brief through the
// real HTTP + SSE-stack turn, then prints the resulting metrics.
//   node scripts/smoke.js  [brief]

import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8791;
const brief = process.argv.slice(2).join(' ') || '哈尔滨 40×28m 场地，设计一栋 3 层社区图书馆，暖木与清水混凝土，南向入口，坡屋顶';

const server = spawn(process.execPath, ['server/src/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), AGENT_MODE: 'local' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d.toString(); });
server.stderr.on('data', (d) => { serverLog += d.toString(); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) break;
    } catch (err) {
      await wait(150);
    }
  }

  const res = await fetch(`${base}/api/design`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: brief, sid: 'smoke', mode: 'local' }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

  const spec = json.spec;
  const m = spec.metrics;
  console.log(`\n  brief  ${brief}`);
  console.log(`  scheme ${spec.meta.title} · ${spec.floors.length} 层 · ${spec.meta.styleLabel}`);
  console.log(`  gfa ${m.gfa}㎡ · far ${m.far} · density ${(m.coverage * 100).toFixed(0)}% · wfr ${m.windowFloorRatio} · rooms ${m.roomCount}`);
  console.log(`  roof ${spec.massing.roof.type} · facade ${spec.facade.system} / ${spec.facade.materials.wall} / ${spec.facade.materials.glass}`);
  console.log(`  checks ${spec.checkSummary.headline}`);
  for (const c of spec.checks) console.log(`    ${c.status.padEnd(4)} ${c.name.padEnd(6)} ${c.value}${c.limit ? ` / ${c.limit}` : ''}  ${c.advice}`);
  console.log('\n  reply:');
  console.log(json.text.split('\n').map((l) => `    ${l}`).join('\n'));
  console.log('\n  OK\n');
}

main()
  .catch((err) => {
    console.error('smoke failed:', err.message);
    if (serverLog) console.error(serverLog);
    process.exitCode = 1;
  })
  .finally(() => server.kill());
