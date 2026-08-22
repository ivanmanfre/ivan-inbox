// CENSUS A (static half): every custom property defined across the three
// workbench sheets, where it is defined, and how many times it is read.
// Re-runnable as an after-proof: `node token-census.mjs`
import { readFileSync, writeFileSync } from 'node:fs'

const DIR = '/Users/ivanmanfredi/Desktop/ivan-inbox/src/exp/v2c/'
const SHEETS = ['faithful.css', 'styles.css', 'wb2026.css']
const SRC = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/src/styles.css', 'utf8')

// --- 1. definitions -------------------------------------------------------
const defs = new Map() // name -> [{sheet, line, value, scope}]
const scopeOf = (text, idx) => {
  // walk back to the nearest opening selector at brace depth 0
  const head = text.slice(0, idx)
  let depth = 0, start = -1
  for (let i = head.length - 1; i >= 0; i--) {
    const c = head[i]
    if (c === '}') depth++
    else if (c === '{') { if (depth === 0) { start = i; break } depth-- }
  }
  if (start < 0) return '(top level)'
  const before = head.slice(0, start)
  const nl = Math.max(before.lastIndexOf('}'), before.lastIndexOf('{'), before.lastIndexOf('*/'))
  return before.slice(nl + 1).replace(/\s+/g, ' ').trim().slice(0, 60) || '(?)'
}

// Comments are blanked (length-preserving, so line numbers stay true). A
// comment that says `--- --r-hero: a card ... ---` is prose, not a definition.
const decomment = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
const files = SHEETS.map(f => [f, decomment(readFileSync(DIR + f, 'utf8'))])
files.push(['src/styles.css', decomment(SRC)])

for (const [sheet, text] of files) {
  const re = /(--[a-zA-Z0-9-]+)\s*:\s*([^;}]+)/g
  let m
  while ((m = re.exec(text))) {
    // skip var(--x, fallback) matches: those are reads not writes
    const pre = text.slice(Math.max(0, m.index - 6), m.index)
    if (/var\(\s*$/.test(pre) || /,\s*$/.test(pre)) continue
    const line = text.slice(0, m.index).split('\n').length
    defs.has(m[1]) || defs.set(m[1], [])
    defs.get(m[1]).push({ sheet, line, value: m[2].trim(), scope: scopeOf(text, m.index) })
  }
}

// --- 2. usage counts ------------------------------------------------------
const cssAll = files.map(f => f[1]).join('\n')
const usage = new Map()
for (const name of defs.keys()) {
  const n = (cssAll.match(new RegExp('var\\(\\s*' + name + '\\b', 'g')) || []).length
  usage.set(name, n)
}

// --- 3. output ------------------------------------------------------------
const rows = [...defs.entries()].sort((a, b) => a[0].localeCompare(b[0]))
const lines = []
lines.push('| token | defs (sheet:line @ scope = value) | var() reads |')
lines.push('|---|---|---|')
for (const [name, ds] of rows) {
  const where = ds.map(d => `${d.sheet}:${d.line} @ \`${d.scope}\` = \`${d.value}\``).join('<br>')
  lines.push(`| \`${name}\` | ${where} | ${usage.get(name)} |`)
}
const md = lines.join('\n')
writeFileSync(new URL('./out-tokens.md', import.meta.url), md)
console.log(`${rows.length} distinct custom properties`)
console.log(`definition sites: ${[...defs.values()].reduce((a, b) => a + b.length, 0)}`)
console.log(`zero-read tokens: ${[...usage.entries()].filter(([, n]) => n === 0).map(([k]) => k).join(', ')}`)
console.log(md)
