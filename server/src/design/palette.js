// Material palette shared by the design spec (semantic keys) and the Three.js
// viewer (concrete colours / roughness). Keys are what the agent is allowed to
// emit; the renderer never sees raw hex from the model.

export const MATERIALS = {
  'warm-concrete': { label: '暖灰清水混凝土', color: '#cfc8bd', roughness: 0.82, metalness: 0.0 },
  'white-plaster': { label: '白色涂料', color: '#ecebe7', roughness: 0.9, metalness: 0.0 },
  'red-brick': { label: '红砖', color: '#a8583f', roughness: 0.88, metalness: 0.0 },
  'grey-brick': { label: '青砖', color: '#6f7175', roughness: 0.85, metalness: 0.0 },
  'timber-slat': { label: '木格栅', color: '#a97845', roughness: 0.7, metalness: 0.0 },
  'corten-steel': { label: '耐候钢', color: '#8a4c33', roughness: 0.55, metalness: 0.35 },
  'dark-metal': { label: '深灰金属', color: '#3f4347', roughness: 0.45, metalness: 0.55 },
  'aluminium': { label: '银白铝板', color: '#c9ced3', roughness: 0.35, metalness: 0.7 },
  'blue-glass': { label: '蓝灰玻璃', color: '#6f8ea3', roughness: 0.08, metalness: 0.15, opacity: 0.42 },
  'clear-glass': { label: '高透玻璃', color: '#a8c3cc', roughness: 0.05, metalness: 0.1, opacity: 0.3 },
  'bronze-glass': { label: '青铜色玻璃', color: '#7d6a52', roughness: 0.1, metalness: 0.2, opacity: 0.40 },
  'metal-seam': { label: '金属屋面', color: '#54595e', roughness: 0.4, metalness: 0.6 },
  'clay-tile': { label: '陶瓦屋面', color: '#8c4a3a', roughness: 0.8, metalness: 0.0 },
  'green-roof': { label: '种植屋面', color: '#5f7a4b', roughness: 1.0, metalness: 0.0 },
  'stone': { label: '石材', color: '#b8b2a6', roughness: 0.75, metalness: 0.0 },
};

export const ROOM_TYPES = {
  public: { label: '公共', floor: '#a9b6c0', height: 4.2 },
  circulation: { label: '交通', floor: '#9aa5af', height: 3.9 },
  office: { label: '办公', floor: '#cbbca2', height: 3.6 },
  meeting: { label: '会议', floor: '#bdae9c', height: 3.6 },
  study: { label: '阅览/学习', floor: '#d3bd8f', height: 3.9 },
  classroom: { label: '教学', floor: '#c7b98f', height: 3.9 },
  exhibition: { label: '展览', floor: '#b6b3ab', height: 4.5 },
  service: { label: '服务/商业', floor: '#c8b28e', height: 3.6 },
  residential: { label: '居住', floor: '#d2bb95', height: 3.0 },
  wet: { label: '卫生间/厨房', floor: '#93a9ae', height: 3.0 },
  technical: { label: '设备/储藏', floor: '#8e979e', height: 3.0 },
};

export const MATERIAL_KEYS = Object.keys(MATERIALS);
export const ROOM_TYPE_KEYS = Object.keys(ROOM_TYPES);

export function materialOf(key) {
  return MATERIALS[key] || MATERIALS['warm-concrete'];
}
