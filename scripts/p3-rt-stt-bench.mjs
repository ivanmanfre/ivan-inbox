// Phase 3 bench: ElevenLabs scribe_v2_realtime over a REAL browser WebSocket.
//
// Measures, per clip: WS open time, time from first audio byte to first
// partial_transcript (paced at realtime, so this is the honest first-interim
// number), and the committed transcript for WER. Also runs the silence clip
// to verify silence emits no text (the honesty contract).
//
// Usage: node scripts/p3-rt-stt-bench.mjs <wavDir> <sessionJsonPath>
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const FN = 'https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/inbox-rt-token'
// The exact KEYTERMS list from supabase/functions/inbox-stt/index.ts.
const KEYTERMS = [
  'Supabase', 'n8n', 'UniPile', 'Smartlead', 'PostgREST', 'ClickUp', 'RLS', 'OAuth',
  'Railway', 'edge function', 'worktree', 'carousel', 'hyperframes', 'lead magnet',
  'DM', 'LinkedIn', 'RISE DTC', 'Mattan', 'ivanmanfredi.com', 'QA verdict', 'JWT', 'STT',
]

const [wavDir, sessPath] = process.argv.slice(2)
const session = JSON.parse(readFileSync(sessPath, 'utf8'))
const truth = JSON.parse(readFileSync(join(wavDir, 'truth.json'), 'utf8'))

async function mint(token) {
  const r = await fetch(FN, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'stt' }),
  })
  if (!r.ok) throw new Error(`mint ${r.status}`)
  return (await r.json()).token
}

// Runs inside the page: opens the WS, paces PCM at realtime in 100ms chunks,
// manual-commits at the end, resolves with timings + transcript pieces.
const RUN = async ({ token, pcmB64, keytermsQS }) => {
  const bin = atob(pcmB64)
  const pcm = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i)
  const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?token=${token}`
    + `&model_id=scribe_v2_realtime&audio_format=pcm_16000&language_code=eng`
    + `&commit_strategy=manual${keytermsQS}`
  const t0 = performance.now()
  const out = {
    wsOpenMs: null, sessionStartedMs: null, firstPartialMs: null,
    partials: [], committed: [], errors: [], commitToFinalMs: null,
  }
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s) }
  return await new Promise((resolve) => {
    const ws = new WebSocket(url)
    let firstAudioAt = null
    let commitAt = null
    const finish = () => { try { ws.close() } catch { /* done */ } resolve(out) }
    const timeout = setTimeout(finish, 30000)
    ws.onopen = () => { out.wsOpenMs = performance.now() - t0 }
    ws.onerror = () => { out.errors.push('ws-error'); clearTimeout(timeout); finish() }
    ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data) } catch { return }
      const mt = msg.message_type || msg.type
      if (mt === 'session_started') {
        out.sessionStartedMs = performance.now() - t0
        // Stream: 100ms chunks (3200 bytes) paced at realtime.
        const CHUNK = 3200
        let off = 0
        firstAudioAt = performance.now()
        const tick = setInterval(() => {
          if (off >= pcm.length) {
            clearInterval(tick)
            commitAt = performance.now()
            ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: b64(new Uint8Array(3200)), commit: true, sample_rate: 16000 }))
            return
          }
          const chunk = pcm.slice(off, off + CHUNK)
          off += CHUNK
          ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: b64(chunk), commit: false, sample_rate: 16000 }))
        }, 100)
      } else if (mt === 'partial_transcript') {
        if (out.firstPartialMs === null && firstAudioAt !== null && (msg.text || '').trim()) {
          out.firstPartialMs = performance.now() - firstAudioAt
        }
        out.partials.push(msg.text ?? '')
      } else if (mt === 'committed_transcript' || mt === 'committed_transcript_with_timestamps') {
        out.committed.push(msg.text ?? '')
        if (commitAt !== null) out.commitToFinalMs = performance.now() - commitAt
        clearTimeout(timeout)
        setTimeout(finish, 300) // drain any trailing frames
      } else if ((mt || '').includes('error')) {
        out.errors.push(JSON.stringify(msg).slice(0, 300))
        clearTimeout(timeout)
        finish()
      }
    }
  })
}

const browser = await chromium.launch()
const page = await browser.newPage()
const keytermsQS = KEYTERMS.map(k => `&keyterms=${encodeURIComponent(k)}`).join('')
const results = {}
for (const name of [...Object.keys(truth), 'silence']) {
  const wav = readFileSync(join(wavDir, `${name}.wav`))
  const pcm = wav.subarray(44) // strip WAV header — protocol wants raw PCM16
  const tMint0 = Date.now()
  const token = await mint(session.access_token)
  const mintMs = Date.now() - tMint0
  const r = await page.evaluate(RUN, { token, pcmB64: pcm.toString('base64'), keytermsQS })
  results[name] = { mintMs, ...r, truth: truth[name] ?? '' }
  const final = r.committed.join(' ').trim()
  console.log(`[${name}] mint=${mintMs}ms wsOpen=${r.wsOpenMs?.toFixed(0)}ms session=${r.sessionStartedMs?.toFixed(0)}ms firstPartial=${r.firstPartialMs?.toFixed(0)}ms commitToFinal=${r.commitToFinalMs?.toFixed(0)}ms partials=${r.partials.length} errors=${r.errors.length}`)
  console.log(`  final: "${final}"`)
  if (r.errors.length) console.log('  errors:', r.errors)
}
writeFileSync(join(wavDir, 'rt-results.json'), JSON.stringify(results, null, 2))
await browser.close()
