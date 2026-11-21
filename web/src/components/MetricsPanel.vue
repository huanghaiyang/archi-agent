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
      <button :class="{ on: tab === 'section' }" @click="tab = 'section'">剖切</button>
      <button :class="{ on: tab === 'interior' }" @click="tab = 'interior'">内部</button>
    </div>

    <!-- ------------------------------------------------------------ metrics -->
    <template v-if="tab === 'metrics'">
      <div class="scroll">
      <div v-if="!spec" class="blank">
        <p>生成方案后，这里会显示面积、容积率、窗地比与规范校核结果。</p>
      </div>

      <template v-else>
        <div class="metric-grid">
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
          <div class="metric tail">
            <span class="label">房间 / 造价</span>
            <strong>{{ spec.metrics.roomCount }}<em>间</em><i>·</i>约 {{ (spec.metrics.costEstimate / 10000).toFixed(0) }}<em>万元</em></strong>
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
          <div class="nt-group">
            <button :disabled="!state.canUndo" title="撤销上一步节点操作" @click="undo">↶ 撤销</button>
            <button :disabled="!state.canRedo" title="重做" @click="redo">↷ 重做</button>
            <button title="恢复所有被删除的节点" @click="reset">恢复</button>
          </div>
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
            <span v-for="m in selected.materials.slice(0, 6)" :key="m">{{ m }}</span>
            <span v-if="selected.materials.length > 6" class="more">+{{ selected.materials.length - 6 }}</span>
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

    <!-- ------------------------------------------------------------ section -->
    <template v-else-if="tab === 'section'">
      <div class="scroll">
        <div v-if="!spec" class="blank"><p>生成方案后可按 X / Y / Z 任意方向剖切模型，查看内部空间与构造层次。</p></div>

        <template v-else>
          <div class="section first">
            <button class="toggle-line" :class="{ on: section.enabled }" @click="setSection('enabled', !section.enabled)">
              <span>开启剖切</span>
              <b>{{ section.enabled ? '开' : '关' }}</b>
            </button>
            <p class="hint">剖切只作用于建筑主体，场地与周边体量保持完整，便于对照环境。</p>
          </div>

          <div class="section">
            <div class="section-head"><h3>剖切方向</h3></div>
            <div class="seg">
              <button v-for="a in axes" :key="a.key" :class="{ on: section.axis === a.key }" @click="setSection('axis', a.key)">{{ a.label }}</button>
            </div>
            <label v-if="section.axis === 'angle'" class="slider-row wide-label">
              <span>角度</span>
              <input type="range" min="0" max="360" step="1" :value="section.angle" @input="setSection('angle', Number($event.target.value))" />
              <b>{{ Math.round(section.angle) }}°</b>
            </label>
            <div class="seg small" style="margin-top: 8px">
              <button :class="{ on: !section.flip }" @click="setSection('flip', false)">正向 +</button>
              <button :class="{ on: section.flip }" @click="setSection('flip', true)">反向 −</button>
            </div>
            <p class="hint">正向保留法线一侧，反向保留另一侧；Y 向正向为下部，反向为上部。</p>
            <button class="wide-btn draw-btn" :class="{ on: section.drawMode }" @click="toggleDraw">{{ section.drawMode ? '取消划线（再点两下）' : '划线定角（在场地点两下）' }}</button>
          </div>

          <div class="section">
            <div class="section-head">
              <h3>剖切位置</h3>
              <span class="count">{{ section.position }} m</span>
            </div>
            <label class="slider-row wide-label">
              <span>位置</span>
              <input type="range" min="0" max="100" step="1" :value="section.offset" @input="setSection('offset', Number($event.target.value))" />
              <b>{{ Math.round(section.offset) }}%</b>
            </label>
            <div class="quick-row">
              <button v-for="q in quickCuts" :key="q" @click="setSection('offset', q)">{{ q }}%</button>
            </div>
            <div class="side-note">{{ cutSideLabel }}</div>
          </div>

          <div class="section">
            <div class="section-head"><h3>剖切面显示</h3></div>
            <button class="toggle-line" :class="{ on: section.cap }" @click="setSection('cap', !section.cap)">
              <span>半透明剖切面</span>
              <b>{{ section.cap ? '显示' : '隐藏' }}</b>
            </button>
            <p class="hint">橙色薄面标出切割位置；在舞台上直接拖动该切面即可移动剖切，不重建模型。</p>
          </div>

          <div class="section">
            <button class="wide-btn" @click="resetSection">复位剖切（50% · 关闭）</button>
          </div>
        </template>
      </div>
    </template>

    <!-- ----------------------------------------------------------- interior -->
    <template v-else-if="tab === 'interior'">
      <div class="scroll">
        <div v-if="!spec" class="blank"><p>生成方案后可在不剖切的情况下剥离外墙，查看内部家具、楼梯与灯具，并运行楼层联通性测试。</p></div>

        <template v-else>
          <div class="section first">
            <div class="section-head"><h3>内部查看</h3></div>
            <button class="toggle-line" :class="{ on: peel }" @click="toggleInterior('peel')">
              <span>剥离外墙 / 屋面</span>
              <b>{{ peel ? '已剥离' : '完整外壳' }}</b>
            </button>
            <button class="toggle-line" :class="{ on: glow }" @click="toggleInterior('glow')">
              <span>内部灯具发光</span>
              <b>{{ glow ? '开' : '关' }}</b>
            </button>
            <p class="hint">剥离后保留楼板、隔墙、家具与楼梯；灯具使用自发光材质，可与日/夜光照叠加。</p>
          </div>

          <div class="section">
            <div class="section-head">
              <h3>楼层联通性测试</h3>
              <span class="count">{{ connectivity.points }} 个路径点</span>
            </div>
            <div class="progress" :class="{ live: connectivity.active }">
              <i :style="{ width: `${connectivity.progress || 0}%` }"></i>
            </div>
            <div class="conn-meta">
              <span>{{ connectivity.active ? '小球滚动中' : connectivity.progress >= 100 ? '已到达顶层' : '待运行' }}</span>
              <b>{{ Math.round(connectivity.progress || 0) }}%</b>
            </div>
            <div class="quick-row">
              <button class="primary" @click="runConnectivity">{{ connectivity.active ? '重新运行' : '运行小球' }}</button>
              <button @click="resetConnectivity">清除</button>
            </div>
            <p class="hint">小球从入口进入，沿首层走廊到达楼梯，逐层滚到最顶层；橙色管道为完整路径，可穿透墙体显示。</p>
          </div>

          <div class="section">
            <div class="section-head"><h3>提示</h3></div>
            <p class="hint">配合「剖切」页签的 Y 向剖切，可从上方观察小球的楼层路径；开启「剥离外墙」效果更直观。</p>
          </div>
        </template>
      </div>
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
const section = reactive({
  enabled: false, axis: 'z', offset: 50, flip: false, cap: true, angle: 0, drawMode: false,
  position: 0,
});
const axes = [
  { key: 'x', label: '横剖 X' },
  { key: 'y', label: '水平 Y' },
  { key: 'z', label: '纵剖 Z' },
  { key: 'angle', label: '斜剖' },
];
const quickCuts = [25, 50, 75];
const peel = ref(false);
const glow = ref(false);
const connectivity = reactive({ active: false, progress: 0, points: 0, duration: 0, hasPath: false });
const cutSideLabel = computed(() => {
  if (section.axis === 'y') return section.flip ? '保留上部楼层' : '保留下部楼层';
  if (section.axis === 'angle') return `保留 ${section.flip ? '反向' : '正向'} · ${Math.round(section.angle)}°`;
  return `保留 ${section.flip ? '-' : '+'}${String(section.axis).toUpperCase()} 侧`;
});

const FACADE_LABEL = { punched: '点式开洞', ribbon: '水平条窗', curtain: '玻璃幕墙', screen: '竖向内凹格栅' };
const ROOF_LABEL = { flat: '平屋顶', gable: '双坡屋顶', shed: '单坡屋顶', hip: '四坡屋顶' };
const facadeLabel = computed(() => (props.spec ? FACADE_LABEL[props.spec.facade.system] || props.spec.facade.system : ''));
const roofLabel = computed(() => (props.spec ? ROOF_LABEL[props.spec.massing.roof.type] || props.spec.massing.roof.type : ''));

const title = computed(() => ({ metrics: '方案指标', nodes: '模型节点', light: '光照与环境', section: '剖切展示', interior: '内部与联通' }[tab.value]));
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
  if (s.section) Object.assign(section, s.section);
  peel.value = Boolean(s.peel);
  glow.value = Boolean(s.glow);
  if (s.connectivity) Object.assign(connectivity, s.connectivity);
  if (selected.value) selected.value = props.viewer.getNodeInfo(selected.value.id);
}

watch(
  () => props.viewer,
  (v) => {
    if (!v) return;
    v.onChange = (s) => {
      state.value = s;
      Object.assign(light, s.lighting);
      if (s.section) Object.assign(section, s.section);
      peel.value = Boolean(s.peel);
      glow.value = Boolean(s.glow);
      if (s.connectivity) Object.assign(connectivity, s.connectivity);
    };
    v.onPick = (id) => select(id);
    v.onLighting = (l) => Object.assign(light, l);
    v.onConnectivity = (c) => Object.assign(connectivity, c);
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

function setSection(key, value) {
  if (!props.viewer) return;
  props.viewer.setSection({ [key]: value });
  sync();
}

function resetSection() {
  props.viewer?.setSection({ enabled: false, axis: 'z', offset: 50, flip: false, cap: true, angle: 0, drawMode: false });
  sync();
}

function toggleDraw() {
  if (!props.viewer) return;
  if (section.drawMode) props.viewer.cancelSectionDraw();
  else props.viewer.beginSectionDraw();
  sync();
}

function toggleInterior(key) {
  if (!props.viewer) return;
  props.viewer.setOption(key, !props.viewer.options[key]);
  sync();
}

function runConnectivity() {
  props.viewer?.runConnectivity();
  sync();
}

function resetConnectivity() {
  props.viewer?.resetConnectivity();
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
  font-size: 12px;
}

/* ------------------------------------------------------------- head + tabs */
.panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 13px 14px 11px; flex: 0 0 auto;
}
.panel-head h2 {
  margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.02em;
  color: #e8eef5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tag {
  flex: 0 0 auto; font-size: 9.5px; line-height: 16px; padding: 0 8px; border-radius: 999px;
  border: 1px solid rgba(95, 191, 139, 0.35); color: #9fe0bd; background: rgba(95, 191, 139, 0.08);
  max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tag.bad { border-color: rgba(226, 121, 97, 0.4); color: #e8a596; background: rgba(226, 121, 97, 0.08); }

.tabs {
  display: flex; gap: 2px; padding: 0 6px 7px; flex: 0 0 auto;
  border-bottom: 1px solid var(--line);
}
.tabs button {
  flex: 1 1 0; min-width: 0; height: 30px; border-radius: 7px;
  display: flex; align-items: center; justify-content: center; gap: 3px;
  font-size: 10.5px; color: #8493a2; background: #171e28; border: 1px solid transparent;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.tabs button:hover { color: #cdd9e5; background: #1b232e; }
.tabs button.on {
  color: #f2e6d2; background: rgba(213, 163, 92, 0.13);
  border-color: rgba(213, 163, 92, 0.32);
}
.tabs em {
  font-style: normal; font-size: 9px; line-height: 13px; padding: 0 4px; border-radius: 999px;
  color: #8b98a6; background: #222b37; min-width: 16px; text-align: center;
}
.tabs button.on em { color: #f1e4cd; background: rgba(213, 163, 92, 0.22); }

/* --------------------------------------------------------------- scrollers */
.scroll, .tree { min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #2b3745 transparent; }
.scroll::-webkit-scrollbar, .tree::-webkit-scrollbar { width: 7px; }
.scroll::-webkit-scrollbar-thumb, .tree::-webkit-scrollbar-thumb { background: #2b3745; border-radius: 4px; }
.blank { padding: 22px 16px; color: var(--muted); font-size: 12px; line-height: 1.75; }

/* ----------------------------------------------------------------- metrics */
.metric-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  padding: 12px; border-bottom: 1px solid var(--line);
}
.metric {
  display: flex; flex-direction: column; gap: 3px; min-width: 0;
  padding: 10px 11px; border-radius: 9px;
  background: #171e28; border: 1px solid #232d3a;
}
.metric.wide {
  grid-column: span 2; background: linear-gradient(180deg, #1a222d, #161d26);
  border-color: #2a3542;
}
.label { font-size: 10px; letter-spacing: 0.06em; color: #7c8997; }
.metric strong {
  font-size: 18px; line-height: 1.2; font-weight: 600; color: #e9eff6;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.metric.wide strong { font-size: 23px; color: #f0e3cc; }
.metric.tail {
  grid-column: span 2; flex-direction: row; align-items: center;
  justify-content: space-between; gap: 10px;
}
.metric.tail .label { white-space: nowrap; }
.metric.tail strong { font-size: 13.5px; color: #dbe4ee; }
.metric.tail strong i { font-style: normal; font-size: 10px; color: #5f6b78; margin: 0 5px; }
.metric strong em { font-size: 10.5px; font-style: normal; font-weight: 400; color: #8b98a6; margin-left: 3px; }
.sub { font-size: 10px; color: #6f7d8b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ---------------------------------------------------------------- sections */
.section { padding: 13px 14px; border-bottom: 1px solid var(--line); }
.section.first { padding-top: 14px; }
.section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 9px; }
.section-head h3 { margin: 0; font-size: 11px; letter-spacing: 0.08em; color: #aab7c5; font-weight: 600; }
.count { font-size: 9.5px; color: #6f7d8b; font-variant-numeric: tabular-nums; white-space: nowrap; }

.stat-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 6px;
  padding: 10px; border-radius: 9px; background: #151c25; border: 1px solid #222c38;
}
.stat-grid div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.stat-grid span { font-size: 9.5px; color: #6f7d8b; }
.stat-grid b { font-size: 12.5px; color: #b7c3d0; font-weight: 500; font-variant-numeric: tabular-nums; }

.checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.checks li { display: flex; gap: 8px; align-items: flex-start; }
.dot { width: 6px; height: 6px; border-radius: 50%; margin-top: 5px; flex: 0 0 auto; background: var(--ok); }
.checks li.warn .dot { background: var(--warn); }
.checks li.fail .dot { background: var(--fail); }
.cbody { flex: 1; min-width: 0; }
.cline { display: flex; justify-content: space-between; gap: 8px; }
.cname { font-size: 11.5px; color: #ccd7e3; }
.cvalue { font-size: 10px; color: #7f8d9c; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cbody p { margin: 2px 0 0; font-size: 10.5px; line-height: 1.55; color: #75828f; }

table.floors { width: 100%; border-collapse: collapse; font-size: 10.5px; color: #a9b6c3; }
table.floors th {
  text-align: left; color: #6f7d8b; font-weight: 500; padding: 3px 0 5px;
  border-bottom: 1px solid #232d3a;
}
table.floors td {
  padding: 5px 0; font-variant-numeric: tabular-nums;
  border-bottom: 1px solid #1b232e;
}
table.floors tr:last-child td { border-bottom: 0; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips .c {
  font-size: 10px; padding: 4px 8px; border-radius: 6px;
  border: 1px solid #26313e; background: #151c25; color: #a7b4c1;
  font-family: ui-monospace, "SF Mono", monospace;
}

.notes { margin: 0; padding-left: 15px; display: flex; flex-direction: column; gap: 7px; }
.notes li { font-size: 11px; line-height: 1.65; color: #8b98a6; }

/* ---------------------------------------------------------- node inspector */
.node-tools {
  display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
  padding: 8px 10px; border-bottom: 1px solid var(--line); background: #131a23;
}
.nt-group { display: flex; gap: 4px; min-width: 0; }
.node-tools button {
  font-size: 10.5px; line-height: 20px; padding: 0 8px; border-radius: 6px;
  border: 1px solid #2c3745; color: #a9b7c5; background: #171e28; white-space: nowrap;
}
.node-tools button:hover:not(:disabled) { color: #f1e4cd; border-color: rgba(213, 163, 92, 0.45); }
.node-tools button:disabled { opacity: 0.38; cursor: not-allowed; }
.node-tools .count { margin-left: auto; font-size: 9.5px; color: #6f7d8b; white-space: nowrap; }

.inspector {
  margin: 10px 10px 2px; padding: 10px 11px; border-radius: 10px;
  background: linear-gradient(180deg, #18212c, #131a23);
  border: 1px solid #2a3542; flex: 0 0 auto;
}
.ihead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ihead strong { font-size: 12.5px; color: #eef3f8; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.itype {
  flex: 0 0 auto; font-size: 9px; line-height: 15px; padding: 0 7px; border-radius: 999px;
  color: #f2e4cd; background: rgba(213, 163, 92, 0.22); border: 1px solid rgba(213, 163, 92, 0.38);
}
.igrid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 10px; margin-top: 9px; }
.igrid div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.igrid span { font-size: 9.5px; color: #6f7d8b; }
.igrid b { font-size: 11px; color: #b3c0cd; font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.imats { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 9px; }
.imats span {
  font-size: 9px; color: #8fa0b1; border: 1px solid #26313e; border-radius: 4px;
  padding: 1px 5px; background: #151c25;
}
.imats .more { color: #d5a35c; border-color: rgba(213, 163, 92, 0.3); }
.iactions { display: flex; gap: 6px; margin-top: 9px; }
.iactions button {
  flex: 1 1 0; font-size: 10px; line-height: 22px; padding: 0 8px; border-radius: 6px;
  border: 1px solid #2c3745; color: #a9b7c5; background: #171e28;
}
.iactions button:hover { color: #eef3f8; border-color: #3a4757; }
.iactions button.danger { border-color: rgba(226, 121, 97, 0.32); color: #e0a093; }
.iactions button.danger:hover { border-color: rgba(226, 121, 97, 0.6); color: #f1b2a4; }

.tree { list-style: none; margin: 0; padding: 4px 6px 20px; flex: 1 1 auto; }
.tree li {
  display: flex; align-items: center; gap: 1px; min-height: 26px;
  padding-right: 6px; border-radius: 6px;
}
.tree li:hover { background: #182029; }
.tree li.sel { background: rgba(213, 163, 92, 0.11); box-shadow: inset 2px 0 0 var(--accent); }
.tree li.off .nlabel { color: #5f6b78; text-decoration: line-through; }
.caret {
  width: 15px; height: 20px; flex: 0 0 auto; font-size: 9px; line-height: 20px;
  color: #8fa0b1; text-align: center; border-radius: 4px;
}
.caret:hover { color: #f1e4cd; }
.caret.ghost { visibility: hidden; }
.nlabel {
  flex: 1 1 auto; min-width: 0; text-align: left; font-size: 11.5px; line-height: 22px;
  color: #c3d0dc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 0 2px; border-radius: 4px;
}
.nlabel:hover { color: #f1e4cd; }
.nkids { flex: 0 0 auto; font-style: normal; font-size: 8.5px; color: #5f6b78; padding: 0 2px; }
.eye, .del {
  width: 18px; height: 18px; flex: 0 0 auto; border-radius: 4px;
  font-size: 10px; line-height: 18px; color: #8fa0b1; opacity: 0.5;
}
.tree li:hover .eye, .tree li:hover .del, .tree li.off .eye, .tree li.sel .eye { opacity: 1; }
.eye:hover { color: #f1e4cd; background: #222b37; }
.del:hover { color: #e0a093; background: rgba(226, 121, 97, 0.12); }

/* ------------------------------------------------------------------ light */
.seg {
  display: flex; gap: 3px; padding: 3px; border-radius: 8px;
  background: #131922; border: 1px solid #232d3a;
}
.seg button {
  flex: 1 1 0; height: 26px; border-radius: 6px;
  font-size: 11px; color: #8fa0b1;
}
.seg button:hover { color: #dbe4ee; }
.seg button.on {
  background: rgba(213, 163, 92, 0.18); color: #f1e4cd;
  box-shadow: inset 0 0 0 1px rgba(213, 163, 92, 0.22);
}
.seg.small button { font-size: 10.5px; }

.slider-row {
  display: grid; grid-template-columns: 48px minmax(0, 1fr) 44px; align-items: center;
  gap: 8px; margin-top: 9px; font-size: 10.5px; color: #8fa0b1;
}
.slider-row span { white-space: nowrap; }
.slider-row input { width: 100%; min-width: 0; accent-color: #d5a35c; height: 3px; cursor: pointer; }
.slider-row b {
  font-size: 9.5px; font-weight: 500; text-align: center; color: #b7c3cf;
  font-variant-numeric: tabular-nums; background: #1b2430; border-radius: 4px; line-height: 18px;
}

.toggle-line {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  margin-top: 7px; padding: 6px 9px; border-radius: 7px;
  border: 1px solid #2c3745; color: #8fa0b1; font-size: 11px; background: #171e28;
}
.toggle-line:hover { border-color: #3a4757; color: #cdd9e5; }
.toggle-line.on {
  border-color: rgba(213, 163, 92, 0.5); color: #f1e4cd;
  background: rgba(213, 163, 92, 0.1);
}
.toggle-line b { font-weight: 500; font-size: 10.5px; }
.hint { margin: 9px 0 0; font-size: 10px; line-height: 1.6; color: #6f7d8b; }
.side-note {
  margin-top: 8px; font-size: 10px; color: #b7c3cf; text-align: center;
  border: 1px dashed #2c3745; border-radius: 6px; line-height: 24px; background: #151c25;
}
.draw-btn { margin-top: 9px; }
.draw-btn.on { border-color: rgba(111, 211, 255, 0.5); color: #bfe9ff; background: rgba(111, 211, 255, 0.08); }
.progress {
  height: 7px; border-radius: 999px; background: #131922; border: 1px solid #232d3a; overflow: hidden;
}
.progress i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #d5a35c, #ffd49a); transition: width 0.12s linear; }
.progress.live i { box-shadow: 0 0 10px rgba(255, 196, 112, 0.55); }
.conn-meta { display: flex; justify-content: space-between; margin-top: 6px; font-size: 10px; color: #7d8b99; }
.conn-meta b { color: #d8c3a2; font-weight: 500; font-variant-numeric: tabular-nums; }
.quick-row .primary {
  color: #f2e4cd; border-color: rgba(213, 163, 92, 0.42); background: rgba(213, 163, 92, 0.12);
}
.quick-row { display: flex; gap: 5px; margin-top: 9px; }
.quick-row button {
  flex: 1 1 0; font-size: 10px; line-height: 24px; border-radius: 6px;
  border: 1px solid #2c3745; color: #9fb0c0; background: #171e28;
}
.quick-row button:hover { color: #f1e4cd; border-color: rgba(213, 163, 92, 0.4); }
.slider-row.wide-label { grid-template-columns: 34px minmax(0, 1fr) 40px; }
.wide-btn {
  width: 100%; font-size: 11px; line-height: 30px; border-radius: 7px;
  border: 1px solid var(--line); color: #a9b7c5; background: #171e28;
}
.wide-btn:hover { color: var(--text); border-color: #3a4757; }
</style>
