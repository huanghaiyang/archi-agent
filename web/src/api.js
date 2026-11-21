// Browser API layer: SSE chat, session history, model settings, reference
// images and the finished-scheme library.

export const SID = (() => {
  const key = 'archi-agent-sid';
  let v = localStorage.getItem(key);
  if (!v) {
    v = `s${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(key, v);
  }
  return v;
})();

async function req(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export const getHealth = async () => {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`health ${res.status}`);
  return res.json();
};

export const getSpec = async () => {
  const json = await req(`/api/spec?sid=${SID}`);
  return json.spec || null;
};

export const getSession = () => req(`/api/history?sid=${SID}`);

export const clearHistory = () => req(`/api/history?sid=${SID}`, { method: 'DELETE' });

export const resetSession = () => req('/api/reset', {
  method: 'POST',
  body: JSON.stringify({ sid: SID }),
});

export const adoptSpec = (spec) => req('/api/spec', {
  method: 'POST',
  body: JSON.stringify({ sid: SID, spec }),
});

// ------------------------------------------------------------------ settings
export const getSettings = () => req('/api/settings');

export const saveSettings = (payload) => req('/api/settings', {
  method: 'POST',
  body: JSON.stringify(payload),
});

export const testProvider = (provider) => req('/api/settings/test', {
  method: 'POST',
  body: JSON.stringify({ provider }),
});

// ----------------------------------------------------------------- reference
export const analyzeReferenceImage = ({ image, palette, message, dimensions }) => req('/api/reference', {
  method: 'POST',
  body: JSON.stringify({ image, palette, message, dimensions }),
});

// ------------------------------------------------------------------- library
export const listLibrary = (params = {}) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return req(`/api/library?${qs.toString()}`);
};

export const getLibraryItem = (id) => req(`/api/library/${id}`);

export const saveToLibrary = (payload = {}) => req('/api/library', {
  method: 'POST',
  body: JSON.stringify({ sid: SID, ...payload }),
});

export const updateLibraryItem = (id, patch) => req(`/api/library/${id}`, {
  method: 'PATCH',
  body: JSON.stringify(patch),
});

export const deleteLibraryItem = (id) => req(`/api/library/${id}`, { method: 'DELETE' });

export const listTrash = () => req('/api/trash');

export const restoreLibraryItem = (id) => req(`/api/trash/${id}/restore`, { method: 'POST' });

export const purgeLibraryItem = (id) => req(`/api/trash/${id}`, { method: 'DELETE' });

export const emptyTrash = () => req('/api/trash', { method: 'DELETE' });

// ---------------------------------------------------------------------- chat
export async function chatStream({ message, mode, image, palette, dimensions, onEvent, signal }) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, mode, sid: SID, image, palette, dimensions }),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`chat ${res.status} ${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (!chunk.startsWith('data:')) continue;
      const payload = chunk.slice(5).trim();
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload));
      } catch (err) {
        console.warn('bad SSE payload', payload, err);
      }
    }
  }
}

/** Dominant colours from an image file, used when no vision model is configured. */
export function paletteFromImage(file, count = 6) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        const s = 48;
        c.width = s;
        c.height = s;
        const ctx = c.getContext('2d');
        // Sample the body of the building rather than the whole frame: sky and
        // ground planes otherwise dominate and paint every scheme blue/green.
        const sx = img.width * 0.15;
        const sy = img.height * 0.3;
        ctx.drawImage(
          img,
          sx, sy, img.width * 0.7, img.height * 0.7,
          0, 0, s, s,
        );
        const data = ctx.getImageData(0, 0, s, s).data;
        const buckets = new Map();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 200) continue;
          const key = `${Math.round(r / 32)}-${Math.round(g / 32)}-${Math.round(b / 32)}`;
          const prev = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
          prev.n += 1;
          prev.r += r;
          prev.g += g;
          prev.b += b;
          buckets.set(key, prev);
        }
        const top = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, count);
        const hex = (v) => v.toString(16).padStart(2, '0');
        resolve(top.map((t) => `#${hex(Math.round(t.r / t.n))}${hex(Math.round(t.g / t.n))}${hex(Math.round(t.b / t.n))}`));
      } catch {
        resolve([]);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve([]);
    };
    img.src = url;
  });
}

export function readFileAsDataUrl(file, maxWidth = 1280) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = reader.result;
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxWidth / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.86));
        } catch {
          resolve(raw);
        }
      };
      img.onerror = () => resolve(raw);
      img.src = raw;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
