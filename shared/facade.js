// Pure geometry helpers shared by the server (metrics / checks) and the
// Vue + Three.js viewer (actual mesh generation). Keeping one implementation
// guarantees that the reported window-to-floor ratio matches what is drawn.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round1 = (v) => Math.round(v * 10) / 10;

export const EPS = 0.02;

/** Rects are axis-aligned in site coordinates: { x, z, w, d } (x west→east, z north→south). */
export function rectArea(r) {
  return Math.max(0, r.w) * Math.max(0, r.d);
}

export function rectsOverlap(a, b) {
  return !(
    a.x + a.w <= b.x + EPS ||
    b.x + b.w <= a.x + EPS ||
    a.z + a.d <= b.z + EPS ||
    b.z + b.d <= a.z + EPS
  );
}

export function insetRect(r, inset) {
  const i = Math.min(inset, r.w / 2 - 0.1, r.d / 2 - 0.1);
  return { x: r.x + i, z: r.z + i, w: r.w - 2 * i, d: r.d - 2 * i };
}

/**
 * Punched-window bay layout along one wall span.
 * Bays fill the span between two `gap` end margins, so the drawn rhythm and the
 * reported glazing area stay consistent for any room width.
 */
export function windowBays(span, facade = {}) {
  const winW = clamp(Number(facade.windowWidth) || 1.8, 0.6, 6);
  const gap = clamp(Number(facade.gap) || 1.2, 0.4, 4);
  const usable = span - gap * 2;
  if (usable < Math.min(1.2, winW)) return [];
  const pitch = winW + gap;
  const count = Math.max(1, Math.floor((usable + gap) / pitch));
  const bayW = (usable - (count - 1) * gap) / count;
  const bays = [];
  for (let i = 0; i < count; i += 1) {
    bays.push({ offset: gap + i * (bayW + gap), width: bayW });
  }
  return bays;
}

/**
 * Structural bay grid for one elevation, anchored on the full facade span.
 * Using the whole span (rather than each room segment) keeps every floor on
 * the same vertical opening axes, even when the room programme changes.
 */
export function facadeBays(floor, side, facade = {}) {
  const fp = floor.footprint;
  const alongX = side === 'n' || side === 's';
  const start = alongX ? fp.x : fp.z;
  const span = alongX ? fp.w : fp.d;
  return windowBays(span, facade).map((b) => ({
    a: start + b.offset,
    b: start + b.offset + b.width,
    width: b.width,
  }));
}

export function windowVertical(floorHeight, facade = {}) {
  const sill = clamp(Number(facade.sillHeight) || 0.9, 0.3, 1.8);
  const head = clamp(Number(facade.headClearance) || 0.5, 0.2, 1.2);
  // cap the opening so a 4.5m lobby does not turn into a fully glazed slot
  const height = Math.min(Math.max(0.4, floorHeight - sill - head), 2.7);
  return { sill, height };
}

/** Total glass area for one wall span given the facade rule. */
export function glassArea(span, floorHeight, facade) {
  const bays = windowBays(span, facade);
  if (!bays.length) return 0;
  const v = windowVertical(floorHeight, facade);
  return bays.reduce((s, b) => s + b.width * v.height, 0);
}

export function sidesTouchingEnvelope(room, outer) {
  const t = 0.06;
  return {
    n: Math.abs(room.z - outer.z) < t,
    s: Math.abs(room.z + room.d - (outer.z + outer.d)) < t,
    w: Math.abs(room.x - outer.x) < t,
    e: Math.abs(room.x + room.w - (outer.x + outer.w)) < t,
  };
}

export function roomFacingSides(room) {
  const sides = room.windows || {};
  return ['n', 's', 'e', 'w'].filter((k) => sides[k]);
}

export function facadeSpanFor(side, room) {
  return side === 'n' || side === 's' ? room.w : room.d;
}

/** Glass area contributed by a room on the envelope, honouring its window flags. */
export function roomGlassArea(room, floorHeight, facade) {
  const sides = room.windows || {};
  let area = 0;
  for (const side of ['n', 's', 'e', 'w']) {
    if (!sides[side]) continue;
    area += glassArea(facadeSpanFor(side, room), floorHeight, facade);
  }
  return area;
}

const NO_GLASS = new Set(['wet', 'technical']);

/**
 * Segments along one elevation of a floor: `{ a, b, glazed }`, a/b in site
 * coordinates (x for n/s, z for e/w). Adjacent glazed rooms merge into one
 * continuous glazed strip, so elevations don't end up with blank walls, and
 * the same segments feed both the metrics and the Three.js geometry.
 */
export function facadeSegments(floor, side) {
  const fp = floor.footprint;
  const alongX = side === 'n' || side === 's';
  const start = alongX ? fp.x : fp.z;
  const end = alongX ? fp.x + fp.w : fp.z + fp.d;

  const intervals = floor.rooms
    .filter((r) => sidesTouchingEnvelope(r, fp)[side])
    .map((r) => {
      const a = clamp(alongX ? r.x : r.z, start, end);
      const b = clamp(alongX ? r.x + r.w : r.z + r.d, start, end);
      const glazed = !NO_GLASS.has(r.type) && Boolean(r.windows?.[side]);
      return { a, b, glazed };
    })
    .filter((it) => it.b > it.a + 0.05)
    .sort((x, y) => x.a - y.a);

  // stair / lift cores get a glazed strip too, so elevations do not end up
  // with a blank service wall on the short side
  if (floor.core && sidesTouchingEnvelope(floor.core, fp)[side]) {
    const c = floor.core;
    const a = alongX ? c.x : c.z;
    const b = alongX ? c.x + c.w : c.z + c.d;
    intervals.push({ a: Math.max(start, a), b: Math.min(end, b), glazed: true });
    intervals.sort((x, y) => x.a - y.a);
  }

  const segs = [];
  let cursor = start;
  for (const it of intervals) {
    if (it.a > cursor + 0.02) segs.push({ a: cursor, b: it.a, glazed: false });
    const last = segs[segs.length - 1];
    if (last && Math.abs(last.b - it.a) < 0.03 && last.glazed === it.glazed) {
      last.b = Math.max(last.b, it.b);
    } else {
      segs.push({ ...it, a: Math.max(it.a, cursor) });
    }
    cursor = Math.max(cursor, it.b);
  }
  if (end > cursor + 0.02) segs.push({ a: cursor, b: end, glazed: false });
  return segs;
}

export function floorGlassArea(floor, facade) {
  const aligned = facade?.align !== false;
  let area = 0;
  for (const side of ['n', 's', 'e', 'w']) {
    const axes = aligned ? facadeBays(floor, side, facade) : null;
    const v = windowVertical(floor.height, facade);
    for (const seg of facadeSegments(floor, side)) {
      if (!seg.glazed) continue;
      if (!axes) {
        area += glassArea(seg.b - seg.a, floor.height, facade);
        continue;
      }
      for (const bay of axes) {
        if (bay.a >= seg.a + 0.04 && bay.b <= seg.b - 0.04) area += bay.width * v.height;
      }
    }
  }
  return area;
}

export function metersText(v, digits = 1) {
  return `${round1(v).toFixed(digits)}m`;
}
