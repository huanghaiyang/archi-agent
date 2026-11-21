// Site: paving, street, planting, trees, benches, bollards and a soft contact
// shadow so the massing sits on the ground instead of floating.

import * as THREE from 'three';

function tree(batch, x, z, s = 1) {
  batch.cylinder('trunk', 0.09 * s, 0.14 * s, 2.4 * s, x, 1.2 * s, z, 7);
  const crowns = [
    [0, 3.2, 0, 1.55],
    [-0.5, 3.9, 0.35, 1.05],
    [0.45, 3.7, -0.4, 0.95],
  ];
  for (const [dx, y, dz, r] of crowns) {
    const g = new THREE.IcosahedronGeometry(r * s, 1);
    // flatten a little for a broadleaf silhouette
    g.scale(1, 0.82, 1);
    g.translate(x + dx * s, y * s, z + dz * s);
    batch.push('plant', g);
  }
}

function bench(batch, x, z, rot = 0) {
  batch.boxRot('furnwood', 1.8, 0.08, 0.5, x, 0.45, z, rot);
  batch.boxRot('furnwood', 0.08, 0.52, 0.5, x - 0.85, 0.26, z, rot);
  batch.boxRot('furnmetal', 0.08, 0.45, 0.42, x - 0.6, 0.22, z, rot);
  batch.boxRot('furnmetal', 0.08, 0.45, 0.42, x + 0.6, 0.22, z, rot);
}

function car(batch, x, z, rot = 0) {
  const L = 4.2;
  batch.boxRot('carbody', L, 0.7, 1.76, x, 0.66, z, rot);
  batch.boxRot('carbody', L * 0.46, 0.5, 1.62, x, 1.2, z, rot);
  batch.boxRot('carbody', L * 0.5, 0.36, 1.68, x, 0.4, z, rot);
  batch.boxRot('glass', L * 0.42, 0.3, 1.68, x, 1.2, z, rot);
  for (const dz of [-0.82, 0.82]) {
    for (const dx of [-1.32, 1.32]) {
      const wx0 = x + Math.cos(rot) * dx - Math.sin(rot) * dz;
      const wz0 = z + Math.sin(rot) * dx + Math.cos(rot) * dz;
      const g = new THREE.CylinderGeometry(0.31, 0.31, 0.2, 12);
      g.rotateX(Math.PI / 2);
      g.translate(wx0, 0.31, wz0);
      batch.push('frame', g);
    }
  }
}

function lamp(batch, x, z) {
  batch.cylinder('frame', 0.11, 0.16, 5.0, x, 2.5, z, 8);
  batch.box('frame', 0.9, 0.5, 0.16, x - 0.4, 4.9, z);
  batch.box('glass', 0.5, 0.08, 0.4, x - 0.72, 4.62, z);
}

function contactShadow(fp) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 126);
  g.addColorStop(0, 'rgba(20,18,14,0.42)');
  g.addColorStop(0.55, 'rgba(20,18,14,0.22)');
  g.addColorStop(1, 'rgba(20,18,14,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(fp.w + 12, fp.d + 12),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.95 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export function buildSite({ batch, spec, wx, wz, extras }) {
  const site = spec.site;
  const ground = spec.floors[0]?.footprint || { x: 0, z: 0, w: site.width, d: site.depth };
  const sw = site.width;
  const sd = site.depth;

  // grass mat under everything
  batch.box('grass', sw + 34, 0.12, sd + 38, wx(sw / 2), -0.06, wz(sd / 2 + 3));

  // paved site (inside the boundary)
  batch.box('paving', sw, 0.1, sd, wx(sw / 2), 0.02, wz(sd / 2));

  // street + sidewalk to the south
  batch.box('asphalt', sw + 24, 0.1, 9, wx(sw / 2), 0.03, wz(sd + 5.4));
  batch.box('paving', sw + 24, 0.1, 1.8, wx(sw / 2), 0.05, wz(sd + 0.9));
  for (let x = 1; x < sw + 20; x += 4.4) {
    batch.box('paving', 2.2, 0.02, 0.16, wx(x), 0.09, wz(sd + 5.4));
  }

  // approach path to the entrance
  const doorZ = ground.z + ground.d;
  batch.box('coping', 3.6, 0.03, 0.2, wx(ground.x + ground.w / 2), 0.08, wz(doorZ + 0.2));
  batch.box('paving', 2.8, 0.04, sd - doorZ - 0.6, wx(ground.x + ground.w / 2), 0.07, wz((doorZ + sd) / 2));

  // planting beds at the corners + hedge along the boundary
  const beds = [
    [site.setback?.west ?? 4, site.setback?.north ?? 5],
    [sw - (site.setback?.east ?? 4), sd - (site.setback?.south ?? 4)],
    [sw - (site.setback?.east ?? 4), site.setback?.north ?? 5],
  ];
  for (const [bx, bz] of beds) {
    batch.box('grass', 3.4, 0.1, 3.0, wx(bx), 0.1, wz(bz));
  }

  // boundary hedge with a gap at the street entrance
  const hedgeH = 0.75;
  for (let x = 1.2; x < sw - 1.2; x += 2.0) {
    if (x > sw / 2 - 2.2 && x < sw / 2 + 2.2) continue;
    batch.box('plant', 1.9, hedgeH, 0.5, wx(x), hedgeH / 2 + 0.06, wz(0.35));
  }
  for (let x = 1.2; x < sw - 1.2; x += 2.0) {
    batch.box('plant', 1.9, hedgeH, 0.5, wx(x), hedgeH / 2 + 0.06, wz(sd - 0.35));
  }
  for (let z = 1.6; z < sd - 1.6; z += 2.0) {
    batch.box('plant', 0.5, hedgeH, 1.9, wx(0.35), hedgeH / 2 + 0.06, wz(z));
    batch.box('plant', 0.5, hedgeH, 1.9, wx(sw - 0.35), hedgeH / 2 + 0.06, wz(z));
  }

  // trees: along the west edge, the north-east corner and beside the street
  const treeSpots = [
    [1.8, sd * 0.55, 1.15],
    [1.8, sd * 0.8, 0.95],
    [sw - 2.2, sd * 0.55, 1.05],
    [sw * 0.22, 1.8, 1.2],
    [sw * 0.78, 1.9, 1.0],
    [sw - 2.4, sd * 0.22, 0.9],
  ];
  for (const [tx, tz, ts] of treeSpots) {
    if (tx > ground.x - 1 && tx < ground.x + ground.w + 1 && tz > ground.z - 1 && tz < ground.z + ground.d + 1) continue;
    tree(batch, wx(tx), wz(tz), ts);
  }

  // benches + bollards near the plaza
  bench(batch, wx(sw * 0.32), wz(sd - 1.8));
  bench(batch, wx(sw * 0.68), wz(sd - 1.8), Math.PI);
  for (let x = ground.x + ground.w / 2 - 3.2; x <= ground.x + ground.w / 2 + 3.2; x += 1.6) {
    batch.cylinder('frame', 0.09, 0.09, 0.9, wx(x), 0.45, wz(sd - 0.9), 8);
  }

  // parked cars along the kerb
  const carX = [6.5, 11.5, 21.0, 31.5];
  for (let i = 0; i < carX.length; i += 1) {
    car(batch, wx(carX[i]), wz(sd + 2.5), i % 2 ? 0 : Math.PI);
  }

  // street lights on the pavement
  for (let x = 3; x < sw + 10; x += 11) {
    lamp(batch, wx(x), wz(sd + 0.35));
  }

  // low planters with shrubs by the entrance
  for (const [px, pz] of [[sw / 2 - 6, sd - 3.4], [sw / 2 + 6, sd - 3.4]]) {
    batch.box('plinth', 1.4, 0.45, 1.0, wx(px), 0.28, wz(pz));
    const g1 = new THREE.IcosahedronGeometry(0.55, 1);
    g1.translate(wx(px), 0.85, wz(pz));
    batch.push('plant', g1);
  }

  const shadow = contactShadow({ x: ground.x, z: ground.z, w: ground.w, d: ground.d });
  shadow.position.set(wx(ground.x + ground.w / 2), 0.11, wz(ground.z + ground.d / 2));
  extras.push(shadow);

  // datum line / site outline
  extras.push(...siteOutline(site, wx, wz));
}

function siteOutline(site, wx, wz) {
  const mat = new THREE.LineBasicMaterial({ color: 0x8d7a55, transparent: true, opacity: 0.45 });
  const pts = [
    [0, 0], [site.width, 0], [site.width, site.depth], [0, site.depth], [0, 0],
  ].map(([x, z]) => new THREE.Vector3(wx(x), 0.13, wz(z)));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return [new THREE.Line(geo, mat)];
}
