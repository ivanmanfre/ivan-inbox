import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const sess = readFileSync('.session.json','utf8')
const b = await chromium.launch()
const pg = await (await b.newContext({viewport:{width:1440,height:900}})).newPage()
await pg.goto('http://localhost:5431/', {waitUntil:'domcontentloaded'})
await pg.evaluate(s => localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', s), sess)
await pg.reload({waitUntil:'domcontentloaded'})
await pg.waitForTimeout(4000)
const out = await pg.evaluate(async () => {
  const mod = await import('/src/lib/claude.ts')
  const events = []
  const t0 = Date.now()
  const p = mod.sendToClaude('Reply with exactly: MOD OK', {
    onEvent: e => events.push({ t: Date.now() - t0, kind: e.kind, text: (e.delta ?? e.text ?? '').slice(0, 60), code: e.code }),
  })
  const timeout = new Promise(r => setTimeout(() => r('TIMEOUT'), 60000))
  const end = await Promise.race([p.then(() => 'RESOLVED'), timeout])
  return { end, ms: Date.now() - t0, events }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
