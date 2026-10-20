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
//   node cost_report.js --lang en  # 输出语言（zh/en，默认走 YI_JIA_LANG 或系统区域）
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createT, resolveLang } = require('../src/i18n.cjs');

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
  const langIdx = argv.indexOf('--lang');
  const langArg = langIdx >= 0 ? argv[langIdx + 1] : null;
  const lang = resolveLang([
    langArg,
    process.env.YI_JIA_LANG,
    () => Intl.DateTimeFormat().resolvedOptions().locale,
    'zh',
  ]);
  const t = createT(lang);
  if (argv.includes('--json')) {
    const st = loadStatus(true);
    if (!st) { console.error('status unavailable'); process.exit(1); }
    console.log(JSON.stringify(st, null, 2));
    return;
  }
  const st = loadStatus(argv.includes('--refresh'));
  if (!st) {
    console.log(t('report.noData'));
    return;
  }
  const c = st.cost, tks = st.totals;
  const peakShare = st.peakT.calls && st.calls ? (st.peakT.calls / st.calls * 100).toFixed(1) : '0.0';

  const lines = [];
  lines.push(t('report.title', { model: st.model }));
  lines.push('');
  lines.push(t('report.coverage', { sessions: st.sessions, calls: st.calls }));
  lines.push(t('report.usage', { miss: mt(tks.miss), hit: mt(tks.hit), out: mt(tks.out) }));
  lines.push(t('report.rates', { rate: (tks.hit / (tks.hit + tks.miss) * 100).toFixed(1), share: peakShare }));
  lines.push('');
  lines.push(t('report.tableScenario'));
  lines.push('|---|---|');
  lines.push(t('report.actual', { amount: yuan(c.actualMixed) }));
  lines.push(t('report.allIdle', { amount: yuan(c.allIdle), save: yuan(c.actualMixed - c.allIdle) }));
  lines.push(t('report.allPeak', { amount: yuan(c.allPeak), extra: yuan(c.allPeak - c.allIdle) }));
  lines.push(t('report.proRef', { idle: yuan(c.proIdle), peak: yuan(c.proPeak) }));
  lines.push('');
  // 按天分（峰/谷拆分计价）
  const days = Object.keys(st.perDay || {}).sort();
  if (days.length) {
    const F = (st.pricing && st.pricing['deepseek-flash']) || { idle: { hit: 0.02, miss: 1, out: 4 }, peak: { hit: 0.04, miss: 2, out: 8 } };
    const dayCost = (x) =>
      (x.pkMiss / M * F.peak.miss + x.pkHit / M * F.peak.hit + x.pkOut / M * F.peak.out) +
      (((x.miss - x.pkMiss)) / M * F.idle.miss + ((x.hit - x.pkHit)) / M * F.idle.hit + ((x.out - x.pkOut)) / M * F.idle.out);
    lines.push(t('report.dailyTitle'));
    lines.push('');
    lines.push(t('report.dailyHeader'));
    lines.push('|---|---|---|---|');
    let sum = 0;
    for (const d of days) {
      const x = st.perDay[d];
      const dc = dayCost(x); sum += dc;
      lines.push('| ' + d + ' | ' + x.calls + ' | ' + mt(x.out) + ' | ' + yuan(dc) + ' |');
    }
    lines.push(t('report.total', { calls: st.calls, out: mt(st.totals.out), sum: yuan(sum) }));
    lines.push('');
  }
  const gen = new Date(st.generatedAt);
  lines.push(t('report.footer', {
    time: gen.toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN', { timeZone: 'Asia/Shanghai' }),
  }));

  console.log(lines.join('\n'));
}

main();
