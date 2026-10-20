// End-to-end test of yi-jia.mjs apply() — runnable straight from a clone.
//   node scripts/test.mjs
// Uses a stubbed DOM + fake plugin context; no DSH install or live sessions required.
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.join(HERE, '..', 'src', 'yi-jia.mjs')

// The plugin reads its cost snapshot from ~/.dsh/yi-jia/status.json at apply() time.
// Intercept that one read so the test is self-contained (fresh clone, no DSH run needed),
// while leaving every other fs access untouched.
const SNAPSHOT = {
  generatedAt: '2026-10-20T00:00:00.000Z',
  model: 'deepseek-flash',
  calls: 1000,
  sessions: 10,
  totals: { miss: 3000000, hit: 100000000, out: 2000000 },
  peakT: { calls: 300, miss: 1000000, hit: 30000000, out: 600000 },
  idleT: { calls: 700, miss: 2000000, hit: 70000000, out: 1400000 },
  perDay: {
    '2026-10-18': { calls: 100, miss: 100000, hit: 1000000, out: 100000, pkMiss: 0, pkHit: 0, pkOut: 0 },
    '2026-10-19': { calls: 900, miss: 2900000, hit: 99000000, out: 1900000, pkMiss: 1000000, pkHit: 30000000, pkOut: 600000 },
  },
  pricing: {
    'deepseek-flash': { idle: { hit: 0.02, miss: 1, out: 4 }, peak: { hit: 0.04, miss: 2, out: 8 } },
  },
  cost: { actualMixed: 42.5, allIdle: 30.1, allPeak: 60.2, proIdle: 150.5, proPeak: 301.0 },
}
const realReadFileSync = fs.readFileSync
fs.readFileSync = function (file, ...rest) {
  if (typeof file === 'string' && file.replace(/\\/g, '/').endsWith('/yi-jia/status.json')) {
    return JSON.stringify(SNAPSHOT)
  }
  return realReadFileSync.call(fs, file, ...rest)
}
// 智能 stub：status.json 恒存在（注入快照）；scan.cjs 恒不存在（阻止测试真拉起扫描器）；
// 其余路径（含 games.cjs 的引擎标记检测）走真实文件系统——测试会造真实临时目录做识别。
const realExistsSync = fs.existsSync
fs.existsSync = (p) => {
  const s = typeof p === 'string' ? p.replace(/\\/g, '/') : ''
  if (s.endsWith('/yi-jia/status.json')) return true
  if (s.endsWith('/scan.cjs')) return false
  return realExistsSync(p)
}

let preStep = null
let injectListener = null
const ctx = {
  on(ev, fn) { if (ev === 'agent/pre-step') preStep = fn },
  inject(deps, fn) {
    const webCtx = {
      effect(f) { f() },
      on(ev, fn) { if (ev === 'webserver/index-inject') injectListener = fn },
    }
    fn(webCtx)
  },
}

const mod = await import('file:///' + PLUGIN.replace(/\\/g, '/'))
// 测试默认值必须是中文：环境变量优先于系统区域，避免测试机系统语言影响断言
process.env.YI_JIA_LANG = 'zh'
mod.apply(ctx)

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  PASS', n) } else { fail++; console.log('  FAIL', n) } }
const next = async (msgs) => ({ kind: 'enter', messages: msgs })

ok(typeof preStep === 'function', 'pre-step hook registered')
ok(typeof injectListener === 'function', 'webserver/index-inject listener registered')

const realNow = Date.now

// payload 里的 agent（官方 pre-step 载荷自带）；cwd 决定守卫是否对该会话生效
const agentFor = (cwd) => ({ session: { header: { cwd } } })
const TR_PROJECT = 'K:/telegram/telelgram/some-game'

// --- Peak: Mon 2026-10-19 10:00 Beijing = UTC 02:00 ---
Date.now = () => Date.UTC(2026, 9, 19, 2, 0, 0)
const u1 = { role: 'user', id: 'u1', content: [{ type: 'text', text: '批量翻译' }] }
let d = await preStep({ agent: agentFor(TR_PROJECT), messages: [u1] }, () => next([u1]))
ok(d.messages.length === 2, 'peak: guard message appended')
ok(/峰时/.test(d.messages[1].content[0].text), 'peak: mentions 峰时')
ok(d.messages[1].source.plugin === 'yi-jia', 'peak: plugin-tagged')
ok(d.messages[1].source.kind === 'user', 'peak: v4-safe source kind (user, not retired plugin)')
ok(typeof d.messages[1].id === 'string' && d.messages[1].id.length > 0, 'peak: message has id')
ok(d.messages[1].role === 'user', 'peak: message has role')

d = await preStep({ agent: agentFor(TR_PROJECT), messages: [u1] }, () => next([u1]))
ok(d.messages.length === 1, 'peak: same turn deduped')

// --- Peak but NOT a translation project: pass through untouched ---
const uBiz = { role: 'user', id: 'ub', content: [{ type: 'text', text: '整理表格' }] }
d = await preStep({ agent: agentFor('C:/Users/KLsing/Documents/chatlog'), messages: [uBiz] }, () => next([uBiz]))
ok(d.messages.length === 1, 'peak non-project: no injection (not a translation cwd)')

// --- Peak with unknown cwd (no agent / no header): fail closed, no injection ---
d = await preStep({ messages: [uBiz] }, () => next([uBiz]))
ok(d.messages.length === 1, 'peak unknown cwd: no injection (fail closed)')
d = await preStep({ agent: agentFor(undefined), messages: [uBiz] }, () => next([uBiz]))
ok(d.messages.length === 1, 'peak undefined cwd: no injection (fail closed)')

// --- Off-peak: Mon 2026-10-19 23:00 Beijing = UTC 15:00 ---
Date.now = () => Date.UTC(2026, 9, 19, 15, 0, 0)
const u2 = { role: 'user', id: 'u2', content: [{ type: 'text', text: '继续' }] }
d = await preStep({ agent: agentFor(TR_PROJECT), messages: [u2] }, () => next([u2]))
ok(d.messages.length === 1, 'off-peak: no injection')

// --- Weekend: Sat 2026-10-17 10:00 Beijing ---
Date.now = () => Date.UTC(2026, 9, 17, 2, 0, 0)
const u3 = { role: 'user', id: 'u3', content: [{ type: 'text', text: '周末翻译' }] }
d = await preStep({ agent: agentFor(TR_PROJECT), messages: [u3] }, () => next([u3]))
ok(d.messages.length === 1, 'weekend: no injection (off-peak)')

Date.now = realNow

// --- i18n 单元：语言决定链与字典回退 ---
const i18n = await import('file:///' + path.join(HERE, '..', 'src', 'i18n.cjs').replace(/\\/g, '/'))
ok(i18n.normalizeLang('zh-CN') === 'zh' && i18n.normalizeLang('EN-us') === 'en' && i18n.normalizeLang('fr') === null,
   'i18n: normalizeLang zh/en/unknown')
ok(i18n.resolveLang([null, undefined, 'en-US']) === 'en', 'i18n: resolveLang skips empty, honors priority')
ok(i18n.resolveLang([() => { throw new Error('boom') }, 'zh']) === 'zh', 'i18n: lazy probe failure skipped')
ok(i18n.resolveLang([]) === 'zh', 'i18n: fallback zh')
const tEn = i18n.createT('en')
ok(tEn('badge.peak') === '🔴 Peak 1×', 'i18n: en dictionary lookup')
ok(tEn('badge.nextSwitch', { time: '12:00', countdown: '1h 30m' }).includes('Next switch 12:00'), 'i18n: {var} interpolation')
ok(tEn('totally.missing') === 'totally.missing', 'i18n: missing key returns key')
ok(i18n.createT('fr')('badge.peak') === '🔴 峰时 1×', 'i18n: unsupported lang falls back to zh')

// --- 语言决定链：cordis config.lang 优先，其次 YI_JIA_LANG ---
Date.now = () => Date.UTC(2026, 9, 19, 2, 0, 0)   // peak
const uEn = { role: 'user', id: 'u-en', content: [{ type: 'text', text: 'translate batch' }] }
mod.apply({ on(ev, fn) { if (ev === 'agent/pre-step') preStep = fn }, inject() {} }, { lang: 'en' })
d = await preStep({ agent: agentFor(TR_PROJECT), messages: [uEn] }, () => next([uEn]))
ok(d.messages.length === 2 && /Cost Guard/.test(d.messages[1].content[0].text), 'lang=en (config): reminder in English')
ok(d.messages[1].content[0].text.includes('off-peak'), 'lang=en (config): mentions off-peak')

process.env.YI_JIA_LANG = 'en'
const uEnv = { role: 'user', id: 'u-env', content: [{ type: 'text', text: 'batch now' }] }
mod.apply({ on(ev, fn) { if (ev === 'agent/pre-step') preStep = fn }, inject() {} })   // no config → env wins
d = await preStep({ agent: agentFor(TR_PROJECT), messages: [uEnv] }, () => next([uEnv]))
ok(d.messages.length === 2 && /Cost Guard/.test(d.messages[1].content[0].text), 'lang from YI_JIA_LANG when no config')
// 恢复中文默认（env 归位 + 重新 apply，让模块级 t/MESSAGES 回到 zh）
process.env.YI_JIA_LANG = 'zh'
mod.apply({ on(ev, fn) { if (ev === 'agent/pre-step') preStep = fn }, inject() {} })
// --- 游戏引擎档案：detectGame 分层识别（档案驱动，见 docs/game-profiles-plan.md） ---
const games = await import('file:///' + path.join(HERE, '..', 'src', 'games.cjs').replace(/\\/g, '/'))
function fixtureGameDir(setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gj-'))
  setup(dir)
  const hit = games.detectGame(dir)
  games.resetDetectCache()
  fs.rmSync(dir, { recursive: true, force: true })
  return hit
}
ok(fixtureGameDir(d => { fs.mkdirSync(path.join(d, 'js'), { recursive: true }); fs.writeFileSync(path.join(d, 'js', 'rmmz_managers.js'), '') })?.id === 'rpgmaker',
   'detect: rpgmaker via js/rmmz_managers.js')
ok(fixtureGameDir(d => fs.writeFileSync(path.join(d, 'game.rmmzproject'), '{}'))?.id === 'rpgmaker',
   'detect: rpgmaker via .rmmzproject')
ok(fixtureGameDir(d => { fs.mkdirSync(path.join(d, 'scenario'), { recursive: true }); fs.writeFileSync(path.join(d, 'scenario', 'main.ks'), '') })?.id === 'kirikiri',
   'detect: kirikiri via shallow .ks')
ok(fixtureGameDir(d => { fs.mkdirSync(path.join(d, 'game'), { recursive: true }); fs.writeFileSync(path.join(d, 'game', 'script.rpy'), '') })?.id === 'renpy',
   'detect: renpy via shallow .rpy')
ok(fixtureGameDir(d => { fs.mkdirSync(path.join(d, 'sub'), { recursive: true }); fs.writeFileSync(path.join(d, 'sub', 'a.lns'), '') })?.id === 'livemaker',
   'detect: livemaker via shallow .lns')
ok(fixtureGameDir(d => fs.writeFileSync(path.join(d, 'Data.wolf'), ''))?.id === 'wolf',
   'detect: wolf via Data.wolf')
ok(fixtureGameDir(d => fs.writeFileSync(path.join(d, 'UnityPlayer.dll'), ''))?.id === 'unity',
   'detect: unity via UnityPlayer.dll')
ok(fixtureGameDir(d => { fs.mkdirSync(path.join(d, 'Game_Data'), { recursive: true }); fs.writeFileSync(path.join(d, 'Game_Data', 'globalgamemanagers'), '') })?.id === 'unity',
   'detect: unity via *_Data/globalgamemanagers')
ok(fixtureGameDir(d => {}) === null, 'detect: empty dir → null (no guess)')
ok(games.detectGame('Z:/definitely-not-exist-yi-jia') === null, 'detect: nonexistent path → null')
ok(games.GAMES.every(g => g.id && g.name.zh && g.name.en && g.notes.zh && g.notes.en && g.effort.zh && g.effort.en && g.markers.length),
   'registry: every profile is complete (bilingual name/notes/effort + markers)')

// --- 引擎注意事项注入：峰时提醒尾部带【引擎】行（识别只影响提醒，认错无害） ---
// 造一个真实存在的"翻译项目"目录：路径含 telegram（命中守卫范围）+ MZ 标记（命中引擎档案）
const tmpGameRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-'))
fs.mkdirSync(path.join(tmpGameRoot, 'js'), { recursive: true })
fs.writeFileSync(path.join(tmpGameRoot, 'js', 'rmmz_managers.js'), '')
Date.now = () => Date.UTC(2026, 9, 19, 2, 0, 0)   // peak
const uG = { role: 'user', id: 'u-g', content: [{ type: 'text', text: '翻译剧情文本' }] }
d = await preStep({ agent: agentFor(tmpGameRoot), messages: [uG] }, () => next([uG]))
ok(d.messages.length === 2 && /RPG Maker MZ\/MV/.test(d.messages[1].content[0].text), 'engine line: RPG Maker identified')
ok(/建议档位/.test(d.messages[1].content[0].text) && /控制符/.test(d.messages[1].content[0].text), 'engine line: notes + effort present')
// 翻译项目但无引擎标记（路径不存在）→ 提醒与 v1.1 一致，没有引擎行
const uN = { role: 'user', id: 'u-n', content: [{ type: 'text', text: '翻译' }] }
d = await preStep({ agent: agentFor(TR_PROJECT), messages: [uN] }, () => next([uN]))
ok(d.messages.length === 2 && !/【/.test(d.messages[1].content[0].text), 'engine line: absent when no engine detected')
// 英文界面下引擎行全英文
mod.apply({ on(ev, fn) { if (ev === 'agent/pre-step') preStep = fn }, inject() {} }, { lang: 'en' })
const uGe = { role: 'user', id: 'u-ge', content: [{ type: 'text', text: 'translate story' }] }
d = await preStep({ agent: agentFor(tmpGameRoot), messages: [uGe] }, () => next([uGe]))
ok(d.messages.length === 2 && /\[RPG Maker MZ\/MV\]/.test(d.messages[1].content[0].text) && /Suggested effort/.test(d.messages[1].content[0].text),
   'engine line: English when lang=en')
fs.rmSync(tmpGameRoot, { recursive: true, force: true })
// 恢复中文（重建徽标注入）
mod.apply({
  on(ev, fn) { if (ev === 'agent/pre-step') preStep = fn },
  inject(deps, fn) { fn({ effect(f) { f() }, on(ev, f2) { if (ev === 'webserver/index-inject') injectListener = f2 } }) },
})

Date.now = realNow

// --- index-inject rows ---
const table = []
injectListener(table)
ok(table.length === 2, 'index-inject: pushed 2 rows (got ' + table.length + ')')
const g = table.find(r => r.kind === 'global')
const s = table.find(r => r.kind === 'script')
ok(!!g && g.name === '__CG_BOOT__' && typeof g.value === 'string', 'global row: __CG_BOOT__ string value')
ok(!!s && s.placement === 'head' && typeof s.text === 'string', 'script row: head placement + text')
ok(s.text.includes('yi-jia-badge'), 'script row: contains badge element id')
ok(s.text.includes('__CG_BOOT__'), 'script row: reads __CG_BOOT__')

// Evaluate the global value then the script in a stubbed DOM.
// Elements support listeners, children traversal, geometry and closest() so we can
// drive click / drag / reposition logic.
let nextLeft = 12, nextTop = 700   // pretend geometry returned by getBoundingClientRect
let nextW = 300, nextH = 60
function makeEl(tag) {
  const el = {
    tagName: tag, style: { cssText: '' }, children: [], _text: '', _listeners: {}, id: '', title: '',
    classList: { add() {}, remove() {} },
    get textContent() { return this.children.length ? this.children.map(c => c.textContent).join(' ') : this._text },
    set textContent(v) { this._text = v },
    appendChild(c) { this.children.push(c); c.parent = this; return c },
    removeChild(c) { this.children = this.children.filter(x => x !== c) },
    remove() { if (this.parent) this.parent.removeChild(this) },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn) },
    fire(ev, arg) { (this._listeners[ev] || []).forEach(fn => fn(arg)) },
    contains() { return false },
    closest() { return null },
    getBoundingClientRect() {
      const left = parseFloat(this.style.left)
      const top = parseFloat(this.style.top)
      return {
        left: Number.isFinite(left) ? left : nextLeft,
        top: Number.isFinite(top) ? top : nextTop,
        width: nextW, height: nextH,
      }
    },
  }
  return el
}
const store = {}
const win = { innerWidth: 1400, innerHeight: 900 }
global.window = win
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v) },
}
let bodyEl = makeEl('body')
const docListeners = {}
// Real DOM: getElementById finds the mounted badge, so render() removes then re-appends.
// Our stub must mirror that, otherwise every render stacks a new badge.
function findById(id, root) {
  if (!root) return null
  if (root.id === id) return root
  for (const c of root.children || []) {
    const hit = findById(id, c)
    if (hit) return hit
  }
  return null
}
global.document = {
  readyState: 'complete',
  createElement: (t) => makeEl(t),
  getElementById: (id) => findById(id, bodyEl) || findById(id, global.document.documentElement),
  addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn) },
  removeEventListener(ev, fn) { docListeners[ev] = (docListeners[ev] || []).filter(f => f !== fn) },
  elementFromPoint() { return null },   // no existing UI => no overlap
  get body() { return bodyEl },
  documentElement: makeEl('html'),
}
function fireDoc(ev, arg) { (docListeners[ev] || []).slice().forEach(fn => fn(arg)) }
try {
  win.__CG_BOOT__ = eval(g.value)
  ok(typeof win.__CG_BOOT__ === 'function', 'global value evaluates to function')
  const cfg = win.__CG_BOOT__()
  ok(Array.isArray(cfg.holidays) && 'status' in cfg, 'config shape {holidays,status}')
  ok(cfg.status && cfg.status.cost, 'config carries cost snapshot')
  ok(cfg.messages && typeof cfg.messages['badge.peak'] === 'string', 'config carries message dictionary')

  // --- collapsed state ---
  eval(s.text)
  ok(true, 'badge script executes without throwing')
  let badge = bodyEl.children.find(c => c.id === 'yi-jia-badge')
  ok(!!badge, 'collapsed: badge mounted')
  let text = badge.textContent
  ok(/谷时|峰时/.test(text), 'collapsed: shows window')
  ok(/实付/.test(text), 'collapsed: shows actual cost')
  ok(/点击展开/.test(text), 'collapsed: shows expand hint')
  ok(!/v4-pro/.test(text), 'collapsed: hides detail rows')

  // --- default placement: bottom-left, away from top-right controls ---
  ok(badge.style.left === '12px', 'placement: default left margin (got ' + badge.style.left + ')')
  ok(/^688px$|^\d+px$/.test(badge.style.top) && parseFloat(badge.style.top) > 400,
     'placement: bottom area, not top-right (top=' + badge.style.top + ')')
  ok(badge.style.right === 'auto', 'placement: right cleared')

  // --- click to expand (mousedown + mouseup without movement) ---
  badge.fire('mousedown', { button: 0, clientX: 100, clientY: 700, preventDefault() {}, stopPropagation() {} })
  fireDoc('mouseup', { clientX: 100, clientY: 700 })
  ok(store['yi-jia-open'] === '1', 'click: persists open state')
  badge = bodyEl.children.find(c => c.id === 'yi-jia-badge')
  text = badge.textContent
  ok(/v4-pro/.test(text), 'expanded: shows v4-pro comparison')
  ok(/缓存命中率/.test(text), 'expanded: shows cache hit rate')
  ok(/峰\/谷调用占比/.test(text), 'expanded: shows peak/off-peak call share')
  ok(/最近 5 天/.test(text), 'expanded: shows recent days')
  ok(/推理强度/.test(text), 'expanded: shows reasoning guidance')
  ok(!/点击展开/.test(text), 'expanded: hides expand hint')

  // --- drag moves and persists position ---
  badge.style.left = '12px'; badge.style.top = '700px'
  badge.fire('mousedown', { button: 0, clientX: 100, clientY: 700, preventDefault() {}, stopPropagation() {} })
  fireDoc('mousemove', { clientX: 400, clientY: 500 })
  fireDoc('mouseup', { clientX: 400, clientY: 500 })
  const savedPos = JSON.parse(store['yi-jia-pos'] || 'null')
  ok(!!savedPos && typeof savedPos.x === 'number', 'drag: position persisted')
  ok(store['yi-jia-open'] === '1', 'drag: does not toggle open state')

  // --- click again collapses ---
  // Re-query: the previous mousedown/mouseup pair may have re-rendered.
  badge = bodyEl.children.find(c => c.id === 'yi-jia-badge')
  ok(store['yi-jia-open'] === '1', 'state before collapse click is open')
  badge.fire('mousedown', { button: 0, clientX: 300, clientY: 600, preventDefault() {}, stopPropagation() {} })
  fireDoc('mouseup', { clientX: 300, clientY: 600 })
  ok(store['yi-jia-open'] === '0', 'click again: collapses (open=' + store['yi-jia-open'] + ')')

  // --- open state + position survive reload (localStorage) ---
  store['yi-jia-open'] = '1'
  store['yi-jia-pos'] = JSON.stringify({ x: 321, y: 456 })
  bodyEl = makeEl('body')
  // reset module guard so the script re-runs as on a fresh page load
  delete win.__DSH_COST_GUARD__
  eval(s.text)
  badge = bodyEl.children.find(c => c.id === 'yi-jia-badge')
  ok(!!badge && /v4-pro/.test(badge.textContent), 'persistence: reopens after page reload')
  ok(badge.style.left === '321px' && badge.style.top === '456px',
     'persistence: restores saved position (got ' + badge.style.left + ',' + badge.style.top + ')')
} catch (e) { ok(false, 'eval threw: ' + e.message) }

// --- 徽标按注入字典渲染英文 ---
try {
  store['yi-jia-open'] = '0'
  let injectEn = null
  mod.apply({
    on(ev, fn) { if (ev === 'agent/pre-step') preStep = fn },
    inject(deps, fn) { fn({ effect(f) { f() }, on(ev, f2) { if (ev === 'webserver/index-inject') injectEn = f2 } }) },
  }, { lang: 'en' })
  const tableEn = []
  injectEn(tableEn)
  const gEn = tableEn.find(r => r.kind === 'global')
  const sEn = tableEn.find(r => r.kind === 'script')
  win.__CG_BOOT__ = eval(gEn.value)
  delete win.__DSH_COST_GUARD__
  bodyEl = makeEl('body')
  eval(sEn.text)
  const badgeEn = bodyEl.children.find(c => c.id === 'yi-jia-badge')
  ok(!!badgeEn && /(Peak|Off-peak) 1?×?/.test(badgeEn.textContent), 'badge en: window label in English')
  ok(/Paid ¥/.test(badgeEn.textContent), 'badge en: cost line in English')
  ok(!/谷时|峰时|实付/.test(badgeEn.textContent), 'badge en: no Chinese UI strings')
} catch (e) { ok(false, 'badge en eval threw: ' + e.message) }

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
