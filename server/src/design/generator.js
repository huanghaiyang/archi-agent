// Deterministic design engine.
//
// This module is the "hands" of the agent: it turns an architectural brief
// (free text) into a fully normalised, renderable DesignSpec without any
// language model involved. Two uses:
//   1. fallback / demo mode when Hy4 is not reachable;
//   2. the baseline that a Hy4-authored spec is merged into and validated
//      against (the model proposes, the engine disposes).

import { ROOM_TYPES } from './palette.js';
import { clamp, floorGlassArea, sidesTouchingEnvelope, round1 } from '../../../shared/facade.js';

const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

// ---------------------------------------------------------------- programmes
// weight = relative share of the net floor plate; zone = which floor gets it.
export const PROGRAMMES = {
  library: {
    label: '社区图书馆',
    cost: 3200,
    rooms: [
      { name: '门厅', type: 'public', weight: 1.2, zone: 'ground' },
      { name: '服务台', type: 'service', weight: 0.5, zone: 'ground' },
      { name: '少儿阅览', type: 'study', weight: 1.6, zone: 'ground' },
      { name: '开架阅览', type: 'study', weight: 2.6, zone: 'all' },
      { name: '自习区', type: 'study', weight: 1.8, zone: 'upper' },
      { name: '报告厅', type: 'exhibition', weight: 1.4, zone: 'ground' },
      { name: '咖啡书吧', type: 'service', weight: 0.9, zone: 'ground' },
      { name: '办公', type: 'office', weight: 0.9, zone: 'upper' },
      { name: '卫生间', type: 'wet', weight: 0.5, zone: 'all' },
      { name: '设备间', type: 'technical', weight: 0.3, zone: 'ground' },
    ],
  },
  office: {
    label: '企业办公楼',
    cost: 2600,
    rooms: [
      { name: '门厅', type: 'public', weight: 1.0, zone: 'ground' },
      { name: '前台接待', type: 'service', weight: 0.6, zone: 'ground' },
      { name: '开放办公', type: 'office', weight: 3.4, zone: 'all' },
      { name: '会议室', type: 'meeting', weight: 1.3, zone: 'all' },
      { name: '独立办公室', type: 'office', weight: 0.9, zone: 'upper' },
      { name: '洽谈室', type: 'meeting', weight: 0.6, zone: 'upper' },
      { name: '茶水间', type: 'wet', weight: 0.4, zone: 'all' },
      { name: '打印区', type: 'office', weight: 0.4, zone: 'upper' },
      { name: '卫生间', type: 'wet', weight: 0.5, zone: 'all' },
      { name: '设备间', type: 'technical', weight: 0.3, zone: 'ground' },
    ],
  },
  housing: {
    label: '住宅',
    cost: 2200,
    rooms: [
      { name: '门厅', type: 'circulation', weight: 0.4, zone: 'ground' },
      { name: '客厅', type: 'residential', weight: 1.6, zone: 'all' },
      { name: '餐厅', type: 'residential', weight: 0.8, zone: 'all' },
      { name: '厨房', type: 'wet', weight: 0.5, zone: 'all' },
      { name: '主卧', type: 'residential', weight: 1.1, zone: 'all' },
      { name: '次卧', type: 'residential', weight: 0.9, zone: 'all' },
      { name: '书房', type: 'residential', weight: 0.6, zone: 'upper' },
      { name: '卫生间', type: 'wet', weight: 0.5, zone: 'all' },
      { name: '阳台', type: 'residential', weight: 0.4, zone: 'all' },
    ],
  },
  museum: {
    label: '美术馆',
    cost: 4200,
    rooms: [
      { name: '门厅', type: 'public', weight: 1.1, zone: 'ground' },
      { name: '主展厅', type: 'exhibition', weight: 3.0, zone: 'all' },
      { name: '侧展厅', type: 'exhibition', weight: 1.6, zone: 'upper' },
      { name: '藏品库', type: 'technical', weight: 0.8, zone: 'ground' },
      { name: '修复室', type: 'technical', weight: 0.5, zone: 'upper' },
      { name: '报告厅', type: 'exhibition', weight: 1.0, zone: 'ground' },
      { name: '文创商店', type: 'service', weight: 0.6, zone: 'ground' },
      { name: '咖啡', type: 'service', weight: 0.5, zone: 'ground' },
      { name: '办公', type: 'office', weight: 0.7, zone: 'upper' },
      { name: '卫生间', type: 'wet', weight: 0.5, zone: 'all' },
    ],
  },
  school: {
    label: '教学楼',
    cost: 2800,
    rooms: [
      { name: '门厅', type: 'public', weight: 0.9, zone: 'ground' },
      { name: '教室', type: 'classroom', weight: 2.0, zone: 'all' },
      { name: '实验室', type: 'classroom', weight: 1.2, zone: 'upper' },
      { name: '图书室', type: 'study', weight: 1.0, zone: 'ground' },
      { name: '多功能厅', type: 'exhibition', weight: 1.2, zone: 'ground' },
      { name: '教师办公', type: 'office', weight: 0.9, zone: 'upper' },
      { name: '食堂', type: 'service', weight: 0.8, zone: 'ground' },
      { name: '卫生间', type: 'wet', weight: 0.5, zone: 'all' },
    ],
  },
  community: {
    label: '社区中心',
    cost: 2400,
    rooms: [
      { name: '门厅', type: 'public', weight: 1.0, zone: 'ground' },
      { name: '多功能活动室', type: 'exhibition', weight: 2.0, zone: 'ground' },
      { name: '阅览室', type: 'study', weight: 1.4, zone: 'upper' },
      { name: '儿童活动', type: 'study', weight: 1.2, zone: 'ground' },
      { name: '健身室', type: 'classroom', weight: 1.0, zone: 'upper' },
      { name: '办公', type: 'office', weight: 0.8, zone: 'upper' },
      { name: '卫生间', type: 'wet', weight: 0.5, zone: 'all' },
      { name: '设备间', type: 'technical', weight: 0.3, zone: 'ground' },
    ],
  },
};

export const STYLES = {
  minimal: {
    label: '极简白',
    facade: { system: 'ribbon', materials: { wall: 'white-plaster', glass: 'clear-glass', frame: 'dark-metal', roof: 'white-plaster', floorSlab: 'warm-concrete' } },
    windowWidth: 2.4,
    gap: 0.9,
  },
  industrial: {
    label: '工业记忆',
    facade: { system: 'punched', materials: { wall: 'red-brick', glass: 'bronze-glass', frame: 'corten-steel', roof: 'metal-seam', floorSlab: 'warm-concrete' } },
    windowWidth: 2.0,
    gap: 1.4,
  },
  timber: {
    label: '木构暖色',
    facade: { system: 'screen', materials: { wall: 'timber-slat', glass: 'clear-glass', frame: 'dark-metal', roof: 'metal-seam', floorSlab: 'timber-slat' } },
    windowWidth: 2.2,
    gap: 0.8,
  },
  tech: {
    label: '金属科技',
    facade: { system: 'curtain', materials: { wall: 'aluminium', glass: 'blue-glass', frame: 'dark-metal', roof: 'metal-seam', floorSlab: 'warm-concrete' } },
    windowWidth: 3.0,
    gap: 0.5,
  },
  brick: {
    label: '砖砌传统',
    facade: { system: 'punched', materials: { wall: 'grey-brick', glass: 'clear-glass', frame: 'dark-metal', roof: 'clay-tile', floorSlab: 'stone' } },
    windowWidth: 1.6,
    gap: 1.6,
  },
  concrete: {
    label: '暖灰清水混凝土',
    facade: { system: 'punched', materials: { wall: 'warm-concrete', glass: 'bronze-glass', frame: 'dark-metal', roof: 'metal-seam', floorSlab: 'warm-concrete' } },
    windowWidth: 1.8,
    gap: 1.2,
  },
};

export const PROGRAMME_KEYS = Object.keys(PROGRAMMES);
export const STYLE_KEYS = Object.keys(STYLES);

// ---------------------------------------------------------------- brief parse
export function parseBrief(text = '') {
  const src = String(text);
  const out = {};

  const cn = src.match(/([一二两三四五六七八九十])\s*层/);
  const num = src.match(/(\d+)\s*(?:层|F\b|floors?)/i);
  if (num) out.floors = clamp(parseInt(num[1], 10), 1, 12);
  else if (cn) out.floors = clamp(CN_NUM[cn[1]] || 3, 1, 12);

  const site = src.match(/(\d+(?:\.\d+)?)\s*(?:m|米)?\s*[x×*乘]\s*(\d+(?:\.\d+)?)\s*(?:m|米)?/i);
  if (site) out.site = { width: parseFloat(site[1]), depth: parseFloat(site[2]) };

  const area = src.match(/(\d+(?:\.\d+)?)\s*(?:㎡|平米|平方米|m²|m2)/i);
  if (area) out.area = parseFloat(area[1]);

  if (/(图书|阅览|书吧)/.test(src)) out.programme = 'library';
  else if (/(办公|写字楼|总部|商务)/.test(src)) out.programme = 'office';
  else if (/(住宅|公寓|居住|户型)/.test(src)) out.programme = 'housing';
  else if (/(美术|博物|展览|画廊)/.test(src)) out.programme = 'museum';
  else if (/(学校|教室|教学|幼儿园)/.test(src)) out.programme = 'school';
  else if (/(社区|活动中心|便民)/.test(src)) out.programme = 'community';

  // order matters: "单坡屋顶" and "四坡屋顶" both contain "坡屋顶"
  if (/单坡/.test(src)) out.roof = 'shed';
  else if (/(四坡|庑殿|歇山)/.test(src)) out.roof = 'hip';
  else if (/(坡屋顶|双坡|坡屋)/.test(src)) out.roof = 'gable';
  else if (/平屋顶/.test(src)) out.roof = 'flat';

  if (/(极简|纯白|白墙|minimal)/i.test(src)) out.style = 'minimal';
  else if (/(工业|红砖|厂房|loft)/i.test(src)) out.style = 'industrial';
  else if (/(木|木质|格栅|timber)/i.test(src)) out.style = 'timber';
  else if (/(科技|金属|铝板|玻璃幕墙)/.test(src)) out.style = 'tech';
  else if (/(青砖|传统|砖砌)/.test(src)) out.style = 'brick';
  else if (/(清水混凝土|混凝土|concrete)/i.test(src)) out.style = 'concrete';

  if (/退台/.test(src)) out.stepped = true;
  if (/哈尔滨|东北|严寒/.test(src)) out.climate = 'severe-cold';
  else if (/深圳|广州|南方|湿热/.test(src)) out.climate = 'hot-humid';
  return out;
}

// ---------------------------------------------------------------- floor layout
function corridorAxis(fw, fd) {
  return fw >= fd ? 'x' : 'z';
}

/**
 * Slice a rectangular plate into: core + corridor + two room bands.
 * Deterministic, and always produces rects that stay inside the footprint.
 */
export function layoutFloorPlan(footprint, roomSpecs, opts = {}) {
  const { x: fx, z: fz, w: fw, d: fd } = footprint;
  const axis = opts.axis || corridorAxis(fw, fd);
  const corridorW = opts.corridorWidth || 2.2;
  const coreSize = clamp(Math.min(fw, fd) * 0.3, 4.6, 7.2);
  const coreDepth = Math.min(fd, coreSize * 1.2);
  const coreW = Math.min(fw, coreSize);
  const longSpan = axis === 'x' ? fw : fd;

  // core sits at the far end of the long axis, hugging the corridor
  const coreRect = axis === 'x'
    ? { x: fx + fw - coreW, z: fz + (fd - coreDepth) / 2, w: coreW, d: coreDepth }
    : { x: fx + (fw - coreDepth) / 2, z: fz + fd - coreW, w: coreDepth, d: coreW };

  const netLongs = axis === 'x' ? fw - coreW : fd - coreW;
  const bands = [];

  if (axis === 'x') {
    const cz = fz + (fd - corridorW) / 2;
    bands.push({ dir: 'n', rect: { x: fx, z: fz, w: netLongs, d: cz - fz }, side: 's' });
    bands.push({ dir: 's', rect: { x: fx, z: cz + corridorW, w: netLongs, d: fz + fd - (cz + corridorW) }, side: 'n' });
  } else {
    const cx = fx + (fw - corridorW) / 2;
    bands.push({ dir: 'w', rect: { x: fx, z: fz, w: cx - fx, d: netLongs }, side: 'e' });
    bands.push({ dir: 'e', rect: { x: cx + corridorW, z: fz, w: fx + fw - (cx + corridorW), d: netLongs }, side: 'w' });
  }

  // distribute rooms over bands by descending weight, widest first
  const items = roomSpecs.map((r, i) => ({ ...r, i })).sort((a, b) => (b.weight || 1) - (a.weight || 1));
  const buckets = [[], []];
  let load = [0, 0];
  items.forEach((r) => {
    const k = load[0] <= load[1] ? 0 : 1;
    buckets[k].push(r);
    load[k] += r.weight || 1;
  });

  const rooms = [];
  buckets.forEach((list, k) => {
    const band = bands[k];
    if (!band.rect.w || !band.rect.d) return;
    const span = axis === 'x' ? band.rect.w : band.rect.d;
    const total = list.reduce((s, r) => s + (r.weight || 1), 0) || 1;
    const widthList = list.map((r) => Math.max(3.0, ((r.weight || 1) / total) * span));
    const rawSum = widthList.reduce((s, w) => s + w, 0);
    let widths = widthList;
    if (rawSum > span) widths = widthList.map((w) => (w / rawSum) * span);
    else widths[widths.length - 1] += span - rawSum;
    let cursor = 0;
    list.forEach((r, idx) => {
      const w = widths[idx];
      if (w <= 0.4) return;
      const rect = axis === 'x'
        ? { x: band.rect.x + cursor, z: band.rect.z, w, d: band.rect.d }
        : { x: band.rect.x, z: band.rect.z + cursor, w: band.rect.w, d: w };
      rooms.push({
        id: `${axis}${k}-${idx}`,
        name: r.name,
        type: r.type,
        ...rect,
        windows: {},
        door: band.side,
      });
      cursor += w;
    });
  });

  // corridor as a circulation strip, split around the core
  const corridor = axis === 'x'
    ? { x: fx, z: fz + (fd - corridorW) / 2, w: fw - coreW, d: corridorW }
    : { x: fx + (fw - corridorW) / 2, z: fz, w: corridorW, d: fd - coreW };

  return { axis, corridorW, core: coreRect, corridor, rooms };
}

// ---------------------------------------------------------------- main builder
export function generateDesign(briefText, options = {}) {
  const p = { ...parseBrief(briefText), ...options };
  const programmeKey = p.programme || 'library';
  const programme = PROGRAMMES[programmeKey] || PROGRAMMES.library;
  const styleKey = p.style && STYLES[p.style] ? p.style : 'concrete';
  const style = STYLES[styleKey];

  const siteW = clamp(p.site?.width || 44, 20, 120);
  const siteD = clamp(p.site?.depth || 34, 18, 120);
  const siteArea = siteW * siteD;

  const setback = {
    front: p.climate === 'hot-humid' ? 4 : 5,
    back: 4,
    left: 4,
    right: 4,
  };
  const farLimit = programmeKey === 'housing' ? 2.2 : 1.8;
  const coverageLimit = p.climate === 'hot-humid' ? 0.4 : 0.45;

  const floorsCount = clamp(p.floors || (programmeKey === 'housing' ? 6 : 3), 1, 12);
  const floorHeightDefault = 3.6;

  // footprint from target GFA, bounded by FAR / coverage / setbacks.
  // `plate` overrides it (used when adding a floor to an approved scheme).
  const availW = siteW - setback.left - setback.right;
  const availD = siteD - setback.front - setback.back;
  let fpW;
  let fpD;
  if (p.plate && p.plate.w > 0 && p.plate.d > 0) {
    fpW = clamp(p.plate.w, 12, availW);
    fpD = clamp(p.plate.d, 12, availD);
  } else {
    let gfaTarget = p.area || siteArea * 0.9;
    let plateArea = gfaTarget / floorsCount;
    plateArea = Math.min(plateArea, availW * availD, siteArea * coverageLimit, (siteArea * farLimit) / floorsCount);
    plateArea = Math.max(plateArea, 150);
    const ratio = availW / availD;
    fpW = Math.sqrt(plateArea * ratio);
    fpD = plateArea / fpW;
    if (fpW > availW) { fpW = availW; fpD = plateArea / fpW; }
    if (fpD > availD) { fpD = availD; fpW = plateArea / fpD; }
    fpW = clamp(fpW, 12, availW);
    fpD = clamp(fpD, 12, availD);
  }

  // keep the building near the south (front) setback, shifted west so a plaza
  // stays on the east side of the site
  const fpX = setback.left + Math.max(0, (availW - fpW) * 0.35);
  const fpZ = setback.front + Math.max(0, availD - fpD) * 0.55;

  const floors = [];
  let elevation = 0;
  for (let level = 1; level <= floorsCount; level += 1) {
    const isTop = level === floorsCount;
    const step = p.stepped && isTop && floorsCount >= 3 ? 2.4 : 0;
    const footprint = {
      x: fpX + step * 0.5,
      z: fpZ + step * 0.5,
      w: fpW - step,
      d: fpD - step,
    };
    const floorHeight = level === 1 ? 4.5 : 3.6;
    floors.push({ level, elevation, height: floorHeight, footprint });
    elevation += floorHeight;
  }

  // distribute programme rooms per floor
  const roomsByFloor = floors.map((floor) => {
    const isGround = floor.level === 1;
    let specs = programme.rooms.filter((r) => r.zone === 'all' || (isGround ? r.zone === 'ground' : r.zone === 'upper'));
    if (!isGround && specs.length < 3) {
      specs = programme.rooms.filter((r) => r.zone !== 'ground');
    }
    return specs.map((r, i) => ({ ...r, i }));
  });

  const builtFloors = floors.map((floor, idx) => {
    const plan = layoutFloorPlan(floor.footprint, roomsByFloor[idx]);
    const rooms = plan.rooms.map((room, i) => {
      const envelope = sidesTouchingEnvelope(room, floor.footprint);
      const windows = {};
      const allowGlass = !['wet', 'technical'].includes(room.type);
      if (allowGlass) {
        ['n', 's', 'e', 'w'].forEach((side) => {
          if (envelope[side] && room.w > 1.9 && room.d > 1.9) windows[side] = true;
        });
      }
      const spec = ROOM_TYPES[room.type] || ROOM_TYPES.office;
      return {
        id: `L${floor.level}-R${i + 1}`,
        name: room.name,
        type: room.type,
        x: round1(room.x),
        z: round1(room.z),
        w: round1(room.w),
        d: round1(room.d),
        height: Math.min(spec.height, floor.height - 0.6),
        windows,
        door: room.door,
        floorMaterial: ['wet'].includes(room.type) ? 'stone' : ['public', 'exhibition'].includes(room.type) ? 'stone' : 'timber-slat',
      };
    });

    const plan2 = plan;
    return {
      level: floor.level,
      name: `L${floor.level} ${floor.level === 1 ? '· 公共层' : floor.level === floorsCount ? '· 顶层' : '· 标准层'}`,
      elevation: round1(floor.elevation),
      height: floor.height,
      footprint: {
        x: round1(floor.footprint.x),
        z: round1(floor.footprint.z),
        w: round1(floor.footprint.w),
        d: round1(floor.footprint.d),
      },
      corridor: {
        x: round1(plan2.corridor.x),
        z: round1(plan2.corridor.z),
        w: round1(plan2.corridor.w),
        d: round1(plan2.corridor.d),
      },
      core: {
        x: round1(plan2.core.x),
        z: round1(plan2.core.z),
        w: round1(plan2.core.w),
        d: round1(plan2.core.d),
        type: 'stair',
      },
      rooms,
    };
  });

  const facade = {
    system: style.facade.system,
    windowWidth: style.windowWidth,
    gap: style.gap,
    sillHeight: 0.9,
    headClearance: 0.55,
    mullion: 0.08,
    materials: { ...style.facade.materials },
  };

  const roofType = p.roof || (p.stepped ? 'flat' : 'flat');
  const spec = {
    version: '1.0',
    meta: {
      title: `${programme.label} · ${floorsCount}层`,      brief: briefText,
      programme: programmeKey,
      programmeLabel: programme.label,
      style: styleKey,
      styleLabel: style.label,
      generatedBy: 'design-engine',
      unit: 'm',
    },
    site: {
      width: round1(siteW),
      depth: round1(siteD),
      north: '-z',
      entrySide: 's',
      climate: p.climate || 'severe-cold',
      setback,
      farLimit,
      coverageLimit,
      floorHeightDefault,
      plazaSide: 'e',
    },
    massing: {
      roof: {
        type: roofType,
        pitch: 26,
        overhang: 0.6,
        parapet: 1.1,
        material: style.facade.materials.roof,
      },
      floors: builtFloors.map((f) => ({ level: f.level, elevation: f.elevation, height: f.height, footprint: f.footprint })),
    },
    floors: builtFloors,
    facade,
    metrics: {},
    checks: [],
    notes: [],
  };

  spec.metrics = computeMetrics(spec);
  spec.costRate = programme.cost;
  spec.notes = buildNotes(spec, p);
  return spec;
}

export function computeMetrics(spec) {
  const siteArea = spec.site.width * spec.site.depth;
  const gfa = spec.floors.reduce((s, f) => s + f.footprint.w * f.footprint.d, 0);
  const footprintArea = spec.floors[0] ? spec.floors[0].footprint.w * spec.floors[0].footprint.d : 0;
  const glassByFloor = [];
  let glass = 0;
  let siteGlass = 0;
  for (const floor of spec.floors) {
    const floorArea = floor.footprint.w * floor.footprint.d;
    const floorGlass = floorGlassArea(floor, spec.facade);
    glassByFloor.push({ level: floor.level, area: round1(floorGlass), floorArea: round1(floorArea), ratio: round1(floorGlass / Math.max(1, floorArea)) });
    glass += floorGlass;
    siteGlass += floorArea;
  }
  const roomCount = spec.floors.reduce((s, f) => s + f.rooms.length, 0);

  return {
    siteArea: round1(siteArea),
    gfa: round1(gfa),
    footprintArea: round1(footprintArea),
    far: round1(gfa / siteArea),
    coverage: round1(footprintArea / siteArea),
    floors: spec.floors.length,
    height: round1((spec.floors.at(-1)?.elevation || 0) + (spec.floors.at(-1)?.height || 0)),
    roomCount,
    windowFloorRatio: round1(glass / Math.max(1, siteGlass)),
    glassArea: round1(glass),
    glassByFloor,
    costEstimate: Math.round(Math.round(gfa) * (spec.costRate || 2800)),
    corridorWidth: spec.floors[0]?.corridor ? round1(Math.min(spec.floors[0].corridor.w, spec.floors[0].corridor.d)) : 0,
  };
}

function buildNotes(spec, p) {
  const m = spec.metrics || computeMetrics(spec);
  return [
    `场地 ${spec.site.width}×${spec.site.depth}m，建筑 ${m.footprintArea}㎡，容积率 ${m.far}，建筑密度 ${(m.coverage * 100).toFixed(0)}%。`,
    `采用 ${spec.facade.system} 立面体系，${spec.facade.materials.wall} 主墙 + ${spec.facade.materials.glass} 玻璃，窗地比 ${m.windowFloorRatio}。`,
    `标准走廊 ${m.corridorWidth}m，核心筒（楼梯/电梯）设于平面端部，首层 4.5m 通高门厅朝向${spec.site.entrySide === 's' ? '南' : '北'}侧街道。`,
    p.climate === 'severe-cold'
      ? '严寒地区：加大南向开窗、北侧减少窗洞，入口设门斗，屋面做保温构造。'
      : '湿热地区：设置水平遮阳与深挑檐，立面增加可开启扇促进穿堂风。',
  ];
}
