// Offline stand-in for a vision-capable OpenAI-compatible endpoint, used by
// scripts/test-vision.mjs to prove the reference-image -> JSON -> spec path
// works without a GPU or a real VLM.
//
//   node scripts/mock-vision.js        # listens on :8890
//
// It only answers chat/completions requests that actually carry an image_url
// part, and returns the strict JSON shape design/reference.js expects.

import http from 'node:http';

const PORT = Number(process.env.MOCK_VISION_PORT || 8890);
const MODEL = process.env.MOCK_VISION_MODEL || 'mock-vision-4b';
let calls = 0;

const ANALYSIS = {
  programme: 'museum',
  style: 'concrete',
  floors: 3,
  materials: ['white_concrete', 'glass', 'steel'],
  description: '清水混凝土美术馆，横向长窗，三层体量架空于草坡之上。',
};

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model' }, { id: 'hy4', object: 'model' }] }));
    return;
  }
  if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => {
      const body = JSON.parse(buf || '{}');
      const parts = (body.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : []));
      const images = parts.filter((p) => p.type === 'image_url' && p.image_url?.url);
      calls += 1;
      console.log(`[mock-vision] call ${calls} model=${body.model} images=${images.length}`);
      if (!images.length) {
        // plain text chat (agent loop) — answer briefly so the UI keeps working
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: `chatcmpl-v${calls}`,
          object: 'chat.completion',
          model: body.model || MODEL,
          choices: [{ index: 0, message: { role: 'assistant', content: '已按参考图的理解给出方案，可在右侧视图查看。' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 },
        }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: `chatcmpl-v${calls}`,
        object: 'chat.completion',
        model: body.model || MODEL,
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(ANALYSIS) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1200, completion_tokens: 90, total_tokens: 1290 },
      }));
    });
    return;
  }
  res.writeHead(404).end('not found');
});

server.listen(PORT, () => console.log(`[mock-vision] OpenAI-compatible VLM mock on http://127.0.0.1:${PORT}/v1 (model ${MODEL})`));
