<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect x="3" y="10" width="12" height="18" rx="1.5" fill="#d5a35c" opacity="0.9" />
          <rect x="17" y="4" width="12" height="24" rx="1.5" fill="#8fa6b8" opacity="0.55" />
          <path d="M3 10 9 4l6 6" fill="none" stroke="#e7ecf2" stroke-width="1.4" opacity="0.8" />
        </svg>
        <div class="titles">
          <h1>筑野 <span>ARCHI-AGENT</span></h1>
          <p>本地大模型驱动的建筑设计智能体 · Three.js 方案查看器</p>
        </div>
      </div>

      <div class="status">
        <button class="chip" :class="health?.hy4?.reachable ? 'chip-live' : 'chip-local'" @click="settingsOpen = true">
          <i class="dot"></i>
          {{ health?.hy4?.reachable ? `${health.model}` : '本地设计引擎' }}
          <em>{{ health?.hy4?.reachable ? providerLabel : '点击配置模型' }}</em>
        </button>
        <span v-if="health" class="chip muted">{{ health.baseUrl }}</span>
        <button class="ghost" @click="reset" title="清空会话与方案">重置</button>
      </div>
    </header>

    <main class="layout">
      <section class="left">
        <div class="left-tabs">
          <button :class="{ on: tab === 'chat' }" @click="tab = 'chat'">对话</button>
          <button :class="{ on: tab === 'library' }" @click="tab = 'library'">
            成品库<em v-if="libraryCount">{{ libraryCount }}</em>
          </button>
          <button :class="{ on: tab === 'trash' }" @click="tab = 'trash'">
            回收站<em v-if="trashCount">{{ trashCount }}</em>
          </button>
        </div>

        <ChatPanel v-show="tab === 'chat'" ref="chat" :mode="mode" @update:mode="mode = $event" @spec="onSpec" />
        <LibraryPanel
          v-if="tab !== 'chat'"
          :spec="spec"
          :mode="tab === 'trash' ? 'trash' : 'library'"
          @open="onOpenLibrary"
          @saved="libraryCount += 1"
          @counts="onCounts"
        />
      </section>

      <SceneView :spec="spec" class="viewer" />
      <MetricsPanel :spec="spec" class="metrics" />
    </main>

    <SettingsDialog v-if="settingsOpen" @close="settingsOpen = false" @saved="refreshHealth" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import ChatPanel from './components/ChatPanel.vue';
import SceneView from './components/SceneView.vue';
import MetricsPanel from './components/MetricsPanel.vue';
import LibraryPanel from './components/LibraryPanel.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import { adoptSpec, getHealth, getSpec, getSession, listLibrary, resetSession } from './api.js';

const health = ref(null);
const spec = ref(null);
const mode = ref('auto');
const tab = ref('chat');
const settingsOpen = ref(false);
const libraryCount = ref(0);
const trashCount = ref(0);
const chat = ref(null);

const providerLabel = computed(() => {
  const type = health.value?.provider || 'local';
  return { auto: '自动', hy4: 'Hy4', ollama: 'Ollama', openai: 'API', local: '本地' }[type] || type;
});

async function refreshHealth() {
  try {
    health.value = await getHealth();
  } catch {
    health.value = { hy4: { reachable: false }, baseUrl: '服务未启动' };
  }
}

onMounted(async () => {
  await refreshHealth();
  try {
    const session = await getSession();
    spec.value = session.spec || (await getSpec());
  } catch {
    /* first run: no spec yet */
  }
  try {
    const data = await listLibrary();
    libraryCount.value = data.total;
    trashCount.value = data.trashCount || 0;
  } catch {
    /* library empty */
  }
});

function onCounts({ total, trash }) {
  if (typeof total === 'number') libraryCount.value = total;
  if (typeof trash === 'number') trashCount.value = trash;
}

function onSpec(next) {
  spec.value = next;
}

async function onOpenLibrary(nextSpec) {
  spec.value = nextSpec;
  tab.value = 'chat';
  refreshHealth();
  try {
    await adoptSpec(nextSpec);
  } catch {
    /* viewer still shows it */
  }
  chat.value?.refreshReference?.();
}

async function reset() {
  await resetSession();
  spec.value = null;
  chat.value?.clear();
  const data = await listLibrary().catch(() => ({ total: 0, trashCount: 0 }));
  libraryCount.value = data.total || 0;
  trashCount.value = data.trashCount || 0;
}
</script>

<style scoped>
.app { height: 100%; display: flex; flex-direction: column; }

.topbar {
  height: 60px;
  flex: 0 0 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, #131a22, #10161d);
}

.brand { display: flex; align-items: center; gap: 12px; }
.mark { width: 30px; height: 30px; }
.titles h1 { margin: 0; font-size: 17px; letter-spacing: 0.04em; font-weight: 600; }
.titles h1 span { color: var(--muted); font-weight: 400; font-size: 12px; letter-spacing: 0.14em; margin-left: 4px; }
.titles p { margin: 2px 0 0; font-size: 11px; color: var(--muted); }

.status { display: flex; align-items: center; gap: 8px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 10px; border-radius: 999px;
  font-size: 12px; border: 1px solid var(--line); background: var(--panel);
  color: #cfdae6;
}
.chip em { font-style: normal; font-size: 10px; color: #7f8d9c; }
.chip-live { border-color: rgba(95, 191, 139, 0.35); color: #9fe0bd; }
.chip-local { border-color: rgba(213, 163, 92, 0.35); color: var(--accent); }
.chip.muted { color: var(--muted); font-family: ui-monospace, "SF Mono", monospace; font-size: 11px; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.ghost { padding: 6px 12px; border: 1px solid var(--line); border-radius: 8px; font-size: 12px; color: var(--muted); }
.ghost:hover { color: var(--text); border-color: #3a4757; }

.layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 400px minmax(420px, 1fr) 336px;
  gap: 1px;
  background: var(--line);
}

.left { display: flex; flex-direction: column; min-height: 0; background: var(--panel); }
.left-tabs { display: flex; gap: 2px; padding: 8px 12px 0; border-bottom: 1px solid var(--line); background: var(--panel); }
.left-tabs button {
  flex: 1; font-size: 12px; padding: 7px 0 8px; color: #7f8d9c;
  border-bottom: 2px solid transparent; display: flex; align-items: center; justify-content: center; gap: 6px;
}
.left-tabs button.on { color: #eef2f6; border-bottom-color: var(--accent); }
.left-tabs em {
  font-style: normal; font-size: 10px; color: #1a1409;
  background: var(--accent); border-radius: 999px; padding: 0 5px; line-height: 15px;
}

.viewer { min-width: 0; }
.metrics { min-width: 0; }

@media (max-width: 1180px) {
  .layout { grid-template-columns: 360px 1fr; }
  .metrics { display: none; }
}
</style>
