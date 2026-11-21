// Parameterised task-brief builder. Every parameter maps to a phrase the
// deterministic engine (parseBrief) and the LLM both understand, so the same
// string can be typed by a human or generated from a form.
//
// Rules that matter:
// - phrases must not collide: adding "木格栅" as a decorative feature would
//   override a style the user picked, so features avoid style vocab.
// - floors / site / area / roof / stepped / climate all have keywords in
//   parseBrief; anything without a keyword is reported as a "free hint" that
//   only the model can honour.

import { PROGRAMMES, STYLES, parseBrief } from './generator.js';

const STYLE_PHRASE = {
  minimal: '极简白墙',
  industrial: '红砖工业风',
  timber: '木格栅',
  tech: '玻璃幕墙金属科技',
  brick: '青砖传统',
  concrete: '清水混凝土',
};

const ROOF_PHRASE = {
  flat: '平屋顶',
  gable: '双坡屋顶',
  shed: '单坡屋顶',
  hip: '四坡屋顶',
};

const CLIMATE_PHRASE = {
  'severe-cold': '严寒气候，注意保温与南向采光',
  'hot-humid': '湿热气候，注意遮阳与通风',
  temperate: '温和气候，兼顾采光与通风',
};

const CITY_CLIMATE = [
  { re: /哈尔滨|长春|沈阳|东北|内蒙|严寒|乌鲁木齐/i, climate: 'severe-cold' },
  { re: /深圳|广州|海口|厦门|南方|湿热|三亚/i, climate: 'hot-humid' },
];

/** 可选附加要求：只写进自然语言，不改变引擎的结构化参数。 */
const FEATURES = {
  skylight: { label: '屋面天窗', phrase: '屋面设天窗采光' },
  'pv-panel': { label: '屋面光伏', phrase: '屋面布置光伏板' },
  'green-roof': { label: '屋顶绿化', phrase: '屋面做屋顶绿化' },
  canopy: { label: '入口雨棚', phrase: '主入口设雨棚' },
  ramp: { label: '无障碍坡道', phrase: '入口配无障碍坡道' },
  'double-height': { label: '首层通高门厅', phrase: '首层门厅通高 4.5m' },
  'vertical-fin': { label: '竖向遮阳', phrase: '立面加竖向遮阳构件' },
  'night-light': { label: '夜景照明', phrase: '立面做夜景泛光照明' },
};

/** 表单元数据；前端只按这个渲染，不再硬编码选项。 */
export const PARAM_SCHEMA = {
  defaults: {
    city: '哈尔滨',
    programme: 'library',
    floors: 3,
    width: 40,
    depth: 28,
    style: 'timber',
    roof: 'gable',
    roofPitch: 0,
    stepped: false,
    climate: 'severe-cold',
    area: 0,
    features: [],
    notes: '',
  },
  groups: [
    {
      key: 'context', label: '场地 / 地点', items: [
        { key: 'city', label: '城市', type: 'text', placeholder: '哈尔滨' },
        { key: 'width', label: '场地宽 (m)', type: 'number', min: 12, max: 200, step: 1 },
        { key: 'depth', label: '场地进深 (m)', type: 'number', min: 12, max: 200, step: 1 },
        {
          key: 'climate', label: '气候区', type: 'select', options: [
            { value: 'severe-cold', label: '严寒' },
            { value: 'temperate', label: '温和' },
            { value: 'hot-humid', label: '湿热' },
          ],
        },
      ],
    },
    {
      key: 'programme', label: '功能 / 规模', items: [
        {
          key: 'programme', label: '功能类型', type: 'select',
          options: Object.entries(PROGRAMMES).map(([value, def]) => ({ value, label: def.label })),
        },
        { key: 'floors', label: '层数', type: 'range', min: 1, max: 12, step: 1 },
        { key: 'area', label: '目标总建筑面积 (㎡，0=不限)', type: 'number', min: 0, max: 20000, step: 10 },
      ],
    },
    {
      key: 'style', label: '风格 / 屋顶', items: [
        {
          key: 'style', label: '立面风格', type: 'select',
          options: Object.entries(STYLES).map(([value, def]) => ({ value, label: def.label })),
        },
        {
          key: 'roof', label: '屋顶形式', type: 'select',
          options: Object.keys(ROOF_PHRASE).map((value) => ({ value, label: ROOF_PHRASE[value] })),
        },
        { key: 'roofPitch', label: '屋面坡度 (°，0=默认)', type: 'number', min: 0, max: 60, step: 1 },
        { key: 'stepped', label: '顶层退台', type: 'boolean' },
      ],
    },
    {
      key: 'extras', label: '附加要求', items: [
        {
          key: 'features', label: '细部做法', type: 'multi',
          options: Object.entries(FEATURES).map(([value, def]) => ({ value, label: def.label })),
        },
        { key: 'notes', label: '其他要求（自由文本）', type: 'textarea', placeholder: '例如：南向主入口，首层设咖啡书吧，屋面不允许积水' },
      ],
    },
  ],
  presets: [
    {
      name: '严寒社区图书馆',
      params: { city: '哈尔滨', programme: 'library', floors: 3, width: 40, depth: 28, style: 'timber', roof: 'gable', climate: 'severe-cold', features: ['skylight', 'double-height', 'canopy'] },
    },
    {
      name: '企业办公楼（幕墙+退台）',
      params: { city: '上海', programme: 'office', floors: 5, width: 36, depth: 30, style: 'tech', roof: 'flat', climate: 'temperate', stepped: true, features: ['pv-panel', 'night-light'] },
    },
    {
      name: '6 层青砖住宅',
      params: { city: '哈尔滨', programme: 'housing', floors: 6, width: 44, depth: 26, style: 'brick', roof: 'gable', climate: 'severe-cold', features: ['ramp'] },
    },
    {
      name: '美术馆（清水混凝土）',
      params: { city: '杭州', programme: 'museum', floors: 3, width: 48, depth: 34, style: 'concrete', roof: 'shed', climate: 'temperate', features: ['skylight', 'ramp'] },
    },
  ],
};

const num = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const str = (v, fallback) => String(v ?? '').trim() || fallback;

/** Normalise arbitrary input into the parameter object the template expects. */
export function normalizeParams(input = {}) {
  const d = PARAM_SCHEMA.defaults;
  const programme = PROGRAMMES[input.programme] ? input.programme : d.programme;
  const style = STYLES[input.style] ? input.style : d.style;
  const roof = ROOF_PHRASE[input.roof] ? input.roof : d.roof;
  const climate = CLIMATE_PHRASE[input.climate] ? input.climate : d.climate;
  return {
    city: str(input.city, d.city).slice(0, 24),
    programme,
    floors: Math.round(num(input.floors, 1, 12, d.floors)),
    width: Math.round(num(input.width, 8, 200, d.width)),
    depth: Math.round(num(input.depth, 8, 200, d.depth)),
    style,
    roof,
    roofPitch: Math.round(num(input.roofPitch, 0, 60, 0)),
    stepped: Boolean(input.stepped),
    climate,
    area: Math.round(num(input.area, 0, 20000, 0)),
    features: Array.isArray(input.features)
      ? input.features.filter((f) => FEATURES[f]).slice(0, 8)
      : [],
    notes: str(input.notes, '').slice(0, 200),
  };
}

/** Compose the Chinese task brief. Deterministic, no model call. */
export function composePrompt(rawParams = {}) {
  const p = normalizeParams(rawParams);
  const known = [];

  const site = `${p.city === '' ? '' : `${p.city} `}${p.width}×${p.depth}m 场地`;
  known.push({ key: 'site', label: '场地', text: site });

  const head = `设计 ${p.floors} 层${PROGRAMMES[p.programme].label}`;
  known.push({ key: 'floors', label: '层数', text: `${p.floors} 层` });
  known.push({ key: 'programme', label: '功能', text: PROGRAMMES[p.programme].label });

  const styleText = STYLE_PHRASE[p.style] || STYLES[p.style].label;
  known.push({ key: 'style', label: '风格', text: styleText });

  const roofText = ROOF_PHRASE[p.roof];
  known.push({ key: 'roof', label: '屋顶', text: roofText });

  const roofDetail = p.roofPitch > 0 && p.roof !== 'flat' ? `${roofText}（坡度 ${p.roofPitch}°）` : roofText;

  const parts = [
    `${site}，${head}，${styleText}立面，${roofDetail}`,
  ];

  const extra = [];
  if (p.stepped) extra.push('顶层退台一层');
  if (p.area) {
    extra.push(`目标总建筑面积约 ${p.area}㎡`);
    known.push({ key: 'area', label: '建筑面积', text: `${p.area}㎡` });
  }
  if (p.climate) extra.push(CLIMATE_PHRASE[p.climate]);

  const featureTexts = p.features.map((f) => FEATURES[f].phrase);
  if (featureTexts.length) extra.push(...featureTexts);

  if (extra.length) parts.push(`要求：${extra.join('；')}`);
  if (p.notes) parts.push(`补充：${p.notes}`);

  const prompt = `${parts.join('。')}。`;

  const parse = parseBrief(prompt);
  const checks = [
    { key: 'programme', label: '功能', expect: p.programme, got: parse.programme },
    { key: 'floors', label: '层数', expect: p.floors, got: parse.floors },
    { key: 'site', label: '场地', expect: `${p.width}×${p.depth}`, got: parse.site ? `${parse.site.width}×${parse.site.depth}` : undefined },
    { key: 'style', label: '风格', expect: p.style, got: parse.style },
    { key: 'roof', label: '屋顶', expect: p.roof, got: parse.roof },
    { key: 'stepped', label: '退台', expect: p.stepped || undefined, got: parse.stepped },
  ];
  const warnings = checks
    .filter((c) => c.expect !== undefined && String(c.expect) !== String(c.got))
    .map((c) => `「${c.label}」未能被引擎识别（期望 ${c.expect}，实际 ${c.got ?? '无'}）`);

  return {
    prompt,
    params: p,
    segments: {
      site,
      volume: `${head}，${styleText}立面，${roofDetail}`,
      requirements: extra,
      notes: p.notes || '',
    },
    known,
    parse,
    checks,
    warnings,
    tokens: prompt.length,
  };
}

/** Map a city name to a climate zone, used when the user only typed a city. */
export function climateForCity(city = '') {
  const hit = CITY_CLIMATE.find((c) => c.re.test(city));
  return hit ? hit.climate : null;
}
