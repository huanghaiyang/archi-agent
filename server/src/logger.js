// Structured application log. Every line is valid JSON, mirrored to the
// console and appended to server/data/logs/system-YYYY-MM-DD.log.
//
// Design goals:
// - one line per event, so `grep` / jq / tail all work;
// - scoped entries (`http`, `llm`, `agent`, `vision`, `boot`);
// - secrets and large payloads are redacted/truncated before they hit disk;
// - no dependency on a logging library.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL_NAME = String(process.env.ARCHI_LOG_LEVEL || 'info').toLowerCase();
const LEVEL = LEVELS[LEVEL_NAME] || LEVELS.info;
const LOG_DIR = process.env.ARCHI_LOG_DIR || path.join(config.dataDir, 'logs');
const KEEP_DAYS = Number(process.env.ARCHI_LOG_KEEP_DAYS || 14);
const MAX_VALUE = 600;

fs.mkdirSync(LOG_DIR, { recursive: true });

function dayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  // local date, not UTC: the file name should match what the operator sees
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function logFile(date = new Date()) {
  return path.join(LOG_DIR, `system-${dayKey(date)}.log`);
}

function pruneOld() {
  try {
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    for (const name of fs.readdirSync(LOG_DIR)) {
      if (!/^system-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
      const p = path.join(LOG_DIR, name);
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    }
  } catch { /* logging must never break the app */ }
}

pruneOld();

const SECRET_KEY = /^(api[-_]?key|authorization|password|secret|token|access[-_]?token|cookie)$/i;

function cleanValue(value, key = '', depth = 0) {
  if (value == null) return value;
  if (SECRET_KEY.test(key)) return '••••';
  if (typeof value === 'string') {
    if (/^data:image\//i.test(value)) return `<image ${Math.round(value.length / 1024)}KB>`;
    const oneLine = value.replace(/\s+/g, ' ').trim();
    return oneLine.length > MAX_VALUE ? `${oneLine.slice(0, MAX_VALUE)}…` : oneLine;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: cleanValue(value.stack || '', 'stack', depth + 1), status: value.status ?? undefined };
  }
  if (Array.isArray(value)) {
    if (depth >= 3) return `[${value.length} items]`;
    return value.slice(0, 20).map((item) => cleanValue(item, '', depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= 3) return '{"…":"nested"}';
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 40)) out[k] = cleanValue(v, k, depth + 1);
    return out;
  }
  return String(value);
}

function write(level, scope, message, fields = {}) {
  if (LEVELS[level] < LEVEL) return null;
  const entry = {
    ...cleanValue(fields, '', 0),
    ts: new Date().toISOString(),
    level,
    scope,
    message: String(message || ''),
  };
  const line = JSON.stringify(entry);
  try {
    fs.appendFileSync(logFile(), `${line}\n`);
  } catch { /* disk full / permission: don't take down requests */ }
  const prefix = `[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] ${level.toUpperCase().padEnd(5)} ${scope}`;
  const safe = Object.keys(fields).length ? ` ${JSON.stringify(cleanValue(fields))}` : '';
  if (level === 'error' || level === 'warn') console.error(`${prefix} ${message}${safe}`);
  else console.log(`${prefix} ${message}${safe}`);
  return entry;
}

export function requestId() {
  return crypto.randomUUID().slice(0, 8);
}

export const logger = {
  debug: (scope, message, fields) => write('debug', scope, message, fields),
  info: (scope, message, fields) => write('info', scope, message, fields),
  warn: (scope, message, fields) => write('warn', scope, message, fields),
  error: (scope, message, fields) => write('error', scope, message, fields),
  child(scope, base = {}) {
    return {
      debug: (message, fields) => write('debug', scope, message, { ...base, ...fields }),
      info: (message, fields) => write('info', scope, message, { ...base, ...fields }),
      warn: (message, fields) => write('warn', scope, message, { ...base, ...fields }),
      error: (message, fields) => write('error', scope, message, { ...base, ...fields }),
    };
  },
};

/** Tail the current day's log. Used by GET /api/logs. */
export function readLogTail({ limit = 200, level = null, scope = null } = {}) {
  const file = logFile();
  if (!fs.existsSync(file)) return { file, entries: [] };
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const wanted = Math.max(1, Math.min(2000, Number(limit) || 200));
  const min = LEVELS[level] ? LEVELS[level] : 0;
  const entries = [];
  for (let i = lines.length - 1; i >= 0 && entries.length < wanted; i -= 1) {
    try {
      const entry = JSON.parse(lines[i]);
      if (min && LEVELS[entry.level] < min) continue;
      if (scope && entry.scope !== scope) continue;
      entries.push(entry);
    } catch { /* partial line after crash */ }
  }
  return { file, entries: entries.reverse(), total: lines.length };
}

export { LOG_DIR, dayKey };
