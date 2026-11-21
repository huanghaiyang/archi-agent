// Interior: partitions with door openings, stair/lift core, and furniture that
// gives each room a readable programme when the roof is cut away.

import { sidesTouchingEnvelope } from '../../../shared/facade.js';

const PART_T = 0.13;

export function buildInterior({ batch, floor, spec, wx, wz, lamps = [] }) {
  const elev = floor.elevation;

  for (const room of floor.rooms) {
    // room floor finish
    batch.box(`room:${room.type}`, room.w - 0.06, 0.05, room.d - 0.06, wx(room.x + room.w / 2), elev + 0.04, wz(room.z + room.d / 2));
    buildPartitions({ batch, room, floor, wx, wz, elev });
    buildFurniture({ batch, room, elev, wx, wz, spec });
    buildLightFixture({ batch, room, floor, wx, wz, elev, lamps });
  }

  if (floor.corridor) {
    const c = floor.corridor;
    batch.box('room:circulation', c.w - 0.04, 0.055, c.d - 0.04, wx(c.x + c.w / 2), elev + 0.035, wz(c.z + c.d / 2));
    const fixtures = Math.max(1, Math.floor(Math.max(c.w, c.d) / 7));
    for (let i = 0; i < fixtures; i += 1) {
      const t = (i + 0.5) / fixtures;
      const x = c.w > c.d ? c.x + c.w * t : c.x + c.w / 2;
      const z = c.w > c.d ? c.z + c.d / 2 : c.z + c.d * t;
      batch.box('lamp', 0.5, 0.05, 0.5, wx(x), elev + floor.height - 0.16, wz(z));
      batch.box('frame', 0.03, 0.55, 0.03, wx(x), elev + floor.height - 0.45, wz(z));
      lamps.push({ x: wx(x), y: elev + floor.height - 0.16, z: wz(z) });
    }
  }
  if (floor.core) buildCore({ batch, floor, wx, wz, elev });
}

function buildPartitions({ batch, room, floor, wx, wz, elev }) {
  const env = sidesTouchingEnvelope(room, floor.footprint);
  const h = Math.min(room.height, floor.height - 0.2);
  const doorW = 1.05;

  const place = (side, from, len, withDoor) => {
    const gapStart = len * 0.42 - doorW / 2;
    const segs = withDoor ? [[0, Math.max(0, gapStart)], [Math.min(len, gapStart + doorW), len]] : [[0, len]];
    for (const [s0, s1] of segs) {
      const w = s1 - s0;
      if (w < 0.1) continue;
      const c = from + s0 + w / 2;
      if (side === 'n' || side === 's') {
        const z = side === 'n' ? room.z + PART_T / 2 : room.z + room.d - PART_T / 2;
        batch.box('partition', w, h, PART_T, wx(c), elev + h / 2, wz(z));
      } else {
        const x = side === 'w' ? room.x + PART_T / 2 : room.x + room.w - PART_T / 2;
        batch.box('partition', PART_T, h, w, wx(x), elev + h / 2, wz(c));
      }
    }
  };

  for (const side of ['n', 's', 'e', 'w']) {
    if (env[side]) continue; // the facade closes this side
    const alongX = side === 'n' || side === 's';
    const from = alongX ? room.x + 0.05 : room.z + 0.05;
    const len = (alongX ? room.w : room.d) - 0.1;
    place(side, from, len, side === room.door);
  }
}

function buildCore({ batch, floor, wx, wz, elev }) {
  const core = floor.core;
  const h = floor.height;
  const steps = 14;
  const rise = h / steps;
  const run = Math.min(0.3, (core.d * 0.62) / steps);
  const stairW = Math.min(1.5, core.w * 0.48);
  const sx = core.x + 0.2;
  const sz = core.z + 0.2;

  for (let i = 0; i < steps; i += 1) {
    batch.box('stair', stairW, rise, run, wx(sx + stairW / 2), elev + rise * (i + 0.5), wz(sz + run * (i + 0.5)));
  }
  // landing + handrail
  batch.box('stair', stairW, 0.14, core.d - steps * run - 0.4, wx(sx + stairW / 2), elev + h - 0.07, wz(sz + steps * run + (core.d - steps * run - 0.4) / 2));
  batch.box('frame', 0.05, 0.95, 0.05, wx(sx + stairW - 0.05), elev + h * 0.55, wz(sz + run * steps * 0.5));
  batch.box('frame', stairW, 0.06, 0.06, wx(sx + stairW / 2), elev + h * 0.55 + 0.95, wz(sz + run * steps * 0.5));

  // lift shaft with doors facing the corridor
  const liftX = core.x + core.w - 2.2;
  const liftZ = core.z + 0.25;
  const lw = 1.95;
  const ld = Math.min(2.1, core.d - 0.4);
  const doorSide = core.x + core.w > floor.footprint.x + floor.footprint.w - 0.8 ? 'w' : 'w';
  batch.box('core', lw, h, 0.12, wx(liftX + lw / 2), elev + h / 2, wz(liftZ + 0.06));
  batch.box('core', lw, h, 0.12, wx(liftX + lw / 2), elev + h / 2, wz(liftZ + ld - 0.06));
  batch.box('core', 0.12, h, ld, wx(liftX + 0.06), elev + h / 2, wz(liftZ + ld / 2));
  batch.box('core', 0.12, h, ld, wx(liftX + lw - 0.06), elev + h / 2, wz(liftZ + ld / 2));
  // doors (two leaves) on the west face of the shaft
  const doorW = 1.1;
  batch.box('frame', 0.05, 2.2, doorW, wx(liftX - 0.02), elev + 1.1, wz(liftZ + ld / 2));
  batch.box('furnmetal', 0.03, 2.14, 0.52, wx(liftX - 0.05), elev + 1.07, wz(liftZ + ld / 2 - 0.28));
  batch.box('furnmetal', 0.03, 2.14, 0.52, wx(liftX - 0.05), elev + 1.07, wz(liftZ + ld / 2 + 0.28));
}

// ------------------------------------------------------------------- lighting
function buildLightFixture({ batch, room, floor, wx, wz, elev, lamps }) {
  const h = Math.min(room.height, floor.height);
  const x = wx(room.x + room.w / 2);
  const z = wz(room.z + room.d / 2);
  const n = room.w * room.d > 40 ? 2 : 1;
  for (let i = 0; i < n; i += 1) {
    const ox = n === 1 ? 0 : (i === 0 ? -room.w / 4 : room.w / 4);
    batch.box('frame', 0.03, h * 0.18, 0.03, x + ox, elev + h - h * 0.09, z);
    batch.box('lamp', 0.52, 0.06, 0.52, x + ox, elev + h - 0.2, z);
    lamps.push({ x: x + ox, y: elev + h - 0.2, z });
  }
}

// ------------------------------------------------------------------ furniture
function buildFurniture({ batch, room, elev, wx, wz }) {
  const w = room.w - 0.8;
  const d = room.d - 0.8;
  if (w < 1.6 || d < 1.6) return;
  const x0 = room.x + 0.4;
  const z0 = room.z + 0.4;
  const cx = room.x + room.w / 2;
  const cz = room.z + room.d / 2;
  const type = room.type;

  const chair = (x, z, rot = 0) => {
    batch.boxRot('furnfabric', 0.44, 0.06, 0.44, wx(x), elev + 0.46, wz(z), rot);
    batch.boxRot('furnmetal', 0.44, 0.42, 0.06, wx(x), elev + 0.24, wz(z - 0.2), rot);
    batch.boxRot('furnmetal', 0.06, 0.45, 0.06, wx(x), elev + 0.22, wz(z), rot);
  };

  if (type === 'study') {
    // book stacks against the long walls
    const rowD = 0.42;
    const moduleW = 2.1;
    const n = Math.floor(d / (rowD + 0.5));
    const runs = Math.min(n, Math.floor((w - 1) / moduleW));
    for (let i = 0; i < runs; i += 1) {
      for (let k = 0; k < 3; k += 1) {
        batch.box('furnwood', moduleW - 0.12, 1.95, rowD, wx(x0 + moduleW / 2 + k * moduleW), elev + 0.975, wz(room.z + 0.45 + i * (rowD + 0.55) + rowD / 2));
      }
    }
    // reading tables in the remaining aisle
    const tW = 1.9;
    const tD = 0.85;
    const cols = Math.max(0, Math.floor((w - 0.6) / (tW + 1.2)));
    const rows = Math.max(0, Math.floor((d - runs * (rowD + 0.55) - 0.6) / (tD + 0.9)));
    for (let i = 0; i < Math.max(1, rows); i += 1) {
      for (let j = 0; j < Math.max(1, cols); j += 1) {
        const tx = x0 + 0.9 + j * (tW + 1.2) + tW / 2;
        const tz = room.z + 0.6 + runs * (rowD + 0.55) + 1.4 + i * (tD + 0.9);
        if (tz + tD / 2 > room.z + room.d - 0.4) continue;
        batch.box('furnwood', tW, 0.06, tD, wx(tx), elev + 0.74, wz(tz));
        batch.box('furnmetal', 0.06, 0.72, 0.06, wx(tx - tW / 2 + 0.1), elev + 0.37, wz(tz - tD / 2 + 0.1));
        batch.box('furnmetal', 0.06, 0.72, 0.06, wx(tx + tW / 2 - 0.1), elev + 0.37, wz(tz + tD / 2 - 0.1));
        chair(tx - 0.55, tz, 0);
        chair(tx + 0.55, tz, 0);
      }
    }
  } else if (type === 'office') {
    const dW = 1.55;
    const dD = 0.78;
    const cols = Math.max(1, Math.floor(w / (dW + 1.15)));
    const rows = Math.max(1, Math.floor(d / (dD + 1.35)));
    for (let i = 0; i < rows; i += 1) {
      for (let j = 0; j < cols; j += 1) {
        const dx = x0 + 0.5 + j * (dW + 1.15) + dW / 2;
        const dz = z0 + 0.6 + i * (dD + 1.35) + dD / 2;
        if (dx + dW / 2 > room.x + room.w - 0.4) continue;
        batch.box('furnwood', dW, 0.05, dD, wx(dx), elev + 0.74, wz(dz));
        batch.box('furnmetal', 0.05, 0.72, 0.05, wx(dx - dW / 2 + 0.08), elev + 0.37, wz(dz - dD / 2 + 0.1));
        batch.box('furnmetal', 0.05, 0.72, 0.05, wx(dx + dW / 2 - 0.08), elev + 0.37, wz(dz + dD / 2 - 0.1));
        chair(dx, dz + dD / 2 + 0.42, Math.PI);
      }
    }
  } else if (type === 'meeting') {
    const tW = Math.min(w - 0.8, 3.2);
    const tD = Math.min(d - 1.6, 1.15);
    batch.box('furnwood', tW, 0.08, tD, wx(cx), elev + 0.74, wz(cz));
    batch.box('furnmetal', 0.1, 0.7, 0.1, wx(cx - tW / 3), elev + 0.36, wz(cz));
    batch.box('furnmetal', 0.1, 0.7, 0.1, wx(cx + tW / 3), elev + 0.36, wz(cz));
    const seats = Math.max(2, Math.floor(tW / 0.75));
    for (let i = 0; i < seats; i += 1) {
      const sx = cx - tW / 2 + 0.45 + i * (tW - 0.9) / Math.max(1, seats - 1);
      chair(sx, cz - tD / 2 - 0.45, 0);
      chair(sx, cz + tD / 2 + 0.45, Math.PI);
    }
  } else if (type === 'public') {
    // reception counter facing the door side
    const cW = Math.min(w - 1, 3.0);
    batch.box('furnwood', cW, 0.06, 0.66, wx(cx), elev + 1.06, wz(room.z + room.d - 1.6));
    batch.box('furnwood', cW, 1.03, 0.1, wx(cx), elev + 0.52, wz(room.z + room.d - 1.92));
    // soft seating along the wall
    for (let i = 0; i < Math.min(3, Math.floor(w / 2.2)); i += 1) {
      batch.box('furnfabric', 1.5, 0.42, 0.65, wx(x0 + 1.0 + i * 2.1), elev + 0.28, wz(room.z + 0.9));
    }
  } else if (type === 'exhibition') {
    const pW = Math.min(2.0, w - 1.2);
    const step = Math.max(2.4, pW + 1.2);
    for (let x = x0 + 0.6 + pW / 2; x < room.x + room.w - 0.6; x += step) {
      batch.box('furnwood', 0.14, 2.6, pW, wx(x), elev + 1.3, wz(cz), 1.2);
    }
  } else if (type === 'service') {
    batch.box('furnwood', Math.min(w - 0.6, 2.6), 1.05, 0.62, wx(cx), elev + 0.52, wz(room.z + room.d - 1.1));
    batch.box('furnwood', Math.min(w - 0.6, 2.6), 1.9, 0.42, wx(cx), elev + 0.95, wz(room.z + 0.6));
  } else if (type === 'classroom') {
    const cW = 1.35;
    const cD = 0.55;
    const cols = Math.max(1, Math.floor(w / 1.75));
    const rows = Math.max(1, Math.floor(d / 1.5));
    for (let i = 0; i < rows; i += 1) {
      for (let j = 0; j < cols; j += 1) {
        const dx = x0 + 0.4 + j * 1.75 + cW / 2;
        const dz = z0 + 0.5 + i * 1.5;
        batch.box('furnwood', cW, 0.05, cD, wx(dx), elev + 0.72, wz(dz));
        chair(dx, dz + 0.62, Math.PI);
      }
    }
  } else if (type === 'residential') {
    batch.box('furnfabric', 1.6, 0.45, 2.0, wx(cx), elev + 0.28, wz(cz + 0.2));
    batch.box('furnwood', 1.6, 0.1, 0.5, wx(cx), elev + 0.55, wz(cz - 0.85));
    batch.box('furnfabric', 1.9, 0.72, 0.85, wx(room.x + 0.6), elev + 0.38, wz(cz));
    batch.box('furnwood', 1.0, 0.36, 0.55, wx(cx), elev + 0.36, wz(cz + 0.9));
  } else if (type === 'wet') {
    const stalls = Math.max(1, Math.floor((w - 0.6) / 1.1));
    for (let i = 0; i < stalls; i += 1) {
      batch.box('partition', 0.1, 2.0, Math.min(1.4, d - 0.8), wx(x0 + 0.5 + i * 1.1), elev + 1.0, wz(cz));
    }
  } else if (type === 'technical') {
    const racks = Math.max(1, Math.floor((w - 0.5) / 0.8));
    for (let i = 0; i < racks; i += 1) {
      batch.box('furnmetal', 0.6, 1.9, 0.45, wx(x0 + 0.4 + i * 0.8), elev + 0.95, wz(room.z + 0.6));
    }
  }
}
