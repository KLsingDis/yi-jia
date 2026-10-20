# 译价 / yi-jia —— 多语种支持与开源推进方案

> 状态：待拍板（见文末决策点）。调研日期：2026-10-20。

## 一、竞品调研结论

### 1. DSH 成本守卫类（同生态、直接可比）

| 项目 | 功能 | 与 yi-jia 对比 |
|---|---|---|
| [sixtysevenlf/dsh-cost-guard](https://github.com/sixtysevenlf/dsh-cost-guard) | 成本核算、**预算硬顶**、**错峰队列 daemon**（`cost_defer` 登记任务、谷时自动执行）、自动成本路由、收敛引导、客户端面板、optab 子包 | 功能更全；但定位是"通用 API 成本管控"，装配更重（面板 + daemon + 子包） |
| [YMRYMR/deepseek-peak](https://github.com/YMRYMR/deepseek-peak) | 峰谷状态部件 + 峰时暂停 LLM + 队列自动排空 | 峰时拦截思路与 yi-jia 相同，多了自动队列 |
| [Imnotndesh/dsh-peak-pricing-warning](https://github.com/Imnotndesh/dsh-peak-pricing-warning) | 模型选择器旁显示峰谷状态与倒计时 | 比 yi-jia 轻，只有"看"没有"守卫" |
| [overact/dsh-peak-indicator](https://github.com/overact/dsh-peak-indicator) | 峰谷指示器 | 已停维护，并入 dsh-statusline-plus |
| [pi-deepseek-pricing-by-time](https://pi.dev/packages/pi-deepseek-pricing-by-time) | 按产生时段重计价（pi 生态，非 DSH） | 生态不同，仅思路可借鉴 |

### 2. 汉化翻译工具链（不同层，不构成本项目竞品）

- [GalTransl](https://github.com/GalTransl/GalTransl)：Galgame 自动化翻译，提示工程成熟，自带多语言设计——**可学习其 i18n 组织方式**。
- [NEKOparapa/AiNiee](https://github.com/NEKOparapa/AiNiee)：一键翻译游戏/书/字幕，支持 MTool、Renpy、Translator++ 等格式。
- [satan53x/SExtractor](https://github.com/satan53x/SExtractor)：脚本文本提取/注入。

这些是"翻译执行层"；yi-jia 是"成本守卫层"，互补关系，不存在"被替代"。

### 3. 结论

- 通用成本管控方向**已有更完善的实现**，按"比我更完善就停止开发"的字面规则应转用 `sixtysevenlf/dsh-cost-guard`。
- 但 yi-jia 的差异化成立：为**汉化 / 批量翻译工作流**量身定做（推理强度分档建议、汉化工作流约定文案、按天明细对账）、零依赖轻量（单文件插件 + 外部扫描器）、38 项回归测试、真实案例数据。两者可共存：要"全套成本管控"装对方的，要"翻译场景即插即用的峰谷守卫"装 yi-jia。

## 二、决策点（需要拍板）

- **A. 转用**：停掉 yi-jia 的功能开发，改用 sixtysevenlf/dsh-cost-guard，yi-jia 仓库归档。
- **B. 差异化继续（推荐）**：继续完善 yi-jia 并开源，学习对方优点（错峰队列、预算硬顶列入 backlog，本期不做），本期做 i18n 多语种支持。

## 三、本期目标（选 B 时执行）：插件自身多语种支持

把插件界面与输出文案从硬编码中文改为按语言切换（zh / en 起步，结构留扩展口）。
注意：这里的"多语种"指**插件自身的界面语言**，不是翻译方向；项目名"译价"取的是"为翻译定价"。

### 现状盘点

- `locale/zh.json`、`locale/en.json` 目前只覆盖插件面板的 `meta.title` / `meta.description`。
- `src/yi-jia.mjs` 有 73 行含中文（守卫提醒文案、徽标 BADGE_JS 的全部界面字符串）。
- `scripts/cost_report.js` 有 24 行含中文（报表表头与说明）。

### 设计

1. **语言决定顺序**（优先级从高到低）：
   1. `cordis.patch.yml` 里插件配置 `lang`（用户显式指定，最高优先级）；
   2. DSH 界面语言（宿主有 LocaleRuntime / `ctx.slots.installLocale` 机制，实现时验证插件侧可读性，读不到就跳过）；
   3. 兜底 `zh`。
2. **文案抽离**：新建 `src/i18n.js`，导出 `t(lang, key, vars)`；zh/en 两个字典文件放 `locale/messages.zh.json` / `locale/messages.en.json`（与现有 meta 文件并列）。守卫提醒、徽标、报表全部走 `t()`。
3. **徽标传递**：现有 `__CG_BOOT__` 全局变量机制已把 holidays/status 传给页面，顺势把当前语言的字典（或仅当前语言的消息子集）一并注入，BADGE_JS 内部改为查表渲染。
4. **报表 CLI**：`scripts/cost_report.js` 增加 `--lang zh|en`，默认走与插件相同的决定链（配置 → 环境变量 `YI_JIA_LANG` → zh）。
5. **可扩展**：新增语言只需加一个 `locale/messages.<lang>.json`，不改代码。

### 里程碑

| 里程碑 | 内容 | 退出标准 |
|---|---|---|
| M1 文案抽离 | i18n 模块 + zh/en 字典；三处文案改走 `t()` | 代码里不再含硬编码中文界面串（注释除外）；`node scripts/test.mjs` 全绿 |
| M2 语言决定链 | cordis 配置 + 宿主语言探测 + 兜底 | 配置 en 时注入英文提醒；未配置时行为与现状一致 |
| M3 徽标与报表多语言 | BADGE_JS 查表渲染；cost_report `--lang` | 徽标 en 全英文；报表两种语言输出正确 |
| M4 测试与发布 | test.mjs 增加多语言用例（提醒文案、徽标字符串、报表表头）；README 更新 | 全部门禁通过；commit + push + 打 tag v1.1.0 |

### 门禁

```bash
node scripts/test.mjs
```

全绿后才 commit；按 M1→M4 拆 4 个 commit，推 main。

### 不做的事（本期）

- 错峰队列 / 预算硬顶（backlog，先观察 sixtysevenlf/dsh-cost-guard 的演进再定）。
- npm 发布（等 GitHub 版稳定后另行决策）。
- 插件面板 meta 之外的 DSH 官方收录申请。
