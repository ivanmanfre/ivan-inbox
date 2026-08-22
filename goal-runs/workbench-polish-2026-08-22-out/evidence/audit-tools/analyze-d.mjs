// CENSUS D: every implementation of the "ALL-CAPS label + value" metadata row.
// Live instances from out-measure.json, plus a static sweep of the components
// that build them so each distinct implementation can be pointed at a file:line.
//   node analyze-d.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
const d = JSON.parse(readFileSync(new URL('./out-measure.json', import.meta.url), 'utf8'))
const V2C = '/Users/ivanmanfredi/Desktop/ivan-inbox/src/exp/v2c/'
const SRC = '/Users/ivanmanfredi/Desktop/ivan-inbox/src/'
const L = []; const p = s => L.push(s)
const px = s => parseFloat(s) || 0

// ---- live instances ------------------------------------------------------
const all = []
for (const [screen, s] of Object.entries(d.screens)) {
  if (s.error) continue
  for (const l of s.labels) all.push({ ...l, screen })
}
// An IMPLEMENTATION is the label's class plus the row shape it lives in. Two
// labels with the same class and the same parent layout are the same pattern.
const impl = new Map()
for (const l of all) {
  const cls = l.sel.replace(/^[a-z]+\./, '').split('.')[0] || l.sel
  const k = cls + ' @ ' + (l.parentSel || '?').replace(/^[a-z]+\./, '').split('.')[0]
  if (!impl.has(k)) impl.set(k, { k, cls, n: 0, screens: new Set(), ex: l, samples: new Set() })
  const i = impl.get(k); i.n++; i.screens.add(l.screen); if (i.samples.size < 3) i.samples.add(l.text)
}

p('| # | label class | inside | n | screens | label type | value type | row height | parent layout |')
p('|---|---|---|---|---|---|---|---|---|')
const impls = [...impl.values()].sort((a, b) => b.n - a.n)
impls.forEach((i, n) => {
  const e = i.ex
  p(`| ${n + 1} | \`.${i.cls}\` | \`${(e.parentSel || '?')}\` | ${i.n} | ${[...i.screens].join(', ')} | ${e.fs}/${e.fw}${e.tt === 'uppercase' ? '/UPPER' : ''} ls=${e.ls} \`${e.color}\` | ${e.valueFs || '-'} \`${e.valueSel || '-'}\` | **${e.rowH ?? '?'}px** | ${e.parentDisplay}${e.parentFlexDir && e.parentFlexDir !== 'row' ? '/' + e.parentFlexDir : ''} gap=${e.parentGap} pad=${(e.parentPad || '').trim()} |`)
})

// ---- vertical cost --------------------------------------------------------
const heights = all.map(l => l.rowH).filter(h => h != null)
const distinctH = [...new Set(heights.map(h => Math.round(h)))].sort((a, b) => a - b)

// ---- static: where are they authored? -------------------------------------
const files = []
const walk = dir => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!/node_modules/.test(e.name)) walk(dir + e.name + '/'); continue }
    if (!/\.tsx$/.test(e.name) || /\.test\./.test(e.name)) continue
    files.push(dir + e.name)
  }
}
walk(V2C); walk(SRC + 'screens/')
// class names that ARE the label half of a label/value row, harvested live
const labelClasses = [...new Set(all.map(l => l.sel.replace(/^[a-z]+\./, '').split('.')[0]))].filter(Boolean)
const authored = []
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((ln, i) => {
    for (const c of labelClasses) {
      if (!new RegExp(`className=["'\`][^"'\`]*\\b${c}\\b`).test(ln)) continue
      authored.push({ file: f.replace(SRC, 'src/'), line: i + 1, cls: c, text: ln.trim().slice(0, 100) })
      break
    }
  })
}
p('\n### where each implementation is authored\n')
p('| label class | component file:line |')
p('|---|---|')
const byCls = new Map()
authored.forEach(a => { if (!byCls.has(a.cls)) byCls.set(a.cls, []); byCls.get(a.cls).push(`${a.file}:${a.line}`) })
for (const [c, locs] of [...byCls.entries()].sort()) p(`| \`.${c}\` | ${locs.slice(0, 6).join(', ')}${locs.length > 6 ? ` (+${locs.length - 6} more)` : ''} |`)

// ---- the CSS behind each -------------------------------------------------
const sheets = ['faithful.css', 'styles.css', 'wb2026.css'].map(f => [f, readFileSync(V2C + f, 'utf8').split('\n')])
p('\n### the CSS rule behind each label class\n')
p('| label class | rule sites |')
p('|---|---|')
for (const c of labelClasses.sort()) {
  const hits = []
  for (const [f, lines] of sheets) lines.forEach((ln, i) => {
    if (new RegExp(`\\.${c}[,{ :]`).test(ln) && /\{/.test(ln)) hits.push(`${f}:${i + 1}`)
  })
  if (hits.length) p(`| \`.${c}\` | ${hits.slice(0, 5).join(', ')}${hits.length > 5 ? ` (+${hits.length - 5})` : ''} |`)
}

writeFileSync(new URL('./out-census-d.md', import.meta.url), L.join('\n'))
console.error('live label/value instances:', all.length)
console.error('DISTINCT implementations (label class x row shape):', impl.size)
console.error('distinct label CLASSES:', labelClasses.length)
console.error('screens carrying at least one:', new Set(all.map(l => l.screen)).size)
console.error('row heights: distinct', distinctH.length, '=', distinctH.join(', '))
console.error('median row height:', heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)])
console.error('authored sites found:', authored.length)
