// PHASE 4 PROBE — does a browser here actually TRANSCRIBE?
//
// Hard-truth gate before any elaborate harness is built. Answers three questions
// per browser channel, empirically, with the raw event log written to raw/:
//   1. does `new webkitSpeechRecognition()` exist?
//   2. driven with a fake-audio-capture WAV, does it emit a `result` event?
//   3. or does it emit `error: network` / `not-allowed` / `service-not-allowed`?
//
// Usage: node probe.mjs <channel: chromium|chrome> <headless: 0|1> <wav abs path>
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const [, , channel = 'chromium', headlessArg = '0', wav] = process.argv
const headless = headlessArg === '1'
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'raw')
fs.mkdirSync(OUT, { recursive: true })

const PAGE = `<!doctype html><meta charset=utf-8><title>probe</title><body>
<h1>probe</h1><pre id=log></pre><script>
window.__log = []
function L(k, v) { window.__log.push({ t: performance.now(), k, v })
  document.getElementById('log').textContent += k + ' ' + JSON.stringify(v ?? null) + '\\n' }
window.__probe = async function () {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition || null
  L('ctor', { SpeechRecognition: !!window.SpeechRecognition,
              webkitSpeechRecognition: !!window.webkitSpeechRecognition,
              secureContext: window.isSecureContext })
  if (!Ctor) return 'no-ctor'
  // getUserMedia first, exactly as a real page would, so a mic failure is
  // distinguishable from a speech-service failure.
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    L('gum-ok', { tracks: s.getAudioTracks().map(t => t.label) })
    // Prove the fake audio is actually flowing: RMS over 300ms of the stream.
    const ac = new AudioContext()
    const src = ac.createMediaStreamSource(s)
    const an = ac.createAnalyser(); an.fftSize = 2048
    src.connect(an)
    const buf = new Float32Array(an.fftSize)
    let peak = 0
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 10))
      an.getFloatTimeDomainData(buf)
      for (const v of buf) peak = Math.max(peak, Math.abs(v))
    }
    L('stream-peak', { peak })
  } catch (e) { L('gum-fail', { name: e.name, message: e.message }) }

  const r = new Ctor()
  r.lang = 'en-US'; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1
  let done
  const p = new Promise(res => { done = res })
  r.onstart = () => L('onstart')
  r.onaudiostart = () => L('onaudiostart')
  r.onsoundstart = () => L('onsoundstart')
  r.onspeechstart = () => L('onspeechstart')
  r.onspeechend = () => L('onspeechend')
  r.onsoundend = () => L('onsoundend')
  r.onaudioend = () => L('onaudioend')
  r.onresult = e => {
    const out = []
    for (let i = 0; i < e.results.length; i++)
      out.push({ isFinal: e.results[i].isFinal, text: e.results[i][0] && e.results[i][0].transcript })
    L('onresult', { resultIndex: e.resultIndex, results: out })
  }
  r.onerror = e => { L('onerror', { error: e.error, message: e.message }); }
  r.onend = () => { L('onend'); done('ended') }
  try { r.start(); L('start-called') } catch (e) { L('start-threw', { name: e.name, message: e.message }); return 'start-threw' }
  const to = setTimeout(() => done('timeout'), 15000)
  const why = await p; clearTimeout(to)
  return why
}
</script></body>`

const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE)
}).listen(5311)
await new Promise(r => srv.once('listening', r))

const args = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
]
if (wav) args.push(`--use-file-for-fake-audio-capture=${wav}`)

const launch = { headless, args }
if (channel === 'chrome') launch.channel = 'chrome'
const browser = await chromium.launch(launch)
const ctx = await browser.newContext({ permissions: ['microphone'] })
const page = await ctx.newPage()
const console_ = []
page.on('console', m => console_.push({ type: m.type(), text: m.text() }))
await page.goto('http://localhost:5311/')
const why = await page.evaluate('window.__probe()')
const log = await page.evaluate('window.__log')
const ua = await page.evaluate('navigator.userAgent')

const result = { channel, headless, wav, ua, why, log, console: console_ }
const tag = `probe-${channel}-${headless ? 'headless' : 'headed'}${wav ? '-' + path.basename(path.dirname(wav)) + '-' + path.basename(wav, '.wav') : '-nowav'}`
fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ tag, ua, why, log: log.map(l => `${l.t.toFixed(0)} ${l.k} ${JSON.stringify(l.v ?? null)}`) }, null, 2))
await browser.close(); srv.close()
