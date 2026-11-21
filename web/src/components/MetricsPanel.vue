<template>
  <aside class="panel">
    <div class="panel-head">
      <h2>{{ title }}</h2>
      <span v-if="spec && tab === 'metrics'" class="tag" :class="verdictClass">{{ verdict }}</span>
    </div>

    <div class="tabs">
      <button :class="{ on: tab === 'metrics' }" @click="tab = 'metrics'">指标</button>
      <button :class="{ on: tab === 'nodes' }" @click="tab = 'nodes'">节点 <em>{{ stats.nodes || 0 }}</em></button>
      <button :class="{ on: tab === 'light' }" @click="tab = 'light'">光照</button>
    </div>

    <!-- ------------------------------------------------------------ metrics -->
    <template v-if="tab === 'metrics'">
      <div class="scroll">
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
            <h3>场景统计</h3>
            <span class="count">{{ stats.meshes }} 网格 · {{ stats.nodes }} 节点</span>
          </div>
          <div class="stat-grid">
            <div><span>三角面</span><b>{{ fmt(stats.triangles) }}</b></div>
            <div><span>材质</span><b>{{ stats.materials }}</b></div>
            <div><span>Draw call</span><b>{{ stats.drawCalls }}</b></div>
            <div><span>光源</span><b>{{ stats.lights }}</b></div>
            <div><span>隐藏节点</span><b>{{ stats.hidden }}</b></div>
            <div><span>线框</span><b>{{ state?.wireframe ? '开' : '关' }}</b></div>
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
            <span class="c">{{ roofLabel }}</span>
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
      </div>
    </template>

    <!-- -------------------------------------------------------------- nodes -->
    <template v-else-if="tab === 'nodes'">
      <div v-if="!state?.tree" class="blank"><p>生成方案后可查看模型节点树。</p></div>
      <template v-else>
        <div class="node-tools">
          <button :disabled="!state.canUndo" title="撤销上一步节点操作" @click="undo">↶</button>
          <button :disabled="!state.canRedo" title="重做" @click="redo">↷</button>
          <button title="恢复被删除的节点" @click="reset">恢复</button>
          <span class="count">{{ stats.hidden ? `${stats.hidden} 个已隐藏` : `${fmt(stats.triangles)} 面` }}</span>
        </div>

        <div v-if="selected" class="inspector">
          <div class="ihead">
            <strong>{{ selected.label }}</strong>
            <span class="itype">{{ typeLabel(selected.type) }}</span>
          </div>
          <div class="igrid">
            <div><span>尺寸 (m)</span><b>{{ selected.size.x }} × {{ selected.size.y }} × {{ selected.size.z }}</b></div>
            <div><span>三角面</span><b>{{ fmt(selected.triangles) }}</b></div>
            <div><span>子节点</span><b>{{ selected.children }}</b></div>
            <div><span>楼层</span><b>{{ selected.level ? `L${selected.level}` : '—' }}</b></div>
          </div>
          <div v-if="selected.materials.length" class="imats">
            <span v-for="m in selected.materials" :key="m">{{ m }}</span>
          </div>
          <div class="iactions">
            <button v-if="selected.visible" class="danger" @click="removeSelected">删除该节点</button>
            <button v-else @click="restoreSelected">恢复该节点</button>
            <button @click="clearSelection">取消选中</button>
          </div>
        </div>

        <ul class="tree">
          <li
            v-for="r in rows"
            :key="r.id"
            :class="{ sel: selected?.id === r.id, off: !r.visible }"
            :style="{ paddingLeft: `${8 + r.depth * 12}px` }"
          >
            <button v-if="r.children.length" class="caret" @click="toggleOpen(r.id)">{{ isOpen(r.id) ? '▾' : '▸' }}</button>
            <span v-else class="caret ghost"></span>
            <button class="nlabel" :title="r.id" @click="select(r.id)">{{ r.label }}</button>
            <em v-if="r.children.length" class="nkids">{{ r.children.length }}</em>
            <button class="eye" :title="r.visible ? '隐藏节点' : '恢复显示'" @click="toggleVisible(r)">{{ r.visible ? '◉' : '○' }}</button>
            <button class="del" title="删除节点（可撤销）" @click="remove(r)">✕</button>
          </li>
        </ul>
      </template>
    </template>

    <!-- ------------------------------------------------------------- light -->
    <template v-else>
      <div class="scroll">
      <div class="section first">
        <div class="section-head"><h3>时间预设</h3></div>
        <div class="seg">
          <button v-for="t in times" :key="t.key" :class="{ on: light.time === t.key }" @click="setTime(t.key)">{{ t.label }}</button>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <h3>太阳</h3>
          <span class="count">{{ Math.round(light.azimuth) }}° / {{ Math.round(light.altitude) }}°</span>
        </div>
        <label class="slider-row">
          <span>方位角</span>
          <input type="range" min="0" max="360" step="1" :value="light.azimuth" @input="setLight('azimuth', $event)" />
          <b>{{ Math.round(light.azimuth) }}°</b>
        </label>
        <label class="slider-row">
          <span>高度角</span>
          <input type="range" min="3" max="88" step="1" :value="light.altitude" @input="setLight('altitude', $event)" />
          <b>{{ Math.round(light.altitude) }}°</b>
        </label>
        <label class="slider-row">
          <span>强度</span>
          <input type="range" min="0" max="6" step="0.05" :value="light.sunIntensity" @input="setLight('sunIntensity', $event)" />
          <b>{{ Number(light.sunIntensity).toFixed(2) }}</b>
        </label>
      </div>

      <div class="section">
        <div class="section-head"><h3>环境与补光</h3></div>
        <label class="slider-row">
          <span>天光</span>
          <input type="range" min="0" max="1.6" step="0.02" :value="light.hemiIntensity" @input="setLight('hemiIntensity', $event)" />
          <b>{{ Number(light.hemiIntensity).toFixed(2) }}</b>
        </label>
        <label class="slider-row">
          <span>补光</span>
          <input type="range" min="0" max="1.5" step="0.02" :value="light.fill" @input="setLight('fill', $event)" />
          <b>{{ Number(light.fill).toFixed(2) }}</b>
        </label>
        <label class="slider-row">
          <span>环境贴图</span>
          <input type="range" min="0" max="1.5" step="0.02" :value="light.env" @input="setLight('env', $event)" />
          <b>{{ Number(light.env).toFixed(2) }}</b>
        </label>
        <label class="slider-row">
          <span>曝光</span>
          <input type="range" min="0.4" max="2" step="0.02" :value="light.exposure" @input="setLight('exposure', $event)" />
          <b>{{ Number(light.exposure).toFixed(2) }}</b>
        </label>
      </div>

      <div class="section">
        <div class="section-head"><h3>阴影 / 室内</h3></div>
        <div class="seg small">
          <button v-for="s in shadowModes" :key="s.key" :class="{ on: light.shadows === s.key }" @click="setLight('shadows', s.key)">{{ s.label }}</button>
        </div>
        <button class="toggle-line" :class="{ on: light.interior }" @click="setLight('interior', !light.interior)">
          <span>夜间室内灯</span>
          <b>{{ light.interior ? '开' : '关' }}</b>
        </button>
        <button class="toggle-line" :class="{ on: state?.wireframe }" @click="toggleWire">
          <span>线框显示</span>
          <b>{{ state?.wireframe ? '开' : '关' }}</b>
        </button>
      </div>

      <div class="section">
        <button class="wide-btn" @click="resetLight">回到当前时段默认光照</button>
      </div>
      </div>
    </template>
  </aside>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';

const props = defineProps({
  spec: { type: Object, default: null },
  viewer: { type: Object, default: null },
});

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('zh-CN'));
const pct = (v) => `${Math.round((v || 0) * 100)}%`;

const tab = ref('metrics');
const state = ref(null);
const selected = ref(null);
const open = reactive({});
const light = reactive({
  time: 'day', azimuth: 145, altitude: 46, sunIntensity: 2.15,
  hemiIntensity: 0.52, fill: 0.4, env: 0.72, exposure: 0.96,
  shadows: 'soft', interior: false,
});

const FACADE_LABEL = { punched: '点式开洞', ribbon: '水平条窗', curtain: '玻璃幕墙', screen: '竖向内凹格栅' };
const ROOF_LABEL = { flat: '平屋顶', gable: '双坡屋顶', shed: '单坡屋顶', hip: '四坡屋顶' };
const facadeLabel = computed(() => (props.spec ? FACADE_LABEL[props.spec.facade.system] || props.spec.facade.system : ''));
const roofLabel = computed(() => (props.spec ? ROOF_LABEL[props.spec.massing.roof.type] || props.spec.massing.roof.type : ''));

const title = computed(() => ({ metrics: '方案指标', nodes: '模型节点', light: '光照与环境' }[tab.value]));
const verdict = computed(() => props.spec?.checkSummary?.verdict || '');
const verdictClass = computed(() => {
  const s = props.spec?.checkSummary;
  if (!s) return '';
  return s.fail ? 'bad' : 'ok';
});
const stats = computed(() => state.value?.stats || { nodes: 0, meshes: 0, triangles: 0, materials: 0, drawCalls: 0, lights: 0, hidden: 0 });

const times = [
  { key: 'day', label: '日' },
  { key: 'dusk', label: '黄昏' },
  { key: 'night', label: '夜' },
];
const shadowModes = [
  { key: 'off', label: '关' },
  { key: 'soft', label: '柔和' },
  { key: 'high', label: '高精度' },
];

const rows = computed(() => {
  const list = [];
  const walk = (node, depth) => {
    list.push({ ...node, depth });
    if (!node.children.length) return;
    if (!isOpen(node.id, depth)) return;
    node.children.forEach((c) => walk(c, depth + 1));
  };
  if (state.value?.tree) walk(state.value.tree, 0);
  return list;
});

function isOpen(id, depth = 0) {
  if (open[id] !== undefined) return open[id];
  return depth <= 1;
}

function toggleOpen(id) {
  open[id] = !isOpen(id, 1);
}

function sync() {
  if (!props.viewer) return;
  const s = props.viewer.getState();
  state.value = s;
  Object.assign(light, s.lighting);
  if (selected.value) selected.value = props.viewer.getNodeInfo(selected.value.id);
}

watch(
  () => props.viewer,
  (v) => {
    if (!v) return;
    v.onChange = (s) => { state.value = s; Object.assign(light, s.lighting); };
    v.onPick = (id) => select(id);
    v.onLighting = (l) => Object.assign(light, l);
    sync();
  },
  { immediate: true },
);

watch(() => props.spec, () => setTimeout(sync, 80));
onMounted(() => setTimeout(sync, 150));

function typeLabel(t) {
  return ({ group: '组', mesh: '网格', sprite: '标注' })[t] || t;
}

function select(id) {
  if (!props.viewer) return;
  const info = props.viewer.selectNode(id);
  selected.value = info;
  if (info) {
    tab.value = 'nodes';
    // expand the selected node and its ancestors so the row stays visible
    if (info.children) open[id] = true;
    let node = props.viewer.getNode(id);
    while (node?.parent) {
      open[node.parent.id] = true;
      node = node.parent;
    }
  }
}

function clearSelection() {
  props.viewer?.clearSelection();
  selected.value = null;
}

function remove(row) {
  props.viewer?.deleteNode(row.id);
  sync();
}

function removeSelected() {
  if (!selected.value) return;
  props.viewer.deleteNode(selected.value.id);
  selected.value = props.viewer.getNodeInfo(selected.value.id);
  sync();
}

function restoreSelected() {
  if (!selected.value) return;
  props.viewer.restoreNode(selected.value.id);
  selected.value = props.viewer.getNodeInfo(selected.value.id);
  sync();
}

function toggleVisible(row) {
  if (!props.viewer) return;
  if (row.visible) props.viewer.deleteNode(row.id);
  else props.viewer.restoreNode(row.id);
  sync();
}

function undo() {
  props.viewer?.undo();
  sync();
}

function redo() {
  props.viewer?.redo();
  sync();
}

function reset() {
  props.viewer?.resetEdits();
  selected.value = null;
  sync();
}

function toggleWire() {
  if (!props.viewer) return;
  props.viewer.setOption('wireframe', !props.viewer.options.wireframe);
  sync();
}

function setTime(t) {
  props.viewer?.setLighting({ time: t });
  sync();
}

function setLight(key, ev) {
  let value = ev;
  if (ev && ev.target) {
    value = ev.target.type === 'range' ? Number(ev.target.value) : ev.target.value;
  }
  props.viewer?.setLighting({ [key]: value });
  sync();
}

function resetLight() {
  props.viewer?.setLighting({ time: light.time });
  sync();
}
</script>

<style scoped>
.panel {
  background: var(--panel);
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 12px 14px 8px; border-bottom: 1px solid var(--line); flex: 0 0 auto;
}
.panel-head h2 { margin: 0; font-size: 13.5px; font-weight: 600; white-space: nowrap; }
.tag {
  font-size: 9.5px; padding: 2px 7px; border-radius: 999px;
  border: 1px solid rgba(95, 191, 139, 0.35); color: #9fe0bd;
  max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tag.bad { border-color: rgba(226, 121, 97, 0.4); color: #e8a596; }

.tabs { display: flex; gap: 2px; padding: 0 10px; border-bottom: 1px solid var(--line); flex: 0 0 auto; }
.tabs button {
  flex: 1; font-size: 11.5px; padding: 7px 0; color: #7f8d9c;
  border-bottom: 2px solid transparent; display: flex; align-items: center; justify-content: center; gap: 5px;
}
.tabs button.on { color: #eef2f6; border-bottom-color: var(--accent); }
.tabs em { font-style: normal; font-size: 9.5px; color: #6f7d8b; }

.scroll { min-height: 0; overflow-y: auto; }
.blank { padding: 20px 16px; color: var(--muted); font-size: 12px; line-height: 1.7; }

.metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line); border-bottom: 1px solid var(--line); }
.metric { background: #131922; padding: 11px 13px; display: flex; flex-direction: column; gap: 2px; }
.metric.wide { grid-column: span 2; }
.label { font-size: 10.5px; letter-spacing: 0.08em; color: #788594; }
.metric strong { font-size: 21px; font-weight: 600; color: #eef3f8; font-variant-numeric: tabular-nums; }
.metric strong em { font-size: 11px; font-style: normal; color: #8b98a6; margin-left: 3px; font-weight: 400; }
.sub { font-size: 10.5px; color: #6f7d8b; }

.section { padding: 12px 14px; border-bottom: 1px solid var(--line); }
.section.first { padding-top: 14px; }
.section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
.section-head h3 { margin: 0; font-size: 11.5px; letter-spacing: 0.06em; color: #b9c6d3; font-weight: 600; }
.count { font-size: 10px; color: #6f7d8b; font-variant-numeric: tabular-nums; }

.stat-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
.stat-grid div { display: flex; flex-direction: column; gap: 1px; }
.stat-grid span { font-size: 9.5px; color: #6f7d8b; }
.stat-grid b { font-size: 12px; color: #aebbc9; font-weight: 500; font-variant-numeric: tabular-nums; }

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
  font-size: 10.5px; padding: 4px 8px; border-radius: 6px;
  border: 1px solid #26313e; background: #131922; color: #a7b4c1;
  font-family: ui-monospace, "SF Mono", monospace;
}

.notes { margin: 0; padding-left: 15px; display: flex; flex-direction: column; gap: 7px; }
.notes li { font-size: 11px; line-height: 1.65; color: #8b98a6; }

/* ---------------------------------------------------------- node inspector */
.node-tools { display: flex; gap: 5px; align-items: center; padding: 9px 12px; border-bottom: 1px solid var(--line); flex-wrap: nowrap; }
.node-tools button {
  font-size: 11px; padding: 3px 8px; border-radius: 6px;
  border: 1px solid #2c3745; color: #a9b7c5; flex: 0 0 auto;
}
.node-tools button:disabled { opacity: 0.4; cursor: not-allowed; }
.node-tools .count { margin-left: auto; font-size: 10px; color: #6f7d8b; }

.inspector { padding: 10px 12px; border-bottom: 1px solid var(--line); background: #111823; }
.ihead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ihead strong { font-size: 12.5px; }
.itype { font-size: 9.5px; color: #1a1409; background: rgba(213, 163, 92, 0.85); border-radius: 999px; padding: 1px 7px; }
.igrid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; margin-top: 8px; }
.igrid div { display: flex; flex-direction: column; gap: 1px; }
.igrid span { font-size: 9.5px; color: #6f7d8b; }
.igrid b { font-size: 11px; color: #b3c0cd; font-weight: 500; font-variant-numeric: tabular-nums; }
.imats { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.imats span { font-size: 9.5px; color: #8fa0b1; border: 1px solid #26313e; border-radius: 4px; padding: 1px 5px; }
.iactions { display: flex; gap: 6px; margin-top: 9px; }
.iactions button { font-size: 10.5px; padding: 4px 9px; border-radius: 6px; border: 1px solid #2c3745; color: #a9b7c5; }
.iactions button.danger { border-color: rgba(226, 121, 97, 0.35); color: #e0a093; }

.tree { list-style: none; margin: 0; padding: 6px 0 18px; overflow-y: auto; flex: 1; min-height: 0; }
.tree li { display: flex; align-items: center; gap: 3px; padding-right: 8px; min-height: 24px; }
.tree li.sel { background: rgba(213, 163, 92, 0.12); }
.tree li.off .nlabel { color: #5f6b78; text-decoration: line-through; }
.caret { width: 14px; font-size: 9px; color: #8fa0b1; flex: 0 0 auto; }
.caret.ghost { visibility: hidden; }
.nlabel {
  flex: 1; min-width: 0; text-align: left; font-size: 11px; color: #c3d0dc;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 0;
}
.nlabel:hover { color: #f1e4cd; }
.nkids { font-style: normal; font-size: 9px; color: #66727f; }
.eye { font-size: 10px; color: #8fa0b1; padding: 0 2px; flex: 0 0 auto; }
.tree li.off .eye { color: #5f6b78; }
.del { font-size: 10px; color: #6f7d8b; padding: 0 2px; flex: 0 0 auto; }
.del:hover { color: #e0a093; }

/* ------------------------------------------------------------------ light */
.seg { display: flex; gap: 2px; padding: 3px; border-radius: 8px; background: #131922; border: 1px solid var(--line); }
.seg button { flex: 1; font-size: 11px; padding: 4px 0; border-radius: 6px; color: #8fa0b1; }
.seg button.on { background: rgba(213, 163, 92, 0.18); color: #f1e4cd; }
.seg.small button { font-size: 10.5px; }

.slider-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 10.5px; color: #8fa0b1; }
.slider-row span { flex: 0 0 42px; }
.slider-row input { flex: 1; accent-color: #d5a35c; height: 3px; }
.slider-row b { flex: 0 0 38px; text-align: right; font-size: 10px; color: #b7c3cf; font-weight: 500; font-variant-numeric: tabular-nums; }

.toggle-line {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  margin-top: 8px; padding: 6px 9px; border-radius: 7px;
  border: 1px solid #2c3745; color: #8fa0b1; font-size: 11px;
}
.toggle-line.on { border-color: rgba(213, 163, 92, 0.5); color: #f1e4cd; background: rgba(213, 163, 92, 0.12); }
.toggle-line b { font-weight: 500; }
.wide-btn {
  width: 100%; font-size: 11px; padding: 7px; border-radius: 7px;
  border: 1px solid var(--line); color: #a9b7c5;
}
.wide-btn:hover { color: var(--text); border-color: #3a4757; }
</style>
