// Tool contract exposed to Hy4. Each tool is a small, idempotent design
// operation on the session draft; the model orchestrates them, the engine does
// the geometry and the validation.

import {
  finalize,
  newDraft,
  normalizeAgentSpec,
  patchFacade,
  patchRoof,
  patchSite,
  patchWindows,
  regenerate,
} from '../design/spec.js';
import { MATERIAL_KEYS, ROOM_TYPE_KEYS, MATERIALS, ROOM_TYPES } from '../design/palette.js';
import { PROGRAMME_KEYS, STYLE_KEYS } from '../design/generator.js';

const SIDES = ['n', 's', 'e', 'w'];

export const tools = [
  {
    type: 'function',
    function: {
      name: 'design_scheme',
      description: '根据任务书生成（或重生成）总体方案：功能类型、层数、场地尺寸、体量、房间排布。会覆盖现有草稿。核心筒必须各层对位，楼梯上方须留梯井洞口，保证楼层可达。',
      parameters: {
        type: 'object',
        properties: {
          programme: { type: 'string', enum: PROGRAMME_KEYS, description: '功能类型' },
          floors: { type: 'integer', minimum: 1, maximum: 12 },
          site_width: { type: 'number', description: '场地东西向宽度(m)' },
          site_depth: { type: 'number', description: '场地南北向进深(m)' },
          area: { type: 'number', description: '目标总建筑面积(㎡)，可选' },
          style: { type: 'string', enum: STYLE_KEYS, description: '立面风格' },
          roof: { type: 'string', enum: ['flat', 'gable', 'shed', 'hip'] },
          stepped: { type: 'boolean', description: '顶层是否退台' },
          climate: { type: 'string', enum: ['severe-cold', 'hot-humid', 'temperate'] },
        },
        required: ['programme', 'floors'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_roof',
      description: '修改屋顶形式、坡度、出檐、女儿墙或屋面材料。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['flat', 'gable', 'shed', 'hip'] },
          pitch: { type: 'number', description: '坡度(°)，坡屋顶有效' },
          overhang: { type: 'number', description: '出檐(m)' },
          parapet: { type: 'number', description: '女儿墙高(m)，平屋顶有效' },
          material: { type: 'string', enum: MATERIAL_KEYS },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_facade',
      description: '调整立面体系（开窗方式）、洞口尺寸、窗台高度与主材配色。',
      parameters: {
        type: 'object',
        properties: {
          system: { type: 'string', enum: ['punched', 'ribbon', 'curtain', 'screen'], description: 'punched点窗/ribbon条窗/curtain幕墙/screen格栅' },
          windowWidth: { type: 'number', description: '单樘窗洞宽(m) 0.6-4' },
          gap: { type: 'number', description: '窗间墙宽(m) 0.3-3' },
          sillHeight: { type: 'number', description: '窗台高(m)' },
          materials: {
            type: 'object',
            properties: {
              wall: { type: 'string', enum: MATERIAL_KEYS },
              glass: { type: 'string', enum: MATERIAL_KEYS },
              frame: { type: 'string', enum: MATERIAL_KEYS },
              roof: { type: 'string', enum: MATERIAL_KEYS },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_windows',
      description: '按层调整某个（或全部）房间的采光面。sides 传入后即为该房间开窗面集合。',
      parameters: {
        type: 'object',
        properties: {
          level: { type: 'integer', description: '楼层号' },
          room: { type: 'string', description: '房间 id 或名称，缺省为整层' },
          sides: { type: 'array', items: { type: 'string', enum: SIDES }, description: '开窗朝向：n北 s南 e东 w西' },
          value: { type: 'boolean', description: '不传 sides 时，统一开关该层所有窗' },
        },
        required: ['level'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_site',
      description: '调整场地尺寸、退线、容积率/密度上限或气候区。',
      parameters: {
        type: 'object',
        properties: {
          width: { type: 'number' },
          depth: { type: 'number' },
          farLimit: { type: 'number' },
          coverageLimit: { type: 'number' },
          climate: { type: 'string' },
          setback: {
            type: 'object',
            properties: { front: { type: 'number' }, back: { type: 'number' }, left: { type: 'number' }, right: { type: 'number' } },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_floors',
      description: '增加或减少层数（会按现有功能重新排布各层房间）。',
      parameters: {
        type: 'object',
        properties: { count: { type: 'integer', minimum: 1, maximum: 12 } },
        required: ['count'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_codes',
      description: '运行规范自检（容积率、密度、窗地比、层高、疏散距离、退线、走廊宽度等），返回硬性冲突与提示项。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_design',
      description: '提交最终方案给三维查看器。可只传修改意见（如 title / roof / facade / 部分楼层房间），引擎会与当前草稿合并并校验。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '方案名称' },
          notes: { type: 'array', items: { type: 'string' }, description: '设计说明，2-4 条，写给业主看的' },
          site: {
            type: 'object',
            properties: {
              width: { type: 'number' },
              depth: { type: 'number' },
              setback: {
                type: 'object',
                properties: { front: { type: 'number' }, back: { type: 'number' }, left: { type: 'number' }, right: { type: 'number' } },
              },
              farLimit: { type: 'number' },
              coverageLimit: { type: 'number' },
              climate: { type: 'string' },
            },
          },
          roof: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['flat', 'gable', 'shed', 'hip'] },
              pitch: { type: 'number' },
              overhang: { type: 'number' },
              parapet: { type: 'number' },
              material: { type: 'string', enum: MATERIAL_KEYS },
            },
          },
          facade: {
            type: 'object',
            properties: {
              system: { type: 'string', enum: ['punched', 'ribbon', 'curtain', 'screen'] },
              windowWidth: { type: 'number' },
              gap: { type: 'number' },
              sillHeight: { type: 'number' },
              materials: {
                type: 'object',
                properties: {
                  wall: { type: 'string', enum: MATERIAL_KEYS },
                  glass: { type: 'string', enum: MATERIAL_KEYS },
                  frame: { type: 'string', enum: MATERIAL_KEYS },
                  roof: { type: 'string', enum: MATERIAL_KEYS },
                },
              },
            },
          },
          floors: {
            type: 'array',
            description: '可选：自定义每层房间矩形（x,z,w,d，单位米，原点为场地西南角，x向东、z向北为负）',
            items: {
              type: 'object',
              properties: {
                level: { type: 'integer' },
                name: { type: 'string' },
                rooms: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      type: { type: 'string', enum: ROOM_TYPE_KEYS },
                      x: { type: 'number' },
                      z: { type: 'number' },
                      w: { type: 'number' },
                      d: { type: 'number' },
                      windows: {
                        type: 'object',
                        properties: { n: { type: 'boolean' }, s: { type: 'boolean' }, e: { type: 'boolean' }, w: { type: 'boolean' } },
                      },
                    },
                    required: ['name', 'x', 'z', 'w', 'd'],
                  },
                },
              },
              required: ['level', 'rooms'],
            },
          },
        },
      },
    },
  },
];

// ---------------------------------------------------------------- execution
export function createSession(brief = '') {
  return {
    brief,
    spec: newDraft(brief),
    startedAt: Date.now(),
    toolLog: [],
  };
}

export async function runTool(session, name, args = {}) {
  const spec = session.spec;
  switch (name) {
    case 'design_scheme': {
      const patch = {
        programme: args.programme,
        floors: args.floors,
        site: args.site_width && args.site_depth ? { width: args.site_width, depth: args.site_depth } : spec.buildOptions?.site,
        area: args.area,
        style: args.style,
        roof: args.roof,
        stepped: args.stepped,
        climate: args.climate,
        plate: null,
      };
      session.spec = regenerate({ ...spec, roomOverrides: {} }, patch);
      session.brief = session.brief || spec.meta.brief;
      session.spec.meta.brief = session.brief;
      return {
        summary: `${session.spec.meta.title}｜${session.spec.floors.length} 层｜GFA ${session.spec.metrics.gfa}㎡｜容积率 ${session.spec.metrics.far}｜房间 ${session.spec.metrics.roomCount} 间`,
        data: digest(session.spec),
      };
    }
    case 'edit_roof': {
      const s = patchRoof(spec, args);
      finalize(spec);
      return { summary: `屋顶已更新：${s}`, data: digest(spec) };
    }
    case 'edit_facade': {
      const s = patchFacade(spec, args);
      finalize(spec);
      return { summary: `立面已更新：${s}`, data: digest(spec) };
    }
    case 'edit_windows': {
      const s = patchWindows(spec, args);
      finalize(spec);
      return { summary: s, data: digest(spec) };
    }
    case 'edit_site': {
      const s = patchSite(spec, args);
      session.spec = regenerate(spec, {
        site: { width: spec.site.width, depth: spec.site.depth },
        climate: spec.site.climate,
      });
      session.spec.site.farLimit = spec.site.farLimit;
      session.spec.site.coverageLimit = spec.site.coverageLimit;
      session.spec.site.setback = spec.site.setback;
      finalize(session.spec);
      return { summary: `场地已更新：${s}`, data: digest(session.spec) };
    }
    case 'set_floors': {
      const plate = spec.floors[0]?.footprint;
      session.spec = regenerate(spec, {
        floors: args.count,
        plate: plate ? { w: plate.w, d: plate.d } : null,
      });
      return { summary: `层数调整为 ${session.spec.floors.length} 层，GFA ${session.spec.metrics.gfa}㎡`, data: digest(session.spec) };
    }
    case 'check_codes': {
      finalize(spec);
      return {
        summary: spec.checkSummary.headline,
        data: {
          metrics: spec.metrics,
          checks: spec.checks,
          summary: spec.checkSummary,
        },
      };
    }
    case 'submit_design': {
      const merged = normalizeAgentSpec(args, spec);
      session.spec = merged;
      return {
        summary: `方案已提交：${merged.meta.title}，${merged.checkSummary.headline}`,
        data: digest(merged),
      };
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

export function digest(spec) {
  return {
    title: spec.meta.title,
    programme: spec.meta.programmeLabel,
    floors: spec.floors.length,
    site: { width: spec.site.width, depth: spec.site.depth, setback: spec.site.setback, farLimit: spec.site.farLimit, coverageLimit: spec.site.coverageLimit },
    facade: spec.facade,
    roof: spec.massing.roof,
    metrics: spec.metrics,
    checks: spec.checkSummary,
    checkList: spec.checks,
    floorSummary: spec.floors.map((f) => ({
      level: f.level,
      height: f.height,
      footprint: f.footprint,
      rooms: f.rooms.map((r) => ({ id: r.id, name: r.name, w: r.w, d: r.d, windows: r.windows })),
    })),
  };
}

export function paletteSummary() {
  return {
    materials: Object.entries(MATERIALS).map(([k, v]) => `${k}(${v.label})`).join('、'),
    roomTypes: Object.entries(ROOM_TYPES).map(([k, v]) => `${k}(${v.label})`).join('、'),
  };
}
