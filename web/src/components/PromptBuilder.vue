<template>
  <div class="overlay" @click.self="$emit('close')">
    <section class="dialog">
      <header class="head">
        <div>
          <h3>参数化提示词</h3>
          <p>组合参数即成任务书，右侧实时预览，交给引擎或模型执行。</p>
        </div>
        <button class="x" title="关闭" @click="$emit('close')">×</button>
      </header>

      <div class="body">
        <div class="form">
          <div class="presets">
            <span class="plabel">预设</span>
            <button
              v-for="p in presets"
              :key="p.name"
              class="preset"
              :class="{ on: activePreset === p.name }"
              @click="applyPreset(p)"
            >{{ p.name }}</button>
          </div>

          <div v-for="g in groups" :key="g.key" class="group">
            <h4>{{ g.label }}</h4>
            <div class="fields">
              <label v-for="it in g.items" :key="it.key" :class="['field', `type-${it.type}`]">
                <span>{{ it.label }}</span>

                <select
                  v-if="it.type === 'select'"
                  :value="form[it.key]"
                  @change="set(it.key, $event.target.value)"
                >
                  <option v-for="o in it.options" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>

                <input
                  v-else-if="it.type === 'number'"
                  type="number"
                  :min="it.min"
                  :max="it.max"
                  :step="it.step"
                  :value="form[it.key]"
                  @input="set(it.key, $event.target.valueAsNumber)"
                />

                <span v-else-if="it.type === 'range'" class="range">
                  <input
                    type="range"
                    :min="it.min"
                    :max="it.max"
                    :step="it.step"
                    :value="form[it.key]"
                    @input="set(it.key, $event.target.valueAsNumber)"
                  />
                  <b>{{ form[it.key] }}</b>
                </span>

                <button
                  v-else-if="it.type === 'boolean'"
                  class="switch"
                  :class="{ on: form[it.key] }"
                  @click="set(it.key, !form[it.key])"
                >{{ form[it.key] ? '开' : '关' }}</button>

                <input
                  v-else-if="it.type === 'text'"
                  type="text"
                  :placeholder="it.placeholder"
                  :value="form[it.key]"
                  @input="set(it.key, $event.target.value)"
                />

                <input
                  v-else-if="it.type === 'textarea'"
                  type="text"
                  class="wide"
                  :placeholder="it.placeholder"
                  :value="form[it.key]"
                  @input="set(it.key, $event.target.value)"
                />

                <span v-else-if="it.type === 'multi'" class="chips">
                  <button
                    v-for="o in it.options"
                    :key="o.value"
                    class="chip"
                    :class="{ on: form[it.key].includes(o.value) }"
                    @click="toggle(it.key, o.value)"
                  >{{ o.label }}</button>
                </span>
              </label>
            </div>
          </div>
        </div>

        <div class="preview">
          <div class="phead">
            <span>生成的任务书</span>
            <em v-if="built">{{ built.tokens }} 字</em>
          </div>
          <pre class="prompt">{{ built?.prompt || '正在组合…' }}</pre>

          <div v-if="built" class="checks">
            <span
              v-for="c in built.checks"
              :key="c.key"
              class="check"
              :class="c.expect === undefined ? 'skip' : (String(c.expect) === String(c.got) ? 'ok' : 'bad')"
            >
              {{ c.label }}
              <i>{{ c.expect === undefined ? '未设' : (String(c.expect) === String(c.got) ? '已识别' : `未识别：${c.got ?? '无'}`) }}</i>
            </span>
          </div>

          <ul v-if="built?.warnings?.length" class="warn">
            <li v-for="w in built.warnings" :key="w">{{ w }}</li>
          </ul>

          <div class="segments" v-if="built">
            <div><span>场地</span>{{ built.segments.site }}</div>
            <div><span>体量</span>{{ built.segments.volume }}</div>
            <div v-if="built.segments.requirements.length"><span>要求</span>{{ built.segments.requirements.join('；') }}</div>
          </div>
        </div>
      </div>

      <footer class="foot">
        <button class="ghost" :disabled="busy" @click="reset">恢复默认</button>
        <div class="right">
          <button class="ghost" :disabled="!built" @click="copy">复制</button>
          <button class="ghost" :disabled="!built" @click="fill">填入对话</button>
          <button class="primary" :disabled="!built || busy" @click="generate">
            {{ busy ? '生成中…' : '直接生成方案' }}
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { buildPrompt, designFromPrompt, getPromptParams } from '../api.js';

const emit = defineEmits(['close', 'apply', 'spec']);

const schema = ref(null);
const form = reactive({});
const built = ref(null);
const busy = ref(false);
const activePreset = ref('');
let timer = null;

const groups = computed(() => schema.value?.groups || []);
const presets = computed(() => schema.value?.presets || []);

async function load() {
  const data = await getPromptParams();
  schema.value = data.schema;
  Object.assign(form, data.schema.defaults);
  await rebuild();
}

function set(key, value) {
  if (typeof value === 'number' && Number.isNaN(value)) return;
  form[key] = value;
  activePreset.value = '';
}

function toggle(key, value) {
  const list = form[key] || [];
  form[key] = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  activePreset.value = '';
}

function applyPreset(p) {
  Object.assign(form, schema.value.defaults, p.params, { features: [...(p.params.features || [])] });
  activePreset.value = p.name;
}

async function rebuild() {
  clearTimeout(timer);
  try {
    built.value = await buildPrompt({ ...form, features: [...(form.features || [])] });
  } catch (err) {
    built.value = { prompt: `组合失败：${err.message}`, checks: [], warnings: [], segments: { requirements: [] } };
  }
}

watch(form, () => {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 220);
}, { deep: true });

function reset() {
  Object.assign(form, schema.value.defaults, { features: [] });
  activePreset.value = '';
}

async function copy() {
  try {
    await navigator.clipboard.writeText(built.value.prompt);
  } catch {
    /* clipboard may be blocked */
  }
}

function fill() {
  emit('apply', built.value.prompt);
  emit('close');
}

async function generate() {
  busy.value = true;
  try {
    const res = await designFromPrompt({ ...form, features: [...(form.features || [])] });
    emit('spec', res.spec);
    emit('close');
  } catch (err) {
    built.value = { ...built.value, prompt: `生成失败：${err.message}` };
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 40; background: rgba(6, 9, 13, 0.72);
  display: grid; place-items: center; backdrop-filter: blur(3px);
}
.dialog {
  width: min(1100px, 94vw); height: min(760px, 90vh);
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
}
.head {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 16px 20px 12px; border-bottom: 1px solid var(--line);
}
.head h3 { margin: 0; font-size: 15px; }
.head p { margin: 4px 0 0; font-size: 11.5px; color: var(--muted); }
.x { font-size: 18px; color: var(--muted); padding: 0 4px; }

.body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.form { overflow-y: auto; padding: 14px 18px 18px; display: flex; flex-direction: column; gap: 14px; border-right: 1px solid var(--line); }

.presets { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.plabel { font-size: 10.5px; color: #6f7d8b; letter-spacing: 0.1em; }
.preset {
  font-size: 11px; padding: 4px 9px; border-radius: 999px;
  border: 1px solid var(--line); color: #9fb0c0;
}
.preset.on { border-color: rgba(213, 163, 92, 0.55); color: #f1e4cd; background: rgba(213, 163, 92, 0.13); }

.group h4 { margin: 0 0 8px; font-size: 11px; letter-spacing: 0.12em; color: #8fa0b1; font-weight: 500; }
.fields { display: grid; grid-template-columns: 1fr 1fr; gap: 9px 12px; }
.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.field > span { font-size: 11px; color: #93a3b3; }
.field.type-multi, .field.type-textarea { grid-column: 1 / -1; }
.field select, .field input[type=text], .field input[type=number] {
  background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px;
  color: var(--text); font-size: 12px; padding: 7px 9px; outline: none; min-width: 0;
}
.field select:focus, .field input:focus { border-color: #3d4b5c; }
.range { display: flex; align-items: center; gap: 8px; }
.range input { flex: 1; accent-color: #d5a35c; }
.range b { font-size: 12px; color: var(--accent); min-width: 20px; text-align: right; }
.switch {
  align-self: flex-start; font-size: 11px; padding: 5px 12px; border-radius: 999px;
  border: 1px solid var(--line); color: #8fa0b1;
}
.switch.on { border-color: rgba(95, 191, 139, 0.4); color: #9fe0bd; background: rgba(95, 191, 139, 0.1); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: 11px; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--line); color: #9fb0c0; }
.chip.on { border-color: rgba(213, 163, 92, 0.55); color: #f1e4cd; background: rgba(213, 163, 92, 0.13); }

.preview { min-height: 0; overflow-y: auto; padding: 14px 18px 18px; display: flex; flex-direction: column; gap: 10px; background: #10161d; }
.phead { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #8fa0b1; letter-spacing: 0.1em; }
.phead em { font-style: normal; color: #6f7d8b; }
.prompt {
  margin: 0; padding: 12px; border-radius: 10px; border: 1px solid var(--line);
  background: var(--panel-2); color: #e7ecf2; font-size: 13px; line-height: 1.9;
  white-space: pre-wrap; word-break: break-word; font-family: inherit;
}
.checks { display: flex; flex-wrap: wrap; gap: 6px; }
.check { font-size: 10.5px; padding: 3px 8px; border-radius: 6px; border: 1px solid #26313e; color: #93a3b3; }
.check i { font-style: normal; margin-left: 5px; color: #6f7d8b; }
.check.ok { border-color: rgba(95, 191, 139, 0.35); color: #9fe0bd; }
.check.ok i { color: rgba(159, 224, 189, 0.7); }
.check.bad { border-color: rgba(226, 121, 97, 0.4); color: #e8a596; }
.check.bad i { color: rgba(232, 165, 150, 0.8); }
.warn { margin: 0; padding-left: 16px; font-size: 11px; line-height: 1.7; color: #d9ab7b; }
.segments { display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: #93a3b3; }
.segments div { display: flex; gap: 8px; }
.segments span { flex: 0 0 34px; color: #6f7d8b; }

.foot { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-top: 1px solid var(--line); }
.foot .right { display: flex; gap: 8px; }
.ghost { font-size: 12px; padding: 7px 13px; border-radius: 8px; border: 1px solid var(--line); color: #9fb0c0; }
.ghost:disabled { opacity: 0.45; cursor: not-allowed; }
.primary {
  font-size: 12px; padding: 8px 16px; border-radius: 8px;
  background: var(--accent); color: #1a1409; font-weight: 600;
}
.primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
