# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [1.2.0] - 2026-10-20

### 新增

- **游戏引擎档案库**（`src/games.cjs`）：声明式档案（识别签名 + 双语注意事项 + 推理强度建议），
  设计借鉴 GalTransl / AiNiee / SExtractor 的多类型支持模式（见 `docs/game-profiles-plan.md`）。
  首期 6 个引擎：RPG Maker MZ/MV、Kirikiri/KAG、RenPy、Livemaker、Wolf RPG Editor、Unity（含 UTAGE）。
- **引擎感知的峰时提醒**：守卫识别会话工作目录的引擎后，在提醒尾部追加该引擎的成本/质量注意事项
  与建议档位（如 RPG Maker 的控制符保护、Kirikiri 的编码路线）。识别只影响提醒内容，认错无害；
  检测分层（精确路径 → 顶层文件名/扩展名 → 浅层扩展名），未命中不猜。
- **测试扩充至 74 项**：引擎识别（真实临时目录造标记）、档案完整性、引擎行中英文注入、
  无引擎时提醒与 v1.1 一致。

## [1.1.0] - 2026-10-20

### 新增

- **多语种支持（zh/en）**：提醒文案、徽标界面、`/cost` 报表全部接入 i18n。语言决定链：`cordis.patch.yml` 配置 `lang` > 环境变量 `YI_JIA_LANG` > 系统区域 > 默认 `zh`。新增语言只需加 `locale/messages.<lang>.json`。
- **翻译项目限定**：峰时守卫按会话 cwd 过滤（`DSH_COST_GUARD_PROJECTS`，分号分隔，默认 `telegram`），非翻译项目零注入；翻译主会话派生的子代理同样命中。未知 cwd 一律放行（fail-closed）。
- **测试扩充至 59 项**：i18n 决定链、字典回退、英文提醒/徽标渲染、非翻译项目不注入等。

### 修复

- **v4 会话格式兼容**：注入消息从退役的 `source.kind:'plugin'` 改为 `role`/`id` 齐全的普通用户消息，消除 `format v4 message requires a producer-owned source kind` 报错。
- **cost_report.js ESM 兼容**：包声明 `"type": "module"` 后改为 ESM 写法。

## [1.0.0] - 2026-10-20

首个发布版本。

### 新增

- **峰时守卫**：`agent/pre-step` 钩子在每轮用户请求开始时检测北京峰谷窗口，峰时注入提醒（不启动翻译/批量子代理），谷时不注入（零开销）。同一轮对话内去重。
- **可拖动成本徽标**：经 `webserver/index-inject` 注入。默认停靠左下角，落位时用 `elementFromPoint` 避让界面已有控件；支持拖动与位置持久化；点击展开详情面板（成本三口径、v4-pro 参考价、token 用量、缓存命中率、峰谷调用占比、最近 5 天按天费用、计价规则与推理强度建议）。
- **后台成本扫描**：每 30 分钟拉起外部 node 运行 `scan.cjs`，解码 `~/.dsh/sessions` 下的 zstd 会话日志，按峰谷窗口折算真实费用，写 `status.json`。扫描器非阻塞、失败不影响主程序。
- **`/cost` 报表**：`scripts/cost_report.js` 输出 Markdown 报表（实付/全谷/全峰对比 + 按天明细）。
- **命令行窗口判断**：`scripts/offpeak.py`，返回码 0=谷时 1=峰时，支持 `--now` 离线测试与 `--holiday` 法定节假日。
- **DSH bundle 打包**：`package.json` 声明 `dsh.bundle.patch`，含 `locale/en.json`、`locale/zh.json` 与 `icon.svg`，可在插件面板直接安装。
- **38 项回归测试**：`node scripts/test.mjs`，自包含（注入固定快照与 DOM stub，无需 DSH 安装或真实会话）。

### 已知限制

- 推理强度档位**不会自动切换**——插件只负责提醒，档位仍需在模型选择器里手动设置（会话级）。
- 成本统计覆盖 `~/.dsh/sessions` 下**全部项目**，暂不支持按项目过滤。
- 法定节假日需手动通过 `DSH_HOLIDAYS` 环境变量传入，未内置中国节假日表。
