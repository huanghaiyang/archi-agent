// Reference-image intake. If the active model can see images (Hy4 accepts one
// image per prompt, and most OpenAI-compatible vision models too) we ask it to
// read the architecture; otherwise we fall back to the dominant-colour palette
// computed in the browser, so the feature still works with a text-only model.

import { MATERIALS } from './palette.js';
import { PROGRAMMES, STYLES } from './generator.js';
import { chat, probeModel, supportsVision } from '../agent/llm.js';

const STYLE_PHRASE = {
  minimal: '极简白墙',
  industrial: '红砖工业风',
  timber: '木格栅',
  tech: '玻璃幕墙金属科技',
  brick: '青砖传统',
  concrete: '清水混凝土',
};

const MATERIAL_TO_STYLE = {
  'red-brick': 'industrial',
  'corten-steel': 'industrial',
  'grey-brick': 'brick',
  stone: 'brick',
  'clay-tile': 'brick',
  'timber-slat': 'timber',
  aluminium: 'tech',
  'blue-glass': 'tech',
  'metal-seam': 'tech',
  'dark-metal': 'tech',
  'white-plaster': 'minimal',
  'warm-concrete': 'concrete',
  'bronze-glass': 'industrial',
  'clear-glass': null,
};

const hexToRgb = (hex) => {
  const m = String(hex || '').replace('#', '').match(/([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
};

const distance = (a, b) => {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr * 2 + dg * dg * 4 + db * db * 3);
};

/** Map a browser-computed colour palette onto the nearest wall material.
 *  Palette entries arrive sorted by screen area, so the first colours weigh
 *  more than the tail — otherwise one small bright accent repaints the scheme. */
export function styleFromPalette(palette = []) {
  const colours = palette.map(hexToRgb).filter(Boolean);
  if (!colours.length) return { style: 'concrete', material: 'warm-concrete', score: 0, source: 'default' };
  const weights = colours.map((_, i) => 1 / (1 + i * 0.9));
  const total = weights.reduce((a, b) => a + b, 0);
  const scored = [];
  for (const [key, def] of Object.entries(MATERIALS)) {
    if (!MATERIAL_TO_STYLE[key]) continue;
    const target = hexToRgb(def.color);
    if (!target) continue;
    let score = 0;
    colours.forEach((c, i) => { score += weights[i] * distance(c, target); });
    score /= total;
    scored.push({ key, style: MATERIAL_TO_STYLE[key], score });
  }
  scored.sort((a, b) => a.score - b.score);
  const top = scored[0] || { style: 'concrete', material: 'warm-concrete', score: 0 };
  return { style: top.style || 'concrete', material: top.key, score: top.score, source: 'palette' };
}

function visionPrompt() {
  return [
    '你是一名主创建筑师。看这张建筑参考图，判断它的功能与风格。',
    '只输出一行 JSON，不要解释，不要代码块，格式：',
    '{"programme":"library|office|housing|museum|school|community","style":"minimal|industrial|timber|tech|brick|concrete","floors":整数,"materials":["材料键"],"description":"一句中文描述体量、材质、色彩"}',
    '风格键含义：minimal 极简白、industrial 红砖工业、timber 木构格栅、tech 金属玻璃幕墙、brick 青砖砖砌、concrete 清水混凝土。',
  ].join('\n');
}

const normalizeJson = (text) => {
  const s = String(text || '').replace(/```json|```/g, '').trim();
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i < 0 || j < 0) return null;
  try {
    return JSON.parse(s.slice(i, j + 1));
  } catch {
    return null;
  }
};

/**
 * @returns {programme, style, floors, materials, description, source}
 */
export async function analyzeReference({ image, palette = [], hint = '' } = {}) {
  const paletteGuess = styleFromPalette(palette);

  if (image && supportsVision()) {
    const probe = await probeModel();
    if (probe.reachable) {
      try {
        const res = await chat({
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: `${visionPrompt()}\n用户补充：${hint || '（无）'}` },
              { type: 'image_url', image_url: { url: image } },
            ],
          }],
          temperature: 0.2,
          maxTokens: 600,
        });
        const parsed = normalizeJson(res.content);
        if (parsed) {
          return {
            programme: PROGRAMMES[parsed.programme] ? parsed.programme : 'library',
            style: STYLES[parsed.style] ? parsed.style : paletteGuess.style,
            floors: Math.min(12, Math.max(1, Number(parsed.floors) || 4)),
            materials: Array.isArray(parsed.materials) ? parsed.materials.slice(0, 6) : [],
            description: String(parsed.description || '').slice(0, 120),
            source: 'vision',
            model: configModel(probe),
          };
        }
      } catch {
        /* fall through to the palette guess */
      }
    }
  }

  return {
    ...paletteGuess,
    programme: null,
    floors: null,
    materials: [],
    description: paletteGuess.source === 'palette'
      ? '按参考图主色匹配了最近的材质与风格（未启用视觉模型）'
      : '未启用视觉模型，使用默认风格',
    source: paletteGuess.source,
  };
}

function configModel(probe) {
  return probe?.model || probe?.provider || '';
}

const PROGRAMME_WORDS = {
  library: ['图书馆', '阅览'],
  office: ['办公'],
  housing: ['住宅', '公寓', '居住'],
  museum: ['美术馆', '博物馆', '展览'],
  school: ['学校', '教学楼', '小学', '中学'],
  community: ['社区中心', '社区服务', '活动中心'],
};

const detectFloors = (text) => {
  const m = String(text || '').match(/(\d+)\s*层/);
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= 12 ? n : null;
};

const detectProgramme = (text) => {
  const s = String(text || '');
  for (const [key, words] of Object.entries(PROGRAMME_WORDS)) {
    if (words.some((w) => s.includes(w))) return key;
  }
  return null;
};

const detectStyle = (text) => {
  const s = String(text || '');
  if (/极简|白墙|白涂/.test(s)) return 'minimal';
  if (/红砖|工业风|耐候钢/.test(s)) return 'industrial';
  if (/木格栅|木构|木材|木饰/.test(s)) return 'timber';
  if (/玻璃幕墙|金属幕墙|科技感/.test(s)) return 'tech';
  if (/青砖|砖砌|传统/.test(s)) return 'brick';
  if (/清水混凝土|混凝土/.test(s)) return 'concrete';
  return null;
};

/** Build the commission text handed to the deterministic engine / LLM.
 *  What the user typed wins over the reference image, so an explicit
 *  "6 层住宅" is never overwritten by the palette guess. */
export function referenceBrief(analysis = {}, { hint = '', dimensions = {} } = {}) {
  const base = String(hint || '').trim();
  const floors = detectFloors(base) || analysis.floors || null;
  const programme = detectProgramme(base) || analysis.programme || null;
  const styleKey = detectStyle(base) || analysis.style || null;
  const site = dimensions?.width && dimensions?.depth ? `${dimensions.width}×${dimensions.depth}m 场地，` : '';
  const description = analysis.description ? `（参考图：${analysis.description}）` : '';

  const head = [];
  if (floors) head.push(`${floors} 层`);
  if (programme) head.push(PROGRAMMES[programme]?.label || '社区图书馆');
  const style = styleKey ? STYLE_PHRASE[styleKey] : null;

  const lead = `${site}设计一栋${head.length ? ` ${head.join('')}` : '建筑'}${style ? `，${style}` : ''}${description}`;
  return base ? `${lead}；${base}` : `${lead}，请据此生成方案`;
}
