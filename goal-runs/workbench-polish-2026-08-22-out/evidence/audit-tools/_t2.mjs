import { boot, goto } from './_open-draft.mjs'
const { browser, page } = await boot()
await goto(page, '#exp/v2/dms', 3500)
console.log(await page.evaluate(() => ({
  rows: document.querySelectorAll('.rows .r').length,
  anyR: document.querySelectorAll('.r').length,
  text: (document.querySelector('.wb-work')?.innerText||'').slice(0,300),
})))
if (await page.locator('.rows .r').count()) {
  await page.locator('.rows .r').first().click(); await page.waitForTimeout(3000)
  console.log('after click:', await page.evaluate(() => ({ peers: document.querySelector('.wb-regions')?.className, bubbles: document.querySelectorAll('.wb-bubble').length, peer: document.querySelectorAll('[class*=wb-peer]').length })))
}
await browser.close()
