#!/usr/bin/env node
// /cost —— DeepSeek 峰谷成本报表（dsh-yi-jia 的 skill 侧入口）。
//
// 读取（必要时刷新）~/.dsh/yi-jia/status.json，输出人类可读的 Markdown 成本汇总，
// 供 agent 在对话里贴给用户。数据源是 DSH 全部会话日志，按峰/谷窗口计价。
//
// 用法（用外部运行时 node 跑，见 pricing-window.md）：
//   node cost_report.js            # 用现有快照；快照缺失或太旧时自动刷新一次
//   node cost_report.js --refresh  # 强制先重扫再输出
//   node cost_report.js --json     # 只打印 status.json 原文（机读）
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');

const HOME = process.env.USERPROFILE || process.env.HOME || process.cwd();
const GUARD_DIR = path.join(HOME, '.dsh', 'yi-jia');
const STATUS_JSON = path.join(GUARD_DIR, 'status.json');
const SCAN_SCRIPT = path.join(GUARD_DIR, 'scan.cjs');
const SESSIONS_ROOT = path.join(HOME, '.dsh', 'sessions');
const MAX_AGE_MS = 10 * 60 * 1000; // 快照超过 10 分钟视为过期

function findNode() {
  const rt = path.join(HOME, '.dsh', 'dsh-runtimes');
  try {
    for (const d of fs.readdirSync(rt)) {
      const p = path.join(rt, d, 'dependencies', 'node', 'bin', 'node.exe');
      if (fs.existsSync(p)) return p;
    }
  } catch (e) {}
  return null;
}

function refresh() {
  const node = findNode();
  if (!node || !fs.existsSync(SCAN_SCRIPT)) return false;
  const r = spawnSync(node, [SCAN_SCRIPT, SESSIONS_ROOT, STATUS_JSON], {
    env: { ...process.env }, encoding: 'utf8',
  });
  return r.status === 0;
}

function loadStatus(forceRefresh) {
  let st = null;
  let stale = true;
  try {
    const stat = fs.statSync(STATUS_JSON);
    st = JSON.parse(fs.readFileSync(STATUS_JSON, 'utf8'));
    stale = (Date.now() - stat.mtimeMs) > MAX_AGE_MS;
  } catch (e) {}
  if (forceRefresh || !st || stale) {
    if (refresh()) {
      try { st = JSON.parse(fs.readFileSync(STATUS_JSON, 'utf8')); } catch (e) {}
    }
  }
  return st;
}

const M = 1e6;
function mt(n) { return (n / M).toFixed(2) + 'M'; }
function yuan(n) { return '¥' + Number(n).toFixed(2); }

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--json')) {
    const st = loadStatus(true);
    if (!st) { console.error('status unavailable'); process.exit(1); }
    console.log(JSON.stringify(st, null, 2));
    return;
  }
  const st = loadStatus(argv.includes('--refresh'));
  if (!st) {
    console.log('暂无成本数据：扫描器不可用或会话日志目录不存在。');
    return;
  }
  const c = st.cost, t = st.totals;
  const peakShare = st.peakT.calls && st.calls ? (st.peakT.calls / st.calls * 100).toFixed(1) : '0.0';

  const lines = [];
  lines.push('## DeepSeek 成本报表（' + st.model + '）');
  lines.push('');
  lines.push('- 覆盖：' + st.sessions + ' 个会话 / ' + st.calls + ' 次模型调用（全部项目）');
  lines.push('- 用量：输入(未命中) ' + mt(t.miss) + ' · 输入(缓存命中) ' + mt(t.hit) + ' · 输出 ' + mt(t.out));
  lines.push('- 缓存命中率：' + (t.hit / (t.hit + t.miss) * 100).toFixed(1) + '% · 峰时调用占比 ' + peakShare + '%');
  lines.push('');
  lines.push('| 计费场景 | 费用 |');
  lines.push('|---|---|');
  lines.push('| 实际（混合时段） | **' + yuan(c.actualMixed) + '** |');
  lines.push('| 若全部谷时 | ' + yuan(c.allIdle) + '（比实际省 ' + yuan(c.actualMixed - c.allIdle) + '） |');
  lines.push('| 若全部高峰 | ' + yuan(c.allPeak) + '（比全谷贵 ' + yuan(c.allPeak - c.allIdle) + '，即 2×） |');
  lines.push('| 参考：v4-pro 全谷 / 全峰 | ' + yuan(c.proIdle) + ' / ' + yuan(c.proPeak) + ' |');
  lines.push('');
  // 按天分（峰/谷拆分计价）
  const days = Object.keys(st.perDay || {}).sort();
  if (days.length) {
    const F = (st.pricing && st.pricing['deepseek-flash']) || { idle: { hit: 0.02, miss: 1, out: 4 }, peak: { hit: 0.04, miss: 2, out: 8 } };
    const dayCost = (x) =>
      (x.pkMiss / M * F.peak.miss + x.pkHit / M * F.peak.hit + x.pkOut / M * F.peak.out) +
      (((x.miss - x.pkMiss)) / M * F.idle.miss + ((x.hit - x.pkHit)) / M * F.idle.hit + ((x.out - x.pkOut)) / M * F.idle.out);
    lines.push('按天（实付口径）：');
    lines.push('');
    lines.push('| 日期 | 调用 | 输出 | 费用 |');
    lines.push('|---|---|---|---|');
    let sum = 0;
    for (const d of days) {
      const x = st.perDay[d];
      const dc = dayCost(x); sum += dc;
      lines.push('| ' + d + ' | ' + x.calls + ' | ' + mt(x.out) + ' | ' + yuan(dc) + ' |');
    }
    lines.push('| **合计** | ' + st.calls + ' | ' + mt(st.totals.out) + ' | **' + yuan(sum) + '** |');
    lines.push('');
  }
  const gen = new Date(st.generatedAt);
  lines.push('> 快照生成于 ' + gen.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + '（北京时间）。谷时=周一至周五 9-12/14-18 之外+周末节假日全天，0.5×。');

  console.log(lines.join('\n'));
}

main();
