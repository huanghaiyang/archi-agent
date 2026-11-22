// Zero-dependency HTTP server: SSE chat, reference-image intake, finished
// scheme library (with recycle bin), model settings, static viewer hosting.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, publicSettings, saveSettings } from './config.js';
import { probeModel, probeProvider } from './agent/llm.js';
import { createSession, runAgent } from './agent/loop.js';
import { digest } from './agent/tools.js';
import { finalize } from './design/spec.js';
import { analyzeReference, referenceBrief, adoptLocalAnalysis } from './design/reference.js';
import { PROGRAMMES, STYLES } from './design/generator.js';
import { PARAM_SCHEMA, composePrompt } from './design/promptParams.js';
import { LOG_DIR, logger, readLogTail, requestId } from './logger.js';
import {
  addLibraryItem,
  dropSessionState,
  emptyTrash,
  getLibraryItem,
  listLibrary,
  listTrash,
  loadSessionState,
  moveToTrash,
  purgeFromTrash,
  restoreFromTrash,
  saveReferenceImage,
  saveSessionState,
  updateLibraryItem,
} from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DIST = path.join(ROOT, 'web', 'dist');
const MODEL_DIR = path.join(config.dataDir, 'models');

const sessions = new Map();

function getSession(sid = 'demo') {
  if (!sessions.has(sid)) {
    const saved = loadSessionState(sid);
    const session = createSession('');
    if (saved) {
      session.brief = saved.brief || '';
      session.history = Array.isArray(saved.history) ? saved.history : [];
      session.spec = saved.spec || null;
      session.reference = saved.reference || null;
    }
    sessions.set(sid, session);
  }
  return sessions.get(sid);
}

const persist = (sid, session) => saveSessionState(sid, {
  brief: session.brief,
  history: session.history,
  spec: session.spec,
  reference: session.reference
    ? { url: session.reference.url, analysis: session.reference.analysis, at: session.reference.at }
    : null,
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 14 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveFile(res, filePath, cache = 'public, max-age=3600') {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
  fs.createReadStream(filePath).pipe(res);
}

/** /media/<kind>/<name> -> server/data/<kind>/<name> */
function serveMedia(res, pathname) {
  const rel = pathname.replace('/media/', '').split('/');
  if (rel.length !== 2 || !/^[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp)$/i.test(rel[1])) {
    res.writeHead(404).end('not found');
    return;
  }
  const file = path.join(config.dataDir, rel[0], rel[1]);
  if (!file.startsWith(config.dataDir) || !fs.existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  serveFile(res, file, 'public, max-age=86400');
}

/** /models/<repo>/<file> -> server/data/models/<repo>/<file> with Range support. */
function serveModel(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname.replace(/^\/models\//, '')); } catch { rel = ''; }
  const file = path.resolve(MODEL_DIR, rel);
  if (!rel || !file.startsWith(MODEL_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('model file not found');
    return;
  }
  const size = fs.statSync(file).size;
  const ext = path.extname(file).replace(/^\.onnx.*/, '.onnx').toLowerCase();
  const type = ext === '.json' ? 'application/json; charset=utf-8'
    : ext === '.txt' ? 'text/plain; charset=utf-8'
      : 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': size,
  };
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    headers['Content-Length'] = end - start + 1;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    res.writeHead(206, headers);
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

function localVisionStatus() {
  const indexFile = path.join(MODEL_DIR, 'index.json');
  let index = null;
  try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch { /* not installed */ }
  const entry = index?.models?.[0] || null;
  let installed = false;
  let bytes = 0;
  let missing = [];
  let fileCount = 0;
  if (entry) {
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, entry.dir, 'manifest.json'), 'utf8')); } catch { /* fall through */ }
    if (manifest?.files?.length) {
      fileCount = manifest.files.length;
      for (const f of manifest.files) {
        const file = path.join(MODEL_DIR, entry.dir, f.path);
        try {
          const size = fs.statSync(file).size;
          bytes += size;
          if (f.bytes && size !== f.bytes) missing.push(f.path);
        } catch {
          missing.push(f.path);
        }
      }
      installed = missing.length === 0;
    }
  }
  return {
    enabled: Boolean(config.provider.localVision),
    installed,
    model: entry?.model || null,
    modelId: entry?.dir || null,
    dtype: entry?.dtype || null,
    device: entry?.device || null,
    bytes,
    fileCount,
    missing,
    root: '/models/',
    hint: installed ? '' : 'npm run models:vision',
  };
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const clean = decodeURIComponent(url.pathname);
  let filePath = path.join(DIST, clean === '/' ? 'index.html' : clean);
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    if (!fs.existsSync(DIST)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fallbackPage());
      return;
    }
    filePath = path.join(DIST, 'index.html'); // SPA fallback
  }
  serveFile(res, filePath, path.extname(filePath) === '.html' ? 'no-store' : 'public, max-age=3600');
}

function fallbackPage() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>筑野 ARCHI-AGENT</title>
<style>body{font-family:ui-sans-serif,system-ui;background:#0d1117;color:#e6edf3;display:grid;place-items:center;height:100vh;margin:0}
.card{max-width:520px;padding:32px;border:1px solid #2a323d;border-radius:14px;line-height:1.8}
code{background:#161b22;padding:2px 6px;border-radius:4px}</style>
<div class="card"><h2>前端尚未构建</h2>
<p>先安装并启动 Vue + Three.js 查看器：</p>
<p><code>npm run install:all</code><br><code>npm run dev:web</code></p>
<p>或构建后由本服务直接托管：<code>npm run build</code> 再刷新本页。</p></div></html>`;
}

async function handleChat(req, res, body) {
  const message = String(body.message || '').trim();
  const sid = body.sid || 'demo';
  if (!message && !body.image) return json(res, 400, { error: 'message 或 image 必填' });

  const t0 = Date.now();
  const rid = req._rid;
  logger.info('chat', 'turn start', {
    rid, sid, chars: message.length, image: Boolean(body.image), mode: body.mode || config.mode,
    clientVision: body.analysis ? body.analysis.model || 'browser-vision' : null,
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let closed = false;
  req.on('close', () => { closed = true; });
  const emit = (event) => {
    if (closed) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const session = getSession(sid);
  let enriched = message;
  let result = null;
  try {
    if (body.image) {
      emit({ type: 'status', text: body.analysis ? '浏览器本地视觉模型正在解析参考图…' : '正在读取参考图：功能、体量、材质与色彩…' });
      const referenceUrl = saveReferenceImage(body.image);
      const analysis = body.analysis
        ? adoptLocalAnalysis(body.analysis, { palette: body.palette || [], model: body.analysis.model })
        : await analyzeReference({
          image: body.image,
          palette: Array.isArray(body.palette) ? body.palette : [],
          hint: message,
        });
      session.reference = { url: referenceUrl, analysis, at: Date.now(), dataUrl: body.image };
      emit({ type: 'reference', reference: session.reference });
      enriched = referenceBrief(analysis, { hint: message, dimensions: body.dimensions || {} });
      emit({ type: 'status', text: `参考图解析：${analysis.description || analysis.style}（${analysis.source === 'browser' ? '浏览器本地视觉' : analysis.source === 'vision' ? '视觉模型' : '主色匹配'}）` });
      logger.info('vision', 'reference analyzed', { rid, sid, source: analysis.source, model: analysis.model || null, style: analysis.style, programme: analysis.programme, description: analysis.description });
    }
    result = await runAgent({ session, message: enriched, mode: body.mode, emit });
    finalize(session.spec);
    persist(sid, session);
    logger.info('chat', 'turn complete', {
      rid, sid, mode: result?.mode, ms: Date.now() - t0,
      floors: session.spec?.floors?.length || 0, gfa: session.spec?.metrics?.gfa || null,
    });
  } catch (err) {
    logger.error('chat', 'turn failed', { rid, sid, ms: Date.now() - t0, err });
    emit({ type: 'error', text: err.message || '服务异常' });
  }
  emit({ type: 'end' });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;
  const rid = requestId();
  req._rid = rid;
  const started = process.hrtime.bigint();
  logger.debug('http', 'request', { rid, method, path: p, query: Object.fromEntries(url.searchParams), ip: req.socket?.remoteAddress, ua: req.headers['user-agent'] });
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const fields = {
      rid, method, path: p, status: res.statusCode, ms: Math.round(ms * 10) / 10,
      bytes: res.getHeader('content-length') || null, ip: req.socket?.remoteAddress,
    };
    if (res.statusCode >= 500) logger.error('http', 'response', fields);
    else if (res.statusCode >= 400) logger.warn('http', 'response', fields);
    else logger.info('http', 'response', fields);
  });

  // onnxruntime-web needs SharedArrayBuffer for its threaded WASM kernels; both
  // headers are required for cross-origin isolation. Everything the viewer loads
  // (models, assets) is same-origin, so require-corp is safe here.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('X-Request-Id', rid);

  try {
    if (method === 'GET' && p.startsWith('/models/')) return serveModel(req, res, p);

    // ---------------------------------------------------------------- system
    if (p === '/api/logs' && method === 'GET') {
      return json(res, 200, readLogTail({
        limit: url.searchParams.get('limit') || 200,
        level: url.searchParams.get('level') || null,
        scope: url.searchParams.get('scope') || null,
      }));
    }

    if (p === '/api/client-log' && method === 'POST') {
      const body = await readBody(req, 1024 * 1024).catch(() => ({}));
      const level = ['debug', 'info', 'warn', 'error'].includes(body.level) ? body.level : 'error';
      logger[level]('client', String(body.message || 'client event'), {
        rid: req._rid,
        url: String(body.url || '').slice(0, 300),
        clientScope: String(body.scope || '').slice(0, 80),
        detail: body.fields || {},
        ua: req.headers['user-agent'],
      });
      return json(res, 200, { ok: true });
    }

    if (p === '/api/health') {
      const probe = await probeModel();
      return json(res, 200, {
        ok: true,
        mode: config.mode,
        provider: config.provider.type,
        model: config.provider.model,
        baseUrl: config.provider.baseUrl,
        vision: Boolean(config.provider.vision),
        visionModel: config.provider.visionModel || config.provider.model,
        localVision: config.provider.localVision,
        hy4: { baseUrl: config.provider.baseUrl, model: config.provider.model, reasoning: config.provider.reasoning, ...probe },
        build: fs.existsSync(DIST),
        sessions: sessions.size,
        library: { total: listLibrary().total, trash: listTrash().total },
      });
    }

    if (p === '/api/settings' && method === 'GET') return json(res, 200, publicSettings());
    if (p === '/api/vision/local' && method === 'GET') return json(res, 200, localVisionStatus());
    if (p === '/api/settings' && method === 'POST') {
      const body = await readBody(req);
      const saved = saveSettings(body);
      logger.info('settings', 'saved', {
        rid: req._rid,
        mode: saved.mode,
        provider: saved.provider?.type,
        model: saved.provider?.model,
        localVision: saved.provider?.localVision,
        hasKey: Boolean(saved.provider?.apiKey),
      });
      return json(res, 200, { ok: true, settings: publicSettings(), saved });
    }
    if (p === '/api/settings/test' && method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const provider = { ...config.provider, ...(body.provider || {}) };
      const probe = await probeProvider(provider, 5000);
      return json(res, 200, probe);
    }

    // --------------------------------------------------------------- session
    if (p === '/api/spec' && method === 'GET') {
      const session = getSession(url.searchParams.get('sid') || 'demo');
      if (!session.spec?.floors?.length) return json(res, 200, { spec: null, reference: session.reference || null });
      return json(res, 200, {
        spec: session.spec,
        digest: digest(session.spec),
        reference: session.reference || null,
        history: session.history || [],
      });
    }

    if (p === '/api/spec' && method === 'POST') {
      const body = await readBody(req);
      const sid = body.sid || 'demo';
      if (!body.spec?.floors?.length) return json(res, 400, { error: 'spec 不完整' });
      const session = getSession(sid);
      session.spec = body.spec;
      session.brief = body.spec.meta?.brief || body.brief || '';
      session.history = session.history || [];
      persist(sid, session);
      logger.info('session', 'spec adopted', { rid: req._rid, sid, floors: session.spec.floors.length, style: session.spec.meta?.style });
      return json(res, 200, { ok: true });
    }

    if (p === '/api/history' && method === 'GET') {
      const session = getSession(url.searchParams.get('sid') || 'demo');
      return json(res, 200, {
        messages: session.history || [],
        spec: session.spec || null,
        reference: session.reference || null,
        brief: session.brief || '',
      });
    }

    if (p === '/api/history' && method === 'DELETE') {
      const sid = url.searchParams.get('sid') || 'demo';
      sessions.delete(sid);
      dropSessionState(sid);
      return json(res, 200, { ok: true });
    }

    if (p === '/api/reset' && method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const sid = body.sid || 'demo';
      sessions.set(sid, createSession(''));
      dropSessionState(sid);
      return json(res, 200, { ok: true });
    }

    // ----------------------------------------------------------------- design
    if (p === '/api/reference' && method === 'POST') {
      const body = await readBody(req);
      if (!body.image) return json(res, 400, { error: 'image 必填（dataURL）' });
      const referenceUrl = saveReferenceImage(body.image);
      const analysis = body.analysis
        ? adoptLocalAnalysis(body.analysis, { palette: body.palette || [], model: body.analysis.model })
        : await analyzeReference({
          image: body.image,
          palette: Array.isArray(body.palette) ? body.palette : [],
          hint: String(body.message || ''),
        });
      logger.info('vision', 'reference endpoint', { rid: req._rid, source: analysis.source, model: analysis.model || null, style: analysis.style, programme: analysis.programme });
      return json(res, 200, { reference: { url: referenceUrl, analysis }, brief: referenceBrief(analysis, { hint: body.message, dimensions: body.dimensions }) });    }

    // ------------------------------------------------- parameterised prompts
    if (p === '/api/prompt/params' && method === 'GET') {
      return json(res, 200, {
        schema: PARAM_SCHEMA,
        vocab: {
          programmes: Object.fromEntries(Object.entries(PROGRAMMES).map(([k, v]) => [k, v.label])),
          styles: Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v.label])),
        },
      });
    }

    if (p === '/api/prompt/build' && method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      return json(res, 200, composePrompt(body.params || body));
    }

    if (p === '/api/prompt/design' && method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const built = composePrompt(body.params || body);
      const sid = body.sid || 'demo';
      // keep the conversation unless the caller explicitly asks for a fresh one
      if (body.reset === true) {
        sessions.set(sid, createSession(''));
        dropSessionState(sid);
      }
      const s = getSession(sid);
      const t0 = Date.now();
      logger.info('design', 'agent design start', { rid: req._rid, sid, promptChars: built.prompt.length, style: built.params?.style, floors: built.params?.floors, mode: body.mode });
      const result = await runAgent({ session: s, message: built.prompt, mode: body.mode, emit: () => {} });
      finalize(s.spec);
      persist(sid, s);
      logger.info('design', 'agent design done', { rid: req._rid, sid, mode: result.mode, ms: Date.now() - t0, floors: s.spec?.floors?.length });
      return json(res, 200, {
        text: result.text,
        mode: result.mode,
        prompt: built.prompt,
        params: built.params,
        checks: built.checks,
        warnings: built.warnings,
        spec: s.spec,
        digest: digest(s.spec),
      });
    }

    if (p === '/api/design' && method === 'POST') {
      const body = await readBody(req);
      if (!body.message && !body.image) return json(res, 400, { error: 'message 必填' });
      const sid = body.sid || 'demo';
      if (body.reset) {
        sessions.set(sid, createSession(''));
        dropSessionState(sid);
      }
      const s = getSession(sid);
      let message = String(body.message || '');
      const t0 = Date.now();
      logger.info('design', 'design start', { rid: req._rid, sid, chars: message.length, image: Boolean(body.image), mode: body.mode, reset: Boolean(body.reset) });
      if (body.image) {
        const analysis = await analyzeReference({ image: body.image, palette: body.palette || [], hint: message });
        s.reference = { url: saveReferenceImage(body.image), analysis, at: Date.now(), dataUrl: body.image };
        message = referenceBrief(analysis, { hint: message, dimensions: body.dimensions || {} });
        logger.info('vision', 'design reference', { rid: req._rid, sid, source: analysis.source, model: analysis.model || null, style: analysis.style });
      }
      const result = await runAgent({ session: s, message, mode: body.mode, emit: () => {} });
      finalize(s.spec);
      persist(sid, s);
      logger.info('design', 'design done', { rid: req._rid, sid, mode: result.mode, ms: Date.now() - t0, floors: s.spec?.floors?.length, gfa: s.spec?.metrics?.gfa });
      return json(res, 200, {
        text: result.text,
        mode: result.mode,
        spec: s.spec,
        digest: digest(s.spec),
        reference: s.reference || null,
      });
    }

    if (p === '/api/chat' && method === 'POST') {
      const body = await readBody(req);
      return handleChat(req, res, body);
    }

    // ---------------------------------------------------------------- library
    if (p === '/api/library' && method === 'GET') {
      const q = url.searchParams;
      return json(res, 200, listLibrary({
        style: q.get('style'),
        programme: q.get('programme'),
        q: q.get('q'),
        sort: q.get('sort') || 'newest',
      }));
    }

    if (p === '/api/library' && method === 'POST') {
      const body = await readBody(req);
      const sid = body.sid || 'demo';
      const session = sessions.get(sid);
      const spec = body.spec || session?.spec || null;
      if (!spec?.floors?.length) return json(res, 400, { error: '当前没有可入库的方案' });
      const item = addLibraryItem({
        title: body.title,
        tags: body.tags,
        thumbDataUrl: body.thumb,
        spec,
        reference: body.reference || session?.reference?.url || spec?.meta?.reference || null,
        style: body.style || spec.meta.style,
        programme: body.programme || spec.meta.programme,
        source: body.source || 'chat',
      });
      return json(res, 200, { ok: true, item, library: listLibrary() });
    }

    if (p === '/api/trash' && method === 'GET') return json(res, 200, listTrash());
    if (p === '/api/trash' && method === 'DELETE') return json(res, 200, { ok: true, removed: emptyTrash() });

    const restoreMatch = p.match(/^\/api\/trash\/([^/]+)\/restore$/);
    if (restoreMatch && method === 'POST') {
      const item = restoreFromTrash(restoreMatch[1]);
      if (!item) return json(res, 404, { error: '回收站里没有这一项' });
      return json(res, 200, { ok: true, item, library: listLibrary(), trash: listTrash() });
    }

    const trashMatch = p.match(/^\/api\/trash\/([^/]+)$/);
    if (trashMatch && method === 'DELETE') {
      const ok = purgeFromTrash(trashMatch[1]);
      return json(res, ok ? 200 : 404, ok ? { ok: true, trash: listTrash() } : { error: '回收站里没有这一项' });
    }

    const itemMatch = p.match(/^\/api\/library\/([^/]+)$/);
    if (itemMatch) {
      const id = itemMatch[1];
      if (method === 'GET') {
        const item = getLibraryItem(id);
        if (!item) return json(res, 404, { error: '成品不存在' });
        return json(res, 200, { item });
      }
      if (method === 'PATCH') {
        const body = await readBody(req);
        const item = updateLibraryItem(id, body);
        if (!item) return json(res, 404, { error: '成品不存在' });
        return json(res, 200, { ok: true, item, library: listLibrary() });
      }
      if (method === 'DELETE') {
        const item = moveToTrash(id);
        if (!item) return json(res, 404, { error: '成品不存在' });
        return json(res, 200, { ok: true, item, library: listLibrary(), trash: listTrash() });
      }
    }

    if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    if (p.startsWith('/media/')) return serveMedia(res, p);
    return serveStatic(req, res);
  } catch (err) {
    logger.error('http.route', 'unhandled route error', {
      rid, method, path: p, status: 500, err,
    });
    return json(res, 500, { error: err.message || '服务异常' });
  }
});

server.listen(config.port, () => {
  logger.info('boot', 'server listening', {
    port: config.port,
    mode: config.mode,
    provider: config.provider.type,
    baseUrl: config.provider.baseUrl,
    model: config.provider.model,
    vision: Boolean(config.provider.vision),
    visionModel: config.provider.visionModel || config.provider.model,
    build: fs.existsSync(DIST),
    dataDir: config.dataDir,
    logDir: LOG_DIR,
  });
  console.log(`\n  筑野 ARCHI-AGENT`);
  console.log(`  server   http://127.0.0.1:${config.port}`);
  console.log(`  model    ${config.provider.type} · ${config.provider.baseUrl} (${config.provider.model})`);
  console.log(`  mode     ${config.mode}${fs.existsSync(DIST) ? '' : '  (web/dist 未构建，使用 vite dev 开发)'}`);
  console.log(`  log      ${LOG_DIR}\n`);
});

process.on('uncaughtException', (err) => {
  logger.error('process', 'uncaughtException', { err });
  // A corrupt process should not keep serving: let the supervisor restart it.
  setTimeout(() => process.exit(1), 50).unref();
});
process.on('unhandledRejection', (reason) => {
  logger.error('process', 'unhandledRejection', { err: reason instanceof Error ? reason : { message: String(reason) } });
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info('boot', `received ${signal}, shutting down`, { sessions: sessions.size });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
