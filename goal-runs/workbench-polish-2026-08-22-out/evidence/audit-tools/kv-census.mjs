// CENSUS D (structural half): find the "label + value" metadata ROW wherever it
// occurs, by SHAPE rather than by class name, so implementations that were
// hand-rolled instead of reusing `.dd-row` are still caught.
//
// The shape: an element whose two element children are a short quiet label and
// a louder value. That is the same idea whatever the classes are called.
//   node kv-census.mjs
import { writeFileSync } from 'node:fs'
import { boot, goto, openDraft, openThread } from './_open-draft.mjs'

const PROBE = () => {
  const px = s => parseFloat(s) || 0
  const sel = el => {
    const t = el.tagName.toLowerCase()
    const c = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 3).join('.')
    return c ? `${t}.${c}` : t
  }
  const vis = el => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    return r.width >= 4 && r.height >= 4 && cs.visibility !== 'hidden' && cs.display !== 'none'
  }
  const root = document.querySelector('.wb')
  if (!root) return { rows: [] }
  const rows = []
  for (const el of [...root.querySelectorAll('*')].filter(vis)) {
    const kids = [...el.children].filter(vis)
    if (kids.length !== 2) continue
    const [k, v] = kids
    if (k.tagName === 'BUTTON' || v.tagName === 'BUTTON' || el.tagName === 'BUTTON') continue
    const kt = (k.textContent || '').trim(), vt = (v.textContent || '').trim()
    if (!kt || !vt) continue
    if (kt.length > 34) continue                     // a label, not a paragraph
    const kc = getComputedStyle(k), vc = getComputedStyle(v), ec = getComputedStyle(el)
    const kSize = px(kc.fontSize), vSize = px(vc.fontSize)
    // the label must be QUIETER than the value: smaller, or dimmer, or capsed
    const capsed = kc.textTransform === 'uppercase' || (/^[A-Z0-9 ·:%()\/+.,'"-]+$/.test(kt) && /[A-Z]{2}/.test(kt))
    const quieter = kSize < vSize || kc.color !== vc.color || px(kc.letterSpacing) > 0
    if (!capsed && !quieter) continue
    if (k.children.length > 2) continue
    const r = el.getBoundingClientRect()
    rows.push({
      row: sel(el), k: sel(k), v: sel(v), kText: kt.slice(0, 26), vText: vt.slice(0, 26),
      kFs: kc.fontSize, kFw: kc.fontWeight, kLs: kc.letterSpacing, kColor: kc.color, kTt: kc.textTransform,
      vFs: vc.fontSize, vFw: vc.fontWeight, vColor: vc.color,
      display: ec.display, dir: ec.flexDirection, gap: ec.gap, align: ec.alignItems,
      pad: `${px(ec.paddingTop)} ${px(ec.paddingRight)} ${px(ec.paddingBottom)} ${px(ec.paddingLeft)}`,
      border: px(ec.borderBottomWidth) > 0 ? `bottom ${ec.borderBottomWidth} ${ec.borderBottomColor}` :
              (px(ec.borderTopWidth) > 0 ? `top ${ec.borderTopWidth}` : 'none'),
      bg: ec.backgroundColor, radius: ec.borderRadius,
      h: +r.height.toFixed(1), w: Math.round(r.width),
      capsed,
    })
  }
  return { rows }
}

const { browser, page } = await boot()
const out = {}
const SCREENS = [
  ['today', p => goto(p, '#exp/v2/today', 3000)],
  ['dms-list', p => goto(p, '#exp/v2/dms', 3500)],
  ['content-list', async p => { await goto(p, '#exp/v2/content', 3000) }],
  ['content-calendar', async p => { await goto(p, '#exp/v2/content', 3000); try { await p.getByText('Calendar', { exact: true }).first().click({ timeout: 3500 }); await p.waitForTimeout(2200) } catch {} }],
  ['ops', p => goto(p, '#exp/v2/ops', 3000)],
  ['sends', p => goto(p, '#exp/v2/sends', 3000)],
  ['strategy', p => goto(p, '#exp/v2/strategy', 3000)],
  ['settings', p => goto(p, '#exp/v2/settings', 2500)],
  ['thread-open', async p => { for (let i = 0; i < 3; i++) if (await openThread(p)) return; throw new Error('no thread') }],
  ['draft-open', async p => { for (let i = 0; i < 3; i++) if (await openDraft(p)) return; throw new Error('no draft') }],
]
for (const [name, nav] of SCREENS) {
  try { await nav(page); out[name] = (await page.evaluate(PROBE)).rows; console.error(`${name}: ${out[name].length} kv rows`) }
  catch (e) { console.error(`${name}: FAILED ${e.message}`); out[name] = [] }
}
// the draft inspector's four tabs, opened one at a time
try {
  if (await openDraft(page)) {
    for (const tab of ['QA', 'Source', 'Log', 'Fields']) {
      try {
        await page.locator('.dw-jump', { hasText: new RegExp('^' + tab + '$', 'i') }).first().click({ timeout: 3500 })
        await page.waitForTimeout(1400)
        out['draft-insp-' + tab] = (await page.evaluate(PROBE)).rows
        console.error(`draft-insp-${tab}: ${out['draft-insp-' + tab].length} kv rows`)
      } catch (e) { console.error(`  tab ${tab}: ${e.message.slice(0, 50)}`) }
    }
  }
} catch (e) { console.error('inspector tabs failed:', e.message) }

writeFileSync(new URL('./out-kv.json', import.meta.url), JSON.stringify(out, null, 1))
await browser.close()

// ---- summarise -----------------------------------------------------------
const all = []
for (const [screen, rows] of Object.entries(out)) rows.forEach(r => all.push({ ...r, screen }))
// an IMPLEMENTATION = the row class + the k class + the layout it uses
const impl = new Map()
for (const r of all) {
  const k = `${r.row}|${r.k}|${r.display}${r.dir === 'column' ? '/col' : ''}`
  if (!impl.has(k)) impl.set(k, { ...r, n: 0, screens: new Set() })
  impl.get(k).n++; impl.get(k).screens.add(r.screen)
}
console.log('\nTOTAL label/value row instances:', all.length)
console.log('DISTINCT implementations:', impl.size)
console.log('of which ALL-CAPS labels:', [...impl.values()].filter(i => i.capsed).length)
const hs = all.map(r => r.h).sort((a, b) => a - b)
console.log('row height: min', hs[0], 'median', hs[Math.floor(hs.length / 2)], 'max', hs[hs.length - 1])
console.log('distinct row heights:', new Set(all.map(r => Math.round(r.h))).size)
console.log('\ntop implementations:')
;[...impl.values()].sort((a, b) => b.n - a.n).slice(0, 22).forEach(i =>
  console.log(`  ${String(i.n).padStart(3)}x  ${i.row} > ${i.k} + ${i.v}  | ${i.display}${i.dir === 'column' ? '/col' : ''} gap=${i.gap} pad=${i.pad} h=${i.h} | k ${i.kFs}/${i.kFw}${i.kTt === 'uppercase' ? '/UP' : ''} ls=${i.kLs} | v ${i.vFs}/${i.vFw} | border=${i.border} | @${[...i.screens].join(',')}`))
