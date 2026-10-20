import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const games = await import('file:///' + path.join(process.cwd(), 'src', 'games.cjs').replace(/\\/g, '/'))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gj-'))
fs.mkdirSync(path.join(dir, 'scenario'), { recursive: true })
fs.writeFileSync(path.join(dir, 'scenario', 'main.ks'), '')
console.log('dir:', dir)
console.log('hit:', JSON.stringify(games.detectGame(dir) && games.detectGame(dir).id))
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gj-'))
console.log('empty hit:', games.detectGame(empty))
console.log('nonexist hit:', games.detectGame('Z:/nope-yi-jia'))
