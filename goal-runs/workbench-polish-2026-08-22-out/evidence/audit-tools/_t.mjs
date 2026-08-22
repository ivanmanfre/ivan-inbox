import { boot, openDraft, openThread } from './_open-draft.mjs'
const { browser, page } = await boot()
console.log('draft opened:', await openDraft(page))
console.log(await page.evaluate(() => ({
  dw: !!document.querySelector('.dw'),
  keys: [...document.querySelectorAll('.dw-key')].map(b => b.textContent.trim().slice(0,24)),
  secs: [...document.querySelectorAll('.dw-sec-n')].map(b => b.textContent.trim()),
})))
console.log('thread opened:', await openThread(page))
console.log(await page.evaluate(() => ({ bubbles: document.querySelectorAll('.wb-bubble').length, peer: !!document.querySelector('.wb-peer-thread') })))
await browser.close()
