// Ad-hoc DOM probe: drive one lane, answer one question, print JSON.
//   node probe.mjs --lane content --vw 2560 [--click "text"] [--tab Errors]
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d }
const session = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8')
const vw = Number(arg('vw', 1440))
const lane = arg('lane', 'content')
const blocked = []

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: vw, height: vw === 390 ? 812 : 900 } })
await ctx.addInitScript(([s]) => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), [session])
const page = await ctx.newPage()
await page.route('**/rest/v1/**', async r => {
  const q = r.request(), m = q.method()
  if (m === 'PATCH' || m === 'DELETE' || m === 'PUT' || (m === 'POST' && !q.url().includes('/rpc/'))) {
    blocked.push(m + ' ' + q.url().split('/rest/v1/')[1].slice(0, 70))
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  }
  return r.continue()
})
await page.goto(`http://localhost:4173/#exp/v2/${lane}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const tab = arg('tab')
if (tab) { try { await page.getByText(tab, { exact: false }).first().click(); await page.waitForTimeout(1200) } catch (e) { console.log('TAB CLICK FAILED', String(e).slice(0, 80)) } }
const click = arg('click')
if (click) { try { await page.getByText(click, { exact: false }).first().click(); await page.waitForTimeout(1500) } catch (e) { console.log('CLICK FAILED', String(e).slice(0, 80)) } }

const out = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('input[type=checkbox],[role=checkbox],.cb,.ct-cb,[class*=check]')]
    .map(e => ({ cls: (e.className || '').toString().slice(0, 30), tag: e.tagName, h: Math.round(e.getBoundingClientRect().height) }))
  // real content extent: rightmost/bottom-most element that carries its OWN text
  const work = document.querySelector('.wb-work') || document.body
  const wr = work.getBoundingClientRect()
  let maxRight = 0, textArea = 0
  for (const el of work.querySelectorAll('*')) {
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')
    if (!own) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0) continue
    // width of the actual glyph run, not the block: use a Range
    const rng = document.createRange(); rng.selectNodeContents(el)
    const rects = [...rng.getClientRects()]
    for (const q of rects) { maxRight = Math.max(maxRight, q.right); textArea += q.width * q.height }
  }
  const panes = [...work.querySelectorAll('*')].filter(e => {
    const r = e.getBoundingClientRect(); return r.width > 300 && r.height > 200
  }).slice(0, 6).map(e => ({ c: (e.className || '').toString().slice(0, 28), w: Math.round(e.getBoundingClientRect().width) }))
  const tabs = [...document.querySelectorAll('[role=tab],.ct-tab')].map(e => e.textContent.trim().slice(0, 24))
  return {
    checkboxes: boxes.length, boxSample: boxes.slice(0, 5),
    workW: Math.round(wr.width), workH: Math.round(wr.height),
    textRightEdge: Math.round(maxRight), unusedRightPx: Math.round(wr.right - maxRight),
    textAreaPctOfWork: Math.round((textArea / (wr.width * Math.min(wr.height, innerHeight))) * 100),
    panes, tabs,
    bodyChars: document.body.innerText.trim().length,
  }
})
console.log(JSON.stringify(out, null, 1))
console.log('blocked writes:', blocked.length, blocked)
await browser.close()
