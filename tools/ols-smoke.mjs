// B3 read-only regression: own pages at phone/narrow/desktop, plus unread archives.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { chromium, webkit } from 'playwright'
const [base, out] = process.argv.slice(2)
if (!base || !out) throw new Error('usage: ols-smoke.mjs base outDir')
mkdirSync(out, { recursive:true })
const auth = readFileSync(process.env.SHELL_SESSION_PATH, 'utf8')
const rpc = new Set(['inbox_changed_since','inbox_interest_cards','inbox_followup_sources','warm_signal_cards','conversation_agent_cards','inbox_reply_source','outreach_reply_sources','inbox_viewed_back','inbox_range_kpis','inbox_governor','inbox_rise_ready','operator_lanes','x_review_list'])
const result=[]
for (const [engine, driver] of Object.entries({chromium,webkit})) {
 const browser=await driver.launch()
 try {
  for(const width of [390,694,1144]) {
   const context=await browser.newContext({viewport:{width,height:840},serviceWorkers:'block'})
   await context.addInitScript(({auth})=>localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token',auth),{auth})
   let forbidden=0, archiveFailed=false; const blocked=[]
   await context.route('**/*',route=>{const q=route.request(),u=new URL(q.url());if(u.hostname.endsWith('.supabase.co')) {
    if(archiveFailed && u.pathname==='/rest/v1/transcripts')return route.fulfill({status:503,contentType:'application/json',body:'{"message":"archive offline"}'})
    if(!['GET','HEAD','OPTIONS'].includes(q.method()) && !u.pathname.startsWith('/auth/') && !(u.pathname.startsWith('/rest/v1/rpc/')&&rpc.has(u.pathname.split('/').pop()))){forbidden++;blocked.push({method:q.method(),path:u.pathname});return route.fulfill({status:403,body:'read-only smoke'})}
   }return route.continue()})
   const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(String(e)))
   for(const place of ['home','lanes','sales']){
    await page.goto(`${base}?skin=brief:home,lanes,sales#exp/d/${place}`)
    await page.locator(`[data-layout-v4=${place}]`).waitFor()
    await page.waitForTimeout(900)
    assert.equal(await page.locator('.d-boundary,.d-page-error').count(),0)
    const geometry=await page.evaluate(()=>({w:innerWidth,scroll:document.documentElement.scrollWidth,matrix:document.querySelector('.hm4-matrix')?.getBoundingClientRect().height}))
    assert(geometry.scroll<=geometry.w+1,`${place} ${width} overflow`)
    if(width===390&&place==='home')assert(geometry.matrix<=316,'phone matrix >316')
    await page.screenshot({path:`${out}/${engine}-${place}-${width}.png`})
    if(place==='sales'){
     const rail=page.locator('.sl4-rail-tabs');if(await rail.isVisible())await rail.locator('button').filter({hasText:/^Calls$/}).click()
     await page.locator('.sl4-cr').first().waitFor()
     await page.locator('.sl4-cr').first().click()
     await page.locator('[data-open-call]').waitFor()
     await page.keyboard.press('j');await page.keyboard.press('k')
     await page.screenshot({path:`${out}/${engine}-call-${width}.png`})
    }
    result.push({engine,width,place,...geometry})
   }
   archiveFailed=true
   for(const skin of ['brief:home,lanes,sales','off']){
    await page.goto(`${base}?skin=${skin}#exp/d/sales`)
    await page.locator('.sl-rec,.sl4-rec').waitFor({state:'attached'})
    const rail=page.locator(skin==='off'?'.sl-rail-tabs':'.sl4-rail-tabs');if(await rail.isVisible())await rail.locator('button').filter({hasText:/^Calls$/}).click()
    await page.getByText('The call archive did not load.',{exact:false}).waitFor()
    const text=await page.locator(skin==='off'?'.sl-rec':'.sl4-rec').innerText()
    assert(!text.includes('0m'), 'unread average claims zero')
    assert(!/All\s+0/.test(text),'unread total claims zero')
    await page.screenshot({path:`${out}/${engine}-archive-failed-${skin==='off'?'v3':'v4'}-${width}.png`})
   }
   assert.equal(errors.length,0,errors.join('\n'));assert.equal(forbidden,0,JSON.stringify(blocked))
   await context.close()
  }
 }finally{await browser.close()}
}
writeFileSync(`${out}/report.json`,JSON.stringify({ok:true,result},null,2));console.log(JSON.stringify({ok:true,cells:result.length}))
