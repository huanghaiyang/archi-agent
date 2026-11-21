<template>
  <section class="lib">
    <div class="head">
      <span class="head-label">{{ mode === 'trash' ? `回收站 ${trashCount}` : `成品库 ${library.total}` }}</span>
      <button v-if="mode === 'library'" class="save-current" :disabled="!spec || saving" @click="saveCurrent">
        {{ saving ? '存档中…' : '存入当前方案' }}
      </button>
    </div>

    <template v-if="mode === 'library'">
      <div class="search">
        <input v-model="query" placeholder="搜索标题 / 风格 / 标签" @input="debouncedLoad" />
        <select v-model="sort" @change="load">
          <option value="newest">最新</option>
          <option value="oldest">最早</option>
          <option value="title">按名称</option>
          <option value="size">按面积</option>
        </select>
      </div>

      <div class="filter-block">
        <div class="filter-line">
          <span class="flabel">风格</span>
          <button class="chip" :class="{ on: style === 'all' }" @click="selectStyle('all')">
            全部 <i>{{ library.total }}</i>
          </button>
          <button
            v-for="f in library.filters?.styles || []"
            :key="f.key"
            class="chip"
            :class="{ on: style === f.key, empty: !f.count }"
            @click="selectStyle(f.key)"
          >
            {{ f.label }} <i>{{ f.count }}</i>
          </button>
        </div>
        <div class="filter-line">
          <span class="flabel">功能</span>
          <button
            v-for="f in library.filters?.programmes || []"
            :key="f.key"
            class="chip"
            :class="{ on: programme === f.key, empty: !f.count }"
            @click="selectProgramme(f.key)"
          >
            {{ f.label }} <i>{{ f.count }}</i>
          </button>
        </div>
      </div>

      <div class="list">
        <article v-for="it in library.items" :key="it.id" class="card">
          <div class="thumb" :class="`style-${it.style}`" @click="open(it)">
            <img v-if="it.thumb" :src="it.thumb" alt="" />
            <span v-else class="ph">{{ it.styleLabel }}</span>
            <span class="badge">{{ it.programmeLabel }}</span>
          </div>
          <div class="body">
            <div class="title-row">
              <h4 @click="open(it)">{{ it.title }}</h4>
              <button class="icon" :class="{ on: it.pinned }" title="置顶" @click="pin(it)">★</button>
            </div>
            <p class="meta">
              {{ it.styleLabel }} · {{ it.summary?.floors || '—' }} 层 ·
              {{ it.summary?.gfa ? `${it.summary.gfa}㎡` : '—' }}
              <template v-if="it.summary?.far">· FAR {{ it.summary.far }}</template>
            </p>
            <div v-if="it.tags?.length" class="tags">
              <span v-for="t in it.tags" :key="t">{{ t }}</span>
            </div>
            <div class="actions">
              <button @click="open(it)">打开</button>
              <button class="danger" @click="remove(it)">删除</button>
            </div>
          </div>
        </article>

        <p v-if="!library.items.length" class="empty">
          还没有成品。先在对话里生成方案，点右上角"存入当前方案"，或直接在建好的方案上收藏。
        </p>
      </div>
    </template>

    <template v-else>
      <div class="trash-head">
        <span>回收站 {{ trashCount }} 个，删除后仍占磁盘</span>
        <button class="danger" :disabled="!trashCount" @click="purgeAll">清空回收站</button>
      </div>
      <div class="list">
        <article v-for="it in trash.items" :key="it.id" class="card trash-card">
          <div class="thumb small" :class="`style-${it.style}`">
            <img v-if="it.thumb" :src="it.thumb" alt="" />
            <span v-else class="ph">{{ it.styleLabel }}</span>
          </div>
          <div class="body">
            <h4>{{ it.title }}</h4>
            <p class="meta">{{ it.styleLabel }} · 删除于 {{ when(it.deletedAt) }}</p>
            <div class="actions">
              <button @click="restore(it)">恢复</button>
              <button class="danger" @click="purgeOne(it)">彻底删除</button>
            </div>
          </div>
        </article>
        <p v-if="!trash.items.length" class="empty">回收站是空的。</p>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  deleteLibraryItem, emptyTrash, listLibrary, listTrash, restoreLibraryItem,
  purgeLibraryItem, saveToLibrary, updateLibraryItem,
} from '../api.js';

const props = defineProps({
  spec: { type: Object, default: null },
  mode: { type: String, default: 'library' },
});
const emit = defineEmits(['open', 'saved', 'counts']);

const mode = computed(() => props.mode || 'library');
const style = ref('all');
const programme = ref('all');
const query = ref('');
const sort = ref('newest');
const saving = ref(false);
const library = reactive({ items: [], total: 0, trashCount: 0, filters: { styles: [], programmes: [] } });
const trash = reactive({ items: [], total: 0 });
const trashCount = computed(() => library.trashCount || trash.total);

async function load() {
  const data = await listLibrary({
    style: style.value === 'all' ? '' : style.value,
    programme: programme.value === 'all' ? '' : programme.value,
    q: query.value.trim(),
    sort: sort.value,
  });
  Object.assign(library, data);
  emit('counts', { total: library.total, trash: library.trashCount || trash.total });
  if (mode.value === 'trash') await loadTrash();
}

async function loadTrash() {
  const data = await listTrash();
  trash.items = data.items;
  trash.total = data.total;
  emit('counts', { total: library.total, trash: data.total });
}

watch(mode, (m) => {
  if (m === 'trash') loadTrash();
  else load();
});

function selectStyle(key) {
  style.value = style.value === key ? 'all' : key;
  load();
}

function selectProgramme(key) {
  programme.value = programme.value === key ? 'all' : key;
  load();
}

let timer = null;
function debouncedLoad() {
  clearTimeout(timer);
  timer = setTimeout(load, 260);
}

async function saveCurrent() {
  if (!props.spec) return;
  saving.value = true;
  try {
    const thumb = window.__archiViewer?.captureThumbnail?.(520) || null;
    const res = await saveToLibrary({
      title: props.spec.meta?.title || '未命名方案',
      thumb,
      spec: props.spec,
      tags: [props.spec.meta?.styleLabel, props.spec.meta?.programmeLabel].filter(Boolean),
    });
    library.items.unshift(res.item);
    library.total += 1;
    emit('saved', res.item);
  } catch (err) {
    alert(`存档失败：${err.message}`);
  } finally {
    saving.value = false;
  }
}

async function open(it) {
  const res = await fetch(`/api/library/${it.id}`);
  const data = await res.json();
  if (data.item?.spec) emit('open', data.item.spec);
}

async function pin(it) {
  const res = await updateLibraryItem(it.id, { pinned: !it.pinned });
  Object.assign(it, res.item);
  await load();
}

async function remove(it) {
  if (!confirm(`把《${it.title}》移到回收站？`)) return;
  const res = await deleteLibraryItem(it.id);
  Object.assign(library, res.library);
  trash.items = res.trash.items;
  trash.total = res.trash.total;
}

async function restore(it) {
  const res = await restoreLibraryItem(it.id);
  Object.assign(library, res.library);
  trash.items = res.trash.items;
  trash.total = res.trash.total;
  await loadTrash();
}

async function purgeOne(it) {
  if (!confirm(`彻底删除《${it.title}》？不可恢复。`)) return;
  await purgeLibraryItem(it.id);
  await loadTrash();
}

async function purgeAll() {
  if (!confirm('清空回收站？所有已删除方案将被永久移除。')) return;
  await emptyTrash();
  await loadTrash();
  library.trashCount = 0;
  await load();
}

function when(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

onMounted(load);
</script>

<style scoped>
.lib { display: flex; flex-direction: column; flex: 1; min-height: 0; background: var(--panel); }

.head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px 10px; border-bottom: 1px solid var(--line); gap: 8px;
}
.head-label { font-size: 11.5px; color: #8fa0b1; letter-spacing: 0.06em; }
.save-current {
  font-size: 11.5px; padding: 6px 10px; border-radius: 8px;
  border: 1px solid rgba(213, 163, 92, 0.4); color: var(--accent);
}
.save-current:disabled { opacity: 0.4; cursor: not-allowed; }

.search { display: flex; gap: 8px; padding: 10px 14px; }
.search input {
  flex: 1; min-width: 0; background: var(--panel-2); border: 1px solid var(--line);
  border-radius: 8px; color: var(--text); font-size: 12px; padding: 7px 9px; outline: none;
}
.search select {
  background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px;
  color: var(--muted); font-size: 11.5px; padding: 0 6px;
}

.filter-block { padding: 0 14px 10px; display: flex; flex-direction: column; gap: 7px; }
.filter-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.flabel { font-size: 10.5px; color: #6f7d8b; letter-spacing: 0.1em; margin-right: 2px; }
.chip {
  font-size: 11px; padding: 3px 8px; border-radius: 999px;
  border: 1px solid var(--line); color: #9fb0c0; background: transparent;
}
.chip i { font-style: normal; color: #66727f; margin-left: 3px; }
.chip.on { border-color: rgba(213, 163, 92, 0.55); color: #f1e4cd; background: rgba(213, 163, 92, 0.13); }
.chip.empty { opacity: 0.42; }

.list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 14px 16px; display: flex; flex-direction: column; gap: 10px; }

.card { display: flex; gap: 10px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: #131922; }
.thumb {
  position: relative; width: 104px; height: 76px; flex: 0 0 104px; border-radius: 7px; overflow: hidden;
  background: linear-gradient(135deg, #2a3441, #1a222c); cursor: pointer;
  display: grid; place-items: center;
}
.thumb.small { width: 84px; height: 62px; flex-basis: 84px; }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb .ph { font-size: 10px; color: #93a3b3; letter-spacing: 0.08em; }
.badge {
  position: absolute; left: 4px; bottom: 4px; font-size: 9.5px;
  padding: 1px 5px; border-radius: 4px; background: rgba(12, 16, 21, 0.72); color: #cfe0ef;
}
.style-timber { background: linear-gradient(135deg, #7a4a30, #3a2519); }
.style-tech { background: linear-gradient(135deg, #5c7285, #232c36); }
.style-brick { background: linear-gradient(135deg, #6b6f74, #2d3034); }
.style-industrial { background: linear-gradient(135deg, #8a4c33, #34211a); }
.style-minimal { background: linear-gradient(135deg, #d5d8da, #8a9299); }
.style-concrete { background: linear-gradient(135deg, #a79f8f, #4d4a44); }

.body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.title-row { display: flex; align-items: flex-start; gap: 6px; }
.title-row h4 { margin: 0; font-size: 12.5px; line-height: 1.4; font-weight: 600; cursor: pointer; flex: 1; }
.icon { color: #6f7d8b; font-size: 12px; padding: 0 2px; }
.icon.on { color: var(--accent); }
.meta { margin: 0; font-size: 10.5px; color: #7f8d9c; line-height: 1.5; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.tags span { font-size: 9.5px; color: #8fa0b1; border: 1px solid #26313e; border-radius: 4px; padding: 1px 5px; }
.actions { display: flex; gap: 6px; margin-top: 4px; }
.actions button { font-size: 10.5px; padding: 3px 9px; border: 1px solid #2c3745; border-radius: 6px; color: #a9b7c5; }
.actions button.danger { border-color: rgba(226, 121, 97, 0.35); color: #e0a093; }
.empty { font-size: 12px; line-height: 1.7; color: #6f7d8b; padding: 10px 2px; }

.trash-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; font-size: 11px; color: #7f8d9c; }
.trash-head button { font-size: 11px; padding: 4px 10px; border: 1px solid rgba(226, 121, 97, 0.35); border-radius: 7px; color: #e0a093; }
.trash-head button:disabled { opacity: 0.4; }
</style>
