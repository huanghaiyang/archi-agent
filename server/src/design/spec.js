// Draft lifecycle: create -> regenerate -> patch -> validate -> metrics.
// The language model never gets to write raw geometry straight to the viewer:
// every spec passes through here first.

import { clamp, rectArea, rectsOverlap, round1 } from '../../../shared/facade.js';
import { computeMetrics, generateDesign, parseBrief } from './generator.js';
import { MATERIAL_KEYS, ROOM_TYPE_KEYS } from './palette.js';
import { checkSpec, summarizeChecks } from './rules.js';

const FACADE_SYSTEMS = ['punched', 'ribbon', 'curtain', 'screen'];
const ROOF_TYPES = ['flat', 'gable', 'shed', 'hip'];
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function newDraft(brief, options = {}) {
  const parsed = parseBrief(brief);
  const buildOptions = {
    programme: options.programme || parsed.programme,
    floors: options.floors || parsed.floors,
    area: options.area || parsed.area,
    site: options.site || parsed.site,
    style: options.style || parsed.style,
    roof: options.roof || parsed.roof,
    stepped: options.stepped || parsed.stepped,
    climate: options.climate || parsed.climate,
  };
  return finalize(generateDesign(brief, buildOptions), buildOptions);
}

export function regenerate(spec, patch = {}) {
  const options = { ...(spec.buildOptions || {}), ...patch };
  const next = generateDesign(spec.meta.brief, options);
  next.roomOverrides = spec.roomOverrides || {};
  applyRoomOverrides(next);
  return finalize(next, options);
}

function applyRoomOverrides(spec) {
  const map = spec.roomOverrides || {};
  for (const floor of spec.floors) {
    for (const room of floor.rooms) {
      const key = `${floor.level}:${room.id}`;
      if (map[key]) room.windows = { ...room.windows, ...map[key] };
    }
  }
}

export function finalize(spec, buildOptions) {
  spec.buildOptions = buildOptions || spec.buildOptions;
  spec.metrics = computeMetrics(spec);
  spec.checks = checkSpec(spec);
  spec.checkSummary = summarizeChecks(spec.checks);
  return spec;
}

// ------------------------------------------------------------- model output
/**
 * Merge a (possibly partial, possibly sloppy) model-authored spec over the
 * deterministic baseline. Invalid geometry falls back to the engine layout
 * instead of breaking the 3D view.
 */
export function normalizeAgentSpec(raw = {}, base) {
  const warnings = [];
  const spec = structuredClone(base);

  const title = typeof raw.title === 'string' ? raw.title : raw.meta?.title;
  if (typeof title === 'string' && title.trim()) {
    spec.meta.title = title.trim().slice(0, 40);
  }
  if (typeof raw.meta?.styleLabel === 'string') spec.meta.styleLabel = raw.meta.styleLabel.slice(0, 20);

  // ---- site
  if (raw.site) {
    const s = raw.site;
    const width = clamp(num(s.width, spec.site.width), 20, 120);
    const depth = clamp(num(s.depth, spec.site.depth), 18, 120);
    const fb = spec.site.setback;
    const sd = s.setback || {};
    spec.site = {
      ...spec.site,
      width: round1(width),
      depth: round1(depth),
      climate: typeof s.climate === 'string' ? s.climate : spec.site.climate,
      farLimit: clamp(num(s.farLimit, spec.site.farLimit), 0.4, 4),
      coverageLimit: clamp(num(s.coverageLimit, spec.site.coverageLimit), 0.1, 0.85),
      setback: {
        front: clamp(num(sd.front, fb.front), 0, 20),
        back: clamp(num(sd.back, fb.back), 0, 20),
        left: clamp(num(sd.left, fb.left), 0, 20),
        right: clamp(num(sd.right, fb.right), 0, 20),
      },
    };
  }

  // ---- roof
  if (raw.massing?.roof || raw.roof) {
    const r = raw.massing?.roof || raw.roof;
    const roof = spec.massing.roof;
    spec.massing.roof = {
      ...roof,
      type: ROOF_TYPES.includes(r.type) ? r.type : roof.type,
      pitch: clamp(num(r.pitch, roof.pitch), 0, 60),
      overhang: clamp(num(r.overhang, roof.overhang), 0, 2),
      parapet: clamp(num(r.parapet, roof.parapet), 0, 2.4),
      material: MATERIAL_KEYS.includes(r.material) ? r.material : roof.material,
    };
  }

  // ---- facade
  if (raw.facade) {
    const f = raw.facade;
    const mats = { ...spec.facade.materials, ...(f.materials || {}) };
    for (const key of Object.keys(mats)) {
      if (!MATERIAL_KEYS.includes(mats[key])) mats[key] = spec.facade.materials[key] || 'warm-concrete';
    }
    spec.facade = {
      ...spec.facade,
      system: FACADE_SYSTEMS.includes(f.system) ? f.system : spec.facade.system,
      windowWidth: clamp(num(f.windowWidth, spec.facade.windowWidth), 0.6, 4),
      gap: clamp(num(f.gap, spec.facade.gap), 0.3, 3),
      sillHeight: clamp(num(f.sillHeight, spec.facade.sillHeight), 0.3, 1.6),
      headClearance: clamp(num(f.headClearance, spec.facade.headClearance), 0.2, 1.2),
      align: f.align !== false,
      materials: mats,
    };
  }

  // ---- floors / rooms
  if (Array.isArray(raw.floors) && raw.floors.length) {
    for (const rawFloor of raw.floors) {
      const level = Math.round(num(rawFloor.level, 0));
      const target = spec.floors.find((f) => f.level === level);
      if (!target) {
        warnings.push(`忽略未知楼层 L${rawFloor.level}`);
        continue;
      }
      const rooms = (rawFloor.rooms || [])
        .map((r, i) => normalizeRoom(r, target, i))
        .filter(Boolean);
      if (rooms.length >= 2 && roomsValid(rooms, target.footprint)) {
        target.rooms = rooms;
        target.name = typeof rawFloor.name === 'string' && rawFloor.name.trim()
          ? rawFloor.name.trim().slice(0, 24)
          : target.name;
      } else if (rooms.length) {
        warnings.push(`L${level} 房间排布未通过几何校验，改用引擎布局`);
      }
    }
  }

  spec.meta.generatedBy = 'hy4 + design-engine';
  spec.meta.notesFromModel = Array.isArray(raw.notes) ? raw.notes.filter((n) => typeof n === 'string').slice(0, 8) : [];
  spec.normalizeWarnings = warnings;
  const out = finalize(spec, spec.buildOptions);

  // keep model's own narrative notes if the engine generated none
  if (spec.meta.notesFromModel.length) out.notes = spec.meta.notesFromModel;
  return out;
}

function normalizeRoom(raw, floor, index) {
  if (!raw || typeof raw !== 'object') return null;
  const x = num(raw.x, NaN);
  const z = num(raw.z, NaN);
  const w = num(raw.w, NaN);
  const d = num(raw.d, NaN);
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 16) : `房间${index + 1}`;
  const type = ROOM_TYPE_KEYS.includes(raw.type) ? raw.type : 'office';
  if (![x, z, w, d].every(Number.isFinite)) return null;

  const fp = floor.footprint;
  const rect = {
    x: clamp(x, fp.x, fp.x + fp.w - 0.5),
    z: clamp(z, fp.z, fp.z + fp.d - 0.5),
    w: clamp(w, 0.5, fp.w),
    d: clamp(d, 0.5, fp.d),
  };
  rect.w = Math.min(rect.w, fp.x + fp.w - rect.x);
  rect.d = Math.min(rect.d, fp.z + fp.d - rect.z);

  const windows = {};
  const src = raw.windows || {};
  for (const side of ['n', 's', 'e', 'w']) windows[side] = Boolean(src[side]);

  return {
    id: `L${floor.level}-M${index + 1}`,
    name,
    type,
    x: round1(rect.x),
    z: round1(rect.z),
    w: round1(rect.w),
    d: round1(rect.d),
    height: clamp(num(raw.height, Math.min(3.6, floor.height - 0.6)), 2.4, floor.height - 0.1),
    windows,
    door: ['n', 's', 'e', 'w'].includes(raw.door) ? raw.door : 's',
    floorMaterial: MATERIAL_KEYS.includes(raw.floorMaterial) ? raw.floorMaterial : 'timber-slat',
  };
}

function roomsValid(rooms, footprint) {
  const fpArea = footprint.w * footprint.d;
  let covered = 0;
  for (const r of rooms) {
    if (r.w * r.d < 1) return false;
    covered += rectArea(r);
    if (r.x + r.w > footprint.x + footprint.w + 0.06) return false;
    if (r.z + r.d > footprint.z + footprint.d + 0.06) return false;
  }
  if (covered > fpArea * 1.02) return false;
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      if (rectsOverlap(rooms[i], rooms[j])) {
        const overlapW = Math.min(rooms[i].x + rooms[i].w, rooms[j].x + rooms[j].w) - Math.max(rooms[i].x, rooms[j].x);
        const overlapD = Math.min(rooms[i].z + rooms[i].d, rooms[j].z + rooms[j].d) - Math.max(rooms[i].z, rooms[j].z);
        if (overlapW * overlapD > 0.6) return false;
      }
    }
  }
  return true;
}

// ------------------------------------------------------------- tool patches
export function patchRoof(spec, args = {}) {
  const r = spec.massing.roof;
  if (ROOF_TYPES.includes(args.type)) r.type = args.type;
  if (args.pitch != null) r.pitch = clamp(num(args.pitch, r.pitch), 0, 60);
  if (args.overhang != null) r.overhang = clamp(num(args.overhang, r.overhang), 0, 2);
  if (args.parapet != null) r.parapet = clamp(num(args.parapet, r.parapet), 0, 2.4);
  if (MATERIAL_KEYS.includes(args.material)) r.material = args.material;
  return `${r.type} 屋顶${r.type === 'gable' || r.type === 'shed' || r.type === 'hip' ? `，坡度 ${r.pitch}°` : `，女儿墙 ${r.parapet}m`}，${r.material}`;
}

export function patchFacade(spec, args = {}) {
  const f = spec.facade;
  if (FACADE_SYSTEMS.includes(args.system)) f.system = args.system;
  if (args.windowWidth != null) f.windowWidth = clamp(num(args.windowWidth, f.windowWidth), 0.6, 4);
  if (args.gap != null) f.gap = clamp(num(args.gap, f.gap), 0.3, 3);
  if (args.sillHeight != null) f.sillHeight = clamp(num(args.sillHeight, f.sillHeight), 0.3, 1.6);
  if (args.materials) {
    for (const [k, v] of Object.entries(args.materials)) {
      if (MATERIAL_KEYS.includes(v)) f.materials[k] = v;
    }
  }
  return `${f.system} 立面，洞口 ${f.windowWidth}m / 间距 ${f.gap}m，主材 ${f.materials.wall} + ${f.materials.glass}`;
}

export function patchWindows(spec, args = {}) {
  const level = Math.round(num(args.level, 1));
  const floor = spec.floors.find((f) => f.level === level);
  if (!floor) throw new Error(`楼层 L${level} 不存在`);
  const sides = ['n', 's', 'e', 'w'];
  const applied = [];
  const rooms = args.room ? floor.rooms.filter((r) => r.id === args.room || r.name === args.room) : floor.rooms;
  for (const room of rooms) {
    const on = Array.isArray(args.sides) && args.sides.length ? args.sides.filter((s) => sides.includes(s)) : null;
    if (on) {
      room.windows = {};
      for (const s of on) room.windows[s] = true;
    } else if (typeof args.value === 'boolean') {
      for (const s of sides) if (room.windows[s]) room.windows[s] = args.value;
    }
    spec.roomOverrides = spec.roomOverrides || {};
    spec.roomOverrides[`${level}:${room.id}`] = { ...room.windows };
    applied.push(room.name);
  }
  return `已调整 L${level}：${applied.join('、') || '无'} 的窗洞`;
}

export function patchSite(spec, args = {}) {
  const site = spec.site;
  if (args.width != null) site.width = clamp(num(args.width, site.width), 20, 120);
  if (args.depth != null) site.depth = clamp(num(args.depth, site.depth), 18, 120);
  if (args.farLimit != null) site.farLimit = clamp(num(args.farLimit, site.farLimit), 0.4, 4);
  if (args.coverageLimit != null) site.coverageLimit = clamp(num(args.coverageLimit, site.coverageLimit), 0.1, 0.85);
  if (args.climate) site.climate = String(args.climate);
  if (args.setback) {
    for (const k of ['front', 'back', 'left', 'right']) {
      if (args.setback[k] != null) site.setback[k] = clamp(num(args.setback[k], site.setback[k]), 0, 20);
    }
  }
  return `场地 ${round1(site.width)}×${round1(site.depth)}m，容积率上限 ${site.farLimit}，密度上限 ${site.coverageLimit}`;
}
