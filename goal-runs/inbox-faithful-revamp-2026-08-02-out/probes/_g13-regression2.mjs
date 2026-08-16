import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const session = readFileSync('.session.json','utf8')
const outDir = process.argv[2]
mkdirSync(outDir, { recursive: true })
const b = await chromium.launch()

async function capture(baseUrl, hash, tag) {
  const ctx = await b.newContext({ viewport: {width:1440,height:900}, deviceScaleFactor:2 })
  const p = await ctx.newPage()
  await p.addInitScript(([k,v])=>localStorage.setItem(k,v), ['sb-bjbvqvzbzczjbatgmccb-auth-token', session])
  await p.addInitScript(()=>localStorage.setItem('inbox-theme','dark'))
  await p.goto(`${baseUrl}${hash}`, {waitUntil:'domcontentloaded', timeout:45000})
  await p.waitForTimeout(2500)
  // poll literal "Loading" gone from the app root, up to 40s
  await page_wait(p)
  await p.waitForTimeout(1200)
  const dom = await p.evaluate(() => {
    const strip = (el, depth) => {
      if (depth > 6 || !el) return null
      return {
        tag: el.tagName, cls: (el.className||'').toString().split(' ').filter(Boolean).sort().join('.'),
        children: [...el.children].slice(0,40).map(c => strip(c, depth+1)),
      }
    }
    const root = document.querySelector('.app') || document.body
    return strip(root, 0)
  })
  const file = `${outDir}/${tag}.png`
  await p.screenshot({ path: file, fullPage: true })
  await ctx.close()
  return { dom, file }
}
async function page_wait(p) {
  await p.waitForFunction(() => !/Loading the brief/i.test(document.body.innerText || ''), null, { timeout: 40000 }).catch(()=>{})
}

const routes = ['#inbox', '#today', '#sends']
const report = {}
for (const h of routes) {
  const name = h.slice(1)
  const base = await capture('http://localhost:5452/', h, `${name}-base2`)
  const cand = await capture('http://localhost:5444/', h, `${name}-cand2`)
  report[name] = { baseDom: base.dom, candDom: cand.dom, baseFile: base.file, candFile: cand.file }
}
writeFileSync(`${outDir}/regression2.json`, JSON.stringify(report, null, 2))
await b.close()
console.log('done')
