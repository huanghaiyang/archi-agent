// Verifies the Hy4 tool-calling path end to end against the local mock:
// agent server -> Hy4-compatible /v1/chat/completions -> tool loop -> spec.
//   node scripts/test-hy4-loop.js

import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const HY4_PORT = 8891;
const AGENT_PORT = 8793;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const mock = spawn(process.execPath, ['scripts/mock-hy4.js'], {
  cwd: ROOT,
  env: { ...process.env, MOCK_HY4_PORT: String(HY4_PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const agent = spawn(process.execPath, ['server/src/index.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(AGENT_PORT),
    AGENT_MODE: 'hy4',
    HY4_BASE_URL: `http://127.0.0.1:${HY4_PORT}/v1`,
    HY4_MODEL: 'hy4',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
mock.stdout.on('data', (d) => { logs += `[mock] ${d}`; });
agent.stdout.on('data', (d) => { logs += `[agent] ${d}`; });
agent.stderr.on('data', (d) => { logs += `[agent:err] ${d}`; });

async function main() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const h = await fetch(`http://127.0.0.1:${AGENT_PORT}/api/health`);
      const j = await h.json();
      if (j.hy4.reachable) break;
    } catch (err) { /* still booting */ }
    await wait(200);
  }

  const res = await fetch(`http://127.0.0.1:${AGENT_PORT}/api/design`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '哈尔滨 40×28m 场地，设计 3 层社区图书馆，坡屋顶', sid: 'hy4test' }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

  console.log(`mode      ${json.mode}`);
  console.log(`title     ${json.spec.meta.title}`);
  console.log(`generated ${json.spec.meta.generatedBy}`);
  console.log(`roof      ${json.spec.massing.roof.type} @ ${json.spec.massing.roof.pitch}° / overhang ${json.spec.massing.roof.overhang}`);
  console.log(`facade    ${json.spec.facade.system} / ${json.spec.facade.materials.wall}`);
  console.log(`metrics   gfa ${json.spec.metrics.gfa}㎡ · far ${json.spec.metrics.far} · wfr ${json.spec.metrics.windowFloorRatio}`);
  console.log(`checks    ${json.spec.checkSummary.headline}`);
  console.log(`notes     ${json.spec.notes.length} 条`);
  console.log(`reply     ${json.text.slice(0, 120)}…`);
  if (json.mode !== 'hy4') throw new Error('agent did not use the Hy4 path');
  console.log('\n  OK — Hy4 tool-calling loop works\n');
}

main()
  .catch((err) => {
    console.error('test failed:', err.message);
    if (logs) console.error(logs);
    process.exitCode = 1;
  })
  .finally(() => {
    agent.kill();
    mock.kill();
  });
