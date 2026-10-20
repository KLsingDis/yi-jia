// yi-jia 游戏引擎档案库 —— 声明式引擎档案 + 分层检测。
//
// 设计借鉴三个成熟汉化工具的多类型支持：
//   SExtractor: 档案三段式（识别签名 + 文本位置 + 内嵌注意事项）
//   GalTransl:  检测分层（扩展名 → 内容嗅探 → 魔数 → 显式指定），未知安全降级
//   AiNiee:     格式档案三件套（检测特征 + 翻译注意点 + 成本参数）
//
// 本插件是成本守卫：识别结果只用于"提醒内容定制"，不做任何拦截，认错无害。
// 新增引擎 = 在 GAMES 里加一份档案，不改检测逻辑。

'use strict'

const fs = require('node:fs')
const path = require('node:path')

// ---- 档案库 ----
// markers（任一命中即判定，按声明顺序）：
//   { file: 'rel/path' }     精确相对路径存在
//   { topFile: 'name' }      顶层文件名（支持 *.ext 通配）
//   { topExt: '.ext' }       顶层任一文件扩展名
//   { shallowExt: '.ext' }   浅层（限深 2、限量）扩展名
// 每个档案的 notes/effort 双语言，跟 locale 体系对齐。
const GAMES = [
  {
    id: 'rpgmaker',
    name: { zh: 'RPG Maker MZ/MV', en: 'RPG Maker MZ/MV' },
    markers: [
      { file: 'js/rmmz_managers.js' },     // MZ 运行时
      { file: 'js/rpg_managers.js' },      // MV 运行时
      { topExt: '.rmmzproject' },          // MZ 工程文件
      { topExt: '.rpgproject' },           // MV 工程文件
    ],
    effort: {
      zh: '批量首翻 off / 术语·审校 low / 疑难句 high',
      en: 'bulk first-pass off / glossary·proofread low / hard sentences high',
    },
    notes: {
      zh: '控制符 \\C[n] \\V[n] \\N[n] \\G 必须原样保留；data/*.json 大文件先切分再送翻，译后跑占位符完整性校验。',
      en: 'Control codes \\C[n] \\V[n] \\N[n] \\G must be preserved verbatim; split large data/*.json files before batch translation and run a placeholder-integrity check afterwards.',
    },
  },
  {
    id: 'kirikiri',
    name: { zh: 'Kirikiri/KAG', en: 'Kirikiri/KAG' },
    markers: [
      { topExt: '.xp3' },                  // 封包
      { shallowExt: '.ks' },               // 剧本
      { shallowExt: '.tjs' },
    ],
    effort: {
      zh: '批量首翻 off / 标签密集句 low / 双关·梗 high',
      en: 'bulk first-pass off / tag-dense lines low / puns·jokes high',
    },
    notes: {
      zh: '标签 [ruby] [l] [r] [wait] 与内嵌表达式必须原样保留；注意 cp932/SJIS 编码路线（GBK 注入或 SJIS 替换），译后逐文件比对标签数量。',
      en: 'Tags like [ruby] [l] [r] [wait] and embedded expressions must be preserved; mind the cp932/SJIS encoding route (GBK injection or SJIS tunneling), and diff tag counts per file after translation.',
    },
  },
  {
    id: 'renpy',
    name: { zh: 'RenPy', en: 'RenPy' },
    markers: [{ shallowExt: '.rpy' }],
    effort: {
      zh: '批量首翻 off / 审校 low / 文学性台词 high',
      en: 'bulk first-pass off / proofread low / literary lines high',
    },
    notes: {
      zh: 'Python 字符串转义与 {var} 插值必须原样保留；角色名可从脚本结构自动抽取建术语表。',
      en: 'Python string escapes and {var} interpolation must be preserved; character names can be auto-extracted from script structure into the glossary.',
    },
  },
  {
    id: 'livemaker',
    name: { zh: 'Livemaker', en: 'Livemaker' },
    markers: [{ shallowExt: '.lns' }],
    effort: {
      zh: '批量首翻 off / 审校 low',
      en: 'bulk first-pass off / proofread low',
    },
    notes: {
      zh: '二进制 .lns 走 pylivemaker 提取/回写；换行符与编码按工具默认，勿手工改包。',
      en: 'Binary .lns goes through pylivemaker for extraction/write-back; keep the tool\'s default line endings and encoding, don\'t hand-patch packages.',
    },
  },
  {
    id: 'wolf',
    name: { zh: 'Wolf RPG Editor', en: 'Wolf RPG Editor' },
    markers: [
      { topFile: 'Data.wolf' },
      { shallowExt: '.wolf' },
    ],
    effort: {
      zh: '批量首翻 off / 审校 low',
      en: 'bulk first-pass off / proofread low',
    },
    notes: {
      zh: '先 WolfDec 解包 Data.wolf 再提取文本；引擎按 GBK 处理中文，回写注意编码。',
      en: 'Unpack Data.wolf with WolfDec before extracting text; the engine treats Chinese as GBK — mind the encoding on write-back.',
    },
  },
  {
    id: 'unity',
    name: { zh: 'Unity（含 UTAGE）', en: 'Unity (incl. UTAGE)' },
    markers: [
      { file: 'UnityPlayer.dll' },
      { dirFileSuffix: { dirSuffix: '_Data', file: 'globalgamemanagers' } },
    ],
    effort: {
      zh: '文本抽取 low / 翻译 off / 回写校验 low',
      en: 'text extraction low / translation off / write-back check low',
    },
    notes: {
      zh: '文本多在资源与 mono 数据里（UTAGE 为 .dat），需专用工具按资源分批抽取；先小样本验证抽取质量再全量跑。',
      en: 'Text lives in assets and mono data (UTAGE uses .dat); extract per-asset with dedicated tools and validate on a small sample before a full run.',
    },
  },
]

// ---- 分层检测 ----
// 精确路径 → 顶层文件名 → 顶层扩展名 → 浅层扩展名；全部落空返回 null（不猜）。
// 任何 IO 异常都视为"未命中"：检测只影响提醒内容，绝不能打断会话。

const SHALLOW_MAX_DEPTH = 2
const SHALLOW_MAX_ENTRIES = 200
const detectCache = new Map()

function safeExists(p) {
  try { return fs.existsSync(p) } catch (e) { return false }
}

function topFiles(cwd) {
  try {
    return fs.readdirSync(cwd, { withFileTypes: true })
  } catch (e) {
    return []
  }
}

// 浅层扩展名扫描：cwd 起限深 2 层、每层最多 200 条目，找到即短路。
function hasShallowExt(cwd, ext) {
  const walk = (dir, depth) => {
    if (depth > SHALLOW_MAX_DEPTH) return false
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return false }
    let seen = 0
    for (const ent of entries) {
      if (++seen > SHALLOW_MAX_ENTRIES) break
      if (ent.isDirectory()) {
        if (walk(path.join(dir, ent.name), depth + 1)) return true
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith(ext)) {
        return true
      }
    }
    return false
  }
  return walk(cwd, 0)
}

function matchMarker(cwd, marker) {
  if (marker.file) return safeExists(path.join(cwd, ...marker.file.split('/')))
  if (marker.topFile) {
    const want = marker.topFile.toLowerCase()
    const isGlob = want.startsWith('*')
    return topFiles(cwd).some((ent) => {
      const n = ent.name.toLowerCase()
      return isGlob ? n.endsWith(want.slice(1)) : n === want
    })
  }
  if (marker.topExt) {
    return topFiles(cwd).some((ent) => ent.isFile() && ent.name.toLowerCase().endsWith(marker.topExt))
  }
  if (marker.shallowExt) return hasShallowExt(cwd, marker.shallowExt)
  if (marker.dirFileSuffix) {
    const { dirSuffix, file } = marker.dirFileSuffix
    return topFiles(cwd).some((ent) =>
      ent.isDirectory() && ent.name.toLowerCase().endsWith(dirSuffix.toLowerCase()) &&
      safeExists(path.join(cwd, ent.name, file)))
  }
  return false
}

// 返回命中的档案对象；未命中或出错返回 null。结果按 cwd 缓存（档案与检测逻辑都是静态的）。
function detectGame(cwd) {
  if (!cwd || typeof cwd !== 'string') return null
  if (detectCache.has(cwd)) return detectCache.get(cwd)
  let hit = null
  try {
    for (const game of GAMES) {
      if (game.markers.some((m) => matchMarker(cwd, m))) { hit = game; break }
    }
  } catch (e) {
    hit = null
  }
  detectCache.set(cwd, hit)
  return hit
}

// 测试用：清缓存
function resetDetectCache() { detectCache.clear() }

module.exports = { GAMES, detectGame, resetDetectCache }
