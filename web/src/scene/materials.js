// Material factory: maps the spec's semantic material keys to three.js
// materials with procedural maps, so concrete reads as concrete and the
// brick wall reads as brick instead of flat colour.

import * as THREE from 'three';
import { MATERIALS, ROOM_TYPES } from '../../../server/src/design/palette.js';
import {
  concreteTex, plasterTex, brickTex, stoneTex, woodTex, metalTex, pavingTex, grassTex, asphaltTex,
} from './textures.js';

const MAP_FOR = {
  'warm-concrete': () => ({ map: concreteTex(), tile: 2.4 }),
  'white-plaster': () => ({ map: plasterTex(), tile: 3 }),
  'red-brick': () => ({ map: brickTex(), tile: 2.4 }),
  'grey-brick': () => ({ map: stoneTex(), tile: 1.8 }),
  'timber-slat': () => ({ map: woodTex(), tile: 1.4 }),
  'corten-steel': () => ({ map: metalTex(), tile: 2 }),
  'dark-metal': () => ({ map: metalTex(), tile: 1.6 }),
  aluminium: () => ({ map: null, tile: 2.4 }),
  'metal-seam': () => ({ map: metalTex(), tile: 1.8 }),
  'clay-tile': () => ({ map: stoneTex(), tile: 1.6 }),
  'green-roof': () => ({ map: grassTex(), tile: 1.6 }),
  stone: () => ({ map: stoneTex(), tile: 1.8 }),
  'blue-glass': () => ({ map: null }),
  'clear-glass': () => ({ map: null }),
  'bronze-glass': () => ({ map: null }),
};

export class MaterialLibrary {
  constructor(spec) {
    this.spec = spec;
    this.cache = new Map();
  }

  base(key) {
    const role = this.spec?.facade?.materials?.[key] || this.spec?.massing?.roof?.material;
    const m = MATERIALS[key] || MATERIALS[role] || MATERIALS['warm-concrete'];
    return { key, def: m };
  }

  textureSpec(key) {
    const def = MATERIALS[key] || {};
    const fn = MAP_FOR[key];
    return { ...(fn ? fn() : {}), color: def.color || '#cfc8bd' };
  }

  get(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    const spec = this.spec;
    const role = spec?.facade?.materials || {};
    // semantic aliases resolve against the spec
    if (key === 'wall') {
      const m = this.get(role.wall || 'warm-concrete');
      m.side = THREE.DoubleSide;
      return m;
    }
    if (key === 'glasswall') return this.get(role.glass || 'blue-glass');
    if (key === 'roof') {
      const m = this.get(spec?.massing?.roof?.material || 'metal-seam');
      m.side = THREE.DoubleSide;
      if (!m.userData.roofTuned) {
        m.color.multiplyScalar(1.55);
        m.userData.roofTuned = true;
      }
      return m;
    }
    if (key === 'frame') return this.get('dark-metal');
    let mat;

    if (key === 'glass') {
      const def = MATERIALS[role.glass] || MATERIALS['blue-glass'];
      mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(def.color).multiplyScalar(0.78),
        roughness: 0.05,
        metalness: 0.32,
        transparent: true,
        opacity: 0.74,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        envMapIntensity: 1.35,
        side: THREE.DoubleSide,
      });
      mat.userData.nightEmissive = new THREE.Color('#ffd9a0');
    } else if (key === 'void') {
      mat = new THREE.MeshStandardMaterial({ color: '#343c45', roughness: 0.95 });
    } else if (key.startsWith('room:')) {
      const type = key.slice(5);
      const rt = ROOM_TYPES[type] || ROOM_TYPES.office;
      const usePaving = ['public', 'circulation', 'exhibition', 'service'].includes(type);
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(rt.floor),
        roughness: 0.9,
        map: usePaving ? pavingTex() : null,
      });
      if (usePaving) mat.color.multiplyScalar(1.35);
    } else if (key === 'partition') {
      const def = MATERIALS[role.wall] || MATERIALS['warm-concrete'];
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(def.color).lerp(new THREE.Color('#ffffff'), 0.4),
        map: plasterTex(),
        roughness: 0.92,
      });
    } else if (key === 'slab') {
      mat = new THREE.MeshStandardMaterial({ map: concreteTex(), color: new THREE.Color('#e2ded4'), roughness: 0.88 });
    } else if (key === 'plinth') {
      mat = new THREE.MeshStandardMaterial({ map: stoneTex(), color: new THREE.Color('#9a9388'), roughness: 0.8 });
    } else if (key === 'terr') {
      mat = new THREE.MeshStandardMaterial({ map: woodTex(), color: new THREE.Color('#c49a6c'), roughness: 0.75 });
    } else if (key === 'planter') {
      mat = new THREE.MeshStandardMaterial({ map: woodTex(), color: new THREE.Color('#7c6247'), roughness: 0.85 });
    } else if (key === 'lamp') {
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#f6e6c8'),
        emissive: new THREE.Color('#ffcb8a'),
        emissiveIntensity: 0.55,
        roughness: 0.35,
        metalness: 0.1,
      });
    } else if (key === 'furnwood') {
      mat = new THREE.MeshStandardMaterial({ map: woodTex(), color: new THREE.Color('#c8a479'), roughness: 0.7 });
    } else if (key === 'furnfabric') {
      mat = new THREE.MeshStandardMaterial({ color: '#5b6470', roughness: 0.95 });
    } else if (key === 'furnmetal') {
      mat = new THREE.MeshStandardMaterial({ map: metalTex(), color: new THREE.Color('#b8bfc6'), roughness: 0.45, metalness: 0.55 });
    } else if (key === 'stair') {
      mat = new THREE.MeshStandardMaterial({ map: concreteTex(), color: new THREE.Color('#d5cfc4'), roughness: 0.85 });
    } else if (key === 'carbody') {
      mat = new THREE.MeshStandardMaterial({ color: '#3d434a', roughness: 0.52, metalness: 0.25, envMapIntensity: 1.1 });
    } else if (key === 'plant') {
      mat = new THREE.MeshStandardMaterial({ color: '#6b8355', roughness: 1 });
    } else if (key === 'trunk') {
      mat = new THREE.MeshStandardMaterial({ color: '#6b5844', roughness: 1 });
    } else if (key === 'grass') {
      mat = new THREE.MeshStandardMaterial({ map: grassTex(), color: new THREE.Color('#93a377'), roughness: 1 });
    } else if (key === 'asphalt') {
      mat = new THREE.MeshStandardMaterial({ map: asphaltTex(), color: new THREE.Color('#8a8f94'), roughness: 1 });
    } else if (key === 'paving') {
      mat = new THREE.MeshStandardMaterial({ map: pavingTex(), color: new THREE.Color('#ddd7ca'), roughness: 0.95 });
    } else if (key === 'coping') {
      mat = new THREE.MeshStandardMaterial({ map: metalTex(), color: new THREE.Color('#9aa2aa'), roughness: 0.4, metalness: 0.6 });
    } else {
      const tex = this.textureSpec(key);
      const mtl = MATERIALS[key] || {};
      const metalness = mtl.metalness ?? 0;
      mat = new THREE.MeshStandardMaterial({
        map: tex.map || null,
        color: new THREE.Color(tex.color),
        roughness: Math.max(0.32, mtl.roughness ?? 0.8),
        // painted metal panels read almost black without enough IBL; pull
        // metalness back and lift the environment contribution
        metalness: metalness > 0.2 ? metalness * 0.6 : metalness,
        envMapIntensity: metalness > 0.2 ? 1.35 : 1.0,
      });
    }
    this.cache.set(key, mat);
    return mat;
  }

  dispose() {
    this.cache.forEach((m) => m.dispose());
    this.cache.clear();
  }
}

export function roomMaterialKey(room) {
  return `room:${room.type}`;
}
