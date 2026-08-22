import { boot, goto } from './_open-draft.mjs'
const { browser, page } = await boot()
await goto(page, '#exp/v2/content', 3000)
console.log('view state:', await page.evaluate(() => ({ rows: document.querySelectorAll('.ct-rows .r').length, cal: document.querySelectorAll('.cal-day').length, tabs: [...document.querySelectorAll('.ct-tabs *')].map(e=>e.textContent.trim()).slice(0,10) })))
try { await page.getByText('List',{exact:true}).first().click({timeout:4000}); await page.waitForTimeout(2000) } catch(e){ console.log('List click:', e.message.slice(0,80)) }
console.log('after List:', await page.evaluate(() => ({ rows: document.querySelectorAll('.ct-rows .r').length, cal: document.querySelectorAll('.cal-day').length })))
await browser.close()
