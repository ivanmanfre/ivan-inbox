import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
const OUT = '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/729ad97b-bb5e-488b-93ec-d60ed7e488e4/scratchpad/audit'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const BASE = 'https://ivanmanfre.github.io/ivan-inbox/#exp/v2/'
const JOBS = ['today','dms','content','magnets','styles','sends','ops','settings']
const VIEWPORTS = [[390,844,'m390'],[1024,768,'t1024'],[1440,900,'d1440'],[2560,1440,'w2560']]

const probe = () => {
  const vw = innerWidth
  const over = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > vw + 2 || r.left < -2) {
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed' && r.width <= vw + 4) continue
      over.push({ cls: (el.className||'').toString().slice(0,60), tag: el.tagName,
                  l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) })
    }
  }
  const tiny = []
  for (const el of document.querySelectorAll('body *')) {
    if (!el.childNodes.length) continue
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    if (!hasText) continue
    const fs = parseFloat(getComputedStyle(el).fontSize)
    if (fs && fs < 11) tiny.push({ cls:(el.className||'').toString().slice(0,40), fs })
  }
  // deepest scrolling region + how much of the viewport the content actually fills
  const main = document.querySelector('.wb-work, .wb-regions, .rows') 
  return {
    docOverflowX: document.documentElement.scrollWidth > vw + 2,
    scrollW: document.documentElement.scrollWidth, vw,
    overflowers: over.slice(0, 8), overflowCount: over.length,
    tiny: tiny.slice(0,5), tinyCount: tiny.length,
    cards: document.querySelectorAll('.ct-card, .r, .td-r, .dmh-r').length,
    emptyLine: document.querySelector('.wb-empty-l, .ct-subtle')?.textContent?.slice(0,70) ?? null,
    mainH: main ? Math.round(main.getBoundingClientRect().height) : null,
    contentH: main ? main.scrollHeight : null,
    bodyText: document.body.innerText.trim().length,
  }
}

const browser = await chromium.launch()
const report = []
for (const [w,h,tag] of VIEWPORTS) {
  for (const job of JOBS) {
    const page = await browser.newPage({ viewport:{width:w,height:h} })
    const errs = []
    page.on('pageerror', e => errs.push(String(e).slice(0,120)))
    page.on('console', m => { if (m.type()==='error') errs.push('c:'+m.text().slice(0,100)) })
    await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
    await page.goto(BASE+job, { waitUntil:'networkidle' }).catch(()=>{})
    await page.waitForTimeout(5200)
    const m = await page.evaluate(probe).catch(e => ({ err:String(e).slice(0,80) }))
    await page.screenshot({ path:`${OUT}/${tag}-${job}.png` })
    report.push({ vp:tag, job, ...m, errs: errs.slice(0,3) })
    await page.close()
  }
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report,null,1))
// compact console summary: only the rows with something wrong
for (const r of report) {
  const bad = []
  if (r.docOverflowX) bad.push(`OVERFLOW-X ${r.scrollW}>${r.vw}`)
  if (r.overflowCount) bad.push(`${r.overflowCount} el past edge`)
  if (r.tinyCount) bad.push(`${r.tinyCount} tiny<11px`)
  if (r.errs?.length) bad.push(`ERR ${r.errs[0]}`)
  if ((r.bodyText||0) < 120) bad.push(`NEARLY EMPTY ${r.bodyText}ch`)
  if (bad.length) console.log(`${r.vp} ${r.job}: ${bad.join(' | ')}`)
}
console.log('--- done, cards per surface ---')
console.log(report.filter(r=>r.vp==='d1440').map(r=>`${r.job}:${r.cards}`).join(' '))
await browser.close()
