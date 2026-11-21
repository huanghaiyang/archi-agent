// Three.js renderer for the DesignSpec produced by the agent.
//
// v2: the massing is decomposed into construction layers — plinth, slabs,
// facade systems with real depth, interior fit-out, roof build-up, site
// landscape. Facade openings come from shared/facade.js so the picture and
// the server-side metrics never drift apart.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Batch } from './batch.js';
import { MaterialLibrary } from './materials.js';
import { buildFacade, buildEntrance } from './facade.js';
import { buildInterior } from './interior.js';
import { buildRoof } from './roof.js';
import { buildSite } from './site.js';

export class ArchiViewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 3000);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.42;
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxPolarAngle = Math.PI * 0.492;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 520;

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.hemi = new THREE.HemisphereLight(0xcfe3f5, 0xc9c1b0, 0.5);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffe9cc, 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.options = { roof: true, labels: false, isolate: 0, explode: false, time: 'day', context: true };
    this.spec = null;
    this.mats = null;
    this.floorGroups = [];
    this.roofGroup = null;
    this.labelsGroup = null;
    this.contextGroup = null;
    this.siteGroup = null;
    this.explode = 0;

    this.clock = new THREE.Clock();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas.parentElement || canvas);
    }
    this.resize();
    this.animate = this.animate.bind(this);
    this.raf = requestAnimationFrame(this.animate);
  }

  resize() {
    const el = this.canvas.parentElement || this.canvas;
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  animate() {
    this.raf = requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());
    const target = this.options.explode ? 1 : 0;
    this.explode += (target - this.explode) * Math.min(1, dt * 5);
    const off = 1.6 * this.explode;
    this.floorGroups.forEach((g) => {
      g.position.y = (g.userData.level || 0) * off;
    });
    if (this.roofGroup) this.roofGroup.position.y = (this.roofGroup.userData.level || 0) * off + 0.35 * this.explode;
    if (this.labelsGroup) {
      this.labelsGroup.children.forEach((s) => {
        s.position.y = (s.userData.baseY || 0) + (s.userData.level || 0) * off;
      });
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------------ build
  setSpec(spec) {
    if (!spec || !spec.floors?.length) return;
    this.spec = spec;
    this.disposeBuilding();
    this.mats = new MaterialLibrary(spec);

    const siteW = spec.site.width;
    const siteD = spec.site.depth;
    const wx = (x) => x - siteW / 2;
    const wz = (z) => z - siteD / 2;

    // ---- site + landscape (never explodes)
    const siteBatch = new Batch();
    const siteExtras = [];
    buildSite({ batch: siteBatch, spec, wx, wz, extras: siteExtras });
    const site = new THREE.Group();
    this.addBatches(site, siteBatch);
    siteExtras.forEach((o) => o && site.add(o));
    this.root.add(site);
    this.siteGroup = site;

    // ---- building, one group per storey
    const building = new THREE.Group();
    this.floorGroups = [];
    const extras = [];

    spec.floors.forEach((floor, i) => {
      const g = new THREE.Group();
      g.userData = { level: floor.level };
      const batch = new Batch();

      // plinth / structural slab
      const fp = floor.footprint;
      batch.box('slab', fp.w + 0.24, 0.3, fp.d + 0.24, wx(fp.x + fp.w / 2), floor.elevation - 0.15, wz(fp.z + fp.d / 2));
      if (i === 0) {
        batch.box('plinth', fp.w + 0.9, 0.32, fp.d + 0.9, wx(fp.x + fp.w / 2), floor.elevation - 0.16, wz(fp.z + fp.d / 2));
      }

      buildInterior({ batch, floor, spec, wx, wz });
      buildFacade({ batch, floor, spec, wx, wz });

      // horizontal floor band: a thin, slightly proud slab edge that gives
      // the elevation a base line and reads the storey separation
      if (i > 0) {
        const by = floor.elevation - 0.06;
        batch.box('wall', fp.w + 0.16, 0.18, 0.16, wx(fp.x + fp.w / 2), by, wz(fp.z + 0.01));
        batch.box('wall', fp.w + 0.16, 0.18, 0.16, wx(fp.x + fp.w / 2), by, wz(fp.z + fp.d - 0.01));
        batch.box('wall', 0.16, 0.18, fp.d + 0.16, wx(fp.x + 0.01), by, wz(fp.z + fp.d / 2));
        batch.box('wall', 0.16, 0.18, fp.d + 0.16, wx(fp.x + fp.w - 0.01), by, wz(fp.z + fp.d / 2));
      }
      if (i === 0) buildEntrance({ batch, spec, wx, wz, extras });

      this.addBatches(g, batch);
      this.floorGroups.push(g);
      building.add(g);
    });

    // ---- roof
    const roofBatch = new Batch();
    buildRoof({ batch: roofBatch, spec, wx, wz });
    const rg = new THREE.Group();
    this.addBatches(rg, roofBatch);
    const top = spec.floors[spec.floors.length - 1];
    rg.userData = { level: top.level, isolateLevel: top.level + 1 };
    building.add(rg);
    this.roofGroup = rg;

    extras.forEach((o) => building.add(o));

    this.labelsGroup = this.buildLabels(spec, wx, wz);
    building.add(this.labelsGroup);

    this.root.add(building);
    this.building = building;

    this.contextGroup = this.buildContext(spec, wx, wz);
    this.root.add(this.contextGroup);
    this.contextGroup.visible = this.options.context;

    // shallow fog is set per time preset
    this.applyTimeOfDay(this.options.time);
    this.applyOptions();
    this.frame();
  }

  addBatches(group, batch) {
    for (const [key, geom] of batch.merge()) {
      const glass = key === 'glass';
      const mat = this.mats.get(key);
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = !glass;
      mesh.receiveShadow = !glass;
      if (glass) mesh.renderOrder = 1;
      group.add(mesh);
    }
  }

  buildLabels(spec, wx, wz) {
    const group = new THREE.Group();
    for (const floor of spec.floors) {
      for (const room of floor.rooms) {
        const label = makeLabel(room.name);
        const y = floor.elevation + Math.min(room.height, floor.height) + 0.55;
        label.position.set(wx(room.x + room.w / 2), y, wz(room.z + room.d / 2));
        label.userData = { level: floor.level, name: room.name, baseY: y };
        group.add(label);
      }
    }
    return group;
  }

  buildContext(spec, wx, wz) {
    const group = new THREE.Group();
    const siteW = spec.site.width;
    const siteD = spec.site.depth;
    const mat = new THREE.MeshStandardMaterial({ color: '#d3cfc4', roughness: 0.96 });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#b9b6ae', roughness: 0.9 });
    const rng = mulberry32(20261121);
    const ring = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
    for (const [dx, dz] of ring) {
      const bw = 7 + rng() * 16;
      const bd = 7 + rng() * 16;
      const bh = 5 + rng() * 18;
      const px = wx(siteW / 2) + dx * (siteW / 2 + 20 + rng() * 10);
      const pz = wz(siteD / 2) + dz * (siteD / 2 + 20 + rng() * 10);
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
      m.position.set(px, bh / 2 - 0.3, pz);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      const r = new THREE.Mesh(new THREE.BoxGeometry(bw + 1.2, 0.3, bd + 1.2), roofMat);
      r.position.set(px, bh - 0.15, pz);
      r.castShadow = true;
      group.add(r);
    }
    return group;
  }

  // ---------------------------------------------------------------- options
  applyTimeOfDay(time) {
    this.options.time = time;
    const siteW = this.spec?.site?.width || 50;
    const presets = {
      day: { bg: '#dbe7f1', fog: 0.0013, sun: 0xfff3e0, intensity: 2.15, hemi: 0.52, sky: 0xd8e8f7, ground: 0xdad3c2, pos: [siteW * 1.15, siteW * 1.5, siteW * 0.75], exp: 0.96, env: 0.72 },
      dusk: { bg: '#efcdad', fog: 0.0022, sun: 0xffa968, intensity: 1.45, hemi: 0.36, sky: 0xf1c8a8, ground: 0xb8a58c, pos: [-siteW * 1.35, siteW * 0.55, siteW * 1.05], exp: 1.02, env: 0.24 },
      night: { bg: '#0d1319', fog: 0.0032, sun: 0x94aacd, intensity: 0.22, hemi: 0.16, sky: 0x18222e, ground: 0x141719, pos: [-siteW, siteW * 0.75, siteW * 0.4], exp: 1.12, env: 0.1 },
    };
    const p = presets[time] || presets.day;
    this.scene.background = new THREE.Color(p.bg);
    this.scene.fog = new THREE.FogExp2(p.bg, p.fog);
    this.sun.color.setHex(p.sun);
    this.sun.intensity = p.intensity;
    this.sun.position.set(...p.pos);
    this.sun.target.position.set(0, 0, 0);
    const shadowCam = this.sun.shadow.camera;
    const r = Math.max(siteW, this.spec?.site?.depth || 40) * 0.95;
    shadowCam.left = -r; shadowCam.right = r; shadowCam.top = r; shadowCam.bottom = -r;
    shadowCam.near = 1; shadowCam.far = r * 5;
    shadowCam.updateProjectionMatrix();
    this.hemi.color.setHex(p.sky);
    this.hemi.groundColor.setHex(p.ground);
    this.hemi.intensity = p.hemi;
    this.renderer.toneMappingExposure = p.exp;
    this.scene.environmentIntensity = p.env;

    const glass = this.mats?.get('glass');
    if (glass) {
      glass.emissive = glass.emissive || new THREE.Color(0);
      if (time === 'night') glass.emissive.copy(glass.userData.nightEmissive || new THREE.Color('#ffd9a0')).multiplyScalar(0.6);
      else glass.emissive.setHex(0x000000);
      glass.needsUpdate = true;
    }
  }

  applyOptions() {
    const { roof, labels, isolate, context } = this.options;
    const roofIsolate = this.roofGroup?.userData?.isolateLevel ?? 99;
    if (this.roofGroup) this.roofGroup.visible = roof && (!isolate || isolate >= roofIsolate);
    if (this.contextGroup) this.contextGroup.visible = context;
    this.floorGroups.forEach((g) => { g.visible = !isolate || g.userData.level === isolate; });
    if (this.labelsGroup) {
      this.labelsGroup.visible = labels;
      this.labelsGroup.children.forEach((s) => {
        s.visible = labels && (!isolate || s.userData.level === isolate);
      });
    }
  }

  setOption(key, value) {
    this.options[key] = value;
    if (key === 'time') this.applyTimeOfDay(value);
    this.applyOptions();
  }

  // ----------------------------------------------------------------- camera
  frame(view = 'iso') {
    if (!this.spec) return;
    const box = new THREE.Box3().setFromObject(this.building || this.root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(8, size.length() / 2);
    const target = new THREE.Vector3(center.x, center.y - size.y * 0.05, center.z);
    this.controls.target.copy(target);
    const fovHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const dist = radius / Math.sin(fovHalf) * 1.12;

    if (view === 'top') {
      this.camera.up.set(0, 0, -1);
      this.camera.position.set(target.x + 0.01, center.y + radius * 1.6, target.z + 0.01);
    } else if (view === 'front') {
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(target.x, target.y + size.y * 0.05, target.z + dist);
    } else {
      this.camera.up.set(0, 1, 0);
      const dir = new THREE.Vector3(0.62, 0.46, 0.64).normalize();
      this.camera.position.copy(target).addScaledVector(dir, dist);
    }
    this.camera.near = 0.4;
    this.camera.far = Math.max(200, radius * 30);
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = radius * 0.25;
    this.controls.maxDistance = radius * 12;
    this.controls.update();
  }

  /** Render one frame and return a JPEG data URL for library thumbnails. */
  captureThumbnail(width = 480) {
    if (!this.spec) return null;
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const ratio = (src.height || 950) / (src.width || 1600);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round(width * ratio);
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, c.width, c.height);
    try {
      return c.toDataURL('image/jpeg', 0.82);
    } catch {
      return null;
    }
  }

  exportGlb() {
    if (!this.building) return Promise.reject(new Error('尚无方案'));
    return new Promise((resolve, reject) => {
      new GLTFExporter().parse(
        this.building,
        (result) => {
          const blob = new Blob([result], { type: 'model/gltf-binary' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${(this.spec.meta?.title || 'scheme').replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}.glb`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          resolve(true);
        },
        reject,
        { binary: true, onlyVisible: false },
      );
    });
  }

  disposeBuilding() {
    this.root.children.slice().forEach((child) => {
      child.traverse?.((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.isSprite) {
          o.material?.map?.dispose();
          o.material?.dispose();
        }
        if (o.isLine) o.material?.dispose();
      });
      this.root.remove(child);
    });
    this.mats?.dispose();
    this.mats = null;
    this.building = null;
    this.floorGroups = [];
    this.roofGroup = null;
    this.labelsGroup = null;
    this.contextGroup = null;
    this.siteGroup = null;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this._onResize);
    this.observer?.disconnect();
    this.disposeBuilding();
    this.controls.dispose();
    this.envRT?.dispose();
    this.renderer.dispose();
  }
}

// --------------------------------------------------------------- label sprite
function makeLabel(text) {
  const dpr = 2;
  const measure = document.createElement('canvas').getContext('2d');
  const font = `500 ${24 * dpr}px "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`;
  measure.font = font;
  const w = Math.ceil(measure.measureText(text).width) + 26 * dpr;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = 40 * dpr;
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.fillStyle = 'rgba(20,24,29,0.86)';
  roundRect(ctx, 0, 0, canvas.width, canvas.height, 7 * dpr);
  ctx.fill();
  ctx.fillStyle = '#f2eee3';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 13 * dpr, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  sprite.scale.set(canvas.width * 0.011, canvas.height * 0.011, 1);
  sprite.renderOrder = 3;
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
