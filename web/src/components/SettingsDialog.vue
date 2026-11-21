<template>
  <div class="mask" @click.self="$emit('close')">
    <div class="dialog">
      <header>
        <div>
          <h3>模型与部署</h3>
          <p>指向本地 vLLM / SGLang（Hy4）、Ollama、llama.cpp 或任意 OpenAI 兼容服务。</p>
        </div>
        <button class="x" @click="$emit('close')">×</button>
      </header>

      <div class="row">
        <label>提供方</label>
        <select v-model="form.type" @change="applyPreset">
          <option value="auto">自动探测（本地候选）</option>
          <option value="hy4">Hy4 · vLLM / SGLang</option>
          <option value="ollama">Ollama</option>
          <option value="openai">OpenAI 兼容服务</option>
          <option value="local">仅本地设计引擎</option>
        </select>
      </div>

      <div class="row">
        <label>Base URL</label>
        <input v-model="form.baseUrl" placeholder="http://127.0.0.1:8000/v1" :disabled="form.type === 'local'" />
      </div>

      <div class="row two">
        <div>
          <label>模型名</label>
          <input v-model="form.model" placeholder="hy4" :disabled="form.type === 'local'" />
        </div>
        <div>
          <label>API Key</label>
          <input v-model="form.apiKey" placeholder="EMPTY" :disabled="form.type === 'local'" />
        </div>
      </div>

      <div class="row two">
        <div>
          <label>温度</label>
          <input v-model.number="form.temperature" type="number" step="0.05" min="0" max="2" />
        </div>
        <div>
          <label>推理模式（Hy4）</label>
          <select v-model="form.reasoning">
            <option value="no_think">no_think · 直接答</option>
            <option value="high">high · 深度思考</option>
          </select>
        </div>
      </div>

      <div class="row">
        <label>视觉模型（可选，留空=复用上面的模型）</label>
        <input v-model="form.visionModel" placeholder="qwen2.5vl:7b / llava / 留空" :disabled="form.type === 'local' || !form.vision" />
      </div>

      <div class="row inline">
        <label class="check">
          <input v-model="form.vision" type="checkbox" />
          <span>启用视觉（参考图交给模型读，未启用则用主色匹配）</span>
        </label>
      </div>

      <div class="row local-block">
        <label class="check">
          <input v-model="form.localVision" type="checkbox" :disabled="!local.installed" />
          <span>浏览器本地视觉（SmolVLM 500M · ONNX WASM）</span>
        </label>
        <div class="local-state" :class="{ ready: local.installed }">
          <template v-if="local.installed">
            已安装 · {{ local.bytes ? `${(local.bytes / 1073741824).toFixed(2)} GB` : '' }} · {{ local.dtype || 'q8' }} · {{ local.fileCount }} 个文件
          </template>
          <template v-else>
            未下载 · 先在项目根目录运行 <code>npm run models:vision</code>
          </template>
        </div>
        <p class="local-note">
          开启后参考图先交给浏览器里的本地模型推理，不上传图片；失败或未安装时自动回退到上面的服务端视觉。
        </p>
      </div>

      <div class="tips">
        <code>vllm serve hy4 --tool-call-parser hy_v4 --port 8000</code>
        <code>ollama serve  # 然后 baseUrl 用 http://127.0.0.1:11434/v1</code>
      </div>

      <div v-if="result" class="result" :class="result.ok ? 'ok' : 'bad'">
        {{ result.ok ? `连接成功 · ${result.models?.slice(0, 4).join(' / ') || result.model}` : `连接失败：${result.reason}` }}
      </div>

      <footer>
        <button class="test" :disabled="testing" @click="test">{{ testing ? '测试中…' : '测试连接' }}</button>
        <button class="save" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { getLocalVisionStatus, getSettings, saveSettings, testProvider } from '../api.js';

const emit = defineEmits(['close', 'saved']);
const form = reactive({
  type: 'auto', baseUrl: '', model: '', visionModel: '', apiKey: '', temperature: 0.9, reasoning: 'no_think', vision: true, localVision: false,
});
const local = ref({ installed: false, bytes: 0, dtype: '', fileCount: 0, enabled: false });
const testing = ref(false);
const saving = ref(false);
const result = ref(null);

const PRESETS = {
  hy4: { baseUrl: 'http://127.0.0.1:8000/v1', model: 'hy4' },
  ollama: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' },
  openai: { baseUrl: 'http://127.0.0.1:8080/v1', model: 'local-model' },
};

function applyPreset() {
  const preset = PRESETS[form.type];
  if (preset) Object.assign(form, preset);
  result.value = null;
}

async function load() {
  try {
    const s = await getSettings();
    Object.assign(form, {
      type: s.provider?.type || 'auto',
      baseUrl: s.provider?.baseUrl || '',
      model: s.provider?.model || '',
      apiKey: s.hasKey ? '' : '',
      temperature: s.provider?.temperature ?? 0.9,
      reasoning: s.provider?.reasoning || 'no_think',
      vision: s.provider?.vision !== false,
      visionModel: s.provider?.visionModel || '',
      localVision: Boolean(s.provider?.localVision),
    });
  } catch {
    /* keep defaults */
  }
}

async function loadLocalVision() {
  try {
    const s = await getLocalVisionStatus();
    local.value = s;
    if (!s.installed) form.localVision = false;
  } catch {
    /* server offline */
  }
}

async function test() {
  testing.value = true;
  result.value = null;
  try {
    result.value = await testProvider({ ...form, apiKey: form.apiKey || 'EMPTY' });
  } catch (err) {
    result.value = { ok: false, reason: err.message };
  } finally {
    testing.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    await saveSettings({ provider: { ...form, apiKey: form.apiKey || undefined } });
    emit('saved');
    emit('close');
  } catch (err) {
    result.value = { ok: false, reason: err.message };
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  load();
  loadLocalVision();
});
</script>

<style scoped>
.mask {
  position: fixed; inset: 0; z-index: 40;
  background: rgba(6, 9, 13, 0.72);
  backdrop-filter: blur(3px);
  display: grid; place-items: center;
}
.dialog {
  width: min(560px, 92vw);
  background: #121922;
  border: 1px solid #26313e;
  border-radius: 14px;
  padding: 18px 20px 16px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
}
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
header h3 { margin: 0; font-size: 15px; }
header p { margin: 5px 0 0; font-size: 11.5px; color: var(--muted); line-height: 1.6; }
.x { font-size: 18px; color: #7d8b99; padding: 0 4px; }

.row { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.row.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.row.two > div { display: flex; flex-direction: column; gap: 6px; }
.row.inline { flex-direction: row; align-items: center; }
label { font-size: 11px; color: #8fa0b1; letter-spacing: 0.04em; }
input, select {
  background: #0f151d; border: 1px solid #27313d; border-radius: 8px;
  color: #dfe7ef; font-size: 12px; padding: 7px 9px; outline: none;
}
input:focus, select:focus { border-color: rgba(213, 163, 92, 0.5); }
input:disabled { opacity: 0.45; }
.check { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: #9fb0c0; }
.check input { width: 14px; height: 14px; accent-color: var(--accent); }

.local-block {
  padding: 10px 11px; border-radius: 9px; border: 1px solid #26313e;
  background: #0f151d; gap: 7px;
}
.local-state { font-size: 10.5px; color: #b08a54; }
.local-state.ready { color: #9fe0bd; }
.local-state code {
  font-family: ui-monospace, "SF Mono", monospace; font-size: 10px;
  color: #cfd9e4; background: #171e28; border-radius: 4px; padding: 1px 4px;
}
.local-note { margin: 0; font-size: 10.5px; line-height: 1.55; color: #75828f; }

.tips { margin-top: 12px; display: flex; flex-direction: column; gap: 5px; }
.tips code {
  font-family: ui-monospace, "SF Mono", monospace;
  font-size: 10.5px; color: #7f8d9c; background: #0d1319;
  border: 1px solid #1f2833; border-radius: 6px; padding: 5px 8px;
  overflow-x: auto; white-space: nowrap;
}

.result { margin-top: 12px; font-size: 11.5px; padding: 8px 10px; border-radius: 8px; border: 1px solid; }
.result.ok { color: #9fe0bd; border-color: rgba(95, 191, 139, 0.35); background: rgba(95, 191, 139, 0.08); }
.result.bad { color: #f0b3a4; border-color: rgba(226, 121, 97, 0.35); background: rgba(226, 121, 97, 0.08); }

footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.test, .save { padding: 8px 16px; border-radius: 8px; font-size: 12px; }
.test { border: 1px solid #2c3745; color: #b9c4d0; }
.save { background: var(--accent); color: #1a1409; font-weight: 600; }
.save:disabled, .test:disabled { opacity: 0.5; }
</style>
