<template>
  <section class="stage">
    <canvas ref="canvas"></canvas>

    <div v-if="!spec" class="placeholder">
      <div class="ph-card">
        <span class="ph-tag">NO SCHEME YET</span>
        <h3>三维视图待生成</h3>
        <p>在左侧写下任务书，智能体会生成体量、楼层与立面，方案会实时出现在这里。</p>
        <ul>
          <li>程序化生成：楼板 / 墙体 / 门窗 / 楼梯 / 屋面</li>
          <li>指标联动：窗地比、容积率与模型几何同源</li>
          <li>可导出 GLB 进入 Blender / 引擎继续深化</li>
        </ul>
      </div>
    </div>

    <template v-if="spec">
      <div class="overlay top-left">
        <div class="scheme-title">
          <span class="kicker">{{ spec.meta.styleLabel }} · {{ spec.site.width }}×{{ spec.site.depth }}m</span>
          <h3>{{ spec.meta.title }}</h3>
          <p>{{ spec.meta.styleLabel }} · 建筑高度 {{ spec.metrics.height }}m · {{ spec.metrics.roomCount }} 个房间</p>
        </div>
      </div>

      <div class="overlay top-right">
        <div class="seg">
          <button :class="{ on: view === 'iso' }" @click="setView('iso')">轴测</button>
          <button :class="{ on: view === 'front' }" @click="setView('front')">正立面</button>
          <button :class="{ on: view === 'top' }" @click="setView('top')">俯视</button>
        </div>
      </div>

      <div class="overlay bottom-left">
        <div class="toolbar">
          <div class="group">
            <span class="glabel">光线</span>
            <div class="seg small">
              <button :class="{ on: opts.time === 'day' }" @click="setTime('day')">日</button>
              <button :class="{ on: opts.time === 'dusk' }" @click="setTime('dusk')">黄昏</button>
              <button :class="{ on: opts.time === 'night' }" @click="setTime('night')">夜</button>
            </div>
          </div>

          <div class="group">
            <span class="glabel">图层</span>
            <button class="toggle" :class="{ on: opts.roof }" @click="toggle('roof')">屋顶</button>
            <button class="toggle" :class="{ on: opts.labels }" @click="toggle('labels')">房间名</button>
            <button class="toggle" :class="{ on: opts.explode }" @click="toggle('explode')">爆炸</button>
            <button class="toggle" :class="{ on: opts.context }" @click="toggle('context')">周边</button>
            <button class="toggle wire" :class="{ on: opts.wireframe }" @click="toggle('wireframe')">线框</button>
            <button class="toggle" :class="{ on: opts.section }" @click="toggleSection">剖切</button>
            <button class="toggle" :class="{ on: opts.peel }" @click="toggle('peel')">剥离</button>
          </div>

          <div class="group grow">
            <span class="glabel">楼层</span>
            <input
              class="slider"
              type="range"
              min="0"
              :max="spec.floors.length + 1"
              step="1"
              :value="opts.isolate"
              @input="setIsolate(Number($event.target.value))"
            />
            <span class="lvalue">{{ isolateLabel }}</span>
          </div>

          <button class="export" @click="exportGlb">导出 GLB</button>
        </div>
      </div>

      <div class="overlay bottom-right hint">拖拽旋转 · 滚轮缩放 · 右键平移<span v-if="opts.section"> · 拖动橙色切面移动剖切</span></div>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ArchiViewer } from '../scene/ArchiViewer.js';

const props = defineProps({ spec: { type: Object, default: null } });
const emit = defineEmits(['viewer', 'pick']);

const canvas = ref(null);
const view = ref('iso');
const opts = reactive({ roof: true, labels: false, explode: false, context: true, time: 'day', isolate: 0, wireframe: false, section: false, peel: false });
let viewer = null;

onMounted(() => {
  viewer = new ArchiViewer(canvas.value);
  window.__archiViewer = viewer; // handy for debugging / demos in the console
  viewer.onPick = (id) => emit('pick', id);
  // The inspector owns its own onChange slot; subscribe so toolbar toggles
  // mirror panel changes and vice versa.
  viewer.subscribe((s) => {
    opts.wireframe = Boolean(s.wireframe);
    opts.time = s.lighting?.time || opts.time;
    opts.section = Boolean(s.section?.enabled);
    opts.peel = Boolean(s.peel);
  });
  emit('viewer', viewer);
  if (props.spec) applySpec(props.spec);
  viewer.setOption('roof', opts.roof);
  viewer.setOption('labels', opts.labels);
  viewer.setOption('context', opts.context);
  viewer.setOption('time', opts.time);
  viewer.setOption('wireframe', opts.wireframe);
});

watch(
  () => props.spec,
  (next) => {
    if (next) applySpec(next);
  },
);

function applySpec(spec) {
  if (!viewer) return;
  viewer.setSpec(spec);
  viewer.setOption('roof', opts.roof);
  viewer.setOption('labels', opts.labels);
  viewer.setOption('context', opts.context);
  viewer.setOption('time', opts.time);
  viewer.setOption('isolate', opts.isolate);
  viewer.setOption('explode', opts.explode);
  viewer.setOption('wireframe', opts.wireframe);
  viewer.frame(view.value);
}

const isolateLabel = computed(() => {
  if (!props.spec) return '全部';
  if (opts.isolate === 0) return '全部';
  if (opts.isolate > props.spec.floors.length) return '屋顶';
  return `L${opts.isolate}`;
});

function toggle(key) {
  opts[key] = !opts[key];
  viewer?.setOption(key, opts[key]);
}

function setTime(t) {
  opts.time = t;
  viewer?.setOption('time', t);
}

function setIsolate(v) {
  opts.isolate = v;
  viewer?.setOption('isolate', v);
}

function setView(v) {
  view.value = v;
  viewer?.frame(v);
}

function toggleSection() {
  viewer?.setSection({ enabled: !opts.section });
}

async function exportGlb() {
  try {
    await viewer.exportGlb();
  } catch (err) {
    alert(`导出失败：${err.message}`);
  }
}
</script>

<style scoped>
.stage {
  position: relative;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: #dfe9f2;
}
canvas { display: block; width: 100%; height: 100%; }

.placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 50% 45%, #1b2531 0%, #111721 62%, #0d1218 100%);
}
.ph-card { max-width: 400px; padding: 26px 28px; border: 1px solid #26313e; border-radius: 14px; background: #131a23; }
.ph-tag { font-size: 10px; letter-spacing: 0.22em; color: var(--accent); }
.ph-card h3 { margin: 10px 0 8px; font-size: 18px; font-weight: 600; }
.ph-card p { margin: 0 0 14px; font-size: 12.5px; line-height: 1.7; color: var(--muted); }
.ph-card ul { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.9; color: #8fa0b1; }

.overlay { position: absolute; z-index: 2; }
.top-left { top: 16px; left: 18px; }
.top-right { top: 16px; right: 18px; }
.bottom-left { left: 18px; bottom: 16px; right: 18px; }
.bottom-right { right: 18px; bottom: 78px; }

.scheme-title {
  background: rgba(13, 17, 22, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  border-radius: 10px;
  padding: 10px 14px;
  color: #eef2f6;
  max-width: 340px;
}
.kicker { font-size: 10px; letter-spacing: 0.12em; color: var(--accent); }
.scheme-title h3 { margin: 5px 0 3px; font-size: 16px; font-weight: 600; }
.scheme-title p { margin: 0; font-size: 11px; color: #a4b1bf; }

.seg {
  display: flex;
  padding: 3px;
  gap: 2px;
  border-radius: 9px;
  background: rgba(13, 17, 22, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
}
.seg button {
  padding: 5px 12px;
  border-radius: 7px;
  font-size: 11.5px;
  color: #97a5b3;
}
.seg button { white-space: nowrap; }
.seg button.on { background: rgba(213, 163, 92, 0.9); color: #1a1409; font-weight: 600; }
.seg.small button { padding: 4px 9px; }

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  padding: 9px 12px;
  border-radius: 11px;
  background: rgba(13, 17, 22, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(12px);
  color: #cfdae6;
}
.group { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.group.grow { flex: 1 1 170px; min-width: 170px; }
.glabel { font-size: 10.5px; letter-spacing: 0.1em; color: #7d8b99; white-space: nowrap; }
.toggle {
  padding: 4px 10px;
  border-radius: 7px;
  font-size: 11.5px;
  color: #8d9baa;
  border: 1px solid #2c3745;
  white-space: nowrap;
}
@media (max-width: 1440px) {
  .toolbar { gap: 8px; padding: 8px 10px; }
  .toggle { padding: 4px 8px; }
  .group { gap: 6px; }
}
.toggle.on { color: #f1e4cd; border-color: rgba(213, 163, 92, 0.55); background: rgba(213, 163, 92, 0.14); }
.slider { flex: 1; accent-color: var(--accent); height: 3px; }
.lvalue { font-size: 11px; color: #b7c3cf; min-width: 34px; text-align: right; }
.export {
  padding: 6px 12px;
  border-radius: 7px;
  border: 1px solid rgba(143, 166, 184, 0.35);
  font-size: 11.5px;
  color: #c3d0dc;
  white-space: nowrap;
}
.export:hover { border-color: rgba(213, 163, 92, 0.6); color: var(--accent); }
.hint { font-size: 10.5px; color: rgba(22, 30, 38, 0.55); }
</style>
