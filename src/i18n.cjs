// yi-jia 共享 i18n 模块（CJS，供 ESM 插件与 CJS 脚本共用）。
// 字典文件：locale/messages.<lang>.json，zh 为基座，其他语言缺 key 时回退 zh，再缺返回 key 本身。
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DICT_DIR = path.join(__dirname, '..', 'locale')
const SUPPORTED = ['zh', 'en']
const cache = new Map()

function normalizeLang(lang) {
  const l = String(lang || '').trim().toLowerCase()
  if (!l) return null
  if (l.startsWith('zh') || l === 'cn' || l.startsWith('chinese')) return 'zh'
  if (l.startsWith('en')) return 'en'
  return null
}

// 按优先级取第一个可识别的语言；全部落空时回退 'zh'。
// 优先级数组的元素可以是字符串，也可以是返回字符串的惰性函数（求值失败会被跳过）。
function resolveLang(priority = []) {
  for (const item of priority) {
    let value = item
    if (typeof item === 'function') {
      try { value = item() } catch (e) { value = null }
    }
    const n = normalizeLang(value)
    if (n) return n
  }
  return 'zh'
}

function readDict(lang) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DICT_DIR, `messages.${lang}.json`), 'utf8'))
  } catch (e) {
    return {}
  }
}

function loadMessages(lang) {
  const l = normalizeLang(lang) || 'zh'
  if (cache.has(l)) return cache.get(l)
  const base = readDict('zh')
  const messages = l === 'zh' ? base : { ...base, ...readDict(l) }
  cache.set(l, messages)
  return messages
}

// {var} 插值；缺失的 key 先回退 zh，再返回 key 本身（便于发现漏翻）。
function translate(messages, lang, key, vars) {
  let s = messages[key]
  if (typeof s !== 'string' && lang !== 'zh') s = loadMessages('zh')[key]
  if (typeof s !== 'string') return key
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))
  return s
}

// createT('en') 返回 (key, vars) => string
function createT(lang) {
  const l = normalizeLang(lang) || 'zh'
  const messages = loadMessages(l)
  return (key, vars) => translate(messages, l, key, vars)
}

module.exports = { SUPPORTED, normalizeLang, resolveLang, loadMessages, translate, createT }
