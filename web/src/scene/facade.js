// Elevation construction: four facade systems with real depth (reveals,
// mullions, spandrels, fins), plus the ground-floor entrance with canopy,
// steps and signage.

import * as THREE from 'three';
import { windowBays, facadeBays, windowVertical } from '../../../shared/facade.js';
import { facadeSegments } from '../../../shared/facade.js';

const T = 0.3;
const SIDES = ['n', 's', 'e', 'w'];

const sideGeom = (side, fp) => {
  const alongX = side === 'n' || side === 's';
  return {
    alongX,
    fixed: side === 'n' ? fp.z : side === 's' ? fp.z + fp.d : side === 'w' ? fp.x : fp.x + fp.w,
    dir: side === 'n' || side === 'w' ? 1 : -1,
    start: alongX ? fp.x : fp.z,
    end: alongX ? fp.x + fp.w : fp.z + fp.d,
  };
};

export function buildFacade({ batch, floor, spec, wx, wz }) {
  for (const side of SIDES) buildSide({ batch, floor, spec, wx, wz, side });
  addPerimeterColumns({ batch, floor, spec, wx, wz });
  return null;
}

function buildSide({ batch, floor, spec, wx, wz, side }) {
  const fp = floor.footprint;
  const { alongX, fixed, dir } = sideGeom(side, fp);
  const elev = floor.elevation;
  const fh = floor.height;
  const facade = spec.facade;
  const system = facade.system;

  const panel = (key, a, len, y, h, depth = T) => {
    if (len <= 0.01 || h <= 0.01) return;
    const mid = a + len / 2;
    if (alongX) batch.box(key, len, h, depth, wx(mid), elev + y + h / 2, wz(fixed) + dir * depth / 2);
    else batch.box(key, depth, h, len, wx(fixed) + dir * depth / 2, elev + y + h / 2, wz(mid));
  };

  const glass = (a, len, y, h, fromOuter = 0.06) => {
    const mid = a + len / 2;
    if (alongX) batch.box('glass', len, h, 0.04, wx(mid), elev + y + h / 2, wz(fixed) + dir * fromOuter);
    else batch.box('glass', 0.04, h, len, wx(fixed) + dir * fromOuter, elev + y + h / 2, wz(mid));
  };

  const bar = (key, a, len, y, h, depth, protrude = 0) => {
    // thin member sitting on the outer face (positive protrude = further out)
    const mid = a + len / 2;
    const off = protrude + depth / 2;
    if (alongX) batch.box(key, len, h, depth, wx(mid), elev + y + h / 2, wz(fixed) - dir * off);
    else batch.box(key, depth, h, len, wx(fixed) - dir * off, elev + y + h / 2, wz(mid));
  };

  const segments = facadeSegments(floor, side);

  for (const seg of segments) {
    const a = seg.a;
    const len = seg.b - seg.a;
    if (len < 0.05) continue;

    if (!seg.glazed) {
      panel('wall', a, len, 0, fh);
      addSideDetails({ batch, side, alongX, fixed, dir, a, len, elev, fh, wx, wz, spec });
      continue;
    }
    if (system === 'curtain') {
      const spandrel = 0.45;
      panel('wall', a, len, 0, spandrel);
      if (fh - spandrel > 0.5) glass(a, len, spandrel, fh - spandrel - 0.02, 0.02);
      // horizontal mullion at spandrel top and head
      bar('frame', a, len, spandrel - 0.06, 0.06, 0.12, 0.02);
      bar('frame', a, len, fh - 0.06, 0.06, 0.12, 0.02);
      // vertical mullions
      const pitch = Math.max(1.1, Math.min(1.8, facade.windowWidth || 1.4));
      for (let x = a + pitch; x < a + len - 0.2; x += pitch) {
        bar('frame', x - 0.045, 0.09, spandrel - 0.06, fh - spandrel, 0.14, 0.02);
      }
      // spandrel panel finish
      if (spec.facade.materials.wall) bar('wall', a, len, 0.01, spandrel - 0.08, 0.06, 0.0);
    } else if (system === 'ribbon') {
      const sill = 0.75;
      const head = 0.45;
      const winH = Math.min(fh - sill - head, 2.0);
      panel('wall', a, len, 0, sill);
      panel('wall', a, len, sill + winH, fh - sill - winH);
      glass(a, len, sill, winH, 0.06);
      bar('frame', a, len, sill - 0.06, 0.06, 0.16, 0.03);
      bar('frame', a, len, sill + winH, 0.06, 0.16, 0.03);
      const pitch = Math.max(1.0, (facade.windowWidth || 1.6));
      for (let x = a + pitch; x < a + len - 0.2; x += pitch) {
        bar('frame', x - 0.04, 0.08, sill, winH, 0.2, 0.02);
      }
      // transom
      bar('frame', a, len, sill + winH * 0.55, 0.05, 0.18, 0.02);
    } else if (system === 'screen') {
      const sill = 0.6;
      const winH = Math.min(fh - sill - 0.5, 2.5);
      panel('wall', a, len, 0, sill);
      panel('wall', a, len, sill + winH, fh - sill - winH);
      glass(a, len, sill, winH, 0.16);
      // vertical timber fins in front of the glazing
      const pitch = Math.max(0.5, Math.min(1.0, (facade.gap || 0.5) + 0.35));
      for (let x = a + pitch; x < a + len - 0.15; x += pitch) {
        bar(spec.facade.materials.wall === 'timber-slat' ? 'wall' : 'frame', x - 0.03, 0.06, sill - 0.1, winH + 0.2, 0.34, 0.16);
      }
      // top and bottom rails
      bar('frame', a, len, sill - 0.12, 0.06, 0.42, 0.14);
      bar('frame', a, len, sill + winH, 0.06, 0.42, 0.14);
    } else {
      // punched openings with deep reveal + stone liner + projecting sill
      const { sill, height: winH } = windowVertical(fh, facade);
      const aligned = facade.align !== false ? facadeBays(floor, side, facade) : null;
      const bays = aligned
        ? aligned
          .filter((b) => b.a >= a - 0.001 && b.b <= a + len + 0.001)
          .map((b) => ({ offset: b.a - a, width: b.width }))
        : windowBays(len, facade);
      let cursor = a;
      for (const bay of bays) {
        const bs = a + bay.offset;
        if (bs > cursor + 0.02) panel('wall', cursor, bs - cursor, 0, fh);
        if (bay.width > len - 0.3) {
          panel('wall', bs, bay.width, 0, fh);
          cursor = bs + bay.width;
          continue;
        }
        panel('wall', bs, bay.width, 0, sill);
        panel('wall', bs, bay.width, sill + winH, fh - sill - winH);
        glass(bs, bay.width, sill, winH, 0.19);
        // liner: lintel + jambs on the outer face
        bar('coping', bs, bay.width, sill + winH - 0.09, 0.09, 0.06, 0.02);
        bar('coping', bs - 0.02, 0.09, sill, winH, 0.06, 0.02);
        bar('coping', bs + bay.width - 0.07, 0.09, sill, winH, 0.06, 0.02);
        // projecting stone sill
        bar('coping', bs - 0.12, bay.width + 0.24, sill - 0.12, 0.1, 0.36, 0.04);
        // centre mullion on wide windows
        if (bay.width > 2.4) bar('frame', bs + bay.width / 2 - 0.04, 0.08, sill, winH, 0.2, 0.06);
        cursor = bs + bay.width;
      }
      if (a + len > cursor + 0.02) panel('wall', cursor, a + len - cursor, 0, fh);
    }
  }
}

/** Rainwater downpipes + a thin base shadow line at the slab edge. */
function addSideDetails({ batch, side, alongX, fixed, dir, a, len, elev, fh, wx, wz, spec }) {
  // down pipe every ~9m on the perimeter
  const pitch = 9;
  for (let x = a + pitch; x < a + len - 0.5; x += pitch) {
    const r = 0.07;
    if (alongX) batch.cylinder('frame', r, r, fh, wx(x), elev + fh / 2, wz(fixed) - dir * 0.16, 8);
    else batch.cylinder('frame', r, r, fh, wx(fixed) - dir * 0.16, elev + fh / 2, wz(x), 8);
  }
}

function addPerimeterColumns({ batch, floor, spec, wx, wz }) {
  const style = spec.meta.style;
  if (!['tech', 'industrial'].includes(style)) return;
  const fp = floor.footprint;
  const elev = floor.elevation;
  const h = floor.height;
  const inset = 0.55;
  const cols = [];
  const step = 5.4;
  for (let x = fp.x + inset; x <= fp.x + fp.w - inset + 0.01; x += step) cols.push([x, fp.z + inset], [x, fp.z + fp.d - inset]);
  for (let z = fp.z + inset + step; z < fp.z + fp.d - inset - 0.01; z += step) cols.push([fp.x + inset, z], [fp.x + fp.w - inset, z]);
  const seen = new Set();
  for (const [x, z] of cols) {
    const key = `${Math.round(x * 10)}-${Math.round(z * 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    batch.box('frame', 0.34, h, 0.34, wx(x), elev + h / 2, wz(z));
  }
}

// ------------------------------------------------------------------ entrance
export function buildEntrance({ batch, spec, wx, wz, extras }) {
  const ground = spec.floors[0];
  if (!ground) return;
  const fp = ground.footprint;
  const facade = spec.facade;
  const southRooms = ground.rooms.filter((r) =>
    Math.abs(r.z + r.d - (fp.z + fp.d)) < 0.08 && !['technical', 'wet'].includes(r.type));
  if (!southRooms.length) return;

  const lobby = southRooms.find((r) => /门厅|入口|大堂|接待|前厅|展厅/.test(r.name)) || southRooms[0];
  const doorW = Math.min(3.6, Math.max(2.4, lobby.w * 0.45));
  const doorX = Math.max(fp.x + 1.2, Math.min(lobby.x + lobby.w / 2 - doorW / 2, fp.x + fp.w - doorW - 1.2));
  const zOut = fp.z + fp.d;           // south outer face
  const elev = ground.elevation;

  // entrance recess panel (dark), door frame + glass
  batch.box('void', doorW, 2.7, 0.05, wx(doorX + doorW / 2), elev + 1.35, wz(zOut) + 0.02);
  batch.box('glass', doorW - 0.12, 2.55, 0.04, wx(doorX + doorW / 2), elev + 1.3, wz(zOut) + 0.1);
  batch.box('frame', doorW, 0.1, 0.16, wx(doorX + doorW / 2), elev + 2.7, wz(zOut) + 0.06);
  batch.box('frame', 0.1, 2.7, 0.16, wx(doorX + 0.05), elev + 1.35, wz(zOut) + 0.06);
  batch.box('frame', 0.1, 2.7, 0.16, wx(doorX + doorW - 0.05), elev + 1.35, wz(zOut) + 0.06);
  batch.box('frame', 0.08, 2.7, 0.16, wx(doorX + doorW / 2), elev + 1.35, wz(zOut) + 0.06);

  // steps down to the plaza
  for (let i = 0; i < 3; i += 1) {
    batch.box('plinth', doorW + 1.6 - i * 0.5, 0.16, 0.55, wx(doorX + doorW / 2), elev - 0.08 - i * 0.16, wz(zOut) + 0.35 + i * 0.5);
  }

  // canopy
  const cw = doorW + 2.2;
  const cd = 3.0;
  const cy = elev + 3.35;
  batch.box('coping', cw, 0.2, cd, wx(doorX + doorW / 2), cy, wz(zOut) + cd / 2);
  batch.box('coping', cw, 0.62, 0.14, wx(doorX + doorW / 2), cy + 0.2, wz(zOut) + cd - 0.07);
  for (const dx of [0.45, cw - 0.45]) {
    batch.cylinder('frame', 0.07, 0.07, 3.35, wx(doorX + dx), elev + 1.675, wz(zOut) + cd - 0.35, 8);
  }

  // signage plate on the canopy fascia
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(cw - 0.8, 4.2), 0.42),
    new THREE.MeshBasicMaterial({ map: signTexture(spec.meta.programmeLabel, 'ARCHI-AGENT'), transparent: true }),
  );
  plate.position.set(wx(doorX + doorW / 2), cy + 0.21, wz(zOut) + cd + 0.005);
  extras.push(plate);

  // entrance mat
  batch.box('paving', doorW + 0.6, 0.02, 1.2, wx(doorX + doorW / 2), elev + 0.03, wz(zOut) + 0.85);
}

export function signTexture(text, sub) {
  const c = document.createElement('canvas');
  const dpr = 2;
  c.width = 640 * dpr;
  c.height = 96 * dpr;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1b1f24';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#e8e2d5';
  ctx.font = `500 ${34 * dpr}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text || '', 26 * dpr, c.height / 2 - 4 * dpr);
  ctx.fillStyle = '#c6a468';
  ctx.font = `400 ${15 * dpr}px "Helvetica Neue",Arial,sans-serif`;
  ctx.fillText(sub || '', c.width - 26 * dpr - ctx.measureText(sub || '').width, c.height / 2 + 18 * dpr);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
