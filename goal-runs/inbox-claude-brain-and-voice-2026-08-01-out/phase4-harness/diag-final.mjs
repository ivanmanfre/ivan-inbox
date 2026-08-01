// Diagnostic: interim results arrive but no FINAL. Is that (a) our recogniser
// settings, (b) the app's continuous=false, or (c) the Google speech backend
// refusing to finalise? Runs the same audio through 4 recogniser configurations
// in one process and records what each produces, plus a netlog of the
// speech-api traffic.
import { chromium } from '/Users/ivanmanfredi/Desktop/ivan-inbox/node_modules/playwright/index.mjs'
import { spawn, execFileSync } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const OUT = path.join(HERE, 'raw'); fs.mkdirSync(OUT, { recursive: true })
const WAV = process.argv[2] || '/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase4-fixtures/padded/f1.wav'
const SW = '/opt/homebrew/bin/SwitchAudioSource'
const prevIn = execFileSync(SW, ['-c', '-t', 'input']).toString().trim()
let restored = false
const restore = () => { if (restored) return; restored = true; try { execFileSync(SW, ['-s', prevIn, '-t', 'input']) } catch {} }
process.on('exit', restore); process.on('SIGINT', () => { restore(); process.exit(1) })

const PAGE = `<!doctype html><meta charset=utf-8><body><script>
window.__log=[]
const L=(k,v)=>window.__log.push({t:performance.now(),k,v:v??null})
window.__run = cfg => new Promise(res => {
  const R = window.webkitSpeechRecognition || window.SpeechRecognition
  const r = new R()
  r.lang='en-US'; r.continuous=cfg.continuous; r.interimResults=cfg.interim; r.maxAlternatives=1
  L('cfg', cfg)
  r.onstart=()=>L('start'); r.onspeechstart=()=>L('speechstart'); r.onspeechend=()=>L('speechend')
  r.onaudioend=()=>L('audioend')
  r.onresult=e=>{ const o=[]; for(let i=0;i<e.results.length;i++) o.push({f:e.results[i].isFinal,t:e.results[i][0].transcript}); L('result',o) }
  r.onerror=e=>L('error',{error:e.error})
  r.onend=()=>{ L('end'); res(window.__log) }
  r.start()
  setTimeout(()=>res(window.__log), cfg.timeout||22000)
})
window.__reset=()=>{window.__log=[]}
window.__ready=1
</script></body>`
const srv = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(PAGE) }).listen(5314)
await new Promise(r => srv.once('listening', r))

execFileSync(SW, ['-s', 'BlackHole 2ch', '-t', 'input'])
const netlog = path.join(OUT, 'diag-netlog.json')
const configs = [
  { name: 'app-settings (continuous=false, interim=true)', continuous: false, interim: true },
  { name: 'continuous=false, interim=false', continuous: false, interim: false },
  { name: 'continuous=true, interim=true', continuous: true, interim: true },
  { name: 'continuous=true, interim=false', continuous: true, interim: false },
]
const out = []
try {
  for (const cfg of configs) {
    const browser = await chromium.launch({ headless: false, channel: 'chrome', args: [
      '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
      `--log-net-log=${netlog}`, '--net-log-capture-mode=IncludeSensitive',
    ] })
    const ctx = await browser.newContext({ permissions: ['microphone'] })
    const page = await ctx.newPage()
    await page.goto('http://localhost:5314/'); await page.waitForFunction('window.__ready===1')
    const p = page.evaluate(c => window.__run(c), cfg)
    await new Promise(r => setTimeout(r, 700))
    spawn('/opt/homebrew/bin/ffmpeg', ['-nostdin', '-loglevel', 'error', '-re', '-i', WAV,
      '-f', 'audiotoolbox', '-audio_device_index', '1', '-'], { stdio: 'ignore' })
    const log = await p
    await browser.close()
    const finals = log.filter(e => e.k === 'result').flatMap(e => e.v).filter(x => x.f).map(x => x.t)
    const interims = log.filter(e => e.k === 'result').flatMap(e => e.v).filter(x => !x.f).map(x => x.t)
    out.push({ cfg: cfg.name, finals, lastInterim: interims.at(-1) ?? null, log })
    console.log(`${cfg.name}\n  FINAL: ${JSON.stringify(finals)}\n  last interim: ${JSON.stringify(interims.at(-1) ?? null)}\n  events: ${log.map(e => e.k).join(' ')}`)
  }
} finally { srv.close(); restore() }
fs.writeFileSync(path.join(OUT, 'diag-final-configs.json'), JSON.stringify(out, null, 2))
