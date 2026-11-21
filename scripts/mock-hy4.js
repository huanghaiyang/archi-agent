// Offline stand-in for a Hy4 deployment: implements just enough of the
// OpenAI-compatible surface (GET /v1/models, POST /v1/chat/completions) to
// exercise the agent's tool-calling loop without a GPU.
//
//   node scripts/mock-hy4.js            # listens on :8899
//   HY4_BASE_URL=http://127.0.0.1:8899/v1 AGENT_MODE=hy4 npm start
//
// It scripts a fixed design conversation: scheme -> roof -> check -> submit.

import http from 'node:http';

const PORT = Number(process.env.MOCK_HY4_PORT || 8899);
let calls = 0;

const PLAN = [
  {
    thought: '先定体量与功能：3 层社区图书馆，40×28m 场地。',
    tool: 'design_scheme',
    args: { programme: 'library', floors: 3, site_width: 40, site_depth: 28, style: 'timber', roof: 'gable' },
  },
  {
    thought: '屋面做双坡 28°，出檐 0.8m。',
    tool: 'edit_roof',
    args: { type: 'gable', pitch: 28, overhang: 0.8 },
  },
  {
    thought: '跑一遍规范校核。',
    tool: 'check_codes',
    args: {},
  },
  {
    thought: '定稿并推送到三维视图。',
    tool: 'submit_design',
    args: {
      title: '社区图书馆 · 木构双坡',
      notes: [
        '40×28m 场地，容积率 0.9，建筑密度 30%，三层通高门厅朝南。',
        '木格栅立面 + 双坡金属屋面，回应东北严寒气候对南向采光的需求。',
        '标准走廊 2.2m，楼梯核心筒设于东端，后续可增设第二疏散楼梯。',
      ],
    },
  },
  { content: '方案《社区图书馆 · 木构双坡》已定稿：3 层，总建筑面积约 1007㎡，容积率 0.9，窗地比 0.3，规范校核通过（提示：宜增设第二部疏散楼梯）。右侧视图可切换楼层查看内部排布。' },
];

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'hy4', object: 'model' }] }));
    return;
  }
  if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => {
      const body = JSON.parse(buf || '{}');
      const toolMsgs = (body.messages || []).filter((m) => m.role === 'tool').length;
      const step = PLAN[Math.min(toolMsgs, PLAN.length - 1)];
      calls += 1;
      const message = { role: 'assistant', content: step.content || step.thought || '' };
      if (step.tool) {
        message.tool_calls = [{
          id: `call_${calls}`,
          type: 'function',
          function: { name: step.tool, arguments: JSON.stringify(step.args) },
        }];
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: `chatcmpl-${calls}`,
        object: 'chat.completion',
        model: body.model || 'hy4',
        choices: [{ index: 0, message, finish_reason: step.tool ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 800, completion_tokens: 220, total_tokens: 1020 },
      }));
      console.log(`[mock-hy4] step ${toolMsgs + 1}: ${step.tool || 'final answer'}`);
    });
    return;
  }
  res.writeHead(404).end('not found');
});

server.listen(PORT, () => console.log(`[mock-hy4] OpenAI-compatible mock on http://127.0.0.1:${PORT}/v1`));
