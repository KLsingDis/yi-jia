# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

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
