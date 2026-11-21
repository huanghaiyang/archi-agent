<template>
  <section class="chat">
    <div class="chat-head">
      <div>
        <h2>主创建筑师</h2>
        <p>{{ busy ? statusText || '处理中…' : '描述任务书，或直接提出修改' }}</p>
      </div>
      <div class="head-tools">
        <button class="prompt-btn" title="按参数组合生成任务书" @click="builderOpen = true">参数化提示词</button>
        <select :value="mode" class="mode" @change="$emit('update:mode', $event.target.value)">
          <option value="auto">自动</option>
          <option value="hy4">Hy4</option>
          <option value="local">本地</option>
        </select>
      </div>
    </div>

    <div ref="scroller" class="thread">
      <div v-if="!messages.length" class="empty">
        <div class="empty-badge">设计引擎在线</div>
        <p class="lead">把任务书交给它：它会先定体量与功能，再排布楼层、开窗，最后跑一遍规范校核。</p>
        <div class="examples">
          <button v-for="ex in examples" :key="ex" class="example" @click="send(ex)">
            <span>{{ ex }}</span>
          </button>
        </div>
        <p class="hint">接入 Hy4（vLLM / SGLang，OpenAI 兼容）后，模型会自己编排这些工具；未接入时由本地确定性规划器代跑。</p>
      </div>

      <div v-for="(m, i) in messages" :key="i" :class="['msg', m.role]">
        <div v-if="m.role === 'user'" class="bubble user">
          <img v-if="m.image" :src="m.image" class="ref-thumb" alt="参考图" />
          <span>{{ m.text }}</span>
        </div>
        <template v-else>
          <div v-for="(p, j) in m.parts" :key="j" class="part">
            <div v-if="p.type === 'text'" class="bubble assistant" :class="{ error: p.error }">{{ p.text }}</div>
            <div v-else-if="p.type === 'tool'" class="tool" :class="p.status">
              <div class="tool-line">
                <i class="tdot"></i>
                <span class="tname">{{ toolLabel(p.name) }}</span>
                <span class="tstatus">{{ p.status === 'running' ? '执行中' : p.status === 'error' ? '失败' : '完成' }}</span>
              </div>
              <div v-if="p.summary" class="tsummary">{{ p.summary }}</div>
              <div v-else-if="p.args" class="tsummary args">{{ argText(p.args) }}</div>
            </div>
            <div v-else-if="p.type === 'thinking'" class="thinking">{{ p.text }}</div>
          </div>
        </template>
      </div>

      <div v-if="busy" class="pulse"><span></span><span></span><span></span></div>
    </div>

    <div class="composer">
      <div v-if="attached" class="attach">
        <img :src="attached.dataUrl" alt="" />
        <div class="attach-meta">
          <span>{{ attached.name }}</span>
          <em>{{ attached.palette.length ? `主色 ${attached.palette.slice(0, 4).join(' ')}` : '主色分析中…' }}</em>
        </div>
        <button class="attach-x" title="移除参考图" @click="clearAttachment">×</button>
      </div>
      <div v-if="reference" class="ref-chip">
        <span>参考图：{{ reference.analysis?.description || reference.analysis?.style }}</span>
        <a :href="reference.url" target="_blank" rel="noreferrer">查看</a>
      </div>
      <textarea
        ref="inputEl"
        v-model="draft"
        rows="2"
        placeholder="例如：哈尔滨 40×28m 场地，3 层社区图书馆，南向入口，暖灰清水混凝土…（可附参考图）"
        @keydown.enter.exact.prevent="send()"
      ></textarea>
      <div class="composer-row">
        <div class="left-tools">
          <button class="attach-btn" :disabled="busy" @click="pickFile">＋ 参考图</button>
          <span class="tip">Enter 发送 · Shift+Enter 换行</span>
        </div>
        <button v-if="!busy" class="send" :disabled="!canSend" @click="send()">发送</button>
        <button v-else class="send stop" @click="stop()">停止</button>
      </div>
      <input ref="fileEl" type="file" accept="image/*" hidden @change="onFile" />
    </div>

    <PromptBuilder
      v-if="builderOpen"
      @close="builderOpen = false"
      @apply="onPromptApply"
      @spec="onPromptSpec"
    />
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { chatStream, getSession, paletteFromImage, readFileAsDataUrl } from '../api.js';
import PromptBuilder from './PromptBuilder.vue';

const props = defineProps({ mode: { type: String, default: 'auto' } });
const emit = defineEmits(['update:mode', 'spec']);

const messages = ref([]);
const draft = ref('');
const busy = ref(false);
const statusText = ref('');
const scroller = ref(null);
const inputEl = ref(null);
const fileEl = ref(null);
const attached = ref(null);
const reference = ref(null);
const builderOpen = ref(false);
let controller = null;

const canSend = computed(() => Boolean(draft.value.trim() || attached.value) && !busy.value);

const LABELS = {
  design_scheme: '生成总体方案',
  edit_roof: '调整屋顶',
  edit_facade: '调整立面',
  edit_windows: '调整开窗',
  edit_site: '调整场地',
  set_floors: '调整层数',
  check_codes: '规范校核',
  submit_design: '定稿并推送视图',
};
const toolLabel = (name) => LABELS[name] || name;

const examples = [
  '哈尔滨 40×28m 场地，设计 3 层社区图书馆，南向入口，暖灰清水混凝土',
  '学校 45×35m 场地，4 层教学楼，木格栅立面，双坡屋顶',
  '办公楼 36×30m，5 层，玻璃幕墙，顶层退台',
  '把立面改成木格栅，加大开窗到 2.6m，坡度 28°',
];

function currentTurn() {
  let last = messages.value[messages.value.length - 1];
  if (!last || last.role !== 'assistant') {
    last = { role: 'assistant', parts: [] };
    messages.value.push(last);
  }
  return last;
}

function argText(args) {
  if (!args || !Object.keys(args).length) return '默认参数';
  return Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
}

function send(text) {
  const content = (text ?? draft.value).trim();
  if (busy.value) return;
  if (!content && !attached.value) return;
  const image = attached.value?.dataUrl || null;
  const palette = attached.value?.palette || [];
  draft.value = '';
  messages.value.push({ role: 'user', text: content || '按这张参考图生成方案', image });
  const attachment = attached.value;
  attached.value = null;
  busy.value = true;
  statusText.value = '';
  scroll();

  controller = new AbortController();
  chatStream({
    message: content,
    mode: props.mode,
    image,
    palette,
    signal: controller.signal,
    onEvent: (event) => handle(event),
  })
    .catch((err) => {
      if (err.name === 'AbortError') return;
      currentTurn().parts.push({ type: 'text', text: `连接失败：${err.message}`, error: true });
    })
    .finally(() => {
      busy.value = false;
      statusText.value = '';
      controller = null;
      if (attachment) URL.revokeObjectURL?.(attachment.objectUrl);
      scroll();
    });
}

function handle(event) {
  switch (event.type) {
    case 'status':
      statusText.value = event.text;
      break;
    case 'thinking':
      if (event.text) {
        const turn = currentTurn();
        const last = turn.parts[turn.parts.length - 1];
        if (last?.type === 'thinking') last.text = event.text;
        else turn.parts.push({ type: 'thinking', text: event.text });
      }
      break;
    case 'tool_start':
      currentTurn().parts.push({ type: 'tool', id: event.id, name: event.name, args: event.args, status: 'running' });
      statusText.value = `调用工具：${toolLabel(event.name)}…`;
      break;
    case 'tool_end': {
      const turn = currentTurn();
      const item = turn.parts.find((p) => p.type === 'tool' && p.id === event.id);
      if (item) {
        item.status = event.ok ? 'done' : 'error';
        item.summary = event.summary;
      }
      break;
    }
    case 'reference':
      if (event.reference) {
        reference.value = event.reference;
        const turn = currentTurn();
        turn.parts.push({
          type: 'text',
          text: `参考图解析：${event.reference.analysis?.description || event.reference.analysis?.style || '已读取'}`,
        });
      }
      break;
    case 'spec':
      if (event.spec) emit('spec', event.spec);
      break;
    case 'text':
      currentTurn().parts.push({ type: 'text', text: event.text });
      break;
    case 'error':
      currentTurn().parts.push({ type: 'text', text: event.text, error: true });
      break;
    default:
      break;
  }
  scroll();
}

function stop() {
  controller?.abort();
  busy.value = false;
}

function pickFile() {
  fileEl.value?.click();
}

async function onFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const dataUrl = await readFileAsDataUrl(file, 1280);
  attached.value = { name: file.name, dataUrl, palette: [], objectUrl: null };
  const palette = await paletteFromImage(file, 6);
  if (attached.value) attached.value.palette = palette;
}

function clearAttachment() {
  attached.value = null;
}

async function loadHistory() {
  try {
    const data = await getSession();
    reference.value = data.reference || null;
    if (Array.isArray(data.messages) && data.messages.length) {
      messages.value = data.messages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        text: m.content || '',
        parts: m.role === 'user' ? undefined : [{ type: 'text', text: m.content || '' }],
      }));
      scroll();
    }
  } catch {
    /* offline */
  }
}

function clear() {
  messages.value = [];
  draft.value = '';
  busy.value = false;
  statusText.value = '';
  attached.value = null;
  reference.value = null;
}

function onPromptApply(text) {
  draft.value = text;
  nextTick(() => inputEl.value?.focus());
}

function onPromptSpec(spec) {
  if (spec) emit('spec', spec);
}

async function refreshReference() {  try {
    const data = await getSession();
    reference.value = data.reference || null;
  } catch {
    /* ignore */
  }
}

onMounted(loadHistory);

defineExpose({ clear, send, refreshReference });

watch(messages, scroll, { deep: true });

function scroll() {
  nextTick(() => {
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

onUnmounted(() => controller?.abort());
</script>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--panel);
}

.chat-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--line);
}
.chat-head h2 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; }
.chat-head p { margin: 4px 0 0; font-size: 11.5px; color: var(--muted); max-width: 250px; }
.head-tools { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.prompt-btn {
  font-size: 11px; padding: 4px 8px; border-radius: 7px;
  border: 1px solid rgba(213, 163, 92, 0.35); color: var(--accent); white-space: nowrap;
}
.mode {
  background: var(--panel-2);
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 7px;
  font-size: 11.5px;
  padding: 4px 6px;
  outline: none;
}

.thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty { color: var(--muted); }
.empty-badge {
  display: inline-block;
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--accent);
  border: 1px solid rgba(213, 163, 92, 0.3);
  border-radius: 999px;
  padding: 4px 10px;
  margin-bottom: 12px;
}
.lead { margin: 0 0 14px; font-size: 12.5px; line-height: 1.7; color: #b9c4d0; }
.examples { display: flex; flex-direction: column; gap: 8px; }
.example {
  text-align: left;
  font-size: 12px;
  line-height: 1.55;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--panel-2);
  color: #c9d3de;
  transition: border-color 0.15s, transform 0.15s;
}
.example:hover { border-color: rgba(213, 163, 92, 0.5); transform: translateY(-1px); }
.hint { margin: 14px 0 0; font-size: 11px; line-height: 1.7; color: #6f7d8b; }

.msg { display: flex; flex-direction: column; gap: 8px; }
.msg.user { align-items: flex-end; }
.bubble {
  font-size: 12.8px;
  line-height: 1.68;
  white-space: pre-wrap;
  padding: 10px 13px;
  border-radius: 10px;
  max-width: 100%;
  word-break: break-word;
}
.bubble.user { background: rgba(213, 163, 92, 0.16); border: 1px solid rgba(213, 163, 92, 0.28); color: #f1e4cd; }
.bubble.assistant { background: var(--panel-2); border: 1px solid var(--line); color: #dfe7ef; }
.bubble.error { border-color: rgba(226, 121, 97, 0.4); color: #f0b3a4; }

.part { display: flex; flex-direction: column; gap: 8px; }

.tool {
  border: 1px solid var(--line);
  border-left: 2px solid #3d4a5b;
  border-radius: 8px;
  padding: 8px 11px;
  background: #131922;
}
.tool.done { border-left-color: var(--ok); }
.tool.error { border-left-color: var(--fail); }
.tool-line { display: flex; align-items: center; gap: 8px; font-size: 11.5px; }
.tdot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
.tool.done .tdot { background: var(--ok); }
.tool.error .tdot { background: var(--fail); }
.tname { color: #cfdae6; letter-spacing: 0.02em; }
.tstatus { margin-left: auto; color: #6f7d8b; font-size: 10.5px; }
.tsummary { margin-top: 5px; font-size: 11.5px; line-height: 1.55; color: #8fa0b1; }
.tsummary.args { color: #67757f; font-family: ui-monospace, "SF Mono", monospace; font-size: 10.5px; }

.thinking {
  border: 1px dashed #2c3745;
  border-radius: 8px;
  padding: 8px 11px;
  font-size: 11px;
  line-height: 1.6;
  color: #7f8d9c;
  max-height: 120px;
  overflow: hidden;
}

.pulse { display: flex; gap: 5px; padding: 2px 4px; }
.pulse span {
  width: 5px; height: 5px; border-radius: 50%; background: var(--accent);
  animation: blink 1.2s infinite ease-in-out;
}
.pulse span:nth-child(2) { animation-delay: 0.2s; }
.pulse span:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }

.composer { border-top: 1px solid var(--line); padding: 12px 14px 14px; background: #121820; }
.attach {
  display: flex; align-items: center; gap: 9px; margin-bottom: 8px;
  border: 1px solid #26313e; border-radius: 9px; padding: 6px 8px; background: #0f151d;
}
.attach img { width: 46px; height: 46px; object-fit: cover; border-radius: 6px; }
.attach-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.attach-meta span { font-size: 11.5px; color: #cfdae6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attach-meta em { font-style: normal; font-size: 10px; color: #6f7d8b; }
.attach-x { color: #7d8b99; font-size: 15px; padding: 0 4px; }
.ref-chip {
  display: flex; align-items: center; gap: 8px; justify-content: space-between;
  font-size: 10.5px; color: #8fa0b1; border: 1px dashed #2c3745; border-radius: 8px;
  padding: 5px 8px; margin-bottom: 8px;
}
.ref-chip a { color: var(--accent); text-decoration: none; }
.ref-thumb { display: block; max-width: 100%; max-height: 150px; border-radius: 7px; margin-bottom: 7px; }
.left-tools { display: flex; align-items: center; gap: 10px; }
.attach-btn {
  font-size: 11px; padding: 5px 10px; border-radius: 7px;
  border: 1px solid #2c3745; color: #a9b7c5;
}
.attach-btn:hover { border-color: rgba(213, 163, 92, 0.5); color: var(--accent); }
.attach-btn:disabled { opacity: 0.45; }
textarea {
  width: 100%;
  resize: none;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 9px;
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  line-height: 1.6;
  padding: 9px 11px;
  outline: none;
}
textarea:focus { border-color: rgba(213, 163, 92, 0.45); }
.composer-row { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.tip { font-size: 10.5px; color: #66727f; }
.send {
  padding: 6px 16px;
  border-radius: 8px;
  background: var(--accent);
  color: #1a1409;
  font-size: 12px;
  font-weight: 600;
}
.send:disabled { opacity: 0.4; cursor: not-allowed; }
.send.stop { background: transparent; border: 1px solid rgba(226, 121, 97, 0.5); color: #e27961; }
</style>
