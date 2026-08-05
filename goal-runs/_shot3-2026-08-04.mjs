import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
await page.goto('https://ivanmanfre.github.io/ivan-inbox/#exp/v2/content', { waitUntil: 'networkidle' }).catch(()=>{})
await page.waitForTimeout(6000)
const vals = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.ct-card')]
  const src = new Map(), pil = new Map(), fun = new Map()
  for (const c of cards) {
    const v = c.querySelectorAll('.ct-colv')
    const bump = (m, el) => { if (!el) return; const t = el.textContent.trim(); m.set(t, (m.get(t)||0)+1) }
    bump(pil, v[0]); bump(fun, v[1]); bump(src, v[2])
  }
  const top = m => [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12)
  return { pillar: top(pil), funnel: top(fun), source: top(src), cards: cards.length }
})
console.log(JSON.stringify(vals, null, 1))
await browser.close()
