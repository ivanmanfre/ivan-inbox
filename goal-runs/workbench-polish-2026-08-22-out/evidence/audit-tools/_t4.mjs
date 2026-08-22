import { boot, goto } from './_open-draft.mjs'
const { browser, page } = await boot()
await goto(page, '#exp/v2/content', 4500)
console.log(await page.evaluate(() => ({
  rowsInner: (document.querySelector('.ct-rows')?.innerText||'').slice(0,400),
  classes: [...new Set([...document.querySelectorAll('.ct-rows *')].map(e=>typeof e.className==='string'?e.className:'').filter(Boolean))].slice(0,40),
})))
await browser.close()
