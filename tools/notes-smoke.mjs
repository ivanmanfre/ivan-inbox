// Ops notes smoke: a real create -> type -> save -> delete round trip on the
// notes RPCs only. Every other write is answered 403 before it leaves the page.
// node tools/notes-smoke.mjs <baseUrl> <outDir>   NOTES_SESSION_PATH, NOTES_SESSION_OUT (new file)
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
const [base, out] = process.argv.slice(2)
const authKey = 'sb-bjbvqvzbzczjbatgmccb-auth-token'
let session = readFileSync(process.env.NOTES_SESSION_PATH, 'utf8')
const allowRpc = new Set(['operator_ops_notes', 'operator_save_ops_note', 'operator_delete_ops_note', 'x_review_list', 'inbox_changed_since'])
const browser = await chromium.launch()
const report = []
try {
  for (const width of [1440, 390]) {
    const phone = width === 390
    const ctx = await browser.newContext({ viewport: { width, height: phone ? 852 : 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' })
    await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1') } }, [authKey, session])
    const page = await ctx.newPage()
    const calls = [], blocked = []
    await page.route('**/*', route => {
      const r = route.request(), u = new URL(r.url())
      if (u.hostname.endsWith('supabase.co') && r.method() !== 'GET' && r.method() !== 'HEAD' && r.method() !== 'OPTIONS') {
        const rpc = u.pathname.startsWith('/rest/v1/rpc/') ? u.pathname.slice(13) : null
        if (u.pathname.startsWith('/auth/v1/token') || (rpc && allowRpc.has(rpc))) { if (rpc) calls.push(rpc); return route.continue() }
        blocked.push(`${r.method()} ${u.pathname}`)
        return route.fulfill({ status: 403, body: '{"message":"blocked by smoke"}', contentType: 'application/json' })
      }
      return route.continue()
    })
    await page.goto(`${base}#exp/d/ops`)
    await page.waitForSelector('.op-notes', { timeout: 30000 })
    await page.waitForFunction(() => !document.querySelector('.op-notes')?.textContent?.includes('Reading your notes'), null, { timeout: 15000 })
    const notes = page.locator('.op-notes')
    await notes.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${out}/${width}-1-list.png` })
    await notes.getByText('New note').click()
    const ta = notes.locator('.op-ne textarea')
    await ta.waitFor()
    const focused = await ta.evaluate(el => el === document.activeElement)
    await ta.pressSequentially(`Probe note ${width}\nsecond line, delete me`, { delay: 15 })
    await notes.getByText('Saved', { exact: true }).waitFor({ timeout: 10000 })
    await page.screenshot({ path: `${out}/${width}-2-editing.png` })
    await notes.getByText('Done', { exact: true }).click()
    await notes.getByText(`Probe note ${width}`).waitFor()
    await page.screenshot({ path: `${out}/${width}-3-saved.png` })
    // reload: the note came from the server
    await page.reload()
    await page.waitForSelector(`.op-notes >> text=Probe note ${width}`, { timeout: 20000 })
    await page.locator('.op-notes').getByText(`Probe note ${width}`).click()
    await page.locator('.op-notes [data-verb=delete-note]').click()
    await page.getByText('Note deleted.').waitFor()
    await page.screenshot({ path: `${out}/${width}-4-deleted.png` })
    await page.waitForTimeout(1500)
    await page.reload()
    await page.waitForSelector('.op-notes', { timeout: 20000 })
    await page.waitForFunction(() => !document.querySelector('.op-notes')?.textContent?.includes('Reading your notes'), null, { timeout: 15000 })
    await page.waitForTimeout(1500)
    const gone = !(await page.locator('.op-notes').textContent()).includes(`Probe note ${width}`)
    session = await page.evaluate(k => localStorage.getItem(k), authKey) || session
    report.push({ width, focused, gone, calls, blocked: [...new Set(blocked)] })
    await ctx.close()
  }
} finally {
  await browser.close()
  if (process.env.NOTES_SESSION_OUT) writeFileSync(process.env.NOTES_SESSION_OUT, session, { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify(report, null, 1))
}
