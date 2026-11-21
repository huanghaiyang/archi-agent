# 筑野 ARCHI-AGENT

参考开源 **Tencent Hunyuan Hy4**（`Tencent-Hunyuan/Hy4`）实现的**建筑设计智能体**示例：Hy4 做方案判断与工具编排，本地确定性「设计引擎」负责几何、指标与规范校核，Vue 3 + Three.js 负责把方案实时渲成三维模型。

```
            ┌───────────────────────────────────────────────┐
 任务书  →   │  Vue 3 对话面板（SSE 流式事件）                    │
            └───────────────┬───────────────────────────────┘
                            │ POST /api/chat
            ┌───────────────▼───────────────────────────────┐
            │ Agent Loop (server/src/agent/loop.js)          │
            │  • Hy4 (OpenAI 兼容 /v1, tool calling)          │
            │  • 不可用时退化为本地确定性规划器                  │
            └───────┬───────────────────────┬───────────────┘
                    │ 9 个设计工具            │ 回退/校验
      ┌─────────────▼─────────────┐  ┌──────▼────────────────┐
      │ Design Engine             │  │ DesignSpec (JSON)      │
      │ 程序化体量/楼层/立面/屋面   │→ │ metrics + code checks  │
      └───────────────────────────┘  └──────┬────────────────┘
                                            │
                            ┌───────────────▼───────────────┐
                            │ Three.js 查看器（程序化建模）    │
                            │ 楼板/墙/门窗/楼梯/屋面/标注      │
                            └───────────────────────────────┘
```

![社区图书馆方案](docs/01-library-scheme.png)

![楼层隔离：一层平面与家具](docs/02-floor-isolate.png)

![办公楼 + 玻璃幕墙 + 平屋顶设备](docs/03-office-curtain.png)

![爆炸视图](docs/04-exploded.png)

![夜景：玻璃自发光](docs/05-night.png)

![室内：书架 / 阅览桌 / 隔墙 / 核心筒](docs/06-interior.png)

![住宅 8 层 + 青砖 + 陶瓦屋面](docs/07-housing.png)

![参数化提示词面板：左侧参数、右侧实时任务书与识别校验](docs/08-prompt-builder.png)


## 快速开始

```bash
npm run install:all     # 安装 web 依赖（server 零依赖）
npm run dev             # 同时启动 agent server (:8787) 与 Vite (:5173)
```

打开 <http://127.0.0.1:5173>。**不接模型也能完整跑通**：默认 `AGENT_MODE=auto`，探测不到 Hy4 时自动用本地规划器生成方案（同样会走 9 个工具，右侧可以看到工具时间线）。

只跑引擎自检：

```bash
npm run demo            # 生成一份方案并打印指标 / 规范校核
```

没有 GPU 也想验证 Hy4 那条链路？内置一个 OpenAI 兼容的 mock：

```bash
npm run test:hy4        # 启动 mock + agent，跑完整 tool-calling 循环并断言
```

它会依次触发 `design_scheme → edit_roof → check_codes → submit_design`，验证消息拼接、工具参数、Spec 合并与校验都能走通。手动体验：

```bash
npm run mock:hy4                                  # :8899 的假 Hy4
HY4_BASE_URL=http://127.0.0.1:8899/v1 AGENT_MODE=hy4 npm run dev
```

生产构建（server 直接托管静态文件，单端口 8787）：

```bash
npm run build && npm start
```

## 接入 Hy4

Hy4 是腾讯混元开源的 770B MoE 旗舰模型（49B 激活、1M 上下文），官方部署方式是 vLLM / SGLang 暴露 OpenAI 兼容接口，并用 `hy_v4` 解析工具调用。

```bash
# vLLM（官方镜像）
docker run --gpus all --privileged --ipc=host -p 8000:8000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  vllm/vllm-openai:hy4 tencent/Hy4-FP8 \
  --limit-mm-per-prompt '{"image":1,"video":0}' \
  --tensor-parallel-size 8 \
  --enable-auto-tool-choice \
  --reasoning-parser hy_v4 \
  --tool-call-parser hy_v4 \
  --served-model-name hy4 --port 8000
```

然后：

```bash
HY4_BASE_URL=http://127.0.0.1:8000/v1 HY4_MODEL=hy4 AGENT_MODE=hy4 npm run dev
```

Windows PowerShell：

```powershell
$env:HY4_BASE_URL="http://127.0.0.1:8000/v1"; $env:AGENT_MODE="hy4"; npm run dev
```

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `AGENT_MODE` | `auto` | `auto` 探测后回退 / `hy4` 优先走模型（失败仍会提示并回退） / `local` 纯本地 |
| `HY4_BASE_URL` | `http://127.0.0.1:8000/v1` | OpenAI 兼容地址 |
| `HY4_API_KEY` | `EMPTY` | vLLM 本地默认 EMPTY |
| `HY4_MODEL` | `hy4` | 与 `--served-model-name` 一致 |
| `HY4_REASONING` | `no_think` | `high` 开启长链推理（更慢、更深入） |
| `PORT` | `8787` | 服务端口 |

模型参数按官方推荐：`temperature=0.9`、`top_p=1.0`；`reasoning_effort` 通过 `chat_template_kwargs` 传入。

## 本地模型部署（不重启也能换模型）

除了环境变量，模型配置也可以直接在界面右上角的模型 chip 里改，写入 `server/data/settings.json`（tmp+rename 原子写），下次启动自动生效，优先级高于环境变量。

| `provider` | 指向 | 说明 |
| --- | --- | --- |
| `auto` | 先 Hy4 `:8000`，再 Ollama `:11434` | 探测不到就回退本地确定性引擎 |
| `hy4` | `MODEL_BASE_URL` / `HY4_BASE_URL` | 走 `chat_template_kwargs.reasoning_effort`、`tools` |
| `ollama` | `http://127.0.0.1:11434/v1` | 需 `ollama serve` + 一个 7B 级模型 |
| `openai` / `local` | 任意 OpenAI 兼容端点（llama.cpp / vLLM / LM Studio） | 不发 `reasoning_effort`，避免被拒 |

```bash
# 本机最轻的一条路径：Ollama
ollama pull qwen2.5:7b
ollama serve
# 然后在界面里选 ollama / 或：
MODEL_PROVIDER=ollama MODEL_NAME=qwen2.5:7b npm start
```

设置面板里的「测试连接」是 5s 探测（`/api/settings/test`），只验证 `/models` 或一次轻量补全能否返回，不代表模型会设计房子。`GET /api/health` 会回报 `provider / model / baseUrl / vision / hy4.reachable`。

## 参考图出方案

对话输入框左下角的「参考图」可以传一张图，前端先压到 1280px、并在图片中部采样 6 个主色（跳过天空过曝、阴影和植被像素），随后：

1. 若当前 provider 支持视觉（`/api/health` 的 `vision=true`），把图交给模型，要求一行 JSON：`{programme, style, floors, materials, description}`；
2. 否则（或模型返回不合规）用主色做加权 RGB 距离匹配最近的墙材风格（青砖→brick、木格栅→timber、铝/蓝玻→tech、白涂料→minimal、暖灰混凝土→concrete）；
3. 拼成任务书交给 Agent，**但用户在输入框里写的功能与层数优先**——写「做 6 层住宅」，参考图不会把它改成「4 层图书馆」。

参考图会落盘到 `server/data/refs/`，随会话一起恢复；`POST /api/reference` 可以只解析不生成方案。

## 参数化提示词（prompt builder）

左栏对话页右上角「参数化提示词」打开参数面板：13 个字段分成「场地/地点」「功能/规模」「风格/屋顶」「附加要求」四组，改动任意一项，右侧就重新组合出任务书，并即时回显每一项是否被引擎识别。

| 参数 | 去向 |
| --- | --- |
| 城市 / 场地宽 / 进深 | 任务书首句 `哈尔滨 40×28m 场地`，被 `parseBrief` 的正则读成 `site` |
| 功能类型 / 层数 / 目标面积 | `design_scheme` 的 `programme`、`floors`、`area` |
| 立面风格 / 屋顶形式 / 坡度 / 顶层退台 | `style`、`roof`（平/双坡/单坡/四坡）、`pitch`、`stepped` |
| 气候区 | `climate`（严寒 / 温和 / 湿热），影响南向开窗与密度上限 |
| 细部做法（天窗、光伏、屋顶绿化、雨棚、坡道、通高门厅、竖向遮阳、夜景） | 只写进自然语言，由模型挑对应工具落地 |
| 其他要求 | 原样拼进「补充：…」，不影响结构化字段 |

组合规则落在 `server/src/design/promptParams.js`：`PARAM_SCHEMA` 是表单元数据（前端直接按它渲染，不硬编码选项），`composePrompt()` 负责拼句子并**反向自检**——把生成的提示词再喂给 `parseBrief`，逐字段比对，识别不出来的会进 `warnings`（例如选了四坡屋顶但正则只认双坡，就会提示出来）。所以「参数组合」和「引擎真正吃到的值」永远对得上。

内置的预设与快捷值：

- **21 组预设**，按功能分 6 类（社区图书馆 4 / 企业办公楼 4 / 住宅 4 / 美术馆 3 / 教学楼 3 / 社区中心 3），覆盖 6 种风格 × 4 种屋顶 × 严寒/温和/湿热三种气候；
- **26 个城市**（哈尔滨→严寒、北京/上海/杭州→温和、深圳/广州/厦门→湿热），`气候区=按城市自动` 时随城市改口，不用手选；
- **场地尺寸/面积/坡度快捷值**：宽 20/24/28/30/35/40/45/50/60/80，进深 18…50，面积 0/500/800/1200/2000/3000/5000/8000，坡度 0/15/22/30/35，点一下即填；
- **21 种细部做法**（天窗、光伏、屋顶绿化、屋顶露台、雨棚、坡道、无障碍电梯、通高门厅、采光中庭、下沉庭院、首层架空、竖向遮阳、双层挑檐、夜景、雨水花园、自行车棚、设备平台、太阳能集热、车库口、景观水池、儿童场地），只进自然语言、不带风格词，所以不会把用户选的立面风格冲掉。

```javascript
// 纯后端也能用
import { composePrompt } from './server/src/design/promptParams.js';
const { prompt, checks, warnings } = composePrompt({ city: '哈尔滨', programme: 'library', floors: 3, width: 40, depth: 28, style: 'timber', roof: 'gable' });
```

接口：

- `GET /api/prompt/params` → `{ schema, vocab }`
- `POST /api/prompt/build` → `{ prompt, params, segments, checks, warnings }`
- `POST /api/prompt/design` → 组合后直接跑 Agent，返回 `{ prompt, spec, digest, checks }`（默认接着当前会话，传 `reset:true` 才清空）

面板底部三个出口：复制、填入对话（作为草稿，可继续改字或附参考图）、直接生成方案（一次性出图并保留对话历史）。

## 成品库 / 回收站 / 风格分类

左栏三个页签：**对话 / 成品库 / 回收站**。

- 方案生成后点「存入当前方案」，会用 `ArchiViewer.captureThumbnail()` 抓一张 520px 的 JPEG 缩略图存进库；
- 每项带 `title / style / programme / tags / summary(GFA、FAR、密度、窗地比、层数、房间数、高度) / spec / thumb / reference`；
- 列表支持标题搜索、按「最新 / 最早 / 名称 / 面积」排序、**风格 chip 与功能 chip 双维过滤**（chip 上带命中数，0 命中自动置灰）；
- 删除是软删除（进 `trash.json`，缩略图与参考图保留），回收站可「恢复」或「彻底删除」（后者连 `thumbs/`、`refs/` 里的文件一起清掉），也可一键清空；
- 6 种风格：`极简白 / 工业记忆 / 木构暖色 / 金属科技 / 砖砌传统 / 暖灰清水混凝土`；6 类功能：`社区图书馆 / 企业办公楼 / 住宅 / 美术馆 / 教学楼 / 社区中心`。从成品库「打开」会把 spec 回写到当前会话（`POST /api/spec`），后续编辑才对得上。

数据层：`server/data/{library,trash}.json`、`sessions/<sid>.json`（保留最近 30 轮对话 + 参考图 + spec）、`thumbs/`、`refs/`。这些运行数据不入库，`.gitignore` 已排除，仓库里只留 `.gitkeep`。

## 智能体的 9 个工具

模型只被允许通过工具改动方案，几何永远由引擎生成。

| 工具 | 作用 |
| --- | --- |
| `design_scheme` | 按任务书重生成总体方案（功能、层数、场地、风格、屋面） |
| `edit_roof` | 屋顶形式 / 坡度 / 出檐 / 女儿墙 / 屋面材料 |
| `edit_facade` | 立面体系（点窗 / 条窗 / 幕墙 / 格栅）、洞口尺寸、主材 |
| `edit_windows` | 按层 / 按房间调整采光面 |
| `edit_site` | 场地尺寸、退线、容积率与密度上限、气候区 |
| `set_floors` | 增减层数并重新排布 |
| `check_codes` | 规范自检，返回 pass / warn / fail |
| `submit_design` | 定稿并推送三维视图（可携带局部修改与设计说明） |
| *(内部)* `digest` | 每步回灌给模型的真实指标，避免模型编数字 |

**防幻觉设计**：`submit_design` 收到的任何面积、坐标、材料都会经 `normalizeAgentSpec()` 校验——越界房间会被裁剪，重叠房间整层回退到引擎布局，材料必须命中白名单，最后由 `metrics` 与 `checks` 单一来源计算。模型拿到的数值永远是工具返回值。

## 规范校核项

容积率、建筑密度、逐层窗地比、层高、疏散距离（到核心筒）、楼梯数量、退线、走廊净宽、最小房间面积、房间边界越界。

## DesignSpec 要点

```jsonc
{
  "site":    { "width": 40, "depth": 28, "setback": { "front": 5, "back": 4, "left": 4, "right": 4 } },
  "floors":  [ { "level": 1, "elevation": 0, "height": 4.5, "footprint": { "x": 5, "z": 9, "w": 24, "d": 14 },
                 "rooms": [ { "name": "门厅", "type": "public", "x": 5, "z": 9, "w": 8, "d": 5, "windows": { "s": true } } ] } ],
  "facade":  { "system": "punched", "windowWidth": 1.8, "gap": 1.2, "sillHeight": 0.9,
               "materials": { "wall": "warm-concrete", "glass": "bronze-glass" } },
  "massing": { "roof": { "type": "gable", "pitch": 26, "overhang": 0.6 } },
  "metrics": { "gfa": 1006.7, "far": 0.9, "coverage": 0.3, "windowFloorRatio": 0.2 },
  "checks":  [ { "id": "wfr", "name": "窗地比", "status": "pass" } ]
}
```

坐标：场地西北角为原点，`x` 向东、`z` 向南，单位米。`shared/facade.js` 里的开窗算法被服务端（算窗地比）和渲染器（画窗）共用，保证"指标和模型是同一份几何"。

## 目录

```
server/src/agent/     loop（双引擎）、llm（Hy4 客户端）、prompt、tools
server/src/design/    generator（程序化设计）、spec（校验合并）、rules（规范）、palette
shared/               facade.js：窗洞几何 + 面积，服务端与渲染器共用
web/src/scene/        ArchiViewer.js（编排）+ textures/batch/materials/facade/interior/roof/site 七个模块
web/src/components/   ChatPanel / SceneView / MetricsPanel
scripts/              dev.js（并行启动）、smoke.js（端到端自检）、mock-hy4.js + test-hy4-loop.js
docs/                 运行截图
```

## 三维查看器

渲染分成七个模块，按"构造层"而不是"一个盒子 + 开洞"来建模：

- `textures.js`：canvas 程序化贴图（清水混凝土板缝/螺栓孔、错缝砖、石板缝、竖向木纹、直立锁边金属、广场砖、草地、沥青），`scaleBoxUV` 按每个面的真实尺寸缩放 UV，贴图不会被拉伸到整面墙。
- `batch.js`：同材质几何合并，几百个构件合成每材质一次 draw call。
- `materials.js`：spec 的材料名 → three 材质；玻璃用 `MeshPhysicalMaterial`（清漆 + 环境反射），金属降低 metalness 并抬高 `envMapIntensity`，避免在 IBL 下变黑。
- `facade.js`：四套立面体系都带真实深度 —— 幕墙（0.45m 竖向 spandrel + 竖梃 + 横挺）、条窗（窗台/上口 + 中横档）、木格栅（外挑 0.34m 竖向鳍片 + 上下横档）、点窗（0.3m 深洞口 + 石质窗套/窗台 + 宽窗中梃）；另有落水管、外露柱廊、入口雨棚 + 三级台阶 + 双扇玻璃门 + 招牌。
- `interior.js`：内隔墙（带门洞）、核心筒（踏步 + 休息平台 + 栏杆 + 电梯井与厅门）、按房间类型的家具（书架、阅览桌 + 椅、办公桌组、会议长桌、接待台、展板、课桌、床/沙发、湿区隔断、机柜）。
- `roof.js`：平屋顶女儿墙 + 金属压顶 + 屋面机组/风管/采光天窗/雨水口/光伏阵列；坡屋顶脊瓦 + 檐口封边 + 天沟 + 山墙封板；退台形成的屋顶露台木平台 + 玻璃栏板。
- `site.js`：场地铺地、南侧街道与斑马线、绿化带/绿篱、乔木（树干 + 多层树冠）、长椅、阻车柱、路灯、停车、入口步道、接触阴影、用地红线。
- 交互：轴测 / 正立面 / 俯视，日 / 黄昏 / 夜（夜间玻璃自发光），屋顶、房间名、爆炸视图、周边体量、楼层隔离滑杆；导出 **GLB**。

开窗口径仍由 `shared/facade.js` 统一计算，所以立面上的玻璃面积和右栏"窗地比"永远对得上。

## 已知边界

- 平面为矩形标准层 + 走廊 + 端部核心筒的规则布局，不支持异形/L 形平面、坡地、幕墙分格详图。
- 「规范」是可解释的规则近似（疏散距离用曼哈顿距离、楼梯数量按层数与面积判断），不是地方规范条文库，不可直接用于报建。
- 单进程内存会话（按浏览器 `sid` 隔离），无持久化与多用户权限。

## 许可与致谢

Hy4 权重与代码遵循 Tencent Hy License / Apache 2.0（见官方仓库）；本项目仅为架构示例。
