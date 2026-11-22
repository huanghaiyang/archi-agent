// The agent loop. Two brains, one tool contract:
//   - Hy4 (OpenAI-compatible tool calling) when a deployment is reachable;
//   - a deterministic local planner so the sample always runs end-to-end.

import { config } from '../config.js';
import { parseBrief } from '../design/generator.js';
import { newDraft } from '../design/spec.js';
import { logger } from '../logger.js';
import { chat, probeModel, supportsVision } from './llm.js';
import { buildSystemPrompt } from './prompt.js';
import { createSession, digest, runTool, tools } from './tools.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export { createSession };

/** Run one user turn; `emit` receives SSE-ready event objects. */
export async function runAgent({ session, message, emit, mode }) {
  const t0 = Date.now();
  logger.info('agent', 'turn start', { requestedMode: mode || config.mode, chars: message.length, hasSpec: Boolean(session.spec?.floors?.length), vision: supportsVision() && Boolean(session.reference?.dataUrl) });
  // First substantive turn: seed the draft from the brief so that Hy4 reads a
  // real site/programme instead of an empty default.
  let seededNow = false;
  if (!session.brief && /设计|生成|方案|建一?栋?|场地|㎡|层/.test(message)) {
    session.brief = message;
    session.spec = newDraft(message);
    seededNow = true;
    emitSpec(session, emit);
  }
  const useHy4 = await resolveMode(mode);
  logger.info('agent', 'engine resolved', { mode: useHy4 ? 'hy4' : 'local', ms: Date.now() - t0 });
  if (useHy4) {
    try {
      const text = await runHy4Turn(session, message, emit);
      emit({ type: 'done', mode: 'hy4' });
      logger.info('agent', 'turn complete', { mode: 'hy4', ms: Date.now() - t0, textChars: text.length });
      return { text, mode: 'hy4' };
    } catch (err) {
      const reason = err.message || String(err);
      logger.error('agent', 'hy4 turn failed, falling back', { ms: Date.now() - t0, err });
      emit({ type: 'status', tone: 'warn', text: `Hy4 不可用（${reason}），已切换到本地设计引擎。` });
      // fall through to the deterministic planner
    }
  }
  const text = await runLocalTurn(session, message, emit, seededNow);
  emit({ type: 'done', mode: 'local' });
  logger.info('agent', 'turn complete', { mode: 'local', ms: Date.now() - t0, textChars: text.length });
  return { text, mode: 'local' };
}

async function resolveMode(mode) {
  if (mode === 'local' || config.mode === 'local') return false;
  if (mode === 'hy4') return true;
  if (config.mode === 'hy4') return true;
  const probe = await probeModel();
  return probe.reachable;
}

async function callTool(session, name, args, emit) {
  const id = `t${Date.now()}${Math.random().toString(16).slice(2, 6)}`;
  const t0 = Date.now();
  emit({ type: 'tool_start', id, name, args });
  logger.info('agent', 'tool start', { id, name, args });
  let result;
  try {
    result = await runTool(session, name, args);
    logger.info('agent', 'tool ok', { id, name, ms: Date.now() - t0, summary: result.summary });
    emit({ type: 'tool_end', id, name, ok: true, summary: result.summary });
    emitSpec(session, emit);
    return { ok: true, result };
  } catch (err) {
    logger.error('agent', 'tool failed', { id, name, ms: Date.now() - t0, err });
    emit({ type: 'tool_end', id, name, ok: false, summary: err.message });
    return { ok: false, error: err.message };
  }
}

function emitSpec(session, emit) {
  emit({ type: 'spec', spec: session.spec, digest: digest(session.spec) });
}

// ------------------------------------------------------------------- Hy4 path
async function runHy4Turn(session, message, emit) {
  if (!session.history) session.history = [];
  const messages = [
    { role: 'system', content: buildSystemPrompt(digest(session.spec)) },
    ...session.history.slice(-8),
    {
      role: 'user',
      content: supportsVision() && session.reference?.dataUrl
        ? [
          { type: 'text', text: `${message}\n（用户上传了建筑参考图，请结合图片的体量、材质与色彩做方案。）` },
          { type: 'image_url', image_url: { url: session.reference.dataUrl } },
        ]
        : message,
    },
  ];

  emit({ type: 'status', text: 'Hy4 正在阅读任务书并编排设计工具…' });
  let finalText = '';
  let steps = 0;
  let submitted = false;

  while (steps < config.maxSteps) {
    steps += 1;
    logger.info('agent', 'hy4 step', { step: steps, messages: messages.length });
    const res = await chat({ messages, tools });
    if (res.reasoning) emit({ type: 'thinking', text: res.reasoning.slice(0, 800) });

    if (res.toolCalls?.length) {
      messages.push({ role: 'assistant', content: res.content || '', tool_calls: res.toolCalls });
      for (const tc of res.toolCalls) {
        const name = tc.function?.name;
        let args = {};
        try {
          args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch (err) {
          logger.error('agent', 'tool args invalid json', { id: tc.id, name, err, raw: tc.function?.arguments });
          emit({ type: 'tool_end', id: tc.id, name, ok: false, summary: '参数不是合法 JSON' });
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ ok: false, error: 'arguments 必须是合法 JSON 对象' }) });
          continue;
        }
        emit({ type: 'tool_start', id: tc.id, name, args });
        logger.info('agent', 'tool start', { id: tc.id, name, args, step: steps });
        let out;
        const toolT0 = Date.now();
        try {
          out = await runTool(session, name, args);
          logger.info('agent', 'tool ok', { id: tc.id, name, step: steps, ms: Date.now() - toolT0, summary: out.summary });
          emit({ type: 'tool_end', id: tc.id, name, ok: true, summary: out.summary });
          emitSpec(session, emit);
          if (name === 'submit_design') submitted = true;
        } catch (err) {
          logger.error('agent', 'tool failed', { id: tc.id, name, step: steps, ms: Date.now() - toolT0, err });
          out = { error: err.message };
          emit({ type: 'tool_end', id: tc.id, name, ok: false, summary: err.message });
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) });
      }
      if (res.content) emit({ type: 'text', text: res.content });
      continue;
    }

    // plain assistant answer -> turn finished
    finalText = (res.content || '').trim();
    if (finalText) emit({ type: 'text', text: finalText });
    messages.push({ role: 'assistant', content: finalText });
    break;
  }

  if (steps >= config.maxSteps) {
    emit({ type: 'status', tone: 'warn', text: '达到工具调用步数上限，先按当前方案定稿。' });
  }

  if (!submitted) {
    await callTool(session, 'check_codes', {}, emit);
    await callTool(session, 'submit_design', { title: session.spec.meta.title, notes: session.spec.notes }, emit);
  }

  session.history = [...(session.history || []), { role: 'user', content: message }, { role: 'assistant', content: finalText }];
  if (!finalText) {
    finalText = localSummary(session.spec);
    emit({ type: 'text', text: finalText });
  }
  return finalText;
}

// ----------------------------------------------------------------- local path
function classify(message, hasSpec) {
  if (!hasSpec) return 'new';
  const text = String(message);
  // a fresh commission, not an edit of the current scheme
  if (/(设计|新建|重新|另|再造|换一)/.test(text) && !/(改成|调整为|修改|加上|去掉|保留)/.test(text)) return 'new';
  if (/屋顶|坡屋|屋面|女儿墙|出檐/.test(text)) return 'roof';
  if (/立面|幕墙|开窗|窗洞|条窗|格栅|外墙|材料|配色|颜色/.test(text)) return 'facade';
  if (/(层数|几层|加一层|减一层|再加|抬高|降低|加到|减到)/.test(text)) return 'floors';
  if (/场地|退线|红线|容积率|密度|气候|朝向/.test(text)) return 'site';
  if (/校核|规范|检查|有没有问题|合规/.test(text)) return 'check';
  if (/指标|面积|多少|介绍|说明|总结|为什么/.test(text) && hasSpec) return 'explain';
  return 'new';
}

function extractNumbers(text) {
  return (String(text).match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function parseFloorCount(message, cur) {
  const text = String(message);
  const target = text.match(/(?:做成|改成|调整为|做到)\s*(\d+|[一二两三四五六七八九十])\s*层/);
  if (target) {
    const v = /^\d+$/.test(target[1]) ? Number(target[1]) : CN_NUM[target[1]];
    return Math.min(12, Math.max(1, v || cur));
  }
  const add = text.match(/(?:再加|加|增)\s*(\d+)?\s*层/);
  if (add && !/做成|改成|调整为/.test(text)) return Math.min(12, cur + (add[1] ? Number(add[1]) : 1));
  const cut = text.match(/(?:再减|减|少)\s*(\d+)?\s*层/);
  if (cut) return Math.max(1, cur - (cut[1] ? Number(cut[1]) : 1));
  const digits = text.match(/(\d+)\s*层/);
  if (digits) return Math.min(12, Math.max(1, Number(digits[1])));
  const cn = text.match(/([一二两三四五六七八九十])\s*层/);
  if (cn) return Math.min(12, Math.max(1, CN_NUM[cn[1]]));
  return Math.min(12, cur + 1);
}

/** One sentence may contain several edits ("加一层，屋顶改双坡"): apply them all. */
function planOps(message, session) {
  const text = String(message);
  const ops = [];

  if (/屋顶|坡屋|屋面|女儿墙|出檐/.test(text)) {
    const args = {};
    if (/单坡/.test(text)) args.type = 'shed';
    else if (/双坡|坡屋/.test(text)) args.type = 'gable';
    else if (/平屋/.test(text)) args.type = 'flat';
    else if (/四坡/.test(text)) args.type = 'hip';
    const deg = text.match(/(\d+(?:\.\d+)?)\s*[°度]/);
    if (deg) args.pitch = Number(deg[1]);
    const oh = text.match(/出檐\s*(\d+(?:\.\d+)?)/);
    if (oh) args.overhang = Number(oh[1]);
    if (Object.keys(args).length) ops.push({ name: 'edit_roof', args });
  }

  if (/立面|幕墙|开窗|窗洞|条窗|格栅|外墙|材料|配色|颜色/.test(text)) {
    const args = {};
    if (/幕墙|玻璃幕墙/.test(text)) args.system = 'curtain';
    else if (/条窗|横向/.test(text)) args.system = 'ribbon';
    else if (/格栅|屏/.test(text)) args.system = 'screen';
    else if (/点窗|开洞|点式/.test(text)) args.system = 'punched';
    const win = text.match(/(?:开窗|窗洞|洞口|窗户)[^0-9]{0,10}(\d+(?:\.\d+)?)/)
      || text.match(/(\d+(?:\.\d+)?)\s*(?:m|米)\s*(?:宽)?的?窗/);
    if (win) args.windowWidth = Number(win[1]);
    const mats = {};
    if (/木格栅|木质|木构/.test(text)) { mats.wall = 'timber-slat'; mats.frame = 'dark-metal'; }
    else if (/红砖/.test(text)) { mats.wall = 'red-brick'; mats.frame = 'corten-steel'; }
    else if (/青砖/.test(text)) { mats.wall = 'grey-brick'; }
    else if (/耐候钢/.test(text)) { mats.frame = 'corten-steel'; mats.wall = 'corten-steel'; }
    else if (/白墙|白色|极简/.test(text)) { mats.wall = 'white-plaster'; mats.glass = 'clear-glass'; }
    else if (/铝板|金属幕墙/.test(text)) { mats.wall = 'aluminium'; mats.glass = 'blue-glass'; }
    if (Object.keys(mats).length) args.materials = mats;
    if (Object.keys(args).length) ops.push({ name: 'edit_facade', args });
  }

  if (/(层数|几层|加一层|减一层|再加|做成.{0,6}层|改成.{0,6}层|\d+\s*层)/.test(text)) {
    const count = parseFloorCount(text, session.spec?.floors.length || 3);
    if (count !== session.spec?.floors.length) ops.push({ name: 'set_floors', args: { count } });
  }

  if (/场地|退线|红线|容积率|密度|气候|朝向/.test(text)) {
    const nums = extractNumbers(text);
    const args = {};
    if (/容积率/.test(text) && nums.length) args.farLimit = nums[0];
    else if (/密度/.test(text) && nums.length) args.coverageLimit = nums[0] > 1 ? nums[0] / 100 : nums[0];
    else if (/退线/.test(text) && nums.length) args.setback = { front: nums[0] };
    if (Object.keys(args).length) ops.push({ name: 'edit_site', args });
  }

  return ops;
}

async function runLocalTurn(session, message, emit, forceNew = false) {
  const hasSpec = Boolean(session.spec?.meta?.brief);
  const intent = forceNew ? 'new' : classify(message, hasSpec);
  emit({ type: 'status', text: `本地设计引擎接管（${forceNew ? 'new' : intent}）。Hy4 接入后同一套工具会被模型编排。` });
  await sleep(150);

  if (intent === 'explain') {
    const text = localSummary(session.spec);
    emit({ type: 'text', text });
    emitSpec(session, emit);
    return text;
  }

  let changed = false;
  if (intent === 'new') {
    session.brief = message;
    await callTool(session, 'design_scheme', parseLocalArgs(message, session), emit);
    await sleep(120);
    changed = true;
  } else {
    const ops = planOps(message, session);
    for (const op of ops) {
      await callTool(session, op.name, op.args, emit);
      changed = true;
    }
    if (!changed && intent === 'check') {
      // pure review request, nothing to modify
    }
  }

  await callTool(session, 'check_codes', {}, emit);
  const notes = session.spec.notes.slice(0, 3);
  await callTool(session, 'submit_design', { title: session.spec.meta.title, notes }, emit);

  const text = localSummary(session.spec);
  emit({ type: 'text', text });
  session.history = [...(session.history || []), { role: 'user', content: message }, { role: 'assistant', content: text }];
  return text;
}

function parseLocalArgs(message, session) {
  const parsed = parseBrief(message);
  return {
    programme: parsed.programme || session?.spec?.meta?.programme || 'library',
    floors: parsed.floors,
    site_width: parsed.site?.width,
    site_depth: parsed.site?.depth,
    area: parsed.area,
    style: parsed.style,
    roof: parsed.roof,
    stepped: parsed.stepped,
    climate: parsed.climate,
  };
}

function sessionProgrammeDefault() {
  return 'library';
}

function localSummary(spec) {
  const m = spec.metrics;
  const c = spec.checkSummary;
  const name = spec.meta.title;
  const lines = [
    `《${name}》：${spec.floors.length} 层，总建筑面积 ${m.gfa}㎡，容积率 ${m.far}，建筑密度 ${(m.coverage * 100).toFixed(0)}%，窗地比 ${m.windowFloorRatio}。`,
    c.headline + (c.fail ? '，建议先处理硬性冲突再深化。' : '。'),
    `${spec.floors[0] ? `首层 ${spec.floors[0].height}m 通高门厅朝南，标准层 ${spec.floors[1]?.height || 3.6}m，` : ''}走廊 ${m.corridorWidth}m，核心筒设于平面端部。`,
    '方案已推送到右侧三维视图。可以继续让我调整屋顶、立面开窗、层数或场地退线。',
  ];
  return lines.join('\n');
}
