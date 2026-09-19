// node .shots-c.mjs <baseUrl> <tag> <outDir> [views csv] [widths csv]
// Builder C's shooter. Same lock, same session write-back as .shots.mjs.
// A view entry may carry a click: `sends@Lanes` clicks the control whose text
// is "Lanes" after the page settles, then shoots as `sends-Lanes`.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, rmdirSync } from 'node:fs'
const [base, tag, out, viewsArg, widthsArg] = process.argv.slice(2)
const views = (viewsArg || 'sends,sales,ops,ask,settings,money,orbit').split(',')
const widths = (widthsArg || '1440,390').split(',').map(Number)
mkdirSync(out, { recursive: true })
// ONE shooter at a time: the session holds a single rotating refresh token.
const LOCK = '/tmp/elev-shot.lock'
for (let i = 0; ; i++) { try { mkdirSync(LOCK); break } catch { if (i > 600) throw new Error('lock timeout'); await new Promise(r => setTimeout(r, 1000)) } }
const unlock = () => { try { rmdirSync(LOCK) } catch {} }
process.on('exit', unlock); process.on('SIGINT', () => { unlock(); process.exit(1) }); process.on('uncaughtException', e => { console.error(e); unlock(); process.exit(1) })
const SP = '/Users/ivanmanfredi/Desktop/inbox-elevate-wt/.session.json', K = 'sb-bjbvqvzbzczjbatgmccb-auth-token'
let session = JSON.parse(readFileSync(SP, 'utf8'))
const sig = p => p.evaluate(() => document.body.innerText.length + ':' + document.querySelectorAll('.sk,.ds-skel,[class*="skeleton"]').length)
const settle = async p => { for (let i = 0; i < 50; i++) { const a = await sig(p); await p.waitForTimeout(500); const b = await sig(p); if (a === b && parseInt(b) > 300 && i > 2) return } }
const b = await chromium.launch(); const errors = []
for (const w of widths) {
  const phone = w < 500
  const ctx = await b.newContext({ viewport: { width: w, height: phone ? 844 : 900 }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone })
  const p = await ctx.newPage()
  p.on('console', m => { if (m.type() === 'error') errors.push(`[${w}] ${m.text().slice(0, 160)}`) })
  p.on('pageerror', e => errors.push(`[${w}] PAGEERROR ${String(e).slice(0, 200)}`))
  await p.goto(base, { waitUntil: 'domcontentloaded' })
  await p.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [K, session])
  for (const spec of views) {
    const [v, click] = spec.split('@')
    await p.goto(`${base}/#exp/brain-b/${v}`, { waitUntil: 'domcontentloaded' }); await p.reload({ waitUntil: 'domcontentloaded' }); await settle(p)
    if (click) {
      // `.ds-seg-item` ONLY. A union with `button:has-text()` picked the RAIL's
      // own "Lanes" button first (document order), which re-navigated to the
      // default sub-tab instead of switching it.
      const t = click.startsWith('css:')
        ? p.locator(click.slice(4)).first()
        : p.locator(`.ds-seg-item:has-text("${click}")`).first()
      try { await t.click({ timeout: 8000 }); await p.waitForTimeout(400); await settle(p) }
      catch (e) { console.log('click miss', spec, String(e).slice(0, 90)) }
    }
    const f = await p.evaluate(k => localStorage.getItem(k), K)
    if (f) { try { const j = JSON.parse(f); if (j.refresh_token) { session = j; writeFileSync(SP, JSON.stringify(j)) } } catch {} }
    if (process.env.SCROLL) await p.evaluate(y => { const s = document.querySelector('.a-body,.a-orbit-canvas,.ds-col-body') || document.scrollingElement; s.scrollTop = Number(y) }, process.env.SCROLL)
    await p.waitForTimeout(400)
    await p.screenshot({ path: `${out}/${tag}-${v}${click ? '-' + click : ''}-${w}.png`, fullPage: !!process.env.FULL })
    const ox = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    console.log(spec, w, 'overflowX', ox)
  }
  await ctx.close()
}
await b.close()
console.log('errors', errors.length); errors.slice(0, 10).forEach(e => console.log(e))
