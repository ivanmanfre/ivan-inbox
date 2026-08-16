import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const session = readFileSync('.session.json','utf8')
const outDir = process.argv[2]
mkdirSync(outDir, { recursive: true })
const b = await chromium.launch()

function findScroller() {
  const els = [...document.querySelectorAll('*')]
  let best = null, bestDelta = 0
  for (const el of els) {
    const s = getComputedStyle(el)
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight - el.clientHeight > bestDelta) {
      bestDelta = el.scrollHeight - el.clientHeight
      best = el
    }
  }
  return best
}

async function run(vp, lane) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  await p.addInitScript(([k,v])=>localStorage.setItem(k,v), ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
  await p.addInitScript(()=>localStorage.setItem('inbox-theme','dark'))
  await p.goto('http://localhost:5444/#exp/v2/content', {waitUntil:'domcontentloaded', timeout:45000})
  await p.waitForFunction(() => document.querySelectorAll('.sk').length === 0 && document.querySelectorAll('.wb .ct-card').length > 0, null, {timeout:30000}).catch(()=>{})
  await p.waitForTimeout(2600)
  if (lane === 'mattan') {
    await p.locator('.chips .chip:nth-child(2)').first().click({timeout:6000}).catch(()=>{})
    await p.waitForTimeout(2600)
  }
  const results = []
  const bands = ['top', 'middle', 'bottom']
  for (const band of bands) {
    await p.evaluate(({ band, findScrollerSrc }) => {
      const findScroller = new Function('return ' + findScrollerSrc)()
      const el = findScroller()
      if (!el) return
      const max = el.scrollHeight - el.clientHeight
      el.scrollTop = band === 'top' ? 0 : band === 'middle' ? max/2 : max
    }, { band, findScrollerSrc: findScroller.toString() })
    await p.waitForTimeout(600)
    const info = await p.evaluate(({ findScrollerSrc }) => {
      const findScroller = new Function('return ' + findScrollerSrc)()
      const scroller = findScroller()
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight && r.width>0 && r.height>0 }
      const rows = [...document.querySelectorAll('.ct-card:not(.ct-idea), .ct-idea-h')].filter(vis)
      const xs = rows.map(r => { const p = r.querySelector('.ct-title'); return p ? Math.round(p.getBoundingClientRect().left) : null }).filter(x=>x!==null)
      const stickyCands = [...document.querySelectorAll('*')].filter(el => getComputedStyle(el).position === 'sticky').filter(vis)
      const sticky = stickyCands.map(el => { const r = el.getBoundingClientRect(); return { cls: el.className, top: Math.round(r.top), text: (el.textContent||'').slice(0,40) } })
      return {
        scrollTop: scroller ? scroller.scrollTop : null,
        scrollMax: scroller ? scroller.scrollHeight - scroller.clientHeight : null,
        railVariance: xs.length ? Math.max(...xs)-Math.min(...xs) : null,
        railN: xs.length,
        stickyHeaders: sticky,
        visibleInViewportRowCount: rows.length,
        totalRowsInDom: document.querySelectorAll('.ct-card:not(.ct-idea), .ct-idea-h').length,
      }
    }, { findScrollerSrc: findScroller.toString() })
    results.push({ band, ...info })
    await p.screenshot({ path: `${outDir}/scroll2-${lane}-${vp.width}-${band}.png`, fullPage: false })
  }
  await ctx.close()
  return { results }
}

const out = {}
for (const vp of [{width:1440,height:900}, {width:390,height:844}]) {
  for (const lane of ['ivan','mattan']) {
    const key = `${lane}-${vp.width}`
    out[key] = await run(vp, lane)
    console.log(key, JSON.stringify(out[key].results.map(r=>({band:r.band, scrollTop:r.scrollTop, scrollMax:r.scrollMax, railVariance:r.railVariance, railN:r.railN, visibleRows:r.visibleInViewportRowCount, totalRows:r.totalRowsInDom, sticky:r.stickyHeaders.length, stickyTexts: r.stickyHeaders.slice(0,3).map(s=>s.text)}))))
  }
}
writeFileSync(`${outDir}/density-report2.json`, JSON.stringify(out, null, 2))
await b.close()
