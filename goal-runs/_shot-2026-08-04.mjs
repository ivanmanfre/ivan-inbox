import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(String(e)))
await page.addInitScript(([s]) => { localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s) }, [session])
await page.goto('https://ivanmanfre.github.io/ivan-inbox/#exp/v2/content', { waitUntil: 'networkidle' }).catch(()=>{})
await page.waitForTimeout(6000)
await page.screenshot({ path: '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/729ad97b-bb5e-488b-93ec-d60ed7e488e4/scratchpad/shot-content-top.png' })
const facts = await page.evaluate(() => ({
  colsHead: document.querySelectorAll('.ct-cols-head').length,
  colVals: document.querySelectorAll('.ct-colv').length,
  deleteBtns: document.querySelectorAll('.ct-x').length,
  railBtn: !!document.querySelector('.wb-rail-minbtn'),
  stylesRail: [...document.querySelectorAll('.wb-rj-l')].map(e => e.textContent),
  bodyFs: getComputedStyle(document.querySelector('.wb') || document.body).fontSize,
  firstColHead: document.querySelector('.ct-cols-head')?.textContent,
  cards: document.querySelectorAll('.ct-card').length,
}))
console.log(JSON.stringify({ facts, errors: errors.slice(0,3) }, null, 1))
// collapse the rail and reshoot
if (facts.railBtn) { await page.click('.wb-rail-minbtn'); await page.waitForTimeout(600); await page.screenshot({ path: '/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/729ad97b-bb5e-488b-93ec-d60ed7e488e4/scratchpad/shot-rail-collapsed.png' }) }
await browser.close()
