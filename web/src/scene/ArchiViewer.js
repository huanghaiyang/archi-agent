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

// Material bucket → node label, so the tree reads like a construction model
const MAT_LABEL = {
  slab: '楼板',
  plinth: '基座 / 台阶',
  wall: '墙体',
  glass: '玻璃门窗',
  frame: '门窗框 / 构件',
  void: '洞口 / 雨棚底板',
  roof: '屋面',
  coping: '压顶 / 檐口',
  partition: '隔墙',
  stair: '楼梯',
  core: '核心筒',
  furnwood: '木家具',
  furnmetal: '金属家具',
  furnfabric: '软装',
  lamp: '灯具 / 发光构件',
  'room:circulation': '地面铺装',
  'room:public': '地面铺装',
  'room:office': '地面铺装',
  'room:study': '地面铺装',
  'room:exhibition': '地面铺装',
  'room:service': '地面铺装',
  'room:wet': '地面铺装',
  'room:technical': '地面铺装',
  terr: '平台',
  planter: '种植池',
  trunk: '树干',
  plant: '绿篱',
  grass: '草地',
  asphalt: '道路',
  paving: '铺装',
  carbody: '车辆',
};

// Exterior shell buckets removed by the "peel facade" mode
const SHELL_KEYS = new Set(['wall', 'glass', 'frame', 'coping', 'roof', 'void']);

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
    this.renderer.localClippingEnabled = true;

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

    // secondary fill light so the shadow side keeps some colour
    this.fill = new THREE.DirectionalLight(0xbcd4ec, 0.35);
    this.fill.castShadow = false;
    this.scene.add(this.fill);
    this.scene.add(this.fill.target);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._down = null;
    this._onPointerDown = (e) => { this._down = { x: e.clientX, y: e.clientY }; };
    this._onPointerUp = (e) => {
      const down = this._down;
      this._down = null;
      if (!down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return; // drag, not a click
      this.pickAt(e);
    };
    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointerup', this._onPointerUp);

    // Drag the visible cut plane to move the section; orbiting still works
    // everywhere else (and stops while a cut drag is in progress).
    this._sectionDrag = null;
    this._lastSectionNotify = 0;
    this._onSectionDown = (e) => {
      if (e.button !== 0) return;
      if (this.section.drawMode) {
        this.sectionDrawClick(e);
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      if (!this.section.enabled) return;
      if (!this.sectionHit(e)) return;
      this._sectionDrag = { pointerId: e.pointerId };
      this.controls.enabled = false;
      canvas.style.cursor = 'grabbing';
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    this._onSectionMove = (e) => {
      if (!this._sectionDrag) {
        if (this.section.drawMode) {
          canvas.style.cursor = 'crosshair';
          return;
        }
        if (!this.section.enabled) {
          if (canvas.style.cursor === 'grab') canvas.style.cursor = '';
          return;
        }
        canvas.style.cursor = this.sectionHit(e) ? 'grab' : '';
        return;
      }
      if (e.pointerId !== this._sectionDrag.pointerId) return;
      this.dragSectionTo(e);
      const now = Date.now();
      if (now - this._lastSectionNotify > 30) {
        this._lastSectionNotify = now;
        this.notify();
      }
      e.preventDefault();
    };
    this._onSectionUp = (e) => {
      if (!this._sectionDrag) return;
      if (e.pointerId != null && e.pointerId !== this._sectionDrag.pointerId) return;
      this._sectionDrag = null;
      this.controls.enabled = true;
      canvas.style.cursor = this.section.drawMode ? 'crosshair' : '';
      this.notify();
    };
    canvas.addEventListener('pointerdown', this._onSectionDown, true);
    window.addEventListener('pointermove', this._onSectionMove);
    window.addEventListener('pointerup', this._onSectionUp);
    window.addEventListener('pointercancel', this._onSectionUp);

    this.options = { roof: true, labels: false, isolate: 0, explode: false, explodeSpread: 3.8, explodeLift: 1.8, explodeAngle: 45, time: 'day', context: true, wireframe: false, peel: false, glow: false };
    this.section = { enabled: false, axis: 'z', offset: 50, flip: false, cap: true, angle: 0, drawMode: false };
    this.sectionRange = { x: [0, 1], y: [0, 1], z: [0, 1] };
    this.sectionPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    this.sectionHelper = null;
    this.sectionDraw = null;
    this.sectionDrawLine = null;
    this.shellMeshes = [];
    this.changeListeners = new Set();
    this.connectivity = { active: false, t: 0, progress: 0, duration: 0, hasPath: false, points: 0 };
    this.connectivityGroup = null;
    this.connectivityBall = null;
    this.connectivityCurve = null;
    this.onConnectivity = null;
    this._lastConnNotify = 0;
    this.spec = null;
    this.mats = null;
    this.floorGroups = [];
    this.roofGroup = null;
    this.labelsGroup = null;
    this.glowGroup = null;
    this.contextGroup = null;
    this.siteGroup = null;
    this.explode = 0;

    // ---- semantic scene graph / editing state
    this.tree = { id: 'root', label: '场景', type: 'group', children: [] };
    this.nodeMap = new Map();
    this.nodeSeq = 0;
    this.hidden = new Set();
    this.history = [];
    this.hIndex = -1;
    this.selected = null;
    this.selectionHelper = null;
    this.interiorLights = [];
    this.onChange = null;
    this.onPick = null;
    this.light = {
      azimuth: 145, altitude: 46, sunIntensity: null, hemiIntensity: null,
      exposure: null, env: null, fill: 0.35, shadows: 'soft', interior: false,
    };
    this.timePreset = {
      day: { az: 145, alt: 46, sun: 0xfff3e0, intensity: 2.15, hemi: 0.52, sky: 0xd8e8f7, ground: 0xdad3c2, exp: 0.96, env: 0.72, fill: 0.4, bg: '#dbe7f1', fog: 0.0013 },
      dusk: { az: 238, alt: 11, sun: 0xffa968, intensity: 1.42, hemi: 0.36, sky: 0xf1c8a8, ground: 0xb8a58c, exp: 1.02, env: 0.24, fill: 0.22, bg: '#efcdad', fog: 0.0022 },
      night: { az: 302, alt: 34, sun: 0x94aacd, intensity: 0.2, hemi: 0.16, sky: 0x18222e, ground: 0x141719, exp: 1.12, env: 0.1, fill: 0.1, bg: '#0d1319', fog: 0.0032 },
    };

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
    const k = this.explode;
    // staggered exploded view, adjustable from the inspector: each storey
    // slides horizontally at `explodeAngle` and lifts `explodeLift` per floor.
    const spread = (this.options.explodeSpread ?? 3.8) * k;
    const lift = (this.options.explodeLift ?? 1.8) * k;
    const ang = THREE.MathUtils.degToRad(this.options.explodeAngle ?? 45);
    const dx = Math.cos(ang);
    const dz = -Math.sin(ang);
    this.floorGroups.forEach((g) => {
      const lv = g.userData.level || 0;
      g.position.set(lv * spread * dx, lv * lift, lv * spread * dz);
    });
    if (this.roofGroup) {
      const lv = this.roofGroup.userData.level || 0;
      this.roofGroup.position.set(lv * spread * dx, lv * lift + 0.35 * k, lv * spread * dz);
    }
    if (this.labelsGroup) {
      this.labelsGroup.children.forEach((s) => {
        const lv = s.userData.level || 0;
        s.position.set(
          (s.userData.baseX || 0) + lv * spread * dx,
          (s.userData.baseY || 0) + lv * lift,
          (s.userData.baseZ || 0) + lv * spread * dz,
        );
      });
    }
    this.selectionHelper?.update();
    this.animateConnectivity(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------------ build
  setSpec(spec) {
    if (!spec || !spec.floors?.length) return;
    this.spec = spec;
    this.disposeBuilding();
    this.disposeConnectivity();
    this.shellMeshes = [];
    this.lampPositions = [];
    this.mats = new MaterialLibrary(spec);

    // fresh semantic tree per scheme
    this.tree = { id: 'root', label: '场景', type: 'group', children: [] };
    this.nodeMap.clear();
    this.nodeSeq = 0;
    this.hidden.clear();
    this.history = [];
    this.hIndex = -1;
    this.selected = null;
    this.selectionHelper = null;

    const siteW = spec.site.width;
    const siteD = spec.site.depth;
    const wx = (x) => x - siteW / 2;
    const wz = (z) => z - siteD / 2;

    // ---- site + landscape (never explodes)
    const siteBatch = new Batch();
    const siteExtras = [];
    buildSite({ batch: siteBatch, spec, wx, wz, extras: siteExtras });
    const site = new THREE.Group();
    const siteNode = this.registerNode(this.tree, site, '场地与景观', { id: 'site', type: 'group' });
    this.addBatches(site, siteBatch, siteNode);
    siteExtras.forEach((o, i) => {
      if (!o) return;
      site.add(o);
      this.registerNode(siteNode, o, `场地小品 ${i + 1}`, { id: `site-extra-${i}`, type: 'group' });
    });
    this.root.add(site);
    this.siteGroup = site;

    // ---- building, one group per storey
    const building = new THREE.Group();
    const buildingNode = this.registerNode(this.tree, building, '建筑主体', { id: 'building', type: 'group' });
    this.floorGroups = [];
    const extras = [];

    spec.floors.forEach((floor, i) => {
      const g = new THREE.Group();
      g.userData = { level: floor.level };
      const batch = new Batch();

      // plinth / structural slab (upper floors get a stair shaft opening)
      const fp = floor.footprint;
      this.buildFloorSlab(batch, floor, fp, wx, wz, i === 0);
      if (i === 0) {
        batch.box('plinth', fp.w + 0.9, 0.32, fp.d + 0.9, wx(fp.x + fp.w / 2), floor.elevation - 0.16, wz(fp.z + fp.d / 2));
      }

      buildInterior({ batch, floor, spec, wx, wz, lamps: this.lampPositions });
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

      const label = floor.level === 1 ? '首层' : `L${floor.level} 标准层`;
      const floorNode = this.registerNode(buildingNode, g, label, { id: `floor-${floor.level}`, level: floor.level, type: 'group' });
      this.addBatches(g, batch, floorNode);
      this.floorGroups.push(g);
      building.add(g);
    });

    // ---- roof
    const roofBatch = new Batch();
    buildRoof({ batch: roofBatch, spec, wx, wz });
    const rg = new THREE.Group();
    const top = spec.floors[spec.floors.length - 1];
    rg.userData = { level: top.level, isolateLevel: top.level + 1 };
    const roofNode = this.registerNode(buildingNode, rg, '屋面与女儿墙', { id: 'roof', type: 'group' });
    this.addBatches(rg, roofBatch, roofNode);
    building.add(rg);
    this.roofGroup = rg;

    extras.forEach((o, i) => {
      if (!o) return;
      building.add(o);
      const name = o.userData?.label || (o.type === 'Group' ? '入口构件' : '入口雨棚');
      this.registerNode(buildingNode, o, `${name}${i > 0 ? ` ${i + 1}` : ''}`, { id: `entrance-${i}`, type: 'group' });
    });

    this.labelsGroup = this.buildLabels(spec, wx, wz);
    const labelsNode = this.registerNode(buildingNode, this.labelsGroup, '房间名标注', { id: 'labels', type: 'group' });
    this.labelsGroup.children.forEach((s, i) => {
      this.registerNode(labelsNode, s, `房间名 · ${s.userData.name}`, { id: `label-${i}`, type: 'sprite' });
    });
    building.add(this.labelsGroup);
    this.buildLampGlow(building);

    this.root.add(building);
    this.building = building;

    this.contextGroup = this.buildContext(spec, wx, wz);
    const contextNode = this.registerNode(this.tree, this.contextGroup, '周边建筑', { id: 'context', type: 'group' });
    this.contextGroup.children.forEach((m, i) => {
      this.registerNode(contextNode, m, `周边体量 ${i + 1}`, { id: `context-${i}`, type: 'mesh' });
    });
    this.root.add(this.contextGroup);
    this.contextGroup.visible = this.options.context;

    // ---- interior lighting for the night preset
    this.disposeInteriorLights();
    this.interiorLights = spec.floors.map((f) => {
      const l = new THREE.PointLight(0xffc98a, 0, Math.max(24, f.footprint.w * 1.2), 2);
      l.position.set(wx(f.footprint.x + f.footprint.w / 2), f.elevation + f.height * 0.65, wz(f.footprint.z + f.footprint.d / 2));
      this.scene.add(l);
      return l;
    });

    // shallow fog is set per time preset
    this.applyTimeOfDay(this.options.time);
    this.selected = null;
    this.updateSectionRange();
    this.buildConnectivity();
    this.applyOptions();
    this.frame();
    this.notify();
  }

  /**
   * Structural slab for one storey. Above ground the slab is split into four
   * strips around the stair run so the stair can actually reach the next floor
   * instead of ending under a solid plate.
   */
  buildFloorSlab(batch, floor, fp, wx, wz, ground) {
    const th = 0.3;
    const y = floor.elevation - 0.15;
    const x0 = fp.x - 0.12;
    const x1 = fp.x + fp.w + 0.12;
    const z0 = fp.z - 0.12;
    const z1 = fp.z + fp.d + 0.12;
    const emit = (xa, xb, za, zb) => {
      const w = xb - xa;
      const d = zb - za;
      if (w <= 0.05 || d <= 0.05) return;
      batch.box('slab', w, th, d, wx((xa + xb) / 2), y, wz((za + zb) / 2));
    };

    const core = floor.core;
    if (ground || !core) {
      emit(x0, x1, z0, z1);
      return;
    }

    // same stair geometry as interior.js: 14 risers, run clamped to 0.3 m
    const steps = 14;
    const run = Math.min(0.3, (core.d * 0.62) / steps);
    const stairW = Math.min(1.5, core.w * 0.48);
    let hx0 = Math.max(x0, core.x + 0.2 - 0.12);
    let hx1 = Math.min(x1, core.x + 0.2 + stairW + 0.12);
    let hz0 = Math.max(z0, core.z + 0.2 - 0.12);
    let hz1 = Math.min(z1, core.z + 0.2 + steps * run + 0.28);

    if (hx1 - hx0 < 0.5 || hz1 - hz0 < 0.6) {
      emit(x0, x1, z0, z1);
      return;
    }

    emit(x0, hx0, z0, z1);
    emit(hx1, x1, z0, z1);
    emit(hx0, hx1, z0, hz0);
    emit(hx0, hx1, hz1, z1);

    // thin edge trim around the shaft so the cut reads as a deliberate opening
    batch.box('frame', hx1 - hx0 + 0.08, 0.05, 0.06, wx((hx0 + hx1) / 2), y + 0.16, wz(hz0));
    batch.box('frame', hx1 - hx0 + 0.08, 0.05, 0.06, wx((hx0 + hx1) / 2), y + 0.16, wz(hz1));
    batch.box('frame', 0.06, 0.05, hz1 - hz0, wx(hx0), y + 0.16, wz((hz0 + hz1) / 2));
    batch.box('frame', 0.06, 0.05, hz1 - hz0, wx(hx1), y + 0.16, wz((hz0 + hz1) / 2));
  }

  registerNode(parent, object, label, meta = {}) {
    const id = meta.id || `n${(this.nodeSeq += 1)}`;
    const node = {
      id,
      label,
      type: meta.type || (object.isMesh ? 'mesh' : 'group'),
      object,
      parent,
      children: [],
      level: meta.level,
    };
    object.userData.nodeId = id;
    this.nodeMap.set(id, node);
    parent.children.push(node);
    return node;
  }

  addBatches(group, batch, parentNode) {
    for (const [key, geom] of batch.merge()) {
      const glass = key === 'glass';
      const mat = this.mats.get(key);
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = !glass;
      mesh.receiveShadow = !glass;
      mesh.userData.key = key;
      if (glass) mesh.renderOrder = 1;
      if (SHELL_KEYS.has(key)) this.shellMeshes.push(mesh);
      group.add(mesh);
      if (parentNode) {
        this.registerNode(parentNode, mesh, MAT_LABEL[key] || key, { type: 'mesh', key });
      }
    }
  }

  buildLabels(spec, wx, wz) {
    const group = new THREE.Group();
    for (const floor of spec.floors) {
      for (const room of floor.rooms) {
        const label = makeLabel(room.name);
        const y = floor.elevation + Math.min(room.height, floor.height) + 0.55;
        label.position.set(wx(room.x + room.w / 2), y, wz(room.z + room.d / 2));
        label.userData = { level: floor.level, name: room.name, baseX: wx(room.x + room.w / 2), baseY: y, baseZ: wz(room.z + room.d / 2) };
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
    const p = this.timePreset[time] || this.timePreset.day;
    this.light.azimuth = p.az;
    this.light.altitude = p.alt;
    this.light.sunIntensity = p.intensity;
    this.light.hemiIntensity = p.hemi;
    this.light.exposure = p.exp;
    this.light.env = p.env;
    this.light.fill = p.fill;
    if (time === 'night' && !this.light.interior) this.light.interior = true;
    if (time !== 'night') this.light.interior = false;
    this.applyLighting();
  }

  applyLighting() {
    const p = this.timePreset[this.options.time] || this.timePreset.day;
    const L = this.light;
    const siteW = this.spec?.site?.width || 50;
    const siteD = this.spec?.site?.depth || 40;
    const R = Math.max(siteW, siteD) * 1.8;

    // sun direction from azimuth / altitude sliders
    const alt = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(L.altitude ?? p.alt, 3, 88));
    const az = THREE.MathUtils.degToRad(L.azimuth ?? p.az);
    this.sun.position.set(
      Math.sin(az) * Math.cos(alt) * R,
      Math.sin(alt) * R,
      Math.cos(az) * Math.cos(alt) * R,
    );
    this.sun.target.position.set(0, 0, 0);
    this.sun.color.setHex(p.sun);
    this.sun.intensity = Number.isFinite(L.sunIntensity) ? L.sunIntensity : p.intensity;
    this.sun.castShadow = L.shadows !== 'off';

    // soft vs high shadow resolution
    const size = L.shadows === 'high' ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.sun.shadow.bias = L.shadows === 'high' ? -0.0002 : -0.00035;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;

    const shadowCam = this.sun.shadow.camera;
    const r = Math.max(siteW, siteD) * 0.95;
    shadowCam.left = -r; shadowCam.right = r; shadowCam.top = r; shadowCam.bottom = -r;
    shadowCam.near = 1; shadowCam.far = r * 6;
    shadowCam.updateProjectionMatrix();

    // sky / ground bounce
    this.hemi.color.setHex(p.sky);
    this.hemi.groundColor.setHex(p.ground);
    this.hemi.intensity = Number.isFinite(L.hemiIntensity) ? L.hemiIntensity : p.hemi;

    // fill from the shadow side keeps the model readable but flat-free
    this.fill.position.set(-this.sun.position.x * 0.8, R * 0.9, -this.sun.position.z * 0.8);
    this.fill.target.position.set(0, 0, 0);
    this.fill.intensity = L.fill ?? p.fill;

    this.scene.background = new THREE.Color(p.bg);
    this.scene.fog = new THREE.FogExp2(p.bg, p.fog);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = Number.isFinite(L.exposure) ? L.exposure : p.exp;
    this.scene.environmentIntensity = Number.isFinite(L.env) ? L.env : p.env;

    // interior point lights only at night
    const warm = this.options.time === 'night' && L.interior;
    this.interiorLights.forEach((l) => { l.intensity = warm ? 3.2 : 0; });

    const glass = this.mats?.get('glass');
    if (glass) {
      if (this.options.time === 'night') {
        glass.emissive.copy(glass.userData.nightEmissive || new THREE.Color('#ffd9a0')).multiplyScalar(0.65);
      } else {
        glass.emissive.setHex(0x000000);
      }
      glass.needsUpdate = true;
    }
    this.notifyLighting();
  }

  setLighting(patch = {}) {
    if (patch.time) {
      this.applyTimeOfDay(patch.time);
    } else {
      Object.assign(this.light, patch);
      this.applyLighting();
    }
    this.notify();
    return this.getLighting();
  }

  getLighting() {
    return { ...this.light, time: this.options.time };
  }

  notifyLighting() {
    if (typeof this.onLighting === 'function') this.onLighting(this.getLighting());
  }

  applyOptions() {
    const { roof, labels, isolate, context, peel } = this.options;
    const roofIsolate = this.roofGroup?.userData?.isolateLevel ?? 99;
    if (this.roofGroup) this.roofGroup.visible = roof && !peel && (!isolate || isolate >= roofIsolate);
    if (this.contextGroup) this.contextGroup.visible = context;
    this.floorGroups.forEach((g) => { g.visible = !isolate || g.userData.level === isolate; });
    if (this.labelsGroup) {
      const show = labels && !this.section.enabled;
      this.labelsGroup.visible = show;
      this.labelsGroup.children.forEach((s) => {
        s.visible = show && (!isolate || s.userData.level === isolate);
      });
    }
    this.applyWireframe();
    this.applyShellPeel();
    this.applyGlow();
    this.applySection();
    this.applyHidden();
  }

  applyShellPeel() {
    const peel = Boolean(this.options.peel);
    for (const mesh of this.shellMeshes) {
      if (peel) mesh.visible = false;
      else if (!this.hidden.has(mesh.userData.nodeId)) mesh.visible = true;
    }
  }

  applyGlow() {
    const lamp = this.mats?.cache.get('lamp');
    if (lamp) {
      lamp.emissiveIntensity = this.options.glow ? 3.6 : 0.55;
      lamp.needsUpdate = true;
    }
    if (this.glowGroup) this.glowGroup.visible = Boolean(this.options.glow);
  }

  /** Additive halo sprites at every lamp so the glow option reads clearly. */
  buildLampGlow(parent) {
    const positions = this.lampPositions || [];
    if (!positions.length) return;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,236,205,0.95)');
    grad.addColorStop(0.32, 'rgba(255,201,138,0.5)');
    grad.addColorStop(1, 'rgba(255,180,94,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex, color: 0xffd9a8, transparent: true, opacity: 0.52,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const group = new THREE.Group();
    for (const p of positions) {
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(p.x, p.y - 0.16, p.z);
      sprite.scale.set(2.1, 2.1, 1);
      group.add(sprite);
    }
    group.visible = Boolean(this.options.glow);
    group.renderOrder = 8;
    parent.add(group);
    this.glowGroup = group;
  }

  applyWireframe() {
    const on = Boolean(this.options.wireframe);
    if (!this.mats) return;
    for (const mat of this.mats.cache.values()) {
      if ('wireframe' in mat && mat.wireframe !== on) {
        mat.wireframe = on;
        mat.needsUpdate = true;
      }
    }
  }

  // ---------------------------------------------------------------- section
  updateSectionRange() {
    const box = new THREE.Box3();
    if (this.building) box.setFromObject(this.building);
    if (box.isEmpty()) {
      const w = this.spec?.site?.width || 30;
      const d = this.spec?.site?.depth || 30;
      box.set(new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, 14, d / 2));
    }
    this.sectionRange = {
      x: [box.min.x, box.max.x],
      y: [box.min.y, box.max.y],
      z: [box.min.z, box.max.z],
    };
    this.sectionCenter = box.getCenter(new THREE.Vector3());
    this.sectionSize = box.getSize(new THREE.Vector3());
  }

  sectionAngleRad() {
    if (this.section.axis === 'x') return Math.PI / 2;
    if (this.section.axis === 'z') return 0;
    return THREE.MathUtils.degToRad(this.section.angle || 0);
  }

  /** Canonical outward normal, before the keep-side flip. */
  sectionBaseNormal() {
    const S = this.section;
    if (S.axis === 'y') return new THREE.Vector3(0, -1, 0); // keep lower floors by default
    if (S.axis === 'x') return new THREE.Vector3(1, 0, 0);
    if (S.axis === 'z') return new THREE.Vector3(0, 0, 1);
    const a = this.sectionAngleRad();
    return new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
  }

  /** Outward normal of the cutting plane in world space. */
  sectionNormal() {
    const n = this.sectionBaseNormal();
    if (this.section.flip) n.negate();
    return n;
  }

  /** Project the building bounding box on the plane normal. */
  projectionRange(normal = this.sectionNormal()) {
    const size = this.sectionSize || new THREE.Vector3(30, 14, 30);
    const center = this.sectionCenter || new THREE.Vector3();
    let min = Infinity;
    let max = -Infinity;
    for (const sx of [-0.5, 0.5]) {
      for (const sy of [-0.5, 0.5]) {
        for (const sz of [-0.5, 0.5]) {
          const p = new THREE.Vector3(
            center.x + size.x * sx,
            center.y + size.y * sy,
            center.z + size.z * sz,
          );
          const d = normal.dot(p);
          if (d < min) min = d;
          if (d > max) max = d;
        }
      }
    }
    return [min, max];
  }

  /** Signed distance of the cut from the origin along its canonical normal. */
  sectionPosition(normal = this.sectionBaseNormal()) {
    const [min, max] = this.projectionRange(normal);
    const t = THREE.MathUtils.clamp(this.section.offset, 0, 100) / 100;
    return min + (max - min) * t;
  }

  /** A point on the plane, projected toward the building centre. */
  sectionPlanePoint(pos = this.sectionPosition(), normal = this.sectionBaseNormal()) {
    const center = this.sectionCenter || new THREE.Vector3();
    return center.clone().sub(normal.clone().multiplyScalar(normal.dot(center))).add(normal.clone().multiplyScalar(pos));
  }

  sectionHit(event) {
    if (!this.sectionHelper) return false;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObject(this.sectionHelper, true).length > 0;
  }

  /** Move the cut plane so it passes through the mouse ray. */
  dragSectionTo(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const normal = this.sectionBaseNormal();
    const point = this.sectionPlanePoint();
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, point);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(dragPlane, hit)) return;

    const [min, max] = this.projectionRange(normal);
    const pos = normal.dot(hit);
    this.section.offset = THREE.MathUtils.clamp(((pos - min) / (max - min)) * 100, 0, 100);
    this.updateSectionPlane();
  }

  /** Cheap update used while dragging: no geometry rebuild. */
  updateSectionPlane() {
    if (!this.section.enabled) return;
    const base = this.sectionBaseNormal();
    const pos = this.sectionPosition(base);
    const n = this.sectionNormal();
    if (this.sectionHelper) {
      const p = this.sectionPlanePoint(pos, base);
      this.sectionHelper.position.copy(p);
    }
    // same physical plane; flip only changes which half is kept
    this.sectionPlane.set(n, -n.dot(this.sectionPlanePoint(pos, base)));
  }

  applySection() {
    const S = this.section;
    const mats = this.mats ? [...this.mats.cache.values()] : [];

    if (!S.enabled || !this.spec) {
      for (const mat of mats) {
        if (mat.clippingPlanes?.length) {
          mat.clippingPlanes = null;
          mat.needsUpdate = true;
        }
      }
      if (this.sectionHelper) this.sectionHelper.visible = false;
      return;
    }

    const base = this.sectionBaseNormal();
    const pos = this.sectionPosition(base);
    const n = this.sectionNormal();
    this.sectionPlane.set(n, -n.dot(this.sectionPlanePoint(pos, base)));

    for (const mat of mats) {
      if (!('clippingPlanes' in mat)) continue;
      mat.clippingPlanes = [this.sectionPlane];
      mat.clipShadows = true;
      mat.needsUpdate = true;
    }

    this.buildSectionHelper(pos);
  }

  buildSectionHelper(pos) {
    const size = this.sectionSize || new THREE.Vector3(30, 14, 30);
    const center = this.sectionCenter || new THREE.Vector3();
    const S = this.section;
    const axis = S.axis;

    let w;
    let h;
    if (axis === 'y') { w = size.x + 1.2; h = size.z + 1.2; }
    else {
      const a = this.sectionAngleRad();
      w = Math.abs(size.x * Math.sin(a)) + Math.abs(size.z * Math.cos(a)) + 1.2;
      h = size.y + 1.2;
    }

    if (this.sectionHelper) {
      this.scene.remove(this.sectionHelper);
      this.sectionHelper.traverse?.((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }

    const g = new THREE.Group();
    const base = this.sectionBaseNormal();
    const p = this.sectionPlanePoint(pos, base);
    if (axis === 'y') {
      g.rotation.x = -Math.PI / 2;
      g.position.copy(p);
    } else {
      const a = this.sectionAngleRad();
      g.rotation.y = a;
      g.position.copy(p);
    }

    const plane = new THREE.PlaneGeometry(w, h);
    const fill = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
      color: 0xd5a35c,
      transparent: true,
      opacity: S.cap ? 0.02 : 0.008,
      side: THREE.DoubleSide,
      depthWrite: false,
    }));
    fill.renderOrder = 4;
    g.add(fill);

    // light drafting grid so the cut surface reads as a plane instead of a slab
    const gridPts = [];
    const step = 2.4;
    for (let x = -w / 2 + step; x < w / 2; x += step) gridPts.push(x, -h / 2, 0.02, x, h / 2, 0.02);
    for (let y = -h / 2 + step; y < h / 2; y += step) gridPts.push(-w / 2, y, 0.02, w / 2, y, 0.02);
    if (gridPts.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
      const grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: 0xe1b877, transparent: true, opacity: 0.11, depthWrite: false,
      }));
      grid.renderOrder = 5;
      g.add(grid);
    }

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(plane),
      new THREE.LineBasicMaterial({ color: 0xe1b877, transparent: true, opacity: 0.5, depthTest: false }),
    );
    edge.renderOrder = 6;
    g.add(edge);

    this.sectionHelper = g;
    g.visible = true;
    this.scene.add(g);
  }

  beginSectionDraw() {
    this.section.drawMode = true;
    this.sectionDraw = null;
    this.clearSectionDrawLine();
    this.notify();
    return this.getSection();
  }

  cancelSectionDraw() {
    this.section.drawMode = false;
    this.sectionDraw = null;
    this.clearSectionDrawLine();
    this.notify();
  }

  clearSectionDrawLine() {
    if (!this.sectionDrawLine) return;
    this.scene.remove(this.sectionDrawLine);
    this.sectionDrawLine.geometry?.dispose();
    this.sectionDrawLine.material?.dispose();
    this.sectionDrawLine = null;
  }

  /** Raycast a click onto the building first, then onto the ground. */
  planPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.building) {
      const hits = this.raycaster.intersectObject(this.building, true);
      const hit = hits.find((h) => h.object.visible && h.object.isMesh);
      if (hit) return hit.point.clone();
    }
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.05);
    const onGround = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(ground, onGround) ? onGround : null;
  }

  sectionDrawClick(event) {
    const hit = this.planPoint(event);
    if (!hit) return;
    if (!this.sectionDraw) {
      this.sectionDraw = [hit];
      this.clearSectionDrawLine();
      const geo = new THREE.BufferGeometry().setFromPoints([hit, hit]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0x6fd3ff, transparent: true, opacity: 0.95, depthTest: false,
      }));
      line.renderOrder = 9;
      this.sectionDrawLine = line;
      this.scene.add(line);
      return;
    }

    const p1 = this.sectionDraw[0];
    const p2 = hit;
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    if (Math.hypot(dx, dz) < 0.6) return; // too short, keep waiting

    // Section plane runs vertically through the drawn line; its normal is
    // perpendicular to the line in plan. Orient it away from the camera so the
    // near half is removed and the building behind the line stays visible.
    const n = new THREE.Vector3(dz, 0, -dx).normalize();
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    if (n.x * camDir.x + n.z * camDir.z < 0) n.negate();
    const angle = ((Math.atan2(n.x, n.z) * 180 / Math.PI) + 360) % 360;
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    const [min, max] = this.projectionRange(n);
    this.section.axis = 'angle';
    this.section.angle = +angle.toFixed(1);
    this.section.flip = false;
    this.section.offset = THREE.MathUtils.clamp(((n.dot(mid) - min) / (max - min)) * 100, 0, 100);
    this.section.drawMode = false;
    this.section.enabled = true;
    this.sectionDraw = null;
    this.clearSectionDrawLine();
    this.applyOptions();
    this.notify();
  }

  setSection(patch = {}) {
    Object.assign(this.section, patch);
    if (patch.axis) {
      this.section.drawMode = false;
      this.sectionDraw = null;
      this.clearSectionDrawLine();
    }
    this.applyOptions();
    this.notify();
    return this.getSection();
  }

  getSection() {
    const base = this.sectionBaseNormal();
    const pos = this.sectionPosition(base);
    const p = this.sectionPlanePoint(pos, base);
    const shown = this.section.axis === 'y' ? p.y : pos;
    return { ...this.section, position: +shown.toFixed(2) };
  }

  // ----------------------------------------------------------- connectivity
  /** Build the entrance → stair → top-floor route and its visual props. */
  buildConnectivity() {
    this.disposeConnectivity();
    const spec = this.spec;
    if (!spec?.floors?.length) return false;
    const siteW = spec.site.width;
    const siteD = spec.site.depth;
    const wx = (x) => x - siteW / 2;
    const wz = (z) => z - siteD / 2;

    const f0 = spec.floors[0];
    const fp = f0.footprint;
    const points = [];
    const entryX = wx(fp.x + fp.w / 2);
    const entryZ = wz(fp.z + fp.d);
    points.push(new THREE.Vector3(entryX, 0.3, entryZ + 2.2));
    points.push(new THREE.Vector3(entryX, 0.3, entryZ - 1.4));

    for (const floor of spec.floors) {
      const core = floor.core;
      if (!core) continue;
      const run = Math.min(0.3, (core.d * 0.62) / 14);
      const rise = floor.height / 14;
      const stairW = Math.min(1.5, core.w * 0.48);
      const x = wx(core.x + 0.2 + stairW / 2);
      const z0 = wz(core.z + 0.2);
      // corridor → stair foot
      points.push(new THREE.Vector3(x, floor.elevation + 0.32, z0 - 1.2));
      for (let i = 0; i < 14; i += 1) {
        points.push(new THREE.Vector3(x, floor.elevation + rise * (i + 1) + 0.32, z0 + run * (i + 1)));
      }
      // top landing
      points.push(new THREE.Vector3(x, floor.elevation + floor.height + 0.32, z0 + core.d * 0.62));
    }

    const top = spec.floors[spec.floors.length - 1];
    const tfp = top.footprint;
    points.push(new THREE.Vector3(wx(tfp.x + tfp.w / 2), top.elevation + top.height + 0.32, wz(tfp.z + tfp.d / 2)));

    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.18);
    const length = curve.getLength();
    const group = new THREE.Group();
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.max(64, Math.round(length * 4)), 0.09, 6, false),
      new THREE.MeshBasicMaterial({ color: 0xffb45e, transparent: true, opacity: 0.82, depthTest: false, depthWrite: false }),
    );
    tube.renderOrder = 7;
    group.add(tube);

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 20, 14),
      new THREE.MeshStandardMaterial({
        color: '#ffd9a1', emissive: new THREE.Color('#ff9c3d'), emissiveIntensity: 2.1,
        roughness: 0.35, metalness: 0.15, depthTest: false,
      }),
    );
    ball.renderOrder = 9;
    group.add(ball);

    group.visible = false;
    this.scene.add(group);
    this.connectivityGroup = group;
    this.connectivityBall = ball;
    this.connectivityCurve = curve;
    this.connectivity.duration = Math.max(5, length / 3.6);
    this.connectivity.points = points.length;
    this.connectivity.hasPath = true;
    this.connectivity.t = 0;
    ball.position.copy(curve.getPointAt(0));
    return true;
  }

  runConnectivity() {
    if (!this.connectivityCurve && !this.buildConnectivity()) return null;
    this.connectivityGroup.visible = true;
    this.connectivityBall.visible = true;
    this.connectivity.t = 0;
    this.connectivity.active = true;
    this.connectivityBall.position.copy(this.connectivityCurve.getPointAt(0));
    this.notifyConnectivity();
    this.notify();
    return { ...this.connectivity };
  }

  resetConnectivity() {
    if (!this.connectivityCurve) this.buildConnectivity();
    this.connectivity.active = false;
    this.connectivity.t = 0;
    this.connectivity.progress = 0;
    if (this.connectivityGroup) this.connectivityGroup.visible = false;
    if (this.connectivityBall && this.connectivityCurve) {
      this.connectivityBall.position.copy(this.connectivityCurve.getPointAt(0));
    }
    this.notifyConnectivity();
    this.notify();
    return { ...this.connectivity };
  }

  animateConnectivity(dt) {
    if (!this.connectivity.active || !this.connectivityCurve) return;
    this.connectivity.t = Math.min(1, this.connectivity.t + dt / Math.max(1, this.connectivity.duration));
    const p = this.connectivityCurve.getPointAt(this.connectivity.t);
    this.connectivityBall.position.copy(p);
    this.connectivityBall.rotation.x -= dt * 3.2;
    if (this.connectivity.t >= 1) {
      this.connectivity.active = false;
      this.notifyConnectivity();
      this.notify();
      return;
    }
    const now = Date.now();
    if (now - this._lastConnNotify > 100) {
      this._lastConnNotify = now;
      this.notifyConnectivity();
    }
  }

  notifyConnectivity() {
    const c = { ...this.connectivity, progress: Math.round(this.connectivity.t * 100) };
    if (typeof this.onConnectivity === 'function') this.onConnectivity(c);
  }

  disposeConnectivity() {
    if (this.connectivityGroup) {
      this.scene.remove(this.connectivityGroup);
      this.connectivityGroup.traverse?.((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
    this.connectivityGroup = null;
    this.connectivityBall = null;
    this.connectivityCurve = null;
    this.connectivity.active = false;
    this.connectivity.t = 0;
    this.connectivity.progress = 0;
    this.connectivity.hasPath = false;
    this.connectivity.points = 0;
    this.connectivity.duration = 0;
  }

  applyHidden() {
    for (const id of this.hidden) {
      const node = this.nodeMap.get(id);
      if (node) node.object.visible = false;
    }
  }

  setOption(key, value) {
    this.options[key] = value;
    if (key === 'time') this.applyTimeOfDay(value);
    this.applyOptions();
    this.notify();
  }

  // ------------------------------------------------------------ node editing
  serializeNode(node) {
    const visible = node.object
      ? (node.object.visible !== false && (node.parent ? this.isParentVisible(node.parent) : true))
      : true;
    return {
      id: node.id,
      label: node.label,
      type: node.type,
      level: node.level,
      visible,
      children: node.children.map((c) => this.serializeNode(c)),
    };
  }

  isParentVisible(node) {
    if (!node) return true;
    if (!node.object) return true;
    if (node.object.visible === false) return false;
    return this.isParentVisible(node.parent);
  }

  getTree() {
    return { tree: this.serializeNode(this.tree), selected: this.selected };
  }

  getNode(id) {
    return this.nodeMap.get(id) || null;
  }

  selectNode(id) {
    const node = this.nodeMap.get(id);
    if (!node) return null;
    this.clearSelection();
    this.selected = id;
    const helper = new THREE.BoxHelper(node.object, 0xd5a35c);
    helper.material.depthTest = false;
    helper.material.transparent = true;
    helper.material.opacity = 0.95;
    helper.renderOrder = 6;
    this.scene.add(helper);
    this.selectionHelper = helper;
    this.notify();
    return this.getNodeInfo(id);
  }

  clearSelection() {
    if (this.selectionHelper) {
      this.scene.remove(this.selectionHelper);
      this.selectionHelper.geometry?.dispose();
      this.selectionHelper.material?.dispose();
      this.selectionHelper = null;
    }
    this.selected = null;
  }

  getNodeInfo(id) {
    const node = this.nodeMap.get(id);
    if (!node) return null;
    const obj = node.object;
    obj.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    let meshes = 0;
    let tris = 0;
    const keys = new Set();
    obj.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      meshes += 1;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position?.count || 0) / 3;
      if (o.userData.key) keys.add(o.userData.key);
    });
    return {
      id: node.id,
      label: node.label,
      type: node.type,
      visible: obj.visible !== false,
      children: node.children.length,
      level: node.level ?? null,
      size: { x: +size.x.toFixed(2), y: +size.y.toFixed(2), z: +size.z.toFixed(2) },
      center: { x: +center.x.toFixed(2), y: +center.y.toFixed(2), z: +center.z.toFixed(2) },
      meshes,
      triangles: Math.round(tris),
      materials: [...keys],
    };
  }

  deleteNode(id) {
    const node = this.nodeMap.get(id);
    if (!node || id === 'root') return false;
    const before = node.object.visible !== false;
    node.object.visible = false;
    this.hidden.add(id);
    this.pushHistory({ id, before, after: false });
    this.notify();
    return true;
  }

  restoreNode(id) {
    const node = this.nodeMap.get(id);
    if (!node) return false;
    node.object.visible = true;
    this.hidden.delete(id);
    this.pushHistory({ id, before: false, after: true });
    this.applyOptions();
    this.notify();
    return true;
  }

  pushHistory(op) {
    this.history.splice(this.hIndex + 1);
    this.history.push(op);
    this.hIndex = this.history.length - 1;
    if (this.history.length > 120) {
      this.history.shift();
      this.hIndex -= 1;
    }
  }

  applyHistoryOp(op, direction) {
    const node = this.nodeMap.get(op.id);
    if (!node) return;
    const visible = direction === 'undo' ? op.before : op.after;
    node.object.visible = visible;
    if (visible) this.hidden.delete(op.id);
    else this.hidden.add(op.id);
  }

  undo() {
    if (this.hIndex < 0) return false;
    this.applyHistoryOp(this.history[this.hIndex], 'undo');
    this.hIndex -= 1;
    this.applyOptions();
    this.notify();
    return true;
  }

  redo() {
    if (this.hIndex >= this.history.length - 1) return false;
    this.hIndex += 1;
    this.applyHistoryOp(this.history[this.hIndex], 'redo');
    this.applyOptions();
    this.notify();
    return true;
  }

  resetEdits() {
    this.hidden.clear();
    this.history = [];
    this.hIndex = -1;
    this.nodeMap.forEach((n) => { n.object.visible = true; });
    this.clearSelection();
    this.applyOptions();
    this.notify();
  }

  getStats() {
    let meshes = 0;
    let tris = 0;
    this.root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      meshes += 1;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position?.count || 0) / 3;
    });
    return {
      nodes: this.nodeMap.size,
      meshes,
      triangles: Math.round(tris),
      materials: this.mats?.cache?.size || 0,
      drawCalls: this.renderer.info.render.calls,
      lights: 3 + this.interiorLights.length,
      hidden: this.hidden.size,
    };
  }

  getState() {
    return {
      ...this.getTree(),
      canUndo: this.hIndex >= 0,
      canRedo: this.hIndex < this.history.length - 1,
      wireframe: Boolean(this.options.wireframe),
      explode: Boolean(this.options.explode),
      explodeSpread: Number(this.options.explodeSpread),
      explodeLift: Number(this.options.explodeLift),
      explodeAngle: Number(this.options.explodeAngle),
      peel: Boolean(this.options.peel),
      glow: Boolean(this.options.glow),
      section: this.getSection(),
      connectivity: { ...this.connectivity, progress: Math.round(this.connectivity.t * 100) },
      lighting: this.getLighting(),
      stats: this.getStats(),
    };
  }

  /** Extra change listeners; keeps SceneView's toolbar and the inspector in sync. */
  subscribe(fn) {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  notify() {
    const state = this.getState();
    if (typeof this.onChange === 'function') this.onChange(state);
    for (const fn of this.changeListeners) fn(state);
  }

  pickAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.root, true);
    const hit = hits.find((h) => h.object.isMesh && h.object.visible);
    if (!hit) {
      // empty click keeps the selection; explicit clear is a UI action
      return;
    }
    let obj = hit.object;
    while (obj && !obj.userData?.nodeId) obj = obj.parent;
    if (obj?.userData?.nodeId && typeof this.onPick === 'function') {
      this.onPick(obj.userData.nodeId);
    }
  }

  disposeInteriorLights() {
    this.interiorLights?.forEach((l) => this.scene.remove(l));
    this.interiorLights = [];
  }

  disposeSectionHelper() {
    if (!this.sectionHelper) return;
    this.scene.remove(this.sectionHelper);
    this.sectionHelper.traverse?.((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    this.sectionHelper = null;
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
        { binary: true, onlyVisible: true },
      );
    });
  }

  disposeBuilding() {
    this.clearSelection();
    this.disposeInteriorLights();
    this.disposeSectionHelper();
    this.clearSectionDrawLine();
    this.section.drawMode = false;
    this.sectionDraw = null;
    this.section.enabled = false;
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
    this.glowGroup = null;
    this.contextGroup = null;
    this.siteGroup = null;
    this.tree = { id: 'root', label: '场景', type: 'group', children: [] };
    this.nodeMap.clear();
    this.hidden.clear();
    this.selected = null;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this._onResize);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('pointerdown', this._onSectionDown, true);
    window.removeEventListener('pointermove', this._onSectionMove);
    window.removeEventListener('pointerup', this._onSectionUp);
    window.removeEventListener('pointercancel', this._onSectionUp);
    this.changeListeners.clear();
    this.disposeConnectivity();
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
