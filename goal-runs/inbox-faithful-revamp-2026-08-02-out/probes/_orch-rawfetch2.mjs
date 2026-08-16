import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
const sess = readFileSync('.session.json','utf8')
const b = await chromium.launch()
const pg = await (await b.newContext({viewport:{width:1440,height:900}})).newPage()
await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
await pg.evaluate(s => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), sess)
await pg.reload({waitUntil:'domcontentloaded'})
await pg.waitForTimeout(4000)
// persist the (possibly refreshed) session back so later probes stay valid
const fresh = await pg.evaluate(() => localStorage.getItem('sb-bjbvqvzbzczjbatgmccb-auth-token'))
writeFileSync('.session.json', fresh)
const out = await pg.evaluate(async () => {
  const tok = JSON.parse(localStorage.getItem('sb-bjbvqvzbzczjbatgmccb-auth-token')).access_token
  const t0 = Date.now()
  const res = await fetch('https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/inbox-claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ prompt: 'Reply with exactly: RAW OK' }),
  })
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let chunks = 0, text = ''
  const timeout = new Promise(r => setTimeout(() => r('TIMEOUT'), 90000))
  const readAll = (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return 'CLOSED'
      chunks++
      text += dec.decode(value, { stream: true })
    }
  })()
  const end = await Promise.race([readAll, timeout])
  return { status: res.status, end, ms: Date.now() - t0, chunks, sawResult: text.includes('"type":"result"'), sawFinalDone: /"type":\s*"done"/.test(text), tail: text.slice(-150) }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
