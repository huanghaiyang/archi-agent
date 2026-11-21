// Roof: flat plate with parapet/coping, rooftop plant and skylight; pitched
// prisms with fascia, gutter and ridge cap; plus roof terraces on stepped
// floors with glass balustrades.

import * as THREE from 'three';

function upfaced(g) {
  g.computeVertexNormals();
  const n = g.attributes.normal;
  let sy = 0;
  for (let i = 0; i < n.count; i += 1) sy += n.getY(i);
  if (sy < 0) {
    const pos = g.attributes.position.array;
    for (let i = 0; i < pos.length; i += 9) {
      for (let k = 0; k < 3; k += 1) {
        const a = i + 3 + k;
        const b = i + 6 + k;
        const t = pos[a];
        pos[a] = pos[b];
        pos[b] = t;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}

function uvFromPlanar(g, tile = 2.4) {
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 1) {
    uv[i * 2] = pos.getX(i) / tile;
    uv[i * 2 + 1] = pos.getZ(i) / tile;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function quad(batch, a, b, c, d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  batch.push('roof', uvFromPlanar(upfaced(g)));
}

function tri(batch, a, b, c, key = 'roof') {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  batch.push(key, uvFromPlanar(upfaced(g)));
}

export function buildRoof({ batch, spec, wx, wz }) {
  const floors = spec.floors;
  const top = floors[floors.length - 1];
  if (!top) return;
  const fp = top.footprint;
  const yTop = top.elevation + top.height;
  const roof = spec.massing?.roof || { type: 'flat', angle: 0, overhang: 0.6 };
  const type = roof.type || 'flat';
  const o = Math.max(0.2, roof.overhang ?? 0.6);

  // slab / deck under the roof
  batch.box('slab', fp.w + 0.16, 0.2, fp.d + 0.16, wx(fp.x + fp.w / 2), yTop + 0.06, wz(fp.z + fp.d / 2));

  const x0 = fp.x - o;
  const x1 = fp.x + fp.w + o;
  const z0 = fp.z - o;
  const z1 = fp.z + fp.d + o;
  const cx = (x0 + x1) / 2;

  if (type === 'gable') {
    const rise = Math.tan((roof.angle || 26) * Math.PI / 180) * (fp.d / 2);
    const zr = fp.z + fp.d / 2;
    const yr = yTop + rise;
    const ey = yTop - 0.06;
    // south slope, eave line -> ridge
    quad(batch, [wx(x0), ey, wz(z1)], [wx(x1), ey, wz(z1)], [wx(x1), yr, wz(zr)], [wx(x0), yr, wz(zr)]);
    // north slope
    quad(batch, [wx(x1), ey, wz(z0)], [wx(x0), ey, wz(z0)], [wx(x0), yr, wz(zr)], [wx(x1), yr, wz(zr)]);
    // gable end walls close the triangle between eave and ridge
    for (const x of [fp.x + 0.01, fp.x + fp.w - 0.01]) {
      tri(batch, [wx(x), ey, wz(z1)], [wx(x), ey, wz(z0)], [wx(x), yr, wz(zr)], 'wall');
    }
    // ridge cap
    batch.box('coping', fp.w + o * 2, 0.14, 0.34, wx(cx), yr + 0.05, wz(zr));
    // eave fascia + gutter at both eaves
    for (const z of [z0, z1]) {
      batch.box('frame', fp.w + o * 2, 0.3, 0.1, wx(cx), ey - 0.12, wz(z));
      batch.box('frame', fp.w + o * 2, 0.13, 0.15, wx(cx), ey - 0.32, wz(z));
    }
  } else if (type === 'shed') {
    const rise = Math.tan((roof.angle || 15) * Math.PI / 180) * fp.d;
    const ey = yTop - 0.06;
    quad(batch, [wx(x0), ey, wz(z1)], [wx(x1), ey, wz(z1)], [wx(x1), yTop + rise, wz(z0)], [wx(x0), yTop + rise, wz(z0)]);
    batch.box('frame', fp.w + o * 2, 0.28, 0.1, wx(cx), ey - 0.12, wz(z1));
    batch.box('coping', fp.w + o * 2, 0.12, 0.22, wx(cx), yTop + rise + 0.05, wz(z0));
  } else if (type === 'hip') {
    const rl = Math.max(0.6, fp.w - fp.d);
    const rx0 = fp.x + (fp.w - rl) / 2;
    const rx1 = rx0 + rl;
    const zr = fp.z + fp.d / 2;
    const yr = yTop + Math.tan((roof.angle || 26) * Math.PI / 180) * (fp.d / 2);
    const ey = yTop - 0.06;
    quad(batch, [wx(x0), ey, wz(z1)], [wx(x1), ey, wz(z1)], [wx(rx1), yr, wz(zr)], [wx(rx0), yr, wz(zr)]);
    quad(batch, [wx(x1), ey, wz(z0)], [wx(x0), ey, wz(z0)], [wx(rx0), yr, wz(zr)], [wx(rx1), yr, wz(zr)]);
    tri(batch, [wx(x1), ey, wz(z1)], [wx(x1), ey, wz(z0)], [wx(rx1), yr, wz(zr)]);
    tri(batch, [wx(x0), ey, wz(z0)], [wx(x0), ey, wz(z1)], [wx(rx0), yr, wz(zr)]);
    batch.box('coping', rl, 0.12, 0.26, wx((rx0 + rx1) / 2), yr + 0.04, wz(zr));
  } else {
    // flat roof
    batch.box('roof', fp.w, 0.06, fp.d, wx(fp.x + fp.w / 2), yTop + 0.18, wz(fp.z + fp.d / 2));
    buildParapet({ batch, fp, yTop, wx, wz });
    buildRoofPlant({ batch, spec, top, fp, yTop, wx, wz });
  }

  buildTerraces({ batch, spec, wx, wz });
}

function buildParapet({ batch, fp, yTop, wx, wz }) {
  const t = 0.22;
  const h = 1.15;
  const inset = 0.12;
  const y = yTop + h / 2 + 0.1;
  // four walls, corners lapped so the ring closes
  batch.box('wall', fp.w, h, t, wx(fp.x + fp.w / 2), y, wz(fp.z + inset + t / 2));
  batch.box('wall', fp.w, h, t, wx(fp.x + fp.w / 2), y, wz(fp.z + fp.d - inset - t / 2));
  batch.box('wall', t, h, fp.d, wx(fp.x + inset + t / 2), y, wz(fp.z + fp.d / 2));
  batch.box('wall', t, h, fp.d, wx(fp.x + fp.w - inset - t / 2), y, wz(fp.z + fp.d / 2));
  // metal coping, slightly proud and overhanging
  const cy = yTop + h + 0.12;
  batch.box('coping', fp.w + 0.16, 0.1, 0.4, wx(fp.x + fp.w / 2), cy, wz(fp.z + inset + t / 2));
  batch.box('coping', fp.w + 0.16, 0.1, 0.4, wx(fp.x + fp.w / 2), cy, wz(fp.z + fp.d - inset - t / 2));
  batch.box('coping', 0.4, 0.1, fp.d + 0.16, wx(fp.x + inset + t / 2), cy, wz(fp.z + fp.d / 2));
  batch.box('coping', 0.4, 0.1, fp.d + 0.16, wx(fp.x + fp.w - inset - t / 2), cy, wz(fp.z + fp.d / 2));
}

function buildRoofPlant({ batch, spec, top, fp, yTop, wx, wz }) {
  const cx = fp.x + fp.w / 2;
  // mechanical units near the north-east corner
  const ux = fp.x + fp.w * 0.66;
  const uz = fp.z + fp.d * 0.34;
  batch.box('furnmetal', 2.3, 1.15, 1.4, wx(ux), yTop + 0.68, wz(uz));
  batch.box('furnmetal', 0.9, 0.45, 0.9, wx(ux - 2.0), yTop + 0.33, wz(uz + 1.0));
  // ducts
  batch.box('furnmetal', 1.2, 0.3, 0.5, wx(ux - 0.4), yTop + 1.38, wz(uz - 0.5));

  // skylight above the core
  if (top.core) {
    const core = top.core;
    const sw = Math.min(2.6, core.w - 0.6);
    const sd = Math.min(2.4, core.d - 0.6);
    const sy = yTop + 0.62;
    batch.box('frame', sw + 0.24, 0.14, sd + 0.24, wx(core.x + core.w / 2), yTop + 0.2, wz(core.z + core.d / 2));
    batch.box('glass', sw, 0.06, sd, wx(core.x + core.w / 2), sy, wz(core.z + core.d / 2));
    batch.box('frame', 0.08, 0.5, sd + 0.2, wx(core.x + core.w / 2 - sw / 2 - 0.08), sy - 0.2, wz(core.z + core.d / 2));
    batch.box('frame', 0.08, 0.5, sd + 0.2, wx(core.x + core.w / 2 + sw / 2 + 0.08), sy - 0.2, wz(core.z + core.d / 2));
  }

  // photo-voltaic array for tech schemes
  if (spec.meta.style === 'tech') {
    for (let i = 0; i < 3; i += 1) {
      batch.box('glass', 3.2, 0.06, 1.5, wx(cx - 2.5), yTop + 0.55, wz(fp.z + fp.d * 0.68 + i * 1.9));
      batch.box('frame', 3.2, 0.08, 0.06, wx(cx - 2.5), yTop + 0.52, wz(fp.z + fp.d * 0.68 + i * 1.9));
    }
  }

  // roof drains
  for (const [dx, dz] of [[fp.x + 0.6, fp.z + 0.6], [fp.x + fp.w - 0.6, fp.z + 0.6], [fp.x + 0.6, fp.z + fp.d - 0.6], [fp.x + fp.w - 0.6, fp.z + fp.d - 0.6]]) {
    batch.cylinder('frame', 0.12, 0.12, 0.1, wx(dx), yTop + 0.24, wz(dz), 8);
  }
}

function buildTerraces({ batch, spec, wx, wz }) {
  const floors = spec.floors;
  for (let i = 1; i < floors.length; i += 1) {
    const lower = floors[i - 1];
    const upper = floors[i];
    const lf = lower.footprint;
    const uf = upper.footprint;
    const y = lower.elevation + lower.height;
    const depthS = (lf.z + lf.d) - (uf.z + uf.d);
    if (depthS < 1.7) continue;
    const zA = Math.max(uf.z + uf.d, lf.z + 0.3);
    const zB = lf.z + lf.d - 0.35;
    // decking
    batch.box('terr', lf.w - 0.8, 0.06, zB - zA, wx(lf.x + lf.w / 2), y + 0.1, wz((zA + zB) / 2));
    // glass balustrade along the exposed edge
    const railH = 1.05;
    batch.box('glass', lf.w - 0.8, railH, 0.04, wx(lf.x + lf.w / 2), y + 0.12 + railH / 2, wz(zB));
    batch.box('coping', lf.w - 0.6, 0.08, 0.12, wx(lf.x + lf.w / 2), y + 0.12 + railH + 0.04, wz(zB));
    for (let x = lf.x + 0.4; x <= lf.x + lf.w - 0.3; x += 1.6) {
      batch.box('frame', 0.05, railH, 0.05, wx(x), y + 0.12 + railH / 2, wz(zB));
    }
  }
}
