# yi-jia v1.2.0 —— 游戏引擎档案（学习开源汉化工具的多类型支持）

> 状态：进行中。调研日期：2026-10-20。前一版方案见 [multilang-plan.md](multilang-plan.md)。

## 一、开源项目的成功经验（调研结论）

调研了三个成熟汉化工具的多游戏类型支持设计：

| 项目 | 组织方式 | 可借鉴点 |
|---|---|---|
| [GalTransl](https://github.com/GalTransl/GalTransl)（GPL-3.0，2.3k★） | yapsy 插件：`file_*`（格式归一化）/ `text_*`（文本清洗钩子）/ `problem_*`（译后质检）；检测分层：扩展名 → 内容嗅探 → 文件头魔数 → 显式指定 | 声明式能力注册（yaml 声明 Extensions）；**档案 = 检测签名 + 注意清单 + 资源特征**；未知格式安全降级；`maxChars`/`maxTurns`/`autoAdjustWorkers` 等成本旋钮 |
| [AiNiee](https://github.com/NEKOparapa/AiNiee) | 每种格式一对 Reader/Writer，惰性注册表 + `AutoTypeReader`（扩展名过滤 → 各 Reader 的 `can_read_by_content`） | 统一中间格式（CacheProject），管线格式无关；**格式档案三件套：检测特征 + 翻译注意点 + 成本参数**；按角色路由不同价位 API；token 预估→限流排队 |
| [SExtractor](https://github.com/satan53x/SExtractor)（511★） | `engine.ini` 声明式档案（file 模式 + postfix 扩展名 + sample 示例 + 内嵌注意事项）+ `reg.yaml` 规则库；无自动识别，用户选引擎 | **引擎档案三段式：识别签名 + 文本位置 + 内嵌注意事项**；新增引擎 = 加档案不改核心；sample 样例即冒烟测试；fail-fast 能力门控 |

**三条共同模式**（本方案照抄）：
1. **档案驱动**：新游戏类型 = 加一份声明式档案，不改核心代码。
2. **检测分层 + 安全降级**：文件名/扩展名匹配只用于"提醒"，认错无害。
3. **档案 = 识别签名 + 注意事项 + 成本/资源特征**。

## 二、落到 yi-jia 上是什么

yi-jia 是成本守卫，不是翻译执行器。所以"支持更多游戏类型"= **引擎感知的成本守卫**：

- 峰时提醒不再只有通用文案——识别出游戏引擎后，附上该引擎的**成本/质量注意事项**（如 RPG Maker 的控制符保护、Kirikiri 的编码路线）和**推理强度建议档位**。
- 认错无害：检测只影响提醒内容，不做任何拦截。
- 档案双语言（zh/en），跟 i18n 体系对齐。

## 三、设计

### 档案格式（src/games.cjs，声明式）

```js
{
  id: 'rpgmaker',                    // 稳定标识
  name: { zh: 'RPG Maker MZ/MV', en: 'RPG Maker MZ/MV' },
  markers: [                         // 任一命中即判定；识别分层见下
    { file: 'js/rmmz_managers.js' },           // 精确相对路径
    { topExt: '.rmmzproject' },                // 顶层扩展名
    { shallowExt: '.ks', maxDepth: 2 },        // 浅层扫描扩展名
  ],
  effort: { zh: '批量首翻 off / 术语·审校 low / 疑难句 high', en: 'bulk off / glossary·proofread low / hard sentences high' },
  notes: { zh: '…控制符 \C[n] \V[n] 必须原样保留；data/*.json 大文件先切分再送翻…', en: '…' },
}
```

### 识别分层（照 GalTransl/AiNiee）

精确相对路径 → 顶层扩展名 → 浅层扩展名（限深 2 层、限量 200 条目，try/catch 全包）→ 都不命中返回 null（不猜）。结果按 cwd 缓存。

### 首期引擎档案（6 个，覆盖主流汉化对象）

| id | 签名 | 注意事项要点 |
|---|---|---|
| rpgmaker | `js/rmmz_managers.js`（MZ）/ `js/rpg_managers.js`（MV）/ `*.rmmzproject` | 控制符 `\C[n]\V[n]\N[n]` 原样保留；data/*.json 先切分；占位符完整性校验 |
| kirikiri | 浅层 `.ks`/`.tjs`、`*.xp3` | 标签 `[ruby][l][r]` 保护；cp932/SJIS 编码路线（GBK 注入或 SJIS 替换） |
| renpy | 浅层 `.rpy` | Python 转义与 `{var}` 插值保护；人名从脚本结构抽取 |
| livemaker | 浅层 `.lns` | 二进制脚本走 pylivemaker；换行/编码谨慎 |
| wolf | `Data.wolf` / 浅层 `.wolf` | 先 WolfDec 解包；GBK 编码 |
| unity | 顶层 `*_Data` 目录含 `globalgamemanagers` / `UnityPlayer.dll` | 文本多在资源内，需专用工具（如 UTAGE 系）；按资源分批 |

### 注入点

`agent/pre-step` 守卫在 `isGuardedProject(cwd)` 通过后 `detectGame(cwd)`，命中则在提醒尾部追加一行：

```
【RPG Maker MZ/MV】控制符 \C[n] \V[n] 必须原样保留；data/*.json 大文件先切分再送翻，译后跑占位符完整性校验。建议档位：批量首翻 off / 术语·审校 low / 疑难句 high
```

字典新增 `guard.engineLine`：`【{engine}】{notes} 建议档位：{effort}`（en 同构）。

## 四、里程碑

| 里程碑 | 内容 | 退出标准 |
|---|---|---|
| M1 | `src/games.cjs` 档案库 + `detectGame`（分层识别 + cwd 缓存） | 单测：临时目录造标记文件，各引擎识别正确；空目录/异常目录返回 null；test.mjs 全绿 |
| M2 | 提醒注入引擎注意事项 | 峰时提醒尾部含【引擎】行；未识别引擎时提醒与 v1.1 一致；en 语言下全英文 |
| M3（backlog） | `/cost` 报表按项目标注引擎（projcache cwd → detectGame） | 本期不做 |
| M4 | 测试扩充 + CHANGELOG/README + tag v1.2.0 | 门禁全绿，双推 |

### 门禁

```bash
node scripts/test.mjs
```
