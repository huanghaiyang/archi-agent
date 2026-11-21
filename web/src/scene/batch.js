// Geometry bucket: collect transformed boxes per material key, merge once.
// Keeps draw calls low while allowing hundreds of detail elements.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { scaleBoxUV } from './textures.js';

const TILE = {
  wall: 2.4,
  partition: 2.4,
  slab: 2.4,
  roof: 2.4,
  frame: 2.0,
  core: 2.0,
  stair: 2.0,
  plinth: 1.6,
  furnwood: 1.2,
  furnfabric: 1.2,
  furnmetal: 1.2,
  terr: 1.6,
  planter: 1.6,
};

export class Batch {
  constructor() {
    this.buckets = new Map();
  }

  push(key, geom) {
    if (!geom) return;
    // normalise so mergeGeometries never mixes indexed / non-indexed or
    // geometries without a uv channel (roof quads, tree crowns)
    if (!geom.attributes.uv) {
      const n = geom.attributes.position.count;
      geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    }
    if (!geom.index) {
      const n = geom.attributes.position.count;
      geom.setIndex(Array.from({ length: n }, (_, i) => i));
    }
    if (!this.buckets.has(key)) this.buckets.set(key, []);
    this.buckets.get(key).push(geom);
  }

  /** Box centred at (x,y,z) with world-scaled UVs. */
  box(key, w, h, d, x, y, z, tileOverride) {
    if (w <= 0.001 || h <= 0.001 || d <= 0.001) return;
    const g = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(g, w, h, d, tileOverride ?? TILE[key] ?? 2.0);
    g.translate(x, y, z);
    this.push(key, g);
  }

  /** Box rotated around Y (for angled furniture / panels). */
  boxRot(key, w, h, d, x, y, z, rotY, tileOverride) {
    const g = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(g, w, h, d, tileOverride ?? TILE[key] ?? 2.0);
    g.rotateY(rotY);
    g.translate(x, y, z);
    this.push(key, g);
  }

  cylinder(key, rTop, rBottom, h, x, y, z, seg = 10) {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
    g.translate(x, y, z);
    this.push(key, g);
    return g;
  }

  merge() {
    const out = new Map();
    for (const [key, list] of this.buckets) {
      const merged = mergeGeometries(list, false);
      if (merged) out.set(key, merged);
      list.forEach((g) => g.dispose());
    }
    this.buckets.clear();
    return out;
  }
}
