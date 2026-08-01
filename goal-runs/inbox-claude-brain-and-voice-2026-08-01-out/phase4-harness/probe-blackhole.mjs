// Third probe: can Chrome's recogniser transcribe at all, if the audio arrives on
// a REAL input device instead of the fake-file device it demonstrably ignores?
//
// Route: ffmpeg plays the fixture into BlackHole 2ch's OUTPUT; BlackHole loops it
// to its INPUT; BlackHole is the system default input, so Chrome's recogniser —
// which opens the default hardware input directly — hears it.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { spawn, execFileSync } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const wav = process.argv[2]
const HERE = path.dirname(new URL(import.meta.url).pathname)
const OUT = path.join(HERE, 'raw'); fs.mkdirSync(OUT, { recursive: true })
const SW = '/opt/homebrew/bin/SwitchAudioSource'
const BH = 'BlackHole 2ch'

const prevIn = execFileSync(SW, ['-c', '-t', 'input']).toString().trim()
const prevOut = execFileSync(SW, ['-c', '-t', 'output']).toString().trim()
const restore = () => {
  try { execFileSync(SW, ['-s', prevIn, '-t', 'input']) } catch {}
  try { execFileSync(SW, ['-s', prevOut, '-t', 'output']) } catch {}
}
process.on('exit', restore); process.on('SIGINT', () => { restore(); process.exit(1) })

const PAGE = fs.readFileSync(path.join(HERE, 'probe-page.html'), 'utf8')
const srv = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(PAGE) }).listen(5313)
await new Promise(r => srv.once('listening', r))

execFileSync(SW, ['-s', BH, '-t', 'input'])
console.error(`default input: ${prevIn} -> ${execFileSync(SW, ['-c', '-t', 'input']).toString().trim()}`)

let browser, result
try {
  browser = await chromium.launch({
    headless: false, channel: 'chrome',
    // NOTE: no --use-fake-device / --use-file-for-fake-audio-capture. Real devices;
    // fake UI only auto-accepts the permission prompt.
    args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  })
  const ctx = await browser.newContext({ permissions: ['microphone'] })
  const page = await ctx.newPage()
  await page.goto('http://localhost:5313/')
  // Start the recogniser, then play the fixture 1.2s later so speech lands well
  // inside the listening window.
  const pending = page.evaluate('window.__probe()')
  await new Promise(r => setTimeout(r, 1200))
  spawn('/opt/homebrew/bin/ffmpeg',
    ['-nostdin', '-loglevel', 'error', '-re', '-i', wav, '-f', 'audiotoolbox', '-audio_device_index', '1', '-'],
    { stdio: 'ignore' })
  const why = await pending
  const log = await page.evaluate('window.__log')
  result = { wav, why, log }
  console.log(JSON.stringify({ why, log: log.map(l => `${l.t.toFixed(0)} ${l.k} ${JSON.stringify(l.v ?? null)}`) }, null, 2))
} finally {
  if (browser) await browser.close()
  srv.close(); restore()
  console.error(`restored input: ${execFileSync(SW, ['-c', '-t', 'input']).toString().trim()}`)
}
fs.writeFileSync(path.join(OUT, `probe-blackhole-${path.basename(wav, '.wav')}.json`), JSON.stringify(result, null, 2))
