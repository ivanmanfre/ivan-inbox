// CENSUS C: every button-ish thing in the live UI, grouped into DISTINCT visual
// treatments, with the near-duplicate clusters called out and every hit target
// under 32px listed.
//   node analyze-c.mjs
import { readFileSync, writeFileSync } from 'node:fs'
const d = JSON.parse(readFileSync(new URL('./out-measure.json', import.meta.url), 'utf8'))
const L = []; const p = s => L.push(s)
const px = s => parseFloat(s) || 0

// collect every control, tagged with the screens it appears on.
// REAL controls are the ones a person can actually press: a real tag or an
// explicit role. The probe also catches `cursor:pointer` spans, but those are
// almost always TEXT INSIDE a button (`span.cal-chip-hh` lives in
// `button.cal-chip-t`), so counting them as hit targets double-counts the
// parent and invents failures that do not exist. They are reported separately.
const REAL = new Set(['button', 'a', 'input', 'textarea', 'select'])
const all = [], pointerText = []
for (const [screen, s] of Object.entries(d.screens)) {
  if (s.error) continue
  for (const c of s.controls) (REAL.has(c.tag) ? all : pointerText).push({ ...c, screen })
}

// A VISUAL TREATMENT is what the eye can tell apart: fill, edge, radius, type
// size/weight/case, and the box metrics. Two controls with the same signature
// are the same treatment no matter what they are called.
const sig = c => [c.bg, c.border, c.radius, c.fs, c.fw, c.tt, c.color,
  Math.round(c.h), c.padT, c.padR, c.padB, c.padL].join(' | ')
// A near-duplicate cluster ignores the box metrics and the exact fill, so two
// grey buttons 2px apart in height land together.
const near = c => [c.border === '0px none ' + c.color ? 'noborder' : (px(c.border) > 0 ? 'border' : 'noborder'),
  c.bg, c.radius, c.fs, c.fw, c.tt].join(' | ')

const byTreat = new Map()
for (const c of all) {
  const k = sig(c)
  if (!byTreat.has(k)) byTreat.set(k, { sig: k, n: 0, sels: new Set(), screens: new Set(), ex: c })
  const t = byTreat.get(k); t.n++; t.sels.add(c.sel.split('.').slice(0, 3).join('.')); t.screens.add(c.screen)
}
const byNear = new Map()
for (const c of all) {
  const k = near(c)
  if (!byNear.has(k)) byNear.set(k, new Set())
  byNear.get(k).add(sig(c))
}

p('| # | n | example selector | h | padding (T R B L) | radius | font | fill | edge | screens |')
p('|---|---|---|---|---|---|---|---|---|---|')
const treats = [...byTreat.values()].sort((a, b) => b.n - a.n)
treats.forEach((t, i) => {
  const c = t.ex
  p(`| ${i + 1} | ${t.n} | \`${[...t.sels].slice(0, 2).join('`, `')}\` | ${c.h} | ${px(c.padT)} ${px(c.padR)} ${px(c.padB)} ${px(c.padL)} | ${c.radius} | ${c.fs}/${c.fw}${c.tt !== 'none' ? '/' + c.tt : ''} | \`${c.bg}\` | \`${c.border}\` | ${[...t.screens].length} |`)
})

// near-duplicate clusters: same look-family, more than one exact signature
p('\n### near-duplicate clusters (same job, different numbers)\n')
p('| cluster (fill / radius / font) | distinct exact treatments in it | the values that differ |')
p('|---|---|---|')
let nearDupTreatments = 0
for (const [k, set] of [...byNear.entries()].sort((a, b) => b[1].size - a[1].size)) {
  if (set.size < 2) continue
  nearDupTreatments += set.size
  const members = treats.filter(t => set.has(t.sig))
  const heights = [...new Set(members.map(m => m.ex.h))]
  const pads = [...new Set(members.map(m => `${px(m.ex.padT)}/${px(m.ex.padR)}`))]
  p(`| \`${k.split(' | ').slice(1, 4).join(' / ')}\` | ${set.size} | heights ${heights.join(', ')}; pad T/R ${pads.join(', ')} |`)
}

// hit targets under 32
p('\n### hit targets under 32px\n')
const small = all.filter(c => c.h < 32)
const smallAgg = new Map()
for (const c of small) {
  const k = c.sel.split('.').slice(0, 3).join('.')
  if (!smallAgg.has(k)) smallAgg.set(k, { n: 0, h: c.h, w: c.w, screens: new Set(), text: c.text })
  const a = smallAgg.get(k); a.n++; a.h = Math.min(a.h, c.h); a.w = Math.min(a.w, c.w); a.screens.add(c.screen)
}
p('| selector | min h | min w | instances | screens |')
p('|---|---|---|---|---|')
for (const [k, a] of [...smallAgg.entries()].sort((x, y) => x[1].h - y[1].h))
  p(`| \`${k}\` | **${a.h}** | ${a.w} | ${a.n} | ${[...a.screens].join(', ')} |`)

// distinct value spreads
const spread = key => [...new Set(all.map(c => c[key]))].sort((a, b) => px(a) - px(b))
p('\n### how many distinct values each control property actually takes\n')
p('| property | distinct values | values |')
p('|---|---|---|')
for (const k of ['radius', 'fs', 'fw', 'bg']) {
  const v = spread(k)
  p(`| \`${k}\` | **${v.length}** | ${v.map(x => '`' + x + '`').join(' ')} |`)
}
const heights = [...new Set(all.map(c => Math.round(c.h)))].sort((a, b) => a - b)
p(`| computed height | **${heights.length}** | ${heights.join(', ')} |`)

p('\n### pointer-cursor TEXT SPANS (not hit targets: text inside a button)\n')
const ptAgg = new Map()
for (const c of pointerText) {
  const k = c.sel.split('.').slice(0, 3).join('.')
  if (!ptAgg.has(k)) ptAgg.set(k, { n: 0, h: c.h, screens: new Set() })
  const a = ptAgg.get(k); a.n++; a.h = Math.min(a.h, c.h); a.screens.add(c.screen)
}
p('| selector | instances | min h |')
p('|---|---|---|')
for (const [k, a] of [...ptAgg.entries()].sort((x, y) => y[1].n - x[1].n)) p(`| \`${k}\` | ${a.n} | ${a.h} |`)

writeFileSync(new URL('./out-census-c.md', import.meta.url), L.join('\n'))
console.error('pointer-cursor text spans (excluded):', pointerText.length)
console.error('controls measured:', all.length)
console.error('DISTINCT visual treatments:', byTreat.size)
console.error('treatments living inside a near-duplicate cluster:', nearDupTreatments)
console.error('hit targets under 32px:', small.length, 'instances /', smallAgg.size, 'distinct selectors')
console.error('distinct radii:', spread('radius').length, spread('radius').join(' '))
console.error('distinct heights:', heights.length)
