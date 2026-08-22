// Which authored font declarations are DEAD because faithful.css:181
// (`.wb.wb, .wb.wb *`, specificity 0-2-0) outranks them?
//
// A declaration survives only if its selector scores >= 0-2-0 AND, at exactly
// 0-2-0, also wins on source order. faithful.css is imported after styles.css,
// so a 0-2-0 selector in styles.css LOSES and a 0-2-0 selector in wb2026.css
// (imported last) WINS. Anything below 0-2-0 loses everywhere.
//   node flattener-victims.mjs
import { readFileSync, writeFileSync } from 'node:fs'
const DIR = '/Users/ivanmanfredi/Desktop/ivan-inbox/src/exp/v2c/'
// import order from Shell.tsx:60,64,67
const SHEETS = [['styles.css', 0], ['faithful.css', 1], ['wb2026.css', 2]]
const FLAT_ORDER = 1 // faithful.css

const decomment = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
const FLATTENED = ['font-size', 'font-weight', 'letter-spacing', 'line-height']

// specificity (a,b,c) of ONE compound selector, ignoring the universal selector
const spec = sel => {
  let a = 0, b = 0, c = 0
  const s = sel.replace(/::?[a-z-]+(\([^)]*\))?/g, m => { // pseudo
    if (/^::/.test(m) || /^:(before|after|first-line|first-letter)/.test(m)) { c++; return '' }
    if (/^:(not|is|where|has)\(/.test(m)) return m.slice(m.indexOf('(') + 1, -1) // approximate: count inside
    b++; return ''
  })
  a += (s.match(/#[\w-]+/g) || []).length
  b += (s.match(/\.[\w-]+/g) || []).length
  b += (s.match(/\[[^\]]+\]/g) || []).length
  c += (s.replace(/[.#][\w-]+|\[[^\]]+\]/g, ' ').match(/\b[a-z][\w-]*\b/g) || []).length
  return [a, b, c]
}
const cmp = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
const FLAT = [0, 2, 0]

const rows = []
for (const [file, order] of SHEETS) {
  const text = decomment(readFileSync(DIR + file, 'utf8'))
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(text))) {
    const selList = m[1].split('\n').pop().trim() ? m[1].trim() : m[1].trim()
    const body = m[2]
    const props = FLATTENED.filter(p => new RegExp('(^|;)\\s*' + p + '\\s*:', 'i').test(body))
    if (!props.length) continue
    if (/^\s*@/.test(selList)) continue
    const line = text.slice(0, m.index).split('\n').length
    for (const one of selList.split(',')) {
      const sel = one.trim()
      if (!sel || /^\d/.test(sel)) continue
      // the flatten rule itself, and its re-assertions, are not victims
      if (/\.wb\.wb\b/.test(sel)) {
        const sp = spec(sel)
        if (cmp(sp, FLAT) > 0) continue                    // 0-3-0+, wins
        if (cmp(sp, FLAT) === 0 && order > FLAT_ORDER) continue // ties, later
        rows.push({ file, line, sel, props, sp, why: 'ties 0-2-0 but loses on source order' })
        continue
      }
      const sp = spec(sel)
      const c = cmp(sp, FLAT)
      if (c > 0) continue
      if (c === 0 && order > FLAT_ORDER) continue
      rows.push({ file, line, sel, props, sp, why: c < 0 ? `loses on specificity (${sp.join('-')} < 0-2-0)` : 'ties 0-2-0 but loses on source order' })
    }
  }
}

// A dead declaration is only a VISIBLE defect if nothing re-asserts the tier at
// 0-3-0. faithful.css re-assigns seven tiers over ~200 selectors, so most of
// these are dead-but-covered. The silent victims are the ones whose key class
// appears in NO `.wb.wb.wb` font-size rule anywhere.
const reassert = decomment(readFileSync(DIR + 'faithful.css', 'utf8') + '\n' + readFileSync(DIR + 'wb2026.css', 'utf8'))
const covered = new Set()
{
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(reassert))) {
    if (!/font-size\s*:/.test(m[2])) continue
    for (const one of m[1].split(',')) {
      const sel = one.trim()
      if (!/\.wb\.wb\.wb/.test(sel)) continue
      ;(sel.match(/\.[\w-]+/g) || []).filter(c => c !== '.wb').forEach(c => covered.add(c))
    }
  }
}
const keyClass = sel => (sel.match(/\.[\w-]+/g) || []).filter(c => c !== '.wb').pop()
rows.forEach(r => { const k = keyClass(r.sel); r.silent = !k || !covered.has(k) })
const silent = rows.filter(r => r.silent && r.props.includes('font-size'))

const L = []
L.push('SILENT font-size victims (dead AND never re-asserted at .wb.wb.wb): ' + silent.length + '\n')
L.push('| file:line | selector | specificity | dead declarations |')
L.push('|---|---|---|---|')
for (const r of silent) L.push(`| \`${r.file}:${r.line}\` | \`${r.sel.replace(/\|/g, '\\|').slice(0, 70)}\` | ${r.sp.join('-')} | ${r.props.join(', ')} |`)
L.push('\n### all dead declaration sites\n')
L.push('| file:line | selector | specificity | dead declarations | why |')
L.push('|---|---|---|---|---|')
for (const r of rows) L.push(`| \`${r.file}:${r.line}\` | \`${r.sel.replace(/\|/g, '\\|').slice(0, 70)}\` | ${r.sp.join('-')} | ${r.props.join(', ')} | ${r.why} |`)
writeFileSync(new URL('./out-flattener-victims.md', import.meta.url), L.join('\n'))

const byFile = {}
rows.forEach(r => byFile[r.file] = (byFile[r.file] || 0) + 1)
const byProp = {}
rows.forEach(r => r.props.forEach(p => byProp[p] = (byProp[p] || 0) + 1))
console.log('DEAD declaration sites:', rows.length)
console.log('by sheet:', JSON.stringify(byFile))
console.log('by property:', JSON.stringify(byProp))
console.log('distinct selectors:', new Set(rows.map(r => r.sel)).size)
console.log('SILENT font-size victims (never re-asserted):', silent.length)
