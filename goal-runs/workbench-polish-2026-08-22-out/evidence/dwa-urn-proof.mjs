// DEFECT 1, PROVED ON A ROW THAT ACTUALLY CARRIES A urn.
// The proof draft has source_post_id NULL, so the GET that returns it is
// intercepted and the field is filled in with the exact string the audit named.
// This is a READ rewrite in the browser only; nothing is written anywhere.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
const URN = 'urn:li:activity:7496174424996585473'
const s = readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json','utf8')
const b = await chromium.launch()
const c = await b.newContext({ viewport:{width:1440,height:900} })
await c.addInitScript(([x])=>localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token',x),[s])
const p = await c.newPage()
let w=0
await p.route('**/rest/v1/**', async r => {
  const q=r.request(), m=q.method()
  if(['PATCH','DELETE','PUT','POST'].includes(m)){ w++; return r.fulfill({status:200,contentType:'application/json',body:'[]'}) }
  if(m==='GET' && /carousel_drafts/.test(q.url())){
    const res = await r.fetch()
    let body
    try { body = await res.json() } catch { return r.fulfill({ response: res }) }
    const patch = o => (o && typeof o === 'object' && 'post_body' in o) ? { ...o, source_post_id: URN } : o
    body = Array.isArray(body) ? body.map(patch) : patch(body)
    return r.fulfill({ status: res.status(), contentType: 'application/json', body: JSON.stringify(body) })
  }
  return r.continue()
})
await p.route('**/rest/v1/rpc/**', async r => {
  const m=r.request().method()
  if(['PATCH','DELETE','PUT','POST'].includes(m)){ w++; return r.fulfill({status:200,contentType:'application/json',body:'[]'}) }
  return r.continue()
})
await p.goto('http://localhost:4184/#exp/v2/content',{waitUntil:'networkidle'})
await p.waitForTimeout(1400); await p.locator('.ct-card').first().click(); await p.waitForTimeout(1600)
const out = await p.evaluate(u=>{
  const dw=document.querySelector('.dw')
  const visible = el => { for(let n=el; n; n=n.parentElement){ if(n.tagName==='DETAILS' && !n.open) return false } return true }
  const hits=[...dw.querySelectorAll('*')].filter(el=>[...el.childNodes].some(n=>n.nodeType===3 && n.textContent.includes(u)))
  const leaf = hits[hits.length-1]
  const sec = document.getElementById('dw-sec-src')
  return {
    present: !!leaf,
    visibleAtRest: leaf ? visible(leaf) : null,
    behind: leaf ? leaf.closest('details')?.querySelector('summary')?.textContent.trim() : null,
    cls: leaf?.className,
    type: leaf ? (cs=>`${cs.fontSize}/${cs.fontWeight} ${cs.color}`)(getComputedStyle(leaf)) : null,
    restRows: sec ? [...sec.querySelectorAll('.dd-row')].filter(r=>visible(r)).map(r=>r.textContent.trim()) : [],
  }
}, URN)
console.log(JSON.stringify(out,null,1))
console.log('attemptedWrites =', w)
await p.screenshot({ path:'/tmp/dwa-urn-closed.jpg', quality:82, type:'jpeg' })
// and again with the disclosure open, to show nothing was dropped
await p.locator('#dw-sec-src .qa-fold > summary').first().click().catch(()=>{})
await p.waitForTimeout(500)
const sec = p.locator('#dw-sec-src')
const box = await sec.boundingBox()
if (box) await p.screenshot({ path:'/tmp/dwa-urn-open.jpg', quality:82, type:'jpeg', clip:{...box, height: Math.min(box.height, 420)} })
await b.close()
