// Code-compliance checks. Deliberately simple, explainable rules that mirror
// the real design-review questions an architect asks first.

import { round1 } from '../../../shared/facade.js';

const pass = (id, name, value, limit, advice) => ({ id, name, status: 'pass', value, limit, advice });
const warn = (id, name, value, limit, advice) => ({ id, name, status: 'warn', value, limit, advice });
const fail = (id, name, value, limit, advice) => ({ id, name, status: 'fail', value, limit, advice });

export function checkSpec(spec) {
  const m = spec.metrics;
  const checks = [];

  // 1. FAR
  checks.push(m.far <= spec.site.farLimit
    ? pass('far', '容积率', m.far, spec.site.farLimit, '在规划上限以内')
    : fail('far', '容积率', m.far, spec.site.farLimit, '超出上限，需降低层数或缩小标准层'));

  // 2. coverage
  checks.push(m.coverage <= spec.site.coverageLimit
    ? pass('coverage', '建筑密度', m.coverage, spec.site.coverageLimit, '满足密度控制')
    : fail('coverage', '建筑密度', m.coverage, spec.site.coverageLimit, '底层占地过大，考虑架空或缩小体量'));

  // 3. window-to-floor ratio, per floor
  const worst = [...(m.glassByFloor || [])].sort((a, b) => a.ratio - b.ratio)[0];
  if (worst) {
    if (worst.ratio < 0.18) {
      checks.push(fail('wfr', '窗地比', worst.ratio, 0.2, `L${worst.level} 采光不足，建议加大开窗或改条窗`));
    } else if (worst.ratio > 0.72) {
      checks.push(warn('wfr', '窗地比', worst.ratio, 0.72, '玻璃面积偏大，注意夏季得热与眩光'));
    } else {
      checks.push(pass('wfr', '窗地比', worst.ratio, 0.2, '各层采光均衡'));
    }
  }

  // 4. floor height
  const lowLevel = spec.floors.find((f) => f.height < 3.0);
  checks.push(lowLevel
    ? fail('height', '层高', lowLevel.height, 3.0, `L${lowLevel.level} 层高不足`)
    : pass('height', '层高', round1(spec.floors[0]?.height || 0), 3.0, '首层 4.5m，标准层 3.6m'));

  // 5. evacuation distance: worst room corner distance to the nearest core
  let worstDist = 0;
  let worstRoom = null;
  for (const floor of spec.floors) {
    const core = floor.core;
    if (!core) continue;
    const cx = core.x + core.w / 2;
    const cz = core.z + core.d / 2;
    for (const room of floor.rooms) {
      const rx = room.x + room.w / 2;
      const rz = room.z + room.d / 2;
      const d = Math.abs(rx - cx) + Math.abs(rz - cz);
      if (d > worstDist) { worstDist = d; worstRoom = room; }
    }
  }
  checks.push(worstDist > 30
    ? fail('evac', '疏散距离', round1(worstDist), 30, `${worstRoom?.name || '房间'}离核心筒过远，需增设第二出口`)
    : worstDist > 24
      ? warn('evac', '疏散距离', round1(worstDist), 30, '接近限值，端部房间建议加开疏散门')
      : pass('evac', '疏散距离', round1(worstDist), 30, '最远房间可一次到达核心筒'));

  // 6. number of stairs
  const coresNeeded = spec.floors.length >= 3 || m.gfa > 5000 ? 2 : 1;
  checks.push(coresNeeded > 1
    ? warn('stairs', '楼梯数量', 1, coresNeeded, '多层公共建筑宜设两部疏散楼梯，当前仅核心筒一部')
    : pass('stairs', '楼梯数量', 1, 1, '单层建筑单出口满足要求'));

  // 7. setback
  const s = spec.site.setback;
  const fp = spec.floors[0].footprint;
  const inside = fp.x >= s.left - 0.01 && fp.z >= s.front - 0.01
    && fp.x + fp.w <= spec.site.width - s.right + 0.01
    && fp.z + fp.d <= spec.site.depth - s.back + 0.01;
  checks.push(inside
    ? pass('setback', '建筑退线', 0, 0, `南 ${s.front}m / 北 ${s.back}m / 两侧 ${s.left}m`)
    : fail('setback', '建筑退线', 0, 0, '体量压线，需整体内移'));

  // 8. corridor
  checks.push(m.corridorWidth >= 1.8
    ? pass('corridor', '走廊净宽', m.corridorWidth, 1.8, '满足双向通行')
    : fail('corridor', '走廊净宽', m.corridorWidth, 1.8, '走廊过窄'));

  // 9. tiny rooms
  const tiny = spec.floors.flatMap((f) => f.rooms).filter((r) => r.w * r.d < 4);
  checks.push(tiny.length
    ? warn('roomsize', '最小房间', round1(Math.min(...tiny.map((r) => r.w * r.d))), 4, `${tiny.length} 个房间面积过小，建议合并`)
    : pass('roomsize', '最小房间', round1(Math.min(...spec.floors.flatMap((f) => f.rooms).map((r) => r.w * r.d)) || 0), 4, '无碎片房间'));

  // 10. rooms inside footprint
  const outside = spec.floors.flatMap((f) => f.rooms.filter((r) =>
    r.x < f.footprint.x - 0.05 || r.z < f.footprint.z - 0.05
    || r.x + r.w > f.footprint.x + f.footprint.w + 0.05
    || r.z + r.d > f.footprint.z + f.footprint.d + 0.05));
  checks.push(outside.length
    ? fail('envelope', '房间边界', outside.length, 0, '房间超出标准层轮廓，已需重新排布')
    : pass('envelope', '房间边界', 0, 0, '所有房间均在轮廓内'));

  return checks;
}

export function summarizeChecks(checks) {
  const fails = checks.filter((c) => c.status === 'fail');
  const warns = checks.filter((c) => c.status === 'warn');
  return {
    total: checks.length,
    fail: fails.length,
    warn: warns.length,
    verdict: fails.length ? '有硬性冲突' : warns.length ? '基本可行，有待优化' : '通过校核',
    headline: fails.length
      ? `校核未通过：${fails.map((c) => c.name).join('、')}`
      : warns.length ? `校核通过，提示项：${warns.map((c) => c.name).join('、')}` : '校核全部通过',
  };
}
