// THE ONE LIVE PASS. Walks every workbench surface in a real production build
// and dumps computed style for censuses A (surfaces), B (accent), C (controls),
// D (label/value), E (spacing) into out-measure.json.
// Read-only: writes are intercepted before any navigation.
//
//   node measure.mjs           # then: node analyze-*.mjs
import { writeFileSync } from 'node:fs'
import { boot, goto, openDraft, openThread } from './_open-draft.mjs'

const PROBE = () => {
  const px = s => parseFloat(s) || 0
  const opaque = c => c && c !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)$/.test(c)
  const lum = c => {
    const m = String(c).match(/[\d.]+/g); if (!m) return null
    const [r, g, b] = m.slice(0, 3).map(Number).map(v => {
      const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    })
    return +(0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(4)
  }
  const sel = el => {
    if (!el || el === document.documentElement) return 'html'
    const t = el.tagName.toLowerCase()
    const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 4).join('.')
    return cls ? `${t}.${cls}` : t
  }
  const vis = el => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width >= 4 && r.height >= 4 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'
  }

  const root = document.querySelector('.wb')
  if (!root) return { error: 'no .wb' }
  const all = [...root.querySelectorAll('*')].filter(vis)

  // ---- token resolution in this theme -----------------------------------
  const rs = getComputedStyle(root)
  const TOKENS = ['--canvas', '--surface1', '--surface2', '--surface3', '--hairline', '--hairline-strong',
    '--text', '--text2', '--text3', '--text4', '--ground', '--accent', '--accent-ui', '--accent-soft',
    '--ink', '--sev-clear', '--sev-attention', '--sev-urgent', '--bg', '--surface', '--sep', '--blue',
    '--delta-up', '--delta-down', '--cat-1', '--cat-2', '--cat-3', '--cat-4',
    '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--gut', '--pad-card',
    '--r-chip', '--r-ctl', '--r-card', '--r-hero', '--r-pill', '--r-sm', '--r-md', '--r-lg',
    '--fs-display', '--fs-figure', '--fs-page', '--fs-title', '--fs-body', '--fs-meta', '--fs-eyebrow', '--fs-glyph']
  const tokens = {}
  for (const t of TOKENS) { const v = rs.getPropertyValue(t).trim(); if (v) tokens[t] = { value: v, lum: /^#|rgb/.test(v) ? lum(v.startsWith('#') ? hexToRgb(v) : v) : null } }
  function hexToRgb(h) {
    h = h.replace('#', '')
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`
  }

  // ---- A · surface pairs -------------------------------------------------
  const paint = new Map()
  for (const el of all) { const c = getComputedStyle(el).backgroundColor; if (opaque(c)) paint.set(el, c) }
  const nearestPainted = el => { let p = el.parentElement; while (p) { if (paint.has(p)) return p; p = p.parentElement } return null }
  const INTENT = /\b(chip|card|tile|cell|row|panel|pane|box|item|btn|badge|pill|bubble|sec|insp|well|field|tab|key|swap|qrow|day|mast|kpi|tk|stat|strip|acts|sched|queue|main|rail|head)/i
  const pairs = []
  for (const el of all) {
    const cls = typeof el.className === 'string' ? el.className : ''
    if (!INTENT.test(cls)) continue
    const anc = nearestPainted(el); if (!anc) continue
    const cs = getComputedStyle(el), r = el.getBoundingClientRect()
    const own = cs.backgroundColor, ancC = paint.get(anc)
    const isSame = opaque(own) && own === ancC
    const isNone = !opaque(own)
    if (!isSame && !isNone) continue
    // is this element TRYING to be a box? (border, radius, or its own padding)
    const bw = Math.max(px(cs.borderTopWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth), px(cs.borderRightWidth))
    const rad = Math.max(...cs.borderRadius.split(/\s+/).map(px))
    const padMax = Math.max(px(cs.paddingTop), px(cs.paddingBottom), px(cs.paddingLeft), px(cs.paddingRight))
    pairs.push({
      kind: isSame ? 'SAME' : 'NOPAINT',
      child: sel(el), parent: sel(anc),
      color: isSame ? own : ancC, lum: lum(isSame ? own : ancC),
      borderW: bw, radius: rad, pad: padMax,
      // per SIDE. Math.max of four widths plus borderTopColor reports a white
      // top border on a chip whose only border is a 3px LEFT rail.
      borders: ['Top', 'Right', 'Bottom', 'Left']
        .map(k => px(cs['border' + k + 'Width']) > 0
          ? `${k.toLowerCase()} ${cs['border' + k + 'Width']} ${cs['border' + k + 'Style']} ${cs['border' + k + 'Color']}` : null)
        .filter(Boolean),
      parentShadow: anc ? (getComputedStyle(anc).boxShadow === 'none' ? null : getComputedStyle(anc).boxShadow) : null,
      shadow: cs.boxShadow === 'none' ? null : cs.boxShadow,
      isBox: bw > 0 || rad > 0 || padMax > 0,
      w: Math.round(r.width), h: Math.round(r.height),
    })
  }
  const surfHist = {}
  for (const [el, c] of paint) { if (vis(el)) surfHist[c] = (surfHist[c] || 0) + 1 }

  // ---- B · accent occurrences -------------------------------------------
  const ACC = ['rgb(184, 255, 102)', 'rgb(90, 138, 0)']
  const accHit = c => ACC.some(a => String(c).includes(a.slice(4, -1)))
  const accents = []
  for (const el of all) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect()
    const hits = []
    if (accHit(cs.backgroundColor)) hits.push('bg-fill')
    if (/184,\s*255,\s*102/.test(cs.backgroundColor) && !accHit(cs.backgroundColor)) hits.push('bg-tint')
    if (/184,\s*255,\s*102|90,\s*138,\s*0/.test(cs.backgroundImage)) hits.push('bg-image')
    if (accHit(cs.color)) hits.push('text')
    if (/184,\s*255,\s*102|90,\s*138,\s*0/.test(cs.borderTopColor + cs.borderLeftColor + cs.borderBottomColor + cs.borderRightColor)) hits.push('border')
    if (/184,\s*255,\s*102|90,\s*138,\s*0/.test(cs.boxShadow)) hits.push('shadow')
    if (/184,\s*255,\s*102|90,\s*138,\s*0/.test(cs.outlineColor) && cs.outlineStyle !== 'none') hits.push('outline')
    if (/184,\s*255,\s*102/.test(cs.backgroundColor)) { if (!hits.includes('bg-fill')) hits.push('bg-tint') }
    if (!hits.length) continue
    accents.push({
      sel: sel(el), hits, text: (el.textContent || '').trim().slice(0, 40),
      bg: cs.backgroundColor, color: cs.color, w: Math.round(r.width), h: Math.round(r.height),
      area: Math.round(r.width * r.height),
    })
  }

  // ---- C · controls -------------------------------------------------------
  const controls = []
  for (const el of all) {
    const t = el.tagName.toLowerCase()
    const cs = getComputedStyle(el)
    const role = el.getAttribute('role')
    const isCtl = t === 'button' || (t === 'a' && el.hasAttribute('href')) || role === 'button' ||
      t === 'input' || t === 'textarea' || t === 'select' ||
      (cs.cursor === 'pointer' && /chip|pill|key|tab|btn|tap|jump|act|swap|more/i.test(typeof el.className === 'string' ? el.className : ''))
    if (!isCtl) continue
    const r = el.getBoundingClientRect()
    controls.push({
      tag: t, sel: sel(el), text: (el.textContent || '').trim().slice(0, 30),
      h: +r.height.toFixed(1), w: +r.width.toFixed(1),
      minH: cs.minHeight, padT: cs.paddingTop, padR: cs.paddingRight, padB: cs.paddingBottom, padL: cs.paddingLeft,
      radius: cs.borderRadius, fs: cs.fontSize, fw: cs.fontWeight, ls: cs.letterSpacing, tt: cs.textTransform,
      bg: cs.backgroundColor, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
      color: cs.color, disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    })
  }

  // ---- D · label/value rows ----------------------------------------------
  // An ALL-CAPS label: uppercase by text-transform OR literally uppercase text,
  // small size, tracked. Record it plus whatever value sits beside/below it.
  const labels = []
  for (const el of all) {
    const cs = getComputedStyle(el)
    const txt = (el.textContent || '').trim()
    if (!txt || txt.length > 44) continue
    if (el.children.length > 1) continue
    const upper = cs.textTransform === 'uppercase' || (/^[A-Z0-9 ·:%()\/+.,'"-]+$/.test(txt) && /[A-Z]{2}/.test(txt))
    if (!upper) continue
    if (px(cs.fontSize) > 15) continue
    const r = el.getBoundingClientRect()
    const parent = el.parentElement
    const pcs = parent ? getComputedStyle(parent) : null
    const pr = parent ? parent.getBoundingClientRect() : null
    // the sibling that carries the value
    const sib = el.nextElementSibling || (parent && parent.nextElementSibling)
    labels.push({
      sel: sel(el), text: txt, fs: cs.fontSize, fw: cs.fontWeight, ls: cs.letterSpacing,
      color: cs.color, tt: cs.textTransform, lh: cs.lineHeight,
      parentSel: parent ? sel(parent) : null,
      parentDisplay: pcs ? pcs.display : null, parentGap: pcs ? pcs.gap : null,
      parentFlexDir: pcs ? pcs.flexDirection : null,
      parentPad: pcs ? `${pcs.paddingTop} ${pcs.paddingRight} ${pcs.paddingBottom} ${pcs.paddingLeft}` : null,
      rowH: pr ? +pr.height.toFixed(1) : null,
      valueSel: sib ? sel(sib) : null, valueText: sib ? (sib.textContent || '').trim().slice(0, 30) : null,
      valueFs: sib ? getComputedStyle(sib).fontSize : null,
    })
  }

  // ---- E · spacing --------------------------------------------------------
  const spacing = []
  for (const el of all) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect()
    const p = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px)
    const g = cs.gap === 'normal' ? 0 : px(cs.rowGap || cs.gap)
    const cg = cs.columnGap === 'normal' ? 0 : px(cs.columnGap)
    if (!p.some(Boolean) && !g && !cg) continue
    // role bucket by class, so a card's padding is never compared to a chip's
    const cls = typeof el.className === 'string' ? el.className : ''
    let role = 'other'
    if (/\b(chip|pill|badge|tag)/i.test(cls)) role = 'chip'
    else if (/\b(dw-key|btn|-key|tap|jump)/i.test(cls) || el.tagName === 'BUTTON') role = 'button'
    else if (/\b(card|tile|hero|mast|kpi|box|bubble)/i.test(cls)) role = 'card'
    else if (/\b(\.?r|row|qrow|day|cell|item)\b/i.test(cls) || /\brow\b/.test(cls)) role = 'row'
    else if (/\b(pane|panel|region|work|peer|insp|queue|main|shell|plate|rows)/i.test(cls)) role = 'pane'
    else if (/\b(sec|sech|head|hdr|strip|cmd|tabs|acts|bar)/i.test(cls)) role = 'section'
    else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') role = 'input'
    spacing.push({ sel: sel(el), role, padT: p[0], padR: p[1], padB: p[2], padL: p[3], gap: g, colGap: cg, w: Math.round(r.width), h: Math.round(r.height) })
  }

  return { tokens, pairs, surfHist, accents, controls, labels, spacing, elementCount: all.length }
}

// --------------------------------------------------------------------------
const { browser, page } = await boot()
const out = { theme: {}, screens: {} }

const SCREENS = [
  ['today', p => goto(p, '#exp/v2/today', 3000)],
  ['dms-list', p => goto(p, '#exp/v2/dms', 3500)],
  ['content-list', async p => { await goto(p, '#exp/v2/content', 3000); try { await p.getByText('List', { exact: true }).first().click({ timeout: 3500 }); await p.waitForTimeout(1800) } catch {} }],
  ['content-calendar', async p => { await goto(p, '#exp/v2/content', 3000); try { await p.getByText('Calendar', { exact: true }).first().click({ timeout: 3500 }); await p.waitForTimeout(2200) } catch {} }],
  ['ops', p => goto(p, '#exp/v2/ops', 3000)],
  ['sends', p => goto(p, '#exp/v2/sends', 3000)],
  ['strategy', p => goto(p, '#exp/v2/strategy', 3000)],
  ['settings', p => goto(p, '#exp/v2/settings', 2500)],
  // thread-open BEFORE draft-open: an open content peer survives the hash
  // change and eats the first click on the DMs list.
  ['thread-open', async p => { for (let i = 0; i < 3; i++) { if (await openThread(p)) return } throw new Error('thread did not open') }],
  ['draft-open', async p => { for (let i = 0; i < 3; i++) { if (await openDraft(p)) return } throw new Error('draft did not open') }],
]

for (const [name, nav] of SCREENS) {
  try {
    await nav(page)
    const d = await page.evaluate(PROBE)
    out.screens[name] = d
    if (!Object.keys(out.theme).length) out.theme = d.tokens
    console.error(`${name}: ${d.elementCount} elems · ${d.pairs.length} pairs · ${d.accents.length} accent · ${d.controls.length} ctl · ${d.labels.length} labels`)
  } catch (e) { console.error(`${name}: FAILED ${e.message}`); out.screens[name] = { error: e.message } }
}

// light theme snapshot of the tokens only
try {
  await goto(page, '#exp/v2/today', 2500)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await page.waitForTimeout(900)
  out.themeLight = (await page.evaluate(PROBE)).tokens
} catch (e) { console.error('light theme failed:', e.message) }

writeFileSync(new URL('./out-measure.json', import.meta.url), JSON.stringify(out))
await browser.close()
console.log('wrote out-measure.json')
