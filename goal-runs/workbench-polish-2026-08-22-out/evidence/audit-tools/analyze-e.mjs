// CENSUS E: the spacing scale, and how well the real UI obeys it.
//
// Padding and gap come from out-measure.json (epoch 1, the 11:04 pre-builder
// build), bucketed BY ROLE, because a card's 24px and a chip's 4px are not
// competing values, they are different jobs. N distinct numbers doing N
// different jobs is not a failure; the failure is N numbers doing ONE job.
//
// Radii are read STATICALLY from the sheets at commit 0117a78 (pre-builder),
// because the builder has since shipped a new radius scale in wbsys.css and a
// live read would no longer be a before-count.
//   node analyze-e.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
const d = JSON.parse(readFileSync(new URL('./out-measure.json', import.meta.url), 'utf8'))
const L = []; const p = s => L.push(s)

const SCALE = { 4: '--sp-1', 8: '--sp-2', 12: '--sp-3', 16: '--sp-4 / --gut', 24: '--sp-5 / --pad-card' }
const onScale = n => n === 0 || n in SCALE

// ---- role bucketing, from the selector ------------------------------------
const roleOf = sel => {
  const s = sel.toLowerCase()
  if (/\b(input|textarea|select)\b/.test(s.split('.')[0])) return 'input'
  if (/chip|pill|badge|tag|dot|kind|-st\b/.test(s)) return 'chip'
  if (/btn|-key|\bkey\b|tap|jump|navb|-x\b|sw\b|button/.test(s)) return 'button'
  if (/plate|shell|region|-work|peer|rail|insp|queue|dw-main|pane|panel|\brows\b/.test(s)) return 'pane'
  if (/card|tile|hero|mast|kpi|bubble|\bdd-card\b|cal-day|ov-(pipe|tbl|gov|rc|funnel)/.test(s)) return 'card'
  if (/sech|-h\b|head|hdr|strip|cmd|tabs|acts|-bar|foot|sec\b|nav/.test(s)) return 'section'
  if (/\brow\b|qrow|-r\b|\bitem\b|\bli\b|cell|dd-row|log-r|ov-tr|td-r/.test(s)) return 'row'
  return 'other'
}

const recs = []
for (const [screen, s] of Object.entries(d.screens)) {
  if (s.error) continue
  for (const x of s.spacing) recs.push({ ...x, screen, role: roleOf(x.sel) })
}

// ---- padding by role -------------------------------------------------------
p('### E1 · padding values actually computed, bucketed by role\n')
p('| role | elements | distinct padding values | the values (n = instances) | off-scale |')
p('|---|---|---|---|---|')
const roles = [...new Set(recs.map(r => r.role))].sort()
const offAll = new Map()
for (const role of roles) {
  const rs = recs.filter(r => r.role === role)
  const vals = new Map()
  for (const r of rs) for (const v of [r.padT, r.padR, r.padB, r.padL]) {
    if (v === 0) continue
    vals.set(v, (vals.get(v) || 0) + 1)
  }
  const sorted = [...vals.entries()].sort((a, b) => a[0] - b[0])
  const off = sorted.filter(([v]) => !onScale(v))
  off.forEach(([v, n]) => offAll.set(v, (offAll.get(v) || 0) + n))
  p(`| **${role}** | ${rs.length} | **${sorted.length}** | ${sorted.map(([v, n]) => `${v}px(${n})`).join(' ')} | ${off.length ? off.map(([v, n]) => `**${v}px**(${n})`).join(' ') : 'none'} |`)
}

// ---- gaps -------------------------------------------------------------------
p('\n### E2 · gap values\n')
const gaps = new Map()
for (const r of recs) for (const g of [r.gap, r.colGap]) { if (!g) continue; gaps.set(g, (gaps.get(g) || 0) + 1) }
const gs = [...gaps.entries()].sort((a, b) => a[0] - b[0])
p('| gap | instances | on scale? |')
p('|---|---|---|')
for (const [v, n] of gs) p(`| ${v}px | ${n} | ${onScale(v) ? 'yes (' + (SCALE[v] || '0') + ')' : '**NO**'} |`)

// ---- the single most common padding pair ------------------------------------
p('\n### E3 · the most common padding pairs\n')
const pairs = new Map()
for (const r of recs) {
  if (!r.padT && !r.padR && !r.padB && !r.padL) continue
  const k = `${r.padT} ${r.padR} ${r.padB} ${r.padL}`
  if (!pairs.has(k)) pairs.set(k, { n: 0, roles: new Map() })
  const e = pairs.get(k); e.n++; e.roles.set(r.role, (e.roles.get(r.role) || 0) + 1)
}
const padded = [...pairs.values()].reduce((a, b) => a + b.n, 0)
const top = [...pairs.entries()].sort((a, b) => b[1].n - a[1].n)
p(`Elements carrying any padding: **${padded}**. Distinct padding quadruples: **${pairs.size}**.\n`)
p('| padding (T R B L) | instances | share of padded elements | roles | on scale? |')
p('|---|---|---|---|---|')
for (const [k, e] of top.slice(0, 16)) {
  const nums = k.split(' ').map(Number).filter(Boolean)
  p(`| \`${k}\` | ${e.n} | ${(100 * e.n / padded).toFixed(1)}% | ${[...e.roles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} ${n}`).join(', ')} | ${nums.every(onScale) ? 'yes' : '**NO**'} |`)
}

// ---- section-level padding -------------------------------------------------
const sectionRoles = new Set(['pane', 'card', 'section'])
const secs = recs.filter(r => sectionRoles.has(r.role) && (r.padT || r.padR || r.padB || r.padL))
const secPairs = new Map()
for (const r of secs) { const k = `${r.padT} ${r.padR} ${r.padB} ${r.padL}`; secPairs.set(k, (secPairs.get(k) || 0) + 1) }
const secTop = [...secPairs.entries()].sort((a, b) => b[1] - a[1])
p(`\n**Most common padding on a SECTION-level element** (pane, card or section: ${secs.length} elements, ${secPairs.size} distinct quadruples):\n`)
p('| padding | instances | share of sections |')
p('|---|---|---|')
for (const [k, n] of secTop.slice(0, 8)) p(`| \`${k}\` | ${n} | **${(100 * n / secs.length).toFixed(1)}%** |`)

// ---- off-scale offenders ----------------------------------------------------
p('\n### E4 · off-scale offenders (any padding or gap not in {0,4,8,12,16,24})\n')
const offSpec = new Map()
for (const r of recs) for (const [side, v] of [['padT', r.padT], ['padR', r.padR], ['padB', r.padB], ['padL', r.padL], ['gap', r.gap], ['colGap', r.colGap]]) {
  if (!v || onScale(v)) continue
  const k = v + 'px'
  if (!offSpec.has(k)) offSpec.set(k, { n: 0, sels: new Map(), roles: new Set() })
  const e = offSpec.get(k); e.n++; e.roles.add(r.role)
  const s = r.sel.split('.').slice(0, 2).join('.'); e.sels.set(s, (e.sels.get(s) || 0) + 1)
}
const offTotal = [...offSpec.values()].reduce((a, b) => a + b.n, 0)
const allDecls = recs.reduce((a, r) => a + [r.padT, r.padR, r.padB, r.padL, r.gap, r.colGap].filter(Boolean).length, 0)
p(`Off-scale declarations: **${offTotal}** of ${allDecls} non-zero spacing values = **${(100 * offTotal / allDecls).toFixed(1)}%**. Distinct off-scale numbers: **${offSpec.size}**.\n`)
p('| value | instances | roles | worst offenders |')
p('|---|---|---|---|')
for (const [v, e] of [...offSpec.entries()].sort((a, b) => b[1].n - a[1].n))
  p(`| **${v}** | ${e.n} | ${[...e.roles].join(', ')} | ${[...e.sels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, n]) => `\`${s}\` x${n}`).join(', ')} |`)

// ---- radii, STATIC, at the pre-builder commit -------------------------------
p('\n### E5 · rendered radii, static, at commit 0117a78 (pre-builder)\n')
const V2C = 'src/exp/v2c/'
const TOK = { '--r-chip': 8, '--r-ctl': 12, '--r-card': 20, '--r-hero': 20, '--r-pill': 999, '--r-sm': 12, '--r-md': 20, '--r-lg': 20, '--plate-r': 40 }
const radii = new Map()
for (const f of ['faithful.css', 'styles.css', 'wb2026.css']) {
  let text
  try { text = execSync(`git show 0117a78:${V2C}${f}`, { cwd: '/Users/ivanmanfredi/Desktop/ivan-inbox', maxBuffer: 1 << 26 }).toString() }
  catch { continue }
  text = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /border(?:-[a-z]+)?-radius\s*:\s*([^;}]+)/g
  let m
  while ((m = re.exec(text))) {
    for (const part of m[1].trim().split(/[\s/]+/)) {
      let v = null
      const tok = part.match(/var\(\s*(--[\w-]+)/)
      if (tok) v = TOK[tok[1]] ?? null
      else if (/^\d+(\.\d+)?px$/.test(part)) v = parseFloat(part)
      else if (part === '50%' || part === '99px' || part === '999px') v = 999
      if (v == null) continue
      const k = v === 999 ? '999 (pill)' : v
      if (!radii.has(k)) radii.set(k, { n: 0, files: new Set() })
      radii.get(k).n++; radii.get(k).files.add(f)
    }
  }
}
const rSorted = [...radii.entries()].sort((a, b) => (a[0] === '999 (pill)' ? 1e9 : a[0]) - (b[0] === '999 (pill)' ? 1e9 : b[0]))
p(`Distinct rendered radii: **${radii.size}**. The phase-1 spec asks for 4.\n`)
p('| radius | declarations | sheets |')
p('|---|---|---|')
for (const [v, e] of rSorted) p(`| ${v}${typeof v === 'number' ? 'px' : ''} | ${e.n} | ${[...e.files].join(', ')} |`)

writeFileSync(new URL('./out-census-e.md', import.meta.url), L.join('\n'))
console.error('spacing records:', recs.length)
console.error('padded elements:', padded, '| distinct padding quadruples:', pairs.size)
console.error('most common quadruple:', top[0][0], top[0][1].n, `(${(100 * top[0][1].n / padded).toFixed(1)}%)`)
console.error('section elements:', secs.length, '| most common section padding:', secTop[0][0], secTop[0][1], `(${(100 * secTop[0][1] / secs.length).toFixed(1)}%)`)
console.error('off-scale:', offTotal, '/', allDecls, `= ${(100 * offTotal / allDecls).toFixed(1)}%`, '| distinct off-scale numbers:', offSpec.size)
console.error('distinct radii (pre-builder, static):', radii.size, rSorted.map(r => r[0]).join(', '))
console.error('distinct gaps:', gs.length, gs.map(g => g[0]).join(', '))
