import { open, settle } from './harness.mjs'
const [url, out, w, h, theme] = process.argv.slice(2)
const { browser, page, writes, errors } = await open({ width: +w || 1440, height: +h || 900, theme: theme || 'dark' })
await page.goto(url, { waitUntil: 'domcontentloaded' })
await settle(page, 5000)
await page.screenshot({ path: out, type: 'jpeg', quality: 82 })
console.log(JSON.stringify({ out, writes: writes.length, writeList: writes, errors }))
await browser.close()
