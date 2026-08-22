// SYSTEM PROOF — computed-style evidence for every primitive shipped in
// src/exp/v2c/wbsys.css (phase 1, workbench-polish-2026-08-22).
//
// Nothing here is asserted from the stylesheet. Every value is read back out of
// a real browser with getComputedStyle, inside the real .wb cascade, in BOTH
// themes, so the three-.wb flattener trap (faithful.css:181) cannot hide a
// primitive that silently rendered at body size.
//
// Read-only: the write interceptor (verbatim from
// goal-runs/workbench-2026-plan-2026-08-21/tools/chip-probe.mjs:13-19) fulfils
// every PATCH/PUT/DELETE and non-rpc POST with 200 [] so nothing reaches the DB.
//
//   node system-proof.mjs [baseUrl]
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync, writeFileSync } from 'node:fs'

const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = process.argv[2] || 'http://localhost:4173/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const page = await ctx.newPage()
await page.route('**/rest/v1/**', async r => {
  const q = r.request(), m = q.method()
  if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  }
  return r.continue()
})

// --------------------------------------------------------------------------
// The probe: a real subtree mounted inside the real .wb plate, so every rule in
// styles.css / faithful.css / wb2026.css / wbsys.css applies exactly as it does
// to shipped markup. Removed again before the script exits.
const PROBE = `
<div id="wbsys-probe" style="position:fixed;left:0;top:0;width:900px;z-index:99999">
  <button class="wbb wbb-primary">Approve draft</button>
  <button class="wbb wbb-secondary">Edit</button>
  <button class="wbb wbb-quiet">Back to idea</button>
  <button class="wbb wbb-danger">Delete draft</button>
  <button class="wbb wbb-secondary wbb-sm">Small</button>
  <button class="wbb wbb-secondary wbb-lg">Large</button>
  <button class="wbb wbb-primary" disabled>Disabled</button>
  <div class="wbkv">
    <div class="wbkv-k">Scheduled for</div><div class="wbkv-v">12 Aug, 09:00</div>
    <div class="wbkv-k">Source</div><div class="wbkv-v">Call report</div>
  </div>
  <div class="wbsys-e0"></div><div class="wbsys-e1"></div><div class="wbsys-e2"></div>
  <div class="wbsys-e3"></div><div class="wbsys-e4"></div>
  <div class="wbs-overlay wbs-probe-overlay" data-wbs-in="1">overlay</div>
</div>`

const READ = () => {
  const cs = (sel, ...props) => {
    const el = document.querySelector(sel)
    if (!el) return { MISSING: sel }
    const s = getComputedStyle(el)
    const o = {}
    for (const p of props) o[p] = s.getPropertyValue(p).trim()
    return o
  }
  const tok = n => getComputedStyle(document.querySelector('.wb')).getPropertyValue(n).trim()
  const rgb = c => {
    const d = document.createElement('div')
    d.style.color = c; document.body.appendChild(d)
    const v = getComputedStyle(d).color; d.remove(); return v
  }
  const lum = c => {
    const m = String(c).match(/[\d.]+/g)
    if (!m) return null
    const [r, g, b] = m.slice(0, 3).map(Number).map(v => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    })
    return +(0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(4)
  }
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return +((x + 0.05) / (y + 0.05)).toFixed(2)
  }

  // ---- 1. ladder ---------------------------------------------------------
  const ladder = {}
  for (const n of ['--e0', '--e1', '--e2', '--e3', '--e4']) {
    const v = rgb(tok(n)); ladder[n] = { value: v, L: lum(v) }
  }
  const aliases = {}
  for (const n of ['--canvas', '--surface1', '--surface2', '--surface3', '--hairline', '--hairline-strong']) {
    const v = rgb(tok(n)); aliases[n] = { value: v, L: lum(v) }
  }
  // Painted proof: five real divs, so the token is not merely declared.
  const painted = {}
  for (const k of ['e0', 'e1', 'e2', 'e3', 'e4']) {
    const c = cs('.wbsys-' + k, 'background-color').backgroundColor ||
      getComputedStyle(document.querySelector('.wbsys-' + k)).backgroundColor
    painted[k] = { value: c, L: lum(c) }
  }
  const steps = []
  const order = ['e0', 'e1', 'e2', 'e3', 'e4']
  for (let i = 1; i < order.length; i++) {
    steps.push({
      pair: order[i - 1] + '->' + order[i],
      ratio: ratio(painted[order[i - 1]].value, painted[order[i]].value),
      dL: +(painted[order[i]].L - painted[order[i - 1]].L).toFixed(4),
    })
  }
  // inversion check: the two relationships that ship today and must not flip
  const inversion = {
    'canvas_vs_surface1 (ground vs card)': Math.sign(aliases['--surface1'].L - aliases['--canvas'].L),
    'surface1_vs_surface2 (card vs raised tint)': Math.sign(aliases['--surface2'].L - aliases['--surface1'].L),
    'surface2_vs_surface3 (raised tint vs edge)': Math.sign(aliases['--surface3'].L - aliases['--surface2'].L),
  }

  // ---- 2. radius ---------------------------------------------------------
  const radii = {}
  for (const n of ['--r-xs', '--r-ctl', '--r-card', '--r-pill', '--r-chip', '--r-hero',
    '--r-sm', '--r-md', '--r-lg', '--plate-r']) radii[n] = tok(n)

  // ---- 3. controls -------------------------------------------------------
  const P = ['height', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
    'border-radius', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
    'background-color', 'color', 'border-top-width', 'border-top-style',
    'box-shadow', 'transition-property', 'transition-duration', 'gap',
    'min-height', 'display', 'cursor', 'opacity']
  const ctl = {
    'wbb-primary': cs('.wbb.wbb-primary:not([disabled])', ...P),
    'wbb-secondary': cs('.wbb.wbb-secondary:not(.wbb-sm):not(.wbb-lg)', ...P),
    'wbb-quiet': cs('.wbb.wbb-quiet', ...P),
    'wbb-danger': cs('.wbb.wbb-danger', ...P),
    'wbb-sm': cs('.wbb.wbb-sm', ...P),
    'wbb-lg': cs('.wbb.wbb-lg', ...P),
    'wbb-disabled': cs('.wbb[disabled]', ...P),
  }
  const box = sel => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  }
  const ctlBox = {
    primary: box('.wbb.wbb-primary:not([disabled])'),
    secondary: box('.wbb.wbb-secondary:not(.wbb-sm):not(.wbb-lg)'),
    quiet: box('.wbb.wbb-quiet'),
    danger: box('.wbb.wbb-danger'),
    sm: box('.wbb.wbb-sm'), lg: box('.wbb.wbb-lg'),
  }

  // ---- 4. metadata -------------------------------------------------------
  const kv = {
    wbkv: cs('.wbkv', 'display', 'grid-template-columns', 'column-gap', 'row-gap', 'align-items'),
    'wbkv-k': cs('.wbkv-k', 'font-size', 'font-weight', 'color', 'text-transform', 'letter-spacing',
      'border-top-width', 'background-color', 'line-height'),
    'wbkv-v': cs('.wbkv-v', 'font-size', 'font-weight', 'color', 'font-variant-numeric',
      'border-top-width', 'background-color', 'line-height'),
  }

  // ---- 5. motion ---------------------------------------------------------
  const motion = {
    'wbb transition': cs('.wbb.wbb-secondary:not(.wbb-sm):not(.wbb-lg)',
      'transition-property', 'transition-duration', 'transition-timing-function'),
    'tokens': {
      '--wbs-dur-ctl': tok('--wbs-dur-ctl'),
      '--wbs-dur-overlay': tok('--wbs-dur-overlay'),
      '--wbs-dur-commit': tok('--wbs-dur-commit'),
      '--wbs-ease-ctl': tok('--wbs-ease-ctl'),
      '--wbs-ease-overlay': tok('--wbs-ease-overlay').slice(0, 40) + '...',
    },
    'spring': {
      'linear() supported': CSS.supports('transition-timing-function', 'linear(0, 1)'),
      'resolved --spring starts with': tok('--spring').trim().slice(0, 24),
      'overlay computed': cs('.wbs-probe-overlay',
        'transition-property', 'transition-duration', 'transition-timing-function', 'box-shadow'),
    },
    'shadows': {
      '--sh-card': tok('--sh-card'),
      '--sh-drag': tok('--sh-drag'),
      '--sh-over': tok('--sh-over'),
      '--e4-shadow': tok('--e4-shadow'),
      'plate': cs('.wb-plate', 'box-shadow'),
    },
  }

  // ---- 6. contrast: every text/background pair the system creates ---------
  const text1 = rgb(tok('--text')), text2 = rgb(tok('--text2')), text3 = rgb(tok('--text3'))
  const contrast = [
    ['--text on --e1', text1, painted.e1.value, ratio(text1, painted.e1.value), 4.5],
    ['--text on --e2', text1, painted.e2.value, ratio(text1, painted.e2.value), 4.5],
    ['--text on --e3', text1, painted.e3.value, ratio(text1, painted.e3.value), 4.5],
    ['--text on --e4', text1, painted.e4.value, ratio(text1, painted.e4.value), 4.5],
    ['--text2 on --e2', text2, painted.e2.value, ratio(text2, painted.e2.value), 4.5],
    ['--text2 on --e3', text2, painted.e3.value, ratio(text2, painted.e3.value), 4.5],
    ['--text3 on --e1', text3, painted.e1.value, ratio(text3, painted.e1.value), 4.5],
    ['--text3 on --e2', text3, painted.e2.value, ratio(text3, painted.e2.value), 4.5],
    ['--text3 on --e3', text3, painted.e3.value, ratio(text3, painted.e3.value), 4.5],
  ]
  const cbg = s => getComputedStyle(document.querySelector(s)).backgroundColor
  const cfg = s => getComputedStyle(document.querySelector(s)).color
  for (const [label, sel, min] of [
    ['.wbb-primary label on fill', '.wbb.wbb-primary:not([disabled])', 4.5],
    ['.wbb-secondary label on fill', '.wbb.wbb-secondary:not(.wbb-sm):not(.wbb-lg)', 4.5],
    ['.wbb-quiet label on --e2', '.wbb.wbb-quiet', 4.5],
    ['.wbb-danger label on --e2', '.wbb.wbb-danger', 4.5],
    ['.wbkv-k on --e2', '.wbkv-k', 4.5],
    ['.wbkv-v on --e2', '.wbkv-v', 4.5],
  ]) {
    let bg = cbg(sel)
    if (!bg || /rgba\([^)]*,\s*0\s*\)$/.test(bg)) bg = painted.e2.value
    contrast.push([label, cfg(sel), bg, ratio(cfg(sel), bg), min])
  }
  return { ladder, aliases, painted, steps, inversion, radii, ctl, ctlBox, kv, motion, contrast }
}

// --------------------------------------------------------------------------
const run = async theme => {
  await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.evaluate(t => {
    if (t === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else document.documentElement.setAttribute('data-theme', 'dark')
    const st = document.createElement('style')
    st.id = 'wbsys-probe-style'
    st.textContent = `#wbsys-probe{background:var(--e2);padding:12px;display:block}
      .wbsys-e0{background:var(--e0);width:40px;height:12px}
      .wbsys-e1{background:var(--e1);width:40px;height:12px}
      .wbsys-e2{background:var(--e2);width:40px;height:12px}
      .wbsys-e3{background:var(--e3);width:40px;height:12px}
      .wbsys-e4{background:var(--e4);width:40px;height:12px}`
    document.head.appendChild(st)
  }, theme)
  await page.evaluate(html => {
    const host = document.querySelector('.wb-plate') || document.querySelector('.wb')
    const d = document.createElement('div'); d.innerHTML = html
    host.appendChild(d.firstElementChild)
  }, PROBE)
  await page.waitForTimeout(400)
  const out = await page.evaluate(READ)
  await page.evaluate(() => {
    document.getElementById('wbsys-probe')?.remove()
    document.getElementById('wbsys-probe-style')?.remove()
  })
  return out
}

const out = { dark: await run('dark'), light: await run('light') }

// reduced motion, dark only: the collapse has to be provable
const ctxRM = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
await ctxRM.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const pRM = await ctxRM.newPage()
await pRM.route('**/rest/v1/**', async r => {
  const q = r.request(), m = q.method()
  if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  }
  return r.continue()
})
await pRM.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle' })
await pRM.waitForTimeout(1500)
await pRM.evaluate(html => {
  const host = document.querySelector('.wb-plate') || document.querySelector('.wb')
  const d = document.createElement('div'); d.innerHTML = html
  host.appendChild(d.firstElementChild)
}, PROBE)
await pRM.waitForTimeout(300)
out.reducedMotion = await pRM.evaluate(() => {
  const s = getComputedStyle(document.querySelector('.wbb.wbb-secondary'))
  return {
    'transition-duration': s.transitionDuration,
    'animation-duration': s.animationDuration,
    matchesReduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
})

// live radius census across six surfaces: every distinct non-zero computed
// border-radius actually painted, with an example selector per value.
const CENSUS = () => {
  const sel = el => {
    const t = el.tagName.toLowerCase()
    const c = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 3).join('.')
    return c ? `${t}.${c}` : t
  }
  const hist = {}
  for (const el of document.querySelectorAll('.wb *')) {
    const r = el.getBoundingClientRect()
    if (r.width < 6 || r.height < 6) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const v = cs.borderTopLeftRadius
    if (!v || v === '0px') continue
    hist[v] = hist[v] || { n: 0, eg: [] }
    hist[v].n++
    if (hist[v].eg.length < 3 && !hist[v].eg.includes(sel(el))) hist[v].eg.push(sel(el))
  }
  return hist
}
const radiusCensus = {}
for (const [name, hash, click] of [
  ['content-list', '#exp/v2/content', null],
  ['content-calendar', '#exp/v2/content', 'Calendar'],
  ['dms-list', '#exp/v2/dms', null],
  ['ops', '#exp/v2/ops', null],
  ['today', '#exp/v2/today', null],
  ['settings', '#exp/v2/settings', null],
]) {
  await page.goto(BASE + hash, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1600)
  if (click) { try { await page.getByText(click, { exact: true }).first().click({ timeout: 5000 }); await page.waitForTimeout(1600) } catch { } }
  const h = await page.evaluate(CENSUS)
  for (const [v, d] of Object.entries(h)) {
    radiusCensus[v] = radiusCensus[v] || { n: 0, eg: [] }
    radiusCensus[v].n += d.n
    for (const e of d.eg) if (radiusCensus[v].eg.length < 4 && !radiusCensus[v].eg.includes(e)) radiusCensus[v].eg.push(e)
  }
}
out.radiusCensus = radiusCensus

// real-UI spot checks, dark: the four named collisions, measured on shipped markup
await page.goto(BASE + '#exp/v2/content', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
try { await page.getByText('Calendar', { exact: true }).first().click({ timeout: 5000 }) } catch { }
await page.waitForTimeout(2000)
out.liveCalendar = await page.evaluate(() => {
  const g = (s, ...p) => {
    const el = document.querySelector(s); if (!el) return { MISSING: s }
    const cs = getComputedStyle(el), o = {}
    for (const k of p) o[k] = cs.getPropertyValue(k).trim()
    return o
  }
  return {
    'div.cal-day': g('.cal-day:not(.cal-day-empty)', 'background-color', 'border-radius', 'box-shadow'),
    'div.cal-day-empty': g('.cal-day-empty', 'background-color', 'border-radius', 'box-shadow'),
    'div.cal-chip': g('.cal-chip', 'background-color', 'border-radius', 'box-shadow', 'border-left-width'),
    'button.cal-chip-t': g('.cal-chip-t', 'border-top-width', 'border-top-style'),
    'div.wb-sech': g('.wb-sech', 'background-color', 'border-top-width', 'border-bottom-width'),
  }
})

await browser.close()
writeFileSync(new URL('./out-system-proof.json', import.meta.url), JSON.stringify(out, null, 1))

// ------------------------------- report -----------------------------------
const L = []
const p = s => { L.push(s); console.log(s) }
for (const theme of ['dark', 'light']) {
  const d = out[theme]
  p(`\n===== ${theme.toUpperCase()} =====`)
  p('LADDER (painted, computed):')
  for (const k of ['e0', 'e1', 'e2', 'e3', 'e4']) p(`  --${k}  ${d.painted[k].value.padEnd(20)} L ${d.painted[k].L}`)
  p('STEPS: ' + d.steps.map(s => `${s.pair} ${s.ratio}:1 (dL ${s.dL})`).join('  |  '))
  p('ALIASES: ' + Object.entries(d.aliases).map(([k, v]) => `${k}=${v.value}`).join('  '))
  p('INVERSION SIGNS (must match across themes where the relationship is intended):')
  for (const [k, v] of Object.entries(d.inversion)) p(`  ${k}: ${v > 0 ? 'child LIGHTER' : v < 0 ? 'child DARKER' : 'EQUAL'}`)
  p('RADII: ' + Object.entries(d.radii).map(([k, v]) => `${k}=${v}`).join('  '))
  p('CONTROLS:')
  for (const [k, v] of Object.entries(d.ctl)) {
    p(`  .${k}  h=${d.ctlBox[k.replace('wbb-', '')]?.h ?? v.height}  pad=${v['padding-top']}/${v['padding-right']}  r=${v['border-radius']}  fs=${v['font-size']}/${v['line-height']}  fw=${v['font-weight']}  bg=${v['background-color']}  fg=${v.color}  shadow=${v['box-shadow']}`)
  }
  p('KV: ' + JSON.stringify(d.kv))
  p('MOTION: ' + JSON.stringify(d.motion))
  p('CONTRAST:')
  let worst = 99
  for (const [label, fg, bg, r, min] of d.contrast) {
    const ok = r >= min ? 'PASS' : 'FAIL'
    if (r < worst) worst = r
    p(`  ${ok}  ${r.toFixed(2)}:1 (min ${min})  ${label}  fg=${fg} bg=${bg}`)
  }
  p(`  WORST CASE ${theme}: ${worst.toFixed(2)}:1`)
}
p('\nLIVE RADIUS CENSUS (6 surfaces, distinct computed values):')
for (const [v, d] of Object.entries(out.radiusCensus).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
  p(`  ${v.padEnd(8)} x${String(d.n).padEnd(5)} ${d.eg.join(', ')}`)
}
p('\nREDUCED MOTION: ' + JSON.stringify(out.reducedMotion))
p('\nLIVE CALENDAR (dark): ' + JSON.stringify(out.liveCalendar, null, 1))
writeFileSync(new URL('./out-system-proof.txt', import.meta.url), L.join('\n'))
