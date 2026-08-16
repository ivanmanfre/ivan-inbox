import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = readFileSync('.session.json','utf8')
const b = await chromium.launch()
const ctx = await b.newContext({viewport:{width:1440,height:900}})
await ctx.addInitScript(() => {
  const orig = window.fetch
  window.fetch = async (...args) => {
    const url = String(args[0])
    if (!url.includes('inbox-claude')) return orig(...args)
    console.log('[instr] fetch start')
    const res = await orig(...args)
    console.log('[instr] response', res.status)
    const body = res.body
    const wrapped = new ReadableStream({
      async start(c) {
        const r = body.getReader()
        let n = 0
        try {
          for (;;) {
            const { done, value } = await r.read()
            if (done) { console.log('[instr] stream CLOSED after', n, 'chunks'); break }
            n++
            console.log('[instr] chunk', n, value.length, 'bytes')
            c.enqueue(value)
          }
        } catch (e) { console.log('[instr] stream ERROR', String(e)) }
        c.close()
      },
    })
    return new Response(wrapped, { status: res.status, headers: res.headers })
  }
})
const pg = await ctx.newPage()
pg.on('console', m => { const t = m.text(); if (t.startsWith('[instr]')) console.log(Date.now() % 100000, t) })
await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
await pg.evaluate(s => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), sess)
await pg.goto('http://localhost:5431/#exp/v2/today', {waitUntil:'domcontentloaded'})
await pg.reload({waitUntil:'domcontentloaded'})
await pg.waitForTimeout(6000)
await pg.locator('.cfield').fill('Reply with exactly: INSTR OK')
await pg.locator('.cfield').press('Enter')
for (let i=0;i<60;i++){
  await pg.waitForTimeout(1000)
  if (!(await pg.locator('.wb-stop').count())) { console.log('IDLE at', i, 's'); break }
}
const busyLeft = await pg.locator('.wb-stop').count()
console.log('still busy:', busyLeft)
await b.close()
