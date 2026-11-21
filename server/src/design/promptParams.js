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

/** 中国主要城市 → 气候区，用于 climate=auto 时自动推断。 */
export const CITIES = [
  { name: '哈尔滨', climate: 'severe-cold' },
  { name: '长春', climate: 'severe-cold' },
  { name: '沈阳', climate: 'severe-cold' },
  { name: '呼和浩特', climate: 'severe-cold' },
  { name: '乌鲁木齐', climate: 'severe-cold' },
  { name: '拉萨', climate: 'severe-cold' },
  { name: '北京', climate: 'temperate' },
  { name: '天津', climate: 'temperate' },
  { name: '西安', climate: 'temperate' },
  { name: '郑州', climate: 'temperate' },
  { name: '济南', climate: 'temperate' },
  { name: '青岛', climate: 'temperate' },
  { name: '上海', climate: 'temperate' },
  { name: '杭州', climate: 'temperate' },
  { name: '南京', climate: 'temperate' },
  { name: '武汉', climate: 'temperate' },
  { name: '成都', climate: 'temperate' },
  { name: '重庆', climate: 'temperate' },
  { name: '昆明', climate: 'temperate' },
  { name: '长沙', climate: 'temperate' },
  { name: '深圳', climate: 'hot-humid' },
  { name: '广州', climate: 'hot-humid' },
  { name: '厦门', climate: 'hot-humid' },
  { name: '海口', climate: 'hot-humid' },
  { name: '三亚', climate: 'hot-humid' },
  { name: '南宁', climate: 'hot-humid' },
];

/** 可选附加要求：只写进自然语言，不改变引擎的结构化参数。 */
const FEATURES = {
  skylight: { label: '屋面天窗', phrase: '屋面设天窗采光' },
  'pv-panel': { label: '屋面光伏', phrase: '屋面布置光伏板' },
  'green-roof': { label: '屋顶绿化', phrase: '屋面做屋顶绿化' },
  'roof-terrace': { label: '屋顶露台', phrase: '屋顶设开放露台' },
  canopy: { label: '入口雨棚', phrase: '主入口设雨棚' },
  ramp: { label: '无障碍坡道', phrase: '入口配无障碍坡道' },
  lift: { label: '无障碍电梯', phrase: '配无障碍电梯' },
  'double-height': { label: '首层通高门厅', phrase: '首层门厅通高 4.5m' },
  atrium: { label: '采光中庭', phrase: '设贯通采光中庭' },
  'sunken-court': { label: '下沉庭院', phrase: '设下沉庭院丰富首层空间' },
  'stilt-floor': { label: '首层架空', phrase: '首层局部架空形成灰空间' },
  'vertical-fin': { label: '竖向遮阳', phrase: '立面加竖向遮阳构件' },
  'double-eave': { label: '双层挑檐', phrase: '屋檐做双层挑檐' },
  'night-light': { label: '夜景照明', phrase: '立面做夜景泛光照明' },
  'rain-garden': { label: '雨水花园', phrase: '场地设雨水花园' },
  'bike-shed': { label: '自行车棚', phrase: '场地配自行车棚' },
  'plant-deck': { label: '屋面设备平台', phrase: '屋面设设备平台' },
  'solar-thermal': { label: '太阳能集热', phrase: '屋面配太阳能集热器' },
  'garage-entry': { label: '地下车库口', phrase: '场地设地下车库入口' },
  'water-feature': { label: '景观水池', phrase: '入口前场设浅水池' },
  playground: { label: '儿童活动场地', phrase: '场地设儿童活动场地' },
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
    climate: 'auto',
    area: 0,
    features: [],
    notes: '',
  },
  groups: [
    {
      key: 'context', label: '场地 / 地点', items: [
        {
          key: 'city', label: '城市', type: 'text', placeholder: '哈尔滨',
          options: CITIES.map((c) => c.name),
          hint: '选常见城市会自动推断气候区',
        },
        { key: 'width', label: '场地宽 (m)', type: 'number', min: 8, max: 200, step: 1, quick: [20, 24, 28, 30, 35, 40, 45, 50, 60, 80] },
        { key: 'depth', label: '场地进深 (m)', type: 'number', min: 8, max: 200, step: 1, quick: [18, 20, 22, 24, 26, 28, 30, 35, 40, 50] },
        {
          key: 'climate', label: '气候区', type: 'select', options: [
            { value: 'auto', label: '按城市自动' },
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
        { key: 'floors', label: '层数', type: 'range', min: 1, max: 12, step: 1, quick: [2, 3, 4, 5, 6, 8, 10, 12] },
        {
          key: 'area', label: '目标总建筑面积 (㎡，0=不限)', type: 'number', min: 0, max: 20000, step: 10,
          quick: [0, 500, 800, 1200, 2000, 3000, 5000, 8000],
        },
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
        { key: 'roofPitch', label: '屋面坡度 (°，0=默认)', type: 'number', min: 0, max: 60, step: 1, quick: [0, 15, 22, 30, 35] },
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
    // library
    { tag: '社区图书馆', name: '严寒·木构双坡', params: { city: '哈尔滨', programme: 'library', floors: 3, width: 40, depth: 28, style: 'timber', roof: 'gable', features: ['skylight', 'double-height', 'canopy'] } },
    { tag: '社区图书馆', name: '极简白·平屋顶', params: { city: '上海', programme: 'library', floors: 3, width: 45, depth: 32, style: 'minimal', roof: 'flat', features: ['green-roof', 'night-light', 'atrium'] } },
    { tag: '社区图书馆', name: '工业记忆·天窗', params: { city: '沈阳', programme: 'library', floors: 2, width: 36, depth: 30, style: 'industrial', roof: 'flat', features: ['skylight', 'pv-panel', 'bike-shed'] } },
    { tag: '社区图书馆', name: '湿热·清水混凝土', params: { city: '深圳', programme: 'library', floors: 3, width: 42, depth: 30, style: 'concrete', roof: 'shed', features: ['canopy', 'green-roof', 'rain-garden'] } },

    // office
    { tag: '企业办公楼', name: '幕墙·顶层退台', params: { city: '上海', programme: 'office', floors: 5, width: 36, depth: 30, style: 'tech', roof: 'flat', stepped: true, features: ['pv-panel', 'night-light'] } },
    { tag: '企业办公楼', name: '极简总部·平屋顶', params: { city: '杭州', programme: 'office', floors: 4, width: 40, depth: 34, style: 'minimal', roof: 'flat', features: ['pv-panel', 'green-roof', 'lift'] } },
    { tag: '企业办公楼', name: '红砖办公园', params: { city: '北京', programme: 'office', floors: 4, width: 45, depth: 30, style: 'industrial', roof: 'flat', features: ['solar-thermal', 'plant-deck'] } },
    { tag: '企业办公楼', name: '青砖·坡屋顶', params: { city: '西安', programme: 'office', floors: 3, width: 34, depth: 26, style: 'brick', roof: 'gable', features: ['canopy', 'atrium'] } },

    // housing
    { tag: '住宅', name: '6 层青砖住宅', params: { city: '哈尔滨', programme: 'housing', floors: 6, width: 44, depth: 26, style: 'brick', roof: 'gable', features: ['ramp'] } },
    { tag: '住宅', name: '8 层木构退台', params: { city: '成都', programme: 'housing', floors: 8, width: 40, depth: 28, style: 'timber', roof: 'flat', stepped: true, features: ['roof-terrace', 'green-roof'] } },
    { tag: '住宅', name: '12 层金属住宅', params: { city: '深圳', programme: 'housing', floors: 12, width: 32, depth: 28, style: 'tech', roof: 'flat', features: ['pv-panel', 'lift', 'playground'] } },
    { tag: '住宅', name: '7 层湿热住宅', params: { city: '广州', programme: 'housing', floors: 7, width: 38, depth: 26, style: 'concrete', roof: 'flat', features: ['green-roof', 'ramp', 'rain-garden'] } },

    // museum
    { tag: '美术馆', name: '清水混凝土·单坡', params: { city: '杭州', programme: 'museum', floors: 3, width: 48, depth: 34, style: 'concrete', roof: 'shed', features: ['skylight', 'ramp'] } },
    { tag: '美术馆', name: '极简白·天窗', params: { city: '上海', programme: 'museum', floors: 2, width: 40, depth: 32, style: 'minimal', roof: 'flat', features: ['skylight', 'night-light', 'atrium'] } },
    { tag: '美术馆', name: '工业记忆·四坡', params: { city: '北京', programme: 'museum', floors: 3, width: 44, depth: 30, style: 'industrial', roof: 'hip', features: ['skylight', 'pv-panel'] } },

    // school
    { tag: '教学楼', name: '4 层木构教学楼', params: { city: '哈尔滨', programme: 'school', floors: 4, width: 45, depth: 35, style: 'timber', roof: 'gable', features: ['skylight', 'ramp', 'playground'] } },
    { tag: '教学楼', name: '3 层清水混凝土', params: { city: '西安', programme: 'school', floors: 3, width: 42, depth: 32, style: 'concrete', roof: 'flat', features: ['green-roof', 'ramp', 'bike-shed'] } },
    { tag: '教学楼', name: '5 层青砖教学楼', params: { city: '济南', programme: 'school', floors: 5, width: 40, depth: 30, style: 'brick', roof: 'gable', features: ['ramp', 'lift'] } },

    // community
    { tag: '社区中心', name: '红砖社区中心', params: { city: '沈阳', programme: 'community', floors: 2, width: 32, depth: 24, style: 'industrial', roof: 'flat', features: ['canopy', 'ramp', 'bike-shed'] } },
    { tag: '社区中心', name: '极简·单坡社区中心', params: { city: '厦门', programme: 'community', floors: 2, width: 30, depth: 22, style: 'minimal', roof: 'shed', features: ['green-roof', 'ramp', 'playground'] } },
    { tag: '社区中心', name: '湿热社区中心', params: { city: '深圳', programme: 'community', floors: 3, width: 36, depth: 26, style: 'concrete', roof: 'flat', features: ['canopy', 'rain-garden', 'water-feature'] } },
  ],
};

const num = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const str = (v, fallback) => String(v ?? '').trim() || fallback;

/** Map a city name to a climate zone. */
export function climateForCity(city = '') {
  const key = String(city).trim();
  const hit = CITIES.find((c) => c.name === key);
  if (hit) return hit.climate;
  // tolerate free-form input that still mentions a region
  if (/哈尔滨|长春|沈阳|东北|内蒙|新疆|严寒|拉萨/i.test(key)) return 'severe-cold';
  if (/深圳|广州|海口|厦门|三亚|南方|湿热/i.test(key)) return 'hot-humid';
  return null;
}

/** Normalise arbitrary input into the parameter object the template expects. */
export function normalizeParams(input = {}) {
  const d = PARAM_SCHEMA.defaults;
  const programme = PROGRAMMES[input.programme] ? input.programme : d.programme;
  const style = STYLES[input.style] ? input.style : d.style;
  const roof = ROOF_PHRASE[input.roof] ? input.roof : d.roof;
  const city = str(input.city, d.city).slice(0, 24);
  const explicitClimate = CLIMATE_PHRASE[input.climate] ? input.climate : null;
  const climate = explicitClimate || climateForCity(city) || 'temperate';
  return {
    city,
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
      ? input.features.filter((f) => FEATURES[f]).slice(0, 10)
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
    { key: 'climate', label: '气候', expect: p.climate, got: parse.climate },
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
