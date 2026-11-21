// Procedural canvas textures + per-face UV scaling so one tile size works on
// walls of any dimension (BoxGeometry gives 0..1 UV per face, which would
// stretch a brick pattern across a 20m wall).

import * as THREE from 'three';

const cache = new Map();

function canvasTexture(name, draw, size = 512) {
  if (cache.has(name)) return cache.get(name);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(name, tex);
  return tex;
}

function noise(ctx, size, count, alpha, color = '0,0,0') {
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = `rgba(${color},${Math.random() * alpha})`;
    const r = 1 + Math.random() * 2.4;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// tile = 0.8m of concrete: board marks + fine aggregate
export const concreteTex = () => canvasTexture('concrete', (ctx, s) => {
  ctx.fillStyle = '#cfc8bd';
  ctx.fillRect(0, 0, s, s);
  noise(ctx, s, 900, 0.09, '90,84,76');
  noise(ctx, s, 500, 0.08, '255,255,255');
  // formwork board seams
  ctx.strokeStyle = 'rgba(90,84,76,0.18)';
  ctx.lineWidth = 2;
  for (let y = 0; y <= s; y += s / 4) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(s, y);
    ctx.stroke();
  }
  // tie holes
  ctx.fillStyle = 'rgba(70,64,58,0.22)';
  for (let x = s / 4; x < s; x += s / 2) {
    for (let y = s / 8; y < s; y += s / 4) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // subtle stains
  for (let i = 0; i < 6; i += 1) {
    const g = ctx.createLinearGradient(0, Math.random() * s, 0, Math.random() * s + 120);
    g.addColorStop(0, 'rgba(110,104,95,0.05)');
    g.addColorStop(1, 'rgba(110,104,95,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
});

export const plasterTex = () => canvasTexture('plaster', (ctx, s) => {
  ctx.fillStyle = '#ecebe7';
  ctx.fillRect(0, 0, s, s);
  noise(ctx, s, 800, 0.05, '150,148,140');
  noise(ctx, s, 400, 0.06, '255,255,255');
});

export const brickTex = () => canvasTexture('brick', (ctx, s) => {
  ctx.fillStyle = '#8f5a4a';
  ctx.fillRect(0, 0, s, s);
  const bw = s / 6;
  const bh = s / 12;
  for (let row = 0; row < 12; row += 1) {
    const offset = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 7; col += 1) {
      const x = col * bw + offset + 1;
      const y = row * bh + 1;
      const shade = 0.86 + Math.random() * 0.22;
      ctx.fillStyle = `rgb(${Math.round(158 * shade)},${Math.round(86 * shade)},${Math.round(63 * shade)})`;
      ctx.fillRect(x, y, bw - 2, bh - 2);
    }
  }
  noise(ctx, s, 600, 0.08, '60,30,20');
});

export const stoneTex = () => canvasTexture('stone', (ctx, s) => {
  ctx.fillStyle = '#b8b2a6';
  ctx.fillRect(0, 0, s, s);
  noise(ctx, s, 1000, 0.07, '90,86,78');
  ctx.strokeStyle = 'rgba(80,76,68,0.25)';
  ctx.lineWidth = 2;
  for (let y = 0; y <= s; y += s / 3) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(s, y);
    ctx.stroke();
  }
  for (let x = 0; x <= s; x += s / 4) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, s);
    ctx.stroke();
  }
});

export const woodTex = () => canvasTexture('wood', (ctx, s) => {
  ctx.fillStyle = '#a97845';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 12; i += 1) {
    const x = (i * s) / 12;
    const shade = 0.82 + Math.random() * 0.3;
    ctx.fillStyle = `rgb(${Math.round(169 * shade)},${Math.round(120 * shade)},${Math.round(69 * shade)})`;
    ctx.fillRect(x + 1, 0, s / 12 - 2, s);
    ctx.strokeStyle = 'rgba(70,44,24,0.25)';
    ctx.lineWidth = 1;
    for (let g = 0; g < 5; g += 1) {
      ctx.beginPath();
      ctx.moveTo(x + 2, Math.random() * s);
      ctx.bezierCurveTo(x + s / 24, Math.random() * s, x + s / 16, Math.random() * s, x + s / 12 - 2, Math.random() * s);
      ctx.stroke();
    }
  }
});

export const metalTex = () => canvasTexture('metal', (ctx, s) => {
  ctx.fillStyle = '#cdd2d7';
  ctx.fillRect(0, 0, s, s);
  noise(ctx, s, 700, 0.04, '90,96,104');
  // standing seams
  for (let x = 0; x <= s; x += s / 8) {
    const g = ctx.createLinearGradient(x - 6, 0, x + 6, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.16)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 6, 0, 12, s);
  }
});

export const pavingTex = () => canvasTexture('paving', (ctx, s) => {
  ctx.fillStyle = '#cfcabf';
  ctx.fillRect(0, 0, s, s);
  noise(ctx, s, 900, 0.07, '100,96,88');
  ctx.strokeStyle = 'rgba(120,114,104,0.35)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= s; i += s / 4) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(s, i);
    ctx.stroke();
  }
});

export const grassTex = () => canvasTexture('grass', (ctx, s) => {
  ctx.fillStyle = '#7d8f63';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 2600; i += 1) {
    const shade = 0.7 + Math.random() * 0.5;
    ctx.fillStyle = `rgba(${Math.round(96 * shade)},${Math.round(122 * shade)},${Math.round(74 * shade)},0.7)`;
    ctx.fillRect(Math.random() * s, Math.random() * s, 2, 4);
  }
});

export const asphaltTex = () => canvasTexture('asphalt', (ctx, s) => {
  ctx.fillStyle = '#54585c';
  ctx.fillRect(0, 0, s, s);
  noise(ctx, s, 1600, 0.12, '210,210,210');
});

/** Scale BoxGeometry UVs by its real size so textures keep a constant world tile. */
export function scaleBoxUV(geom, w, h, d, tile = 2) {
  const uv = geom.attributes.uv;
  if (!uv) return;
  const t = Math.max(0.2, tile);
  const perFace = 4;
  const sizes = [
    [d, h], // +x
    [d, h], // -x
    [w, d], // +y
    [w, d], // -y
    [w, h], // +z
    [w, h], // -z
  ];
  for (let f = 0; f < 6; f += 1) {
    const [su, sv] = sizes[f];
    for (let i = 0; i < perFace; i += 1) {
      const idx = f * perFace + i;
      uv.setXY(idx, uv.getX(idx) * (su / t), uv.getY(idx) * (sv / t));
    }
  }
  uv.needsUpdate = true;
}
