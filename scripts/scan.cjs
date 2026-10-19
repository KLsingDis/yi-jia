#!/usr/bin/env node
// dsh-yi-jia session scanner.
// Reads DSH session logs (*.jsonl.zstd), aggregates token usage per peak/off-peak
// window (Beijing time), computes CNY cost, writes a compact status JSON.
//
// Usage: node scan.cjs <sessionsRoot> <outJson>
//   sessionsRoot: e.g. C:\Users\<user>\.dsh\sessions
// Env: DSH_HOLIDAYS=YYYY-MM-DD,YYYY-MM-DD (optional; those dates are all off-peak)
//
// Node >= 22 required (uses node:zlib zstdDecompressSync). Runs as a spawned child
// of the dsh-yi-jia plugin; safe to run standalone for debugging.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('node:zlib');

const M = 1e6;
const TZ_OFFSET_MS = 8 * 3600 * 1000; // Beijing UTC+8

// ---- pricing (CNY per 1M tokens), from DeepSeek official price table ----
const PRICE = {
  'deepseek-flash': {
    idle: { hit: 0.02, miss: 1, out: 4 },
    peak: { hit: 0.04, miss: 2, out: 8 },
  },
  'deepseek-v4-pro': {
    idle: { hit: 0.15, miss: 4.5, out: 13.5 },
    peak: { hit: 0.30, miss: 9, out: 27 },
  },
};

function beijing(ms) { return new Date(ms + TZ_OFFSET_MS); }
function isoDay(ms) { return beijing(ms).toISOString().slice(0, 10); }
function loadHolidays() {
  const set = new Set();
  // 1) env var: DSH_HOLIDAYS=YYYY-MM-DD,YYYY-MM-DD
  const s = process.env.DSH_HOLIDAYS || '';
  for (let h of s.replace(/;/g, ',').split(',')) { h = h.trim(); if (h) set.add(h); }
  // 2) file fallback: ~/.dsh/yi-jia/holidays.txt (one YYYY-MM-DD per line, # = comment)
  try {
    const fp = path.join(__dirname, 'holidays.txt');
    if (fs.existsSync(fp)) {
      for (let line of fs.readFileSync(fp, 'utf8').split(/\r?\n/)) {
        line = line.replace(/#.*$/, '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(line)) set.add(line);
      }
    }
  } catch (e) { /* ignore */ }
  return set;
}
function makeIsPeak(holidays) {
  return function isPeak(ms) {
    const d = beijing(ms);
    if (holidays.has(isoDay(ms))) return false;
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) return false;
    const h = d.getUTCHours();
    return (h >= 9 && h < 12) || (h >= 14 && h < 18);
  };
}

// Decode a possibly multi-frame zstd file to text lines.
function decodeFile(p) {
  const b = fs.readFileSync(p);
  const starts = [];
  for (let i = 0; i + 4 <= b.length; i++) {
    if (b[i] === 0x28 && b[i + 1] === 0xb5 && b[i + 2] === 0x2f && b[i + 3] === 0xfd) starts.push(i);
  }
  let all = '';
  for (let i = 0; i < starts.length; i++) {
    const chunk = b.subarray(starts[i], i + 1 < starts.length ? starts[i + 1] : b.length);
    try { all += zlib.zstdDecompressSync(chunk).toString('utf8'); } catch (e) { /* skip bad frame */ }
  }
  return all.split('\n').filter(Boolean);
}

function main() {
  const sessionsRoot = process.argv[2];
  const outJson = process.argv[3];
  if (!sessionsRoot || !outJson) {
    console.error('usage: node scan.cjs <sessionsRoot> <outJson>');
    process.exit(2);
  }
  const holidays = loadHolidays();
  const isPeak = makeIsPeak(holidays);

  // Collect session log files: <root>/<projectDir>/<sessionDir>/session.v4.jsonl.zstd
  const files = [];
  let projectDirs = [];
  try { projectDirs = fs.readdirSync(sessionsRoot, { withFileTypes: true }).filter(e => e.isDirectory()); }
  catch (e) { console.error('cannot read sessionsRoot:', e.message); process.exit(1); }

  for (const pd of projectDirs) {
    const pdir = path.join(sessionsRoot, pd.name);
    let sessDirs = [];
    try { sessDirs = fs.readdirSync(pdir, { withFileTypes: true }).filter(e => e.isDirectory()); } catch (e) { continue; }
    for (const sd of sessDirs) {
      const f = path.join(pdir, sd.name, 'session.v4.jsonl.zstd');
      try { if (fs.existsSync(f)) files.push({ file: f, project: pd.name }); } catch (e) {}
    }
  }

  const seen = new Set();
  let calls = 0;
  const totals = { miss: 0, hit: 0, out: 0 };
  const peakT = { miss: 0, hit: 0, out: 0, calls: 0 };
  const idleT = { miss: 0, hit: 0, out: 0, calls: 0 };
  const perDay = {};
  const perProject = {};

  for (const { file, project } of files) {
    let lines;
    try { lines = decodeFile(file); } catch (e) { continue; }
    for (const ln of lines) {
      let r; try { r = JSON.parse(ln); } catch (e) { continue; }
      if (r.type !== 'assistant/message' || !r.data || !r.data.usage) continue;
      const id = r.data.message && r.data.message.id;
      if (id) { if (seen.has(id)) continue; seen.add(id); }
      const u = r.data.usage;
      const miss = u.inputTokens || 0, hit = u.cacheReadTokens || 0, out = u.outputTokens || 0;
      calls++;
      totals.miss += miss; totals.hit += hit; totals.out += out;
      const pk = isPeak(r.time);
      const T = pk ? peakT : idleT;
      T.miss += miss; T.hit += hit; T.out += out; T.calls++;
      const day = isoDay(r.time);
      const dd = perDay[day] || (perDay[day] = { miss: 0, hit: 0, out: 0, calls: 0, pkMiss: 0, pkHit: 0, pkOut: 0 });
      dd.miss += miss; dd.hit += hit; dd.out += out; dd.calls++;
      if (pk) { dd.pkMiss += miss; dd.pkHit += hit; dd.pkOut += out; }
      const pp = perProject[project] || (perProject[project] = { miss: 0, hit: 0, out: 0, calls: 0, pkMiss: 0, pkHit: 0, pkOut: 0 });
      pp.miss += miss; pp.hit += hit; pp.out += out; pp.calls++;
      if (pk) { pp.pkMiss += miss; pp.pkHit += hit; pp.pkOut += out; }
    }
  }

  function cost(T, p) { return T.miss / M * p.miss + T.hit / M * p.hit + T.out / M * p.out; }
  const flash = PRICE['deepseek-flash'];
  const pro = PRICE['deepseek-v4-pro'];
  const actual = cost(peakT, flash.peak) + cost(idleT, flash.idle);
  const allIdle = cost(totals, flash.idle);
  const allPeak = cost(totals, flash.peak);
  const proIdle = cost(totals, pro.idle);
  const proPeak = cost(totals, pro.peak);

  const status = {
    generatedAt: new Date().toISOString(),
    currency: 'CNY',
    model: 'deepseek-flash',
    windows: {
      peak: 'Mon-Fri (excl. CN statutory holidays) 09:00-12:00 & 14:00-18:00 Beijing',
      offpeak: 'all other times incl. weekends & holidays (0.5x)',
      holidaysConfigured: [...holidays],
    },
    pricing: PRICE,
    totals, peakT, idleT, perDay, perProject,
    calls,
    sessions: files.length,
    cost: {
      actualMixed: +actual.toFixed(4),
      allIdle: +allIdle.toFixed(4),
      allPeak: +allPeak.toFixed(4),
      savingsIdleVsPeak: +allPeak - +allIdle ? +((allPeak - allIdle).toFixed(4)) : 0,
      proIdle: +proIdle.toFixed(4),
      proPeak: +proPeak.toFixed(4),
    },
  };

  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(status, null, 2), 'utf8');
  console.log(JSON.stringify({
    ok: true, outJson, calls, sessions: files.length,
    miss: +(totals.miss / M).toFixed(3), hit: +(totals.hit / M).toFixed(1), out: +(totals.out / M).toFixed(3),
    actualMixed: status.cost.actualMixed, allIdle: status.cost.allIdle, allPeak: status.cost.allPeak,
  }));
}

main();
