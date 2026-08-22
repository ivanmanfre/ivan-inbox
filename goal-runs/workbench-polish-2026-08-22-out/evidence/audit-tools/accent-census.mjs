// CENSUS B: every place the lime accent is spent, in CSS and in JSX, plus the
// live per-screen count of accent-weighted elements.
// Rule under test: "lime marks the ONE primary action of a screen and the
// live/now state, nowhere else."
//   node accent-census.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'

const V2C = '/Users/ivanmanfredi/Desktop/ivan-inbox/src/exp/v2c/'
const ROOT = '/Users/ivanmanfredi/Desktop/ivan-inbox/src/'
const SHEETS = ['faithful.css', 'styles.css', 'wb2026.css']

// Anything that resolves to lime. --cat-1 and --delta-up are lime by VALUE even
// though they are not named accent, so they spend the same budget on screen.
const LIME = /--accent(?:-ui|-soft)?\b|#B8FF66|#b8ff66|184\s*,\s*255\s*,\s*102|#5A8A00|#5a8a00|90\s*,\s*138\s*,\s*0/
const LIME_ALIAS = /--cat-1\b|--delta-up\b/

const L = []
const p = s => L.push(s)

// ---- 1. CSS occurrences --------------------------------------------------
const cssRows = []
for (const f of SHEETS) {
  const lines = readFileSync(V2C + f, 'utf8').split('\n')
  let sel = '(?)'
  lines.forEach((ln, i) => {
    if (/\{/.test(ln) && !/^\s*\*/.test(ln)) {
      const head = ln.split('{')[0].trim()
      if (head) sel = head
    }
    const inComment = /^\s*(\/\*|\*|--- )/.test(ln)
    if (inComment) return
    const direct = LIME.test(ln)
    const alias = LIME_ALIAS.test(ln)
    if (!direct && !alias) return
    // what property is it painting?
    const prop = (ln.match(/(background(?:-color|-image)?|color|border[a-z-]*|box-shadow|outline[a-z-]*|fill|stroke|--[a-z0-9-]+)\s*:/g) || [])
      .map(s => s.replace(':', '').trim()).join(', ')
    if (!prop) return
    cssRows.push({ file: f, line: i + 1, sel, prop, text: ln.trim().slice(0, 110), alias: alias && !direct })
  })
}

// ---- 2. JSX / inline occurrences ------------------------------------------
const tsx = []
const walk = dir => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!/node_modules|__/.test(e.name)) walk(dir + e.name + '/'); continue }
    if (!/\.(tsx|ts)$/.test(e.name) || /\.test\./.test(e.name)) continue
    const lines = readFileSync(dir + e.name, 'utf8').split('\n')
    lines.forEach((ln, i) => {
      if (!LIME.test(ln) && !LIME_ALIAS.test(ln)) return
      if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return
      tsx.push({ file: (dir + e.name).replace(ROOT, 'src/'), line: i + 1, text: ln.trim().slice(0, 120) })
    })
  }
}
walk(V2C); walk(ROOT + 'screens/'); walk(ROOT + 'lib/')

// ---- 3. live per-screen count ---------------------------------------------
const meas = JSON.parse(readFileSync(new URL('./out-measure.json', import.meta.url), 'utf8'))
const perScreen = []
for (const [name, s] of Object.entries(meas.screens)) {
  if (s.error) { perScreen.push({ name, error: s.error }); continue }
  // "accent-weighted" = the eye reads it as accent: a lime FILL of any size, or
  // lime TEXT, or a lime border/shadow/outline. A 1px lime keyline on the rail
  // counts; the point of the census is what competes for the eye.
  const fills = s.accents.filter(a => a.hits.includes('bg-fill'))
  const tints = s.accents.filter(a => a.hits.includes('bg-tint') && !a.hits.includes('bg-fill'))
  const text = s.accents.filter(a => a.hits.includes('text') && !a.hits.includes('bg-fill'))
  const edge = s.accents.filter(a => (a.hits.includes('border') || a.hits.includes('shadow') || a.hits.includes('outline')) &&
    !a.hits.includes('bg-fill') && !a.hits.includes('text') && !a.hits.includes('bg-tint'))
  perScreen.push({
    name, total: s.accents.length,
    fills: fills.length, tints: tints.length, text: text.length, edge: edge.length,
    biggest: fills.concat(tints).sort((a, b) => b.area - a.area).slice(0, 3)
      .map(a => `\`${a.sel}\` ${a.w}x${a.h} "${a.text.slice(0, 22)}"`).join('<br>') || '-',
  })
}

// ---- output ---------------------------------------------------------------
p('| # | file:line | selector | property | what it marks | verdict |')
p('|---|---|---|---|---|---|')
cssRows.forEach((r, i) => p(`| ${i + 1} | \`${r.file}:${r.line}\` | \`${r.sel.slice(0, 54)}\` | ${r.prop} | \`${r.text.replace(/\|/g, '\\|')}\` | |`))
p('\nJSX/TS occurrences: ' + tsx.length)
tsx.forEach(r => p(`- \`${r.file}:${r.line}\` ${r.text.replace(/\|/g, '\\|')}`))
p('\n| screen | accent-weighted total | fills | tints | text | edge-only | three largest |')
p('|---|---|---|---|---|---|---|')
perScreen.forEach(s => s.error ? p(`| ${s.name} | (failed) | | | | | |`)
  : p(`| ${s.name} | **${s.total}** | ${s.fills} | ${s.tints} | ${s.text} | ${s.edge} | ${s.biggest} |`))

writeFileSync(new URL('./out-census-b.md', import.meta.url), L.join('\n'))
console.error('CSS occurrences:', cssRows.length, '(of which value-alias only:', cssRows.filter(r => r.alias).length + ')')
console.error('JSX occurrences:', tsx.length)
console.error('live total across screens:', perScreen.reduce((a, b) => a + (b.total || 0), 0))
console.error('per screen:', perScreen.map(s => `${s.name}=${s.total ?? 'x'}`).join(' '))
