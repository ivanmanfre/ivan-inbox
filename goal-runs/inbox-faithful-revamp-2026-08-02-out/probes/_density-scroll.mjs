import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const session = readFileSync('.session.json','utf8')
const outDir = process.argv[2]
mkdirSync(outDir, { recursive: true })
const b = await chromium.launch()

async function run(vp, lane) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  await p.addInitScript(([k,v])=>localStorage.setItem(k,v), ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
  await p.addInitScript(()=>localStorage.setItem('inbox-theme','dark'))
  await p.goto('http://localhost:5444/#exp/v2/content', {waitUntil:'domcontentloaded', timeout:45000})
  await p.waitForTimeout(3500)
  if (lane === 'mattan') {
    await p.locator('.chips .chip:nth-child(2)').first().click({timeout:6000}).catch(()=>{})
    await p.waitForTimeout(2600)
  }
  const results = []
  // find the scroll container
  const scrollInfo = await p.evaluate(() => {
    const cands = [...document.querySelectorAll('.wb-work, .wb-scroll, main, .wb-pane, .ct-body')]
    let best = document.scrollingElement
    let bestDelta = 0
    for (const el of cands) {
      const d = el.scrollHeight - el.clientHeight
      if (d > bestDelta) { bestDelta = d; best = el }
    }
    best.__isTarget = true
    return { tag: best.tagName, cls: (best.className||'').toString(), scrollHeight: best.scrollHeight, clientHeight: best.clientHeight }
  })
  const bands = ['top', 'middle', 'bottom']
  for (const band of bands) {
    await p.evaluate((band) => {
      const cands = [...document.querySelectorAll('.wb-work, .wb-scroll, main, .wb-pane, .ct-body')]
      let best = document.scrollingElement
      let bestDelta = 0
      for (const el of cands) {
        const d = el.scrollHeight - el.clientHeight
        if (d > bestDelta) { bestDelta = d; best = el }
      }
      const max = best.scrollHeight - best.clientHeight
      const y = band === 'top' ? 0 : band === 'middle' ? max/2 : max
      best.scrollTop = y
    }, band)
    await p.waitForTimeout(500)
    const info = await p.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width>0 && r.height>0 }
      const rows = [...document.querySelectorAll('.ct-card:not(.ct-idea), .ct-idea-h')].filter(vis)
      const xs = rows.map(r => { const p = r.querySelector('.ct-title'); return p ? Math.round(p.getBoundingClientRect().left) : null }).filter(x=>x!==null)
      const sticky = [...document.querySelectorAll('[class*=sech], [class*="-sec"], .wb-sech, .grouphdr')].filter(vis)
        .map(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return { cls: el.className, top: Math.round(r.top), position: s.position, text: (el.textContent||'').slice(0,40) } })
      return {
        railVariance: xs.length ? Math.max(...xs)-Math.min(...xs) : null,
        railN: xs.length,
        stickyHeaders: sticky,
        visibleRowCount: rows.length,
      }
    })
    results.push({ band, ...info })
    await p.screenshot({ path: `${outDir}/scroll-${lane}-${vp.width}-${band}.png`, fullPage: false })
  }
  await ctx.close()
  return { scrollInfo, results }
}

const out = {}
for (const vp of [{width:1440,height:900}, {width:390,height:844}]) {
  for (const lane of ['ivan','mattan']) {
    const key = `${lane}-${vp.width}`
    out[key] = await run(vp, lane)
    console.log(key, JSON.stringify(out[key].results.map(r=>({band:r.band, railVariance:r.railVariance, railN:r.railN, rows:r.visibleRowCount, sticky:r.stickyHeaders.length}))))
  }
}
writeFileSync(`${outDir}/density-report.json`, JSON.stringify(out, null, 2))
await b.close()
