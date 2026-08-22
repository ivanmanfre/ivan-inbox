// CENSUS A analyzer: surface histogram, same-colour nested pairs, and the
// border-only-separation class. Reads out-measure.json.
import { readFileSync, writeFileSync } from 'node:fs'
const d = JSON.parse(readFileSync(new URL('./out-measure.json', import.meta.url), 'utf8'))
const S = d.screens
const L = []
const p = s => L.push(s)

// --- theme token table ----------------------------------------------------
p('## A1 · COLOUR TOKENS, BOTH THEMES, WITH RELATIVE LUMINANCE\n')
p('| token | dark value | dark L | light value | light L |')
p('|---|---|---|---|---|')
const dk = d.theme || {}, lt = d.themeLight || {}
for (const k of Object.keys(dk)) {
  if (!/^#|rgb/.test(dk[k].value)) continue
  p(`| \`${k}\` | \`${dk[k].value}\` | ${dk[k].lum ?? '-'} | \`${lt[k]?.value ?? '-'}\` | ${lt[k]?.lum ?? '-'} |`)
}

// --- surface histogram ----------------------------------------------------
p('\n## A2 · WHAT IS ACTUALLY PAINTED, PER SCREEN\n')
p('| screen | distinct painted bg colours | top 4 by element count |')
p('|---|---|---|')
const allHist = {}
for (const [name, s] of Object.entries(S)) {
  if (s.error) { p(`| ${name} | (failed) | - |`); continue }
  const h = Object.entries(s.surfHist).sort((a, b) => b[1] - a[1])
  h.forEach(([c, n]) => allHist[c] = (allHist[c] || 0) + n)
  p(`| ${name} | ${h.length} | ${h.slice(0, 4).map(([c, n]) => `${c} x${n}`).join('<br>')} |`)
}
p('\n**Union across all 10 surfaces:**\n')
p('| painted colour | elements | share |')
p('|---|---|---|')
const tot = Object.values(allHist).reduce((a, b) => a + b, 0)
for (const [c, n] of Object.entries(allHist).sort((a, b) => b[1] - a[1]))
  p(`| \`${c}\` | ${n} | ${(100 * n / tot).toFixed(1)}% |`)

// --- SAME pairs -----------------------------------------------------------
const key = r => `${r.child}||${r.parent}`
const same = new Map(), nopaint = new Map()
for (const [name, s] of Object.entries(S)) {
  if (s.error) continue
  for (const r of s.pairs) {
    const m = r.kind === 'SAME' ? same : nopaint
    const k = key(r)
    if (!m.has(k)) m.set(k, { ...r, screens: new Set(), n: 0 })
    m.get(k).screens.add(name); m.get(k).n++
  }
}
const sepOf = r => {
  const bits = []
  if (r.borderW > 0) bits.push(`border ${r.borderW}px ${r.borderColor}`)
  if (r.shadow) bits.push(`shadow ${r.shadow.slice(0, 46)}`)
  if (!bits.length) bits.push('**NOTHING**')
  return bits.join(' + ')
}
p('\n## A3 · NESTED PAIRS WITH IDENTICAL COMPUTED BACKGROUND-COLOR\n')
p(`Distinct \`child||parent\` shapes: **${same.size}**. Live instances across the 10 surfaces: **${[...same.values()].reduce((a, b) => a + b.n, 0)}**.\n`)
p('| child selector | on parent selector | shared bg (L) | what separates them | box? | seen on |')
p('|---|---|---|---|---|---|')
for (const r of [...same.values()].sort((a, b) => b.n - a.n))
  p(`| \`${r.child}\` | \`${r.parent}\` | \`${r.color}\` (${r.lum}) | ${sepOf(r)} | ${r.isBox ? `r${r.radius} p${r.pad}` : 'no'} | ${[...r.screens].join(', ')} |`)

p('\n## A4 · CHILD BOXES THAT PAINT NOTHING AT ALL (border does 100% of the work)\n')
const boxes = [...nopaint.values()].filter(r => r.isBox && (r.borderW > 0 || r.radius > 0))
p(`Distinct shapes: **${boxes.length}** of ${nopaint.size} no-paint shapes. Live instances: **${boxes.reduce((a, b) => a + b.n, 0)}**.\n`)
p('| child selector | on parent selector | inherited bg (L) | separator | radius | seen on |')
p('|---|---|---|---|---|---|')
for (const r of boxes.sort((a, b) => b.n - a.n).slice(0, 45))
  p(`| \`${r.child}\` | \`${r.parent}\` | \`${r.color}\` (${r.lum}) | ${sepOf(r)} | ${r.radius}px | ${[...r.screens].join(', ')} |`)

const md = L.join('\n')
writeFileSync(new URL('./out-census-a.md', import.meta.url), md)
console.log(md.slice(0, 200))
console.error('SAME distinct:', same.size, 'instances:', [...same.values()].reduce((a, b) => a + b.n, 0))
console.error('NOPAINT-box distinct:', boxes.length, 'instances:', boxes.reduce((a, b) => a + b.n, 0))
console.error('union painted colours:', Object.keys(allHist).length)
