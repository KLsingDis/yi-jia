# 译价 / Off-Peak Guard

> DeepSeek 峰谷时段 + 推理强度 双维度成本守卫，为**汉化 / 批量翻译 / AI 编排类任务**设计。

给 DSH（DeepSeek Harness）用的成本守卫插件。它做三件事：

1. **峰时拦截**——北京时间峰时（1× 价格）在每轮请求开头提醒你别启动批量任务，谷时（0.5×）不打扰；
2. **成本可视**——界面角落一块可拖动的徽标，点开看真实花费、峰谷占比、按天明细；
3. **随时对账**——问一句 `/cost`，输出完整报表。

## 为什么需要它

DeepSeek 官方计价：**周一至周五（不含法定节假日）09:00–12:00、14:00–18:00 为高峰**，其余时间（含周末、法定节假日全天）为空闲时段，**谷时价格是峰时的一半**。

同时，**思考内容按输出 token 计费**——全程开 `high` 会让思考 token 吃掉大部分输出成本。

这两件事都在悄悄放大账单，而这个插件帮你把它们变成可见、可控制的。

## 实测数据

本项目真实案例（RPG Maker 游戏汉化，4 天，1.5 万次模型调用）：

| 计费场景 | 费用 |
|---|---|
| 实际（混合时段，全程 high） | ¥180 |
| 若全部谷时 | ¥138 |
| 若全部峰时 | ¥281 |
| 参考：v4-pro 全谷 / 全峰 | ¥676 / ¥1,354 |

> 注意：¥180 里大部分是**调试排查本身**的开销。纯批量机翻 44 万字符实际只需 ¥1–2——真正要省的是编排和审校阶段。

## 功能

### 峰时守卫

每轮用户请求开始时检测窗口。若在峰时，注入一条系统级提醒：

```
[成本守卫] 当前北京时间 10:23 为峰时（周一至周五 9-12 / 14-18 点，1× 价格；
12:00 后转谷时，约 1小时37分）。按汉化工作流约定：峰时不启动翻译/批处理类
子代理，只做读写文件、跑脚本、校验等开销低的工作；如确需现在跑批量任务，
请先向用户确认。挪到谷时可省 50%。
```

谷时**不注入**，零开销。同一轮对话内不重复注入。

### 可拖动徽标

左下角常驻（自动避开界面已有控件），可拖到任意位置，位置与展开状态都会记住。

**收起态**：

```
🟢 谷时 0.5×  北京 00:52  ▸
下次切换 09:00（约 8小时8分）
实付 ¥180.05 · 全谷 ¥140.55 · 全峰 ¥281.10
点击展开 · 可拖动
```

**展开态**：

| 区块 | 内容 |
|---|---|
| 成本 | 实际 / 全谷 / 全峰 / v4-pro 参考价 |
| 用量 | 调用次数、输入未命中、输入缓存命中、输出（含思考）、缓存命中率、峰谷调用占比 |
| 最近 5 天 | 每天调用数 + 按峰谷折算的实际费用 |
| 规则 | 峰谷窗口定义 + 推理强度建议 |

### `/cost` 报表

对话里问"花了多少钱"或 `/cost`，输出 Markdown 报表：

```bash
node scripts/cost_report.js            # 用现有快照，过期自动刷新
node scripts/cost_report.js --refresh  # 强制重扫
node scripts/cost_report.js --json     # 机读
```

## 安装

这是一个标准 **DSH bundle**：`package.json` 声明 `dsh.bundle.patch`，装进 profile 后即出现在插件面板里。

### 方式 A：从 GitHub 安装（推荐）

DSH 插件面板 → **安装** → 填入：

```
github:KLsingDis/yi-jia
```

或本地克隆后指向目录：

```
file:///K:/yi-jia
```

装好后在 plugin 列表里启用 `yi-jia`，重启一次 DSH。

### 方式 B：手动放置（开发者）

```bash
# 插件源
mkdir -p ~/.dsh/profiles/web
cp src/yi-jia.mjs ~/.dsh/profiles/web/

# 成本扫描器（旧的扁平布局；bundle 安装不需要这步）
mkdir -p ~/.dsh/yi-jia
cp scripts/scan.cjs ~/.dsh/yi-jia/
```

编辑**实际被加载的那个 profile** 的 `cordis.patch.yml`：

| 版本 | profile 路径 |
|---|---|
| DSH 桌面版 | `~/.dsh/profiles/desktop/cordis.patch.yml` |
| DSH Web 版 | `~/.dsh/profiles/web/cordis.patch.yml` |

```yaml
- insert:
    - id: yi-jia
      name: file:///C:/Users/<你的用户名>/.dsh/profiles/web/yi-jia.mjs
```

> ⚠️ **装错 profile 是头号坑**。表现：插件完全无日志、徽标不出现、status.json 不更新。
> 判断方法：看 DSH 进程命令行里的 profile 参数，例如
> `DeepSeek Harness.exe ... C:\Users\X\.dsh\profiles\desktop ...`

### 验证

```bash
cat ~/.dsh/yi-jia/guard.log
```

应看到：

```
apply() entered; pid=xxxx
scanner started (node=...)
agent/pre-step hook registered
webserver/index-inject subscriber registered
index-inject rows pushed (table=N)
```

任何一行缺失，就是对应环节没注册上。

### 关于"被 DSH 收录"

DSH 的插件面板从**已安装的 bundle** 读取 `dsh` 清单与 `locale/*.json` 里的 `meta.title` /
`meta.description` 来展示条目和图标。所以：

- 本仓库已经是合规 bundle，可通过 `github:` / `file:` 直接在面板安装即被收录进本地插件库存；
- 若要做成 **npm 公开包**（能被所有人从面板搜索安装），需要发布到 npm registry：
  ```bash
  npm publish --access public
  ```
  之后用户在面板里填包名 `yi-jia` 即可。

## 用法

### 推理强度分档

插件负责**提醒**，档位仍需在 DSH 模型选择器里手动切换（会话级设置）：

| 阶段 | 档位 | 理由 |
|---|---|---|
| 批量首翻 | `off` | 直译任务，更快更省，更贴原文 |
| 术语表 / 人名 / 世界观 | `low` | 需要一点一致性推理 |
| 审校（对读、漏译、语气） | `low`，疑难句 `high` | 多数问题 low 就能发现 |
| 双关 / 梗 / 文学性 | `high` | 需要酌句 |
| `max` | 基本不用 | 翻译边际收益低，留给代码/数学 |

> 关思考偶有指令遵循不稳（占位符、格式），所以**格式校验和审校至少留 `low`**。

### 法定节假日

节假日全天算谷时。用环境变量传入，插件与扫描器共用：

```bash
DSH_HOLIDAYS=2026-10-01,2026-10-02,2026-10-03
```

### 命令行判断窗口

```bash
python scripts/offpeak.py                      # 返回码 0=谷时 1=峰时
python scripts/offpeak.py --json
python scripts/offpeak.py --now "2026-10-19 15:00"           # 离线测试
python scripts/offpeak.py --holiday 2026-10-01
```

## 工作原理

```
┌─────────────────────────────────────────────────┐
│  DSH 宿主进程                                    │
│  ┌───────────────────────────────────────────┐  │
│  │ yi-jia.mjs (ESM 插件)               │  │
│  │                                           │  │
│  │  agent/pre-step ──→ 峰时？注入提醒          │  │
│  │  webserver/index-inject ──→ 注入徽标脚本    │  │
│  │  setInterval(30min) ──→ spawn 扫描器        │  │
│  └───────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────┘
                         │ spawn (detached, 非阻塞)
                         ▼
              ┌──────────────────────┐
              │ node scan.cjs        │  外部 node，6 秒完成
              │  ├─ 读 ~/.dsh/sessions│
              │  ├─ zstd 解码会话日志 │
              │  ├─ 按峰谷折算费用    │
              │  └─ 写 status.json   │
              └──────────┬───────────┘
                         ▼
              ~/.dsh/yi-jia/status.json
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
   徽标（页面内）                    cost_report.js
```

**数据来源**：DSH 会话日志（`~/.dsh/sessions/**/session.v4.jsonl.zstd`）里每次模型调用的 `usage`
字段（`inputTokens` / `cacheReadTokens` / `outputTokens`），**不是估算**。

**关键设计选择**：

- **扫描走外部 node**：DSH 内嵌的 Node 版本不确定，而 zstd 解码需要 Node ≥ 22。用外部运行时解耦。
- **全量重扫只 6 秒**，但仍放后台 30 分钟一次；要新鲜数据用 `--refresh`。
- **只依赖两个已证实的 API**：`ctx.on('agent/pre-step')` 与 `ctx.inject(['webServer'])`。
- **全链路 try/catch**：任何环节失败只写日志，绝不影响 DSH 主程序。

## 坑（都是踩过的）

### 1. profile 装错

桌面版加载 `profiles/desktop`，不是 `profiles/web`。装错 = 插件完全不加载，且**没有任何报错**。

### 2. 不要用 `tapIndex` 注入 UI

`webServer.tapIndex(transform)` 只作用于**原始 markup**，实际拿到的常是重定向页（实测只有 44 字符），
`<head>` 替换逻辑直接失效。正确做法是监听 `webserver/index-inject` 事件并 push 行：

```js
{ kind: 'script', placement: 'head', text }   // 内联脚本
{ kind: 'global', name, value }               // 渲染成 window 赋值（value 必须是字符串）
```

### 3. `global` 行的 value 必须是字符串

不会自动序列化对象。要传复杂数据，返回一个惰性 IIFE 的源码字符串：

```js
return '(function(){var H=' + JSON.stringify(holidays) + ';return function(){return {holidays:H};};})()'
```

### 4. 拖动 + 点击共存

- 拖动阈值设 4px，否则手抖会被判定为拖动；
- document 级监听器必须在手势结束时卸掉，**并在下次 mousedown 时重新挂载**——
  否则第一次拖动后，后续点击收不到 `mouseup`，展开/收起就失灵了；
- `render()` 重建元素时用全局句柄（`window.__CG_DRAG_CLEANUP__`）兜底清理，避免监听器泄漏。

### 5. 徽标别放右上角

DSH 右上角有模型选择器、设置按钮等控件。默认放左下角，落位时用 `elementFromPoint`
探测是否压住按钮/输入框，冲突就换到下一个候选角。

## 回归测试

```bash
node scripts/test.mjs
```

38 项，覆盖：插件注册、峰时注入、谷时/周末不注入、同轮去重、注入行 schema、
默认落位、点击展开/收起、拖动持久化、拖动不误触发展开、刷新后恢复状态。

## 配置项

无配置文件，全部约定：

| 常量 | 位置 | 默认值 |
|---|---|---|
| `SCAN_INTERVAL_MS` | 插件顶部 | 30 分钟 |
| `SESSIONS_ROOT` | 插件顶部 | `~/.dsh/sessions` |
| `GUARD_DIR` | 插件顶部 | `~/.dsh/yi-jia` |
| `DSH_HOLIDAYS` | 环境变量 | 空 |

## 退出

```bash
# 停用：注释掉 cordis.patch.yml 里那条 insert，重启
# 彻底删除：
rm ~/.dsh/profiles/web/yi-jia.mjs
rm -rf ~/.dsh/yi-jia
```

## License

MIT
