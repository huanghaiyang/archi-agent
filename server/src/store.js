// Tiny JSON store: a finished-scheme library with a recycle bin, plus
// per-browser session persistence (chat history + current spec). Files live
// under server/data so they survive restarts and can be committed to git
// (thumbnails are kept out of git via .gitignore).

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { PROGRAMMES, STYLES } from './design/generator.js';

const LIB_FILE = path.join(DATA_DIR, 'library.json');
const TRASH_FILE = path.join(DATA_DIR, 'trash.json');
const SESSION_DIR = path.join(DATA_DIR, 'sessions');

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

const library = readJson(LIB_FILE, { items: [] });
const trash = readJson(TRASH_FILE, { items: [] });
if (!Array.isArray(library.items)) library.items = [];
if (!Array.isArray(trash.items)) trash.items = [];
fs.mkdirSync(SESSION_DIR, { recursive: true });

const saveLib = () => writeJson(LIB_FILE, library);
const saveTrash = () => writeJson(TRASH_FILE, trash);

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const styleLabel = (key) => STYLES[key]?.label || key || '未分类';
const programmeLabel = (key) => PROGRAMMES[key]?.label || key || '未分类';

function persistDataUrl(dataUrl, kind) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const dir = path.join(DATA_DIR, kind);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${newId()}.${ext}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(m[2], 'base64'));
  return `/media/${kind}/${name}`;
}

export function saveReferenceImage(dataUrl) {
  return persistDataUrl(dataUrl, 'refs');
}

export function saveThumb(dataUrl) {
  return persistDataUrl(dataUrl, 'thumbs');
}

function light(item) {
  return {
    id: item.id,
    title: item.title,
    style: item.style,
    styleLabel: item.styleLabel,
    programme: item.programme,
    programmeLabel: item.programmeLabel,
    tags: item.tags || [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    thumb: item.thumb || null,
    reference: item.reference || null,
    summary: item.summary || null,
    pinned: Boolean(item.pinned),
  };
}

export function listLibrary({ style, programme, q, sort = 'newest', includeTrash = false } = {}) {
  let items = library.items.slice();
  if (style && style !== 'all') items = items.filter((it) => it.style === style);
  if (programme && programme !== 'all') items = items.filter((it) => it.programme === programme);
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter((it) =>
      [it.title, it.styleLabel, it.programmeLabel, ...(it.tags || [])].join(' ').toLowerCase().includes(needle));
  }
  const order = {
    newest: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    title: (a, b) => String(a.title).localeCompare(String(b.title)),
    size: (a, b) => (b.summary?.gfa || 0) - (a.summary?.gfa || 0),
  };
  items.sort(order[sort] || order.newest);
  items.sort((a, b) => Number(b.pinned) - Number(a.pinned));

  const styleCounts = {};
  const programmeCounts = {};
  for (const it of library.items) {
    styleCounts[it.style] = (styleCounts[it.style] || 0) + 1;
    programmeCounts[it.programme] = (programmeCounts[it.programme] || 0) + 1;
  }

  return {
    items: items.map(light),
    total: library.items.length,
    trashCount: trash.items.length,
    styles: Object.keys(styleCounts).map((key) => ({ key, label: styleLabel(key), count: styleCounts[key] })),
    programmes: Object.keys(programmeCounts).map((key) => ({ key, label: programmeLabel(key), count: programmeCounts[key] })),
    filters: {
      styles: Object.keys(STYLES).map((key) => ({ key, label: STYLES[key].label, count: styleCounts[key] || 0 })),
      programmes: Object.keys(PROGRAMMES).map((key) => ({ key, label: PROGRAMMES[key].label, count: programmeCounts[key] || 0 })),
    },
  };
}

export function getLibraryItem(id) {
  return library.items.find((it) => it.id === id) || null;
}

export function addLibraryItem(payload = {}) {
  const spec = payload.spec || null;
  const now = Date.now();
  const style = payload.style || spec?.meta?.style || 'concrete';
  const programme = payload.programme || spec?.meta?.programme || 'library';
  const item = {
    id: newId(),
    title: payload.title || spec?.meta?.title || '未命名方案',
    style,
    styleLabel: styleLabel(style),
    programme,
    programmeLabel: programmeLabel(programme),
    tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 8) : [],
    notes: spec?.notes || [],
    createdAt: now,
    updatedAt: now,
    pinned: Boolean(payload.pinned),
    thumb: payload.thumbDataUrl ? saveThumb(payload.thumbDataUrl) : (payload.thumb || null),
    reference: payload.reference || spec?.meta?.reference || null,
    summary: spec
      ? {
        gfa: spec.metrics?.gfa,
        far: spec.metrics?.far,
        coverage: spec.metrics?.coverage,
        wfr: spec.metrics?.windowFloorRatio,
        floors: spec.floors?.length,
        rooms: spec.floors?.reduce((n, f) => n + f.rooms.length, 0),
        height: spec.metrics?.height,
      }
      : null,
    spec,
    source: payload.source || 'chat',
  };
  library.items.unshift(item);
  saveLib();
  return light(item);
}

export function updateLibraryItem(id, patch = {}) {
  const item = library.items.find((it) => it.id === id);
  if (!item) return null;
  if (typeof patch.title === 'string' && patch.title.trim()) item.title = patch.title.trim();
  if (Array.isArray(patch.tags)) item.tags = patch.tags.slice(0, 8).map(String);
  if (typeof patch.pinned === 'boolean') item.pinned = patch.pinned;
  if (typeof patch.style === 'string' && STYLES[patch.style]) {
    item.style = patch.style;
    item.styleLabel = styleLabel(patch.style);
  }
  if (patch.spec) {
    item.spec = patch.spec;
    item.summary = {
      gfa: patch.spec.metrics?.gfa,
      far: patch.spec.metrics?.far,
      floors: patch.spec.floors?.length,
    };
  }
  if (patch.thumbDataUrl) item.thumb = saveThumb(patch.thumbDataUrl);
  item.updatedAt = Date.now();
  saveLib();
  return light(item);
}

export function moveToTrash(id) {
  const idx = library.items.findIndex((it) => it.id === id);
  if (idx < 0) return null;
  const [item] = library.items.splice(idx, 1);
  item.deletedAt = Date.now();
  trash.items.unshift(item);
  saveLib();
  saveTrash();
  return light(item);
}

export function listTrash() {
  return {
    items: trash.items.map((it) => ({ ...light(it), deletedAt: it.deletedAt })),
    total: trash.items.length,
  };
}

export function restoreFromTrash(id) {
  const idx = trash.items.findIndex((it) => it.id === id);
  if (idx < 0) return null;
  const [item] = trash.items.splice(idx, 1);
  delete item.deletedAt;
  item.updatedAt = Date.now();
  library.items.unshift(item);
  saveLib();
  saveTrash();
  return light(item);
}

export function purgeFromTrash(id) {
  const idx = trash.items.findIndex((it) => it.id === id);
  if (idx < 0) return false;
  const [item] = trash.items.splice(idx, 1);
  removeFiles(item);
  saveTrash();
  return true;
}

export function emptyTrash() {
  const removed = trash.items.length;
  for (const item of trash.items) removeFiles(item);
  trash.items = [];
  saveTrash();
  return removed;
}

function removeFiles(item) {
  for (const rel of [item.thumb, item.reference]) {
    if (typeof rel !== 'string' || !rel.startsWith('/media/')) continue;
    const file = path.join(DATA_DIR, rel.replace('/media/', ''));
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }
}

// ------------------------------------------------------------------ sessions
const sidFile = (sid) => path.join(SESSION_DIR, `${String(sid).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

export function saveSessionState(sid, state) {
  if (!sid) return;
  const payload = {
    sid,
    brief: state.brief || '',
    history: (state.history || []).slice(-30),
    spec: state.spec || null,
    reference: state.reference || null,
    savedAt: Date.now(),
  };
  try {
    writeJson(sidFile(sid), payload);
  } catch {
    /* disk issues should not break a turn */
  }
}

export function loadSessionState(sid) {
  if (!sid) return null;
  return readJson(sidFile(sid), null);
}

export function dropSessionState(sid) {
  try {
    fs.unlinkSync(sidFile(sid));
  } catch {
    /* nothing to drop */
  }
}

export { styleLabel, programmeLabel };
