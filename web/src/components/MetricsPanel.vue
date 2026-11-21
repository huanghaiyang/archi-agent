<template>
  <aside class="panel">
    <div class="panel-head">
      <h2>方案指标</h2>
      <span v-if="spec" class="tag">{{ spec.checkSummary.verdict }}</span>
    </div>

    <div v-if="!spec" class="blank">
      <p>生成方案后，这里会显示面积、容积率、窗地比与规范校核结果。</p>
    </div>

    <template v-else>
      <div class="metrics">
        <div class="metric wide">
          <span class="label">总建筑面积</span>
          <strong>{{ fmt(spec.metrics.gfa) }}<em>㎡</em></strong>
          <span class="sub">{{ spec.floors.length }} 层 · 标准层 {{ fmt((spec.floors[1] || spec.floors[0]).footprint.w * (spec.floors[1] || spec.floors[0]).footprint.d) }}㎡</span>
        </div>
        <div class="metric">
          <span class="label">容积率</span>
          <strong>{{ spec.metrics.far }}</strong>
          <span class="sub">上限 {{ spec.site.farLimit }}</span>
        </div>
        <div class="metric">
          <span class="label">建筑密度</span>
          <strong>{{ pct(spec.metrics.coverage) }}</strong>
          <span class="sub">上限 {{ pct(spec.site.coverageLimit) }}</span>
        </div>
        <div class="metric">
          <span class="label">窗地比</span>
          <strong>{{ spec.metrics.windowFloorRatio }}</strong>
          <span class="sub">玻璃 {{ fmt(spec.metrics.glassArea) }}㎡</span>
        </div>
        <div class="metric">
          <span class="label">建筑高度</span>
          <strong>{{ spec.metrics.height }}<em>m</em></strong>
          <span class="sub">首层 {{ spec.floors[0]?.height }}m</span>
        </div>
        <div class="metric">
          <span class="label">房间 / 造价</span>
          <strong>{{ spec.metrics.roomCount }}<em>间</em></strong>
          <span class="sub">约 {{ (spec.metrics.costEstimate / 10000).toFixed(0) }} 万元</span>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <h3>规范校核</h3>
          <span class="count">{{ spec.checkSummary.fail }} 项冲突 · {{ spec.checkSummary.warn }} 项提示</span>
        </div>
        <ul class="checks">
          <li v-for="c in spec.checks" :key="c.id" :class="c.status">
            <i class="dot"></i>
            <div class="cbody">
              <div class="cline">
                <span class="cname">{{ c.name }}</span>
                <span class="cvalue">{{ c.value }}{{ c.limit ? ` / ${c.limit}` : '' }}</span>
              </div>
              <p>{{ c.advice }}</p>
            </div>
          </li>
        </ul>
      </div>

      <div class="section">
        <div class="section-head"><h3>楼层</h3></div>
        <table class="floors">
          <thead>
            <tr><th>层</th><th>标高</th><th>层高</th><th>面积</th><th>房间</th></tr>
          </thead>
          <tbody>
            <tr v-for="f in spec.floors" :key="f.level">
              <td>L{{ f.level }}</td>
              <td>{{ f.elevation }}</td>
              <td>{{ f.height }}</td>
              <td>{{ fmt(f.footprint.w * f.footprint.d) }}</td>
              <td>{{ f.rooms.length }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="section">
        <div class="section-head"><h3>立面配置</h3></div>
        <div class="chips">
          <span class="c">{{ facadeLabel }}</span>
          <span class="c">{{ spec.facade.windowWidth }}m 洞口 / {{ spec.facade.gap }}m 间距</span>
          <span class="c">{{ spec.massing.roof.type === 'flat' ? '平屋顶' : spec.massing.roof.type === 'gable' ? '双坡屋顶' : spec.massing.roof.type === 'shed' ? '单坡屋顶' : '四坡屋顶' }}</span>
          <span class="c">{{ spec.facade.materials.wall }}</span>
          <span class="c">{{ spec.facade.materials.glass }}</span>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h3>设计说明</h3></div>
        <ul class="notes">
          <li v-for="(n, i) in spec.notes" :key="i">{{ n }}</li>
        </ul>
      </div>
    </template>
  </aside>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({ spec: { type: Object, default: null } });
const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('zh-CN'));
const pct = (v) => `${Math.round((v || 0) * 100)}%`;

const FACADE_LABEL = { punched: '点式开洞', ribbon: '水平条窗', curtain: '玻璃幕墙', screen: '竖向内凹格栅' };
const facadeLabel = computed(() => (props.spec ? FACADE_LABEL[props.spec.facade.system] || props.spec.facade.system : ''));
</script>

<style scoped>
.panel {
  background: var(--panel);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}
.panel-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 18px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}
.panel-head h2 { margin: 0; font-size: 14px; font-weight: 600; }
.tag { font-size: 10.5px; padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(95, 191, 139, 0.35); color: #9fe0bd; }

.blank { padding: 20px 18px; color: var(--muted); font-size: 12px; line-height: 1.7; }

.metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--line);
  border-bottom: 1px solid var(--line);
}
.metric {
  background: #131922;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.metric.wide { grid-column: span 2; }
.label { font-size: 10.5px; letter-spacing: 0.08em; color: #788594; }
.metric strong { font-size: 22px; font-weight: 600; letter-spacing: 0.01em; color: #eef3f8; font-variant-numeric: tabular-nums; }
.metric strong em { font-size: 11px; font-style: normal; color: #8b98a6; margin-left: 3px; font-weight: 400; }
.sub { font-size: 10.5px; color: #6f7d8b; }

.section { padding: 14px 16px; border-bottom: 1px solid var(--line); }
.section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 9px; }
.section-head h3 { margin: 0; font-size: 12px; letter-spacing: 0.06em; color: #b9c6d3; font-weight: 600; }
.count { font-size: 10px; color: #6f7d8b; }

.checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
.checks li { display: flex; gap: 8px; align-items: flex-start; }
.dot { width: 6px; height: 6px; border-radius: 50%; margin-top: 5px; flex: 0 0 auto; background: var(--ok); }
.checks li.warn .dot { background: var(--warn); }
.checks li.fail .dot { background: var(--fail); }
.cbody { flex: 1; min-width: 0; }
.cline { display: flex; justify-content: space-between; gap: 8px; }
.cname { font-size: 11.5px; color: #cfdae6; }
.cvalue { font-size: 10.5px; color: #7f8d9c; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cbody p { margin: 2px 0 0; font-size: 10.5px; line-height: 1.5; color: #75828f; }

table.floors { width: 100%; border-collapse: collapse; font-size: 10.5px; color: #a9b6c3; }
table.floors th { text-align: left; color: #6f7d8b; font-weight: 500; padding: 3px 0; border-bottom: 1px solid #1f2937; }
table.floors td { padding: 4px 0; font-variant-numeric: tabular-nums; border-bottom: 1px solid #171f29; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips .c {
  font-size: 10.5px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid #26313e;
  background: #131922;
  color: #a7b4c1;
  font-family: ui-monospace, "SF Mono", monospace;
}

.notes { margin: 0; padding-left: 15px; display: flex; flex-direction: column; gap: 7px; }
.notes li { font-size: 11px; line-height: 1.65; color: #8b98a6; }
</style>
