import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, webkit } from 'playwright'
import { expect, it } from 'vitest'
import { build } from 'vite'
import { execFileSync } from 'node:child_process'

const out = process.env.INBOX_UX_OUT ?? '/Users/ivanmanfredi/Desktop/Ivan - Content System/goal-runs/inbox-ux-2026-11-05-out/layout'
const files = ['src/ds/tokens.css', 'src/ds/ds.css', 'src/d/d.css', 'src/d/dms/dms.css', 'src/d/dms/dms-thread.css', 'src/d/dms/dms-more.css', 'src/d/dms/dms-calm.css', 'src/d/dms/dms-bubbles.css', 'src/d/dms/dms-seats.css', 'src/d/dms/v4/dms-v4.css', 'src/d/dms/phone-ox.css', 'src/d/dms/email.css', 'src/d/dms/rich-email.css', 'src/d/dms/calendar.css']
const css = files.map(f => process.env.INBOX_UX_BASELINE === '1' ? execFileSync('git', ['show', `688b26ea:${f}`], { encoding: 'utf8' }) : readFileSync(resolve(f), 'utf8')).join('\n').replace(/@import[^;]+;/g, '')
function fixture(phone: boolean, legacy: boolean, long: boolean, ownSend: boolean) {
  return `<!doctype html><html class="d-root" data-skin-on="tokens type shell dms" data-layout="${phone ? 'phone' : 'desktop'}" data-fixture='${JSON.stringify({phone,legacy,long,ownSend,baseline:process.env.INBOX_UX_BASELINE === '1'})}'><head><meta charset="utf-8"><style>${css}</style><style>html,body{margin:0;height:100%;overflow:hidden}.d-app{height:100dvh!important;min-height:0!important;padding:0!important}.dx-desk{display:flex!important;height:calc(100dvh - 90px)!important;margin:70px 18px 20px 36%;min-height:0}.dx-desk>.dm-pane{width:100%;height:100%;min-height:0}.dm-phone-thread{height:calc(100dvh - 112px)!important;padding:0!important;margin-top:50px}.dm-phone-thread>.dm-pane{height:100%;min-height:0}.dm-head p{margin:4px 0}.dm-phone-thread .dm-head{padding:10px!important}</style></head><body><div id="root"></div><script src="./client/fixture.iife.js"></script></body></html>`
}

it('keeps history, email editor and send controls usable in both layouts and engines', async () => {
  mkdirSync(out, { recursive: true })
  await build({ configFile: false, logLevel: 'error', plugins: [{ name: 'baseline-components', load(id) { if (process.env.INBOX_UX_BASELINE === '1' && /\/src\/d\/dms\/(EmailComposer|v4\/ThreadV4)\.tsx$/.test(id)) return execFileSync('git', ['show', `688b26ea:${id.slice(id.indexOf('/src/') + 1)}`], { encoding: 'utf8' }) } }], define: { 'process.env.NODE_ENV': '"development"' }, build: { lib: { entry: resolve('scripts/inbox-ux-client.tsx'), name: 'Fixture', formats: ['iife'], fileName: () => 'fixture.iife.js' }, outDir: resolve(out, 'client'), emptyOutDir: true } })
  const report: object[] = [], failures: string[] = []
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch()
    try {
      for (const [width, height] of [[1466, 948], [1366, 768], [1024, 768], [390, 844], [375, 667]]) {
        for (const legacy of [false, true]) for (const long of [false, true]) for (const ownSend of [false, true]) {
          const phone = width < 600, name = `${engine}-${width}x${height}-${legacy ? 'legacy' : 'v4'}-${long ? 'long' : 'empty'}-${ownSend ? 'own-send' : 'dock-send'}`
          const file = resolve(out, `${name}.html`)
          writeFileSync(file, fixture(phone, legacy, long, ownSend))
          const page = await browser.newPage({ viewport: { width, height } })
          const pageErrors: string[] = []
          const externalRequests: string[] = []
          page.on('pageerror', error => pageErrors.push(error.message))
          await page.route('**/*', route => { if (route.request().url().startsWith('file:')) return route.continue(); externalRequests.push(route.request().url()); return route.abort() })
          await page.goto(`file://${file}`)
          await page.getByRole('textbox', { name: 'Email reply', exact: true }).waitFor({ state: 'attached', timeout: 10000 })
          const metrics = await page.evaluate(() => {
            const rect = (s: string) => { const e = document.querySelector(s)!; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight, overflowY: getComputedStyle(e).overflowY } }
            const pane = rect('.dm-pane'), dock = rect('.dm-dock'), history = rect('.dm-scroll'), keys = rect('.dm-keys'), editor = rect('[aria-label="Email reply"]'), toolbar = rect('.dm-email-toolbar'), foot = rect('.dm-email-composer-foot')
            const clip = document.querySelector('.dm-email-composer-body') ? rect('.dm-email-composer-body') : dock
            return { pane, dock, history, keys, editor, toolbar, foot, editorVisible: Math.max(0, Math.min(editor.bottom, clip.bottom, pane.bottom) - Math.max(editor.top, clip.top, pane.top)), overflow: document.documentElement.scrollWidth > innerWidth }
          })
          const problems = []
          if (metrics.keys.top < metrics.pane.top - 1 || metrics.keys.bottom > metrics.pane.bottom + 1) problems.push('send controls clipped')
          if (metrics.editorVisible < 68) problems.push(`editor visible ${metrics.editorVisible}px`)
          if (metrics.history.height < (phone ? 80 : 120)) problems.push(`history ${metrics.history.height}px`)
          if (metrics.overflow) problems.push('horizontal overflow')
          if (metrics.foot.bottom > metrics.pane.bottom + 1) problems.push('composer footer clipped')
          if (!legacy && !long) await page.screenshot({ path: resolve(out, `${name}.png`) })
          if (process.env.INBOX_UX_BASELINE !== '1') {
            const targetVisible = await page.locator('.dm-email-toolbar-target').evaluate(el => { const r = el.getBoundingClientRect(), toolbar = el.closest('.dm-email-toolbar')!.getBoundingClientRect(); return r.height > 0 && r.top >= toolbar.top && r.bottom <= toolbar.bottom + 1 && r.right <= toolbar.right + 1 })
            if (!targetVisible) problems.push('reply target hidden by long recipient')
            const details = page.getByRole('button', { name: 'Email details', exact: true })
            await details.click()
            await page.getByRole('button', { name: 'Show more', exact: true }).click()
            await page.getByRole('button', { name: 'View original', exact: true }).scrollIntoViewIfNeeded()
            const body = page.locator('.dm-email-composer-body')
            await body.evaluate(el => { el.scrollTop = el.scrollHeight })
            const keysVisible = await page.locator('.dm-keys').evaluate(el => { const r = el.getBoundingClientRect(), pane = el.closest('.dm-pane')!.getBoundingClientRect(); return r.top >= pane.top && r.bottom <= pane.bottom + 1 })
            if (!keysVisible) problems.push('scrolling email hides send controls')
            await details.click()
            await page.getByRole('button', { name: 'Preview', exact: true }).click()
            await page.getByRole('button', { name: 'Edit', exact: true }).click()
            const returnedEditorVisible = await page.getByRole('textbox', { name: 'Email reply', exact: true }).evaluate(el => { const r = el.getBoundingClientRect(), body = el.closest('.dm-email-composer-body')!.getBoundingClientRect(); return Math.max(0, Math.min(r.bottom, body.bottom) - Math.max(r.top, body.top)) })
            if (returnedEditorVisible < 68) problems.push(`Preview/Edit loses editor: ${returnedEditorVisible}px`)
            if (long) {
              await page.evaluate(() => window.dispatchEvent(new Event('fixture:recipient-error')))
              const retry = page.getByRole('button', { name: 'Retry email details' })
              await retry.waitFor()
              const retryVisible = await retry.evaluate(el => { const r = el.getBoundingClientRect(), pane = el.closest('.dm-pane')!.getBoundingClientRect(); return r.height > 0 && r.top >= pane.top && r.bottom <= pane.bottom })
              if (!retryVisible) problems.push('recipient error Retry is below the fold')
              if (!(await page.locator('.dm-email-toolbar').innerText()).includes('Recipient unavailable')) problems.push('recipient error still says loading')
            }
          }
          if (externalRequests.length) problems.push(`non-file request attempted: ${externalRequests.join('; ')}`)
          if (pageErrors.length) problems.push(`page errors: ${pageErrors.join('; ')}`)
          if (problems.length) failures.push(`${name}: ${problems.join(', ')}`)
          report.push({ name, metrics, problems })
          await page.close()
        }
      }
    } finally { await browser.close() }
  }
  writeFileSync(resolve(out, 'metrics.json'), JSON.stringify({ cases: report, failures }, null, 2))
  console.log(JSON.stringify({ cases: report.length, failures }, null, 2))
  expect(failures).toEqual([])
})
