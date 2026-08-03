// Phase 3 bench: TTS first-audible latency, both engines.
//
// ElevenLabs Flash v2.5 over the tts_websocket single-use-token WS
// (stream-input): measures WS open, and time from sending the text to the
// FIRST audio chunk arriving (the honest first-audible proxy — playback
// scheduling adds ~0).
//
// speechSynthesis: measured in the same Chromium — time from speak() to the
// utterance's onstart. Headless Chromium often has no voices; the script
// reports that state honestly instead of inventing a number.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'

const FN = 'https://bjbvqvzbzczjbatgmccb.supabase.co/functions/v1/inbox-rt-token'
const VOICE = 'onwK4e9ZLuTAKqWW03F9' // Daniel
const TEXT = 'The queue has eleven drafts in review and two approved without dates.'
const session = JSON.parse(readFileSync('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json', 'utf8'))

async function mint() {
  const r = await fetch(FN, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'tts' }),
  })
  if (!r.ok) throw new Error(`mint ${r.status}: ${await r.text()}`)
  return (await r.json()).token
}

const EL_RUN = async ({ token, voice, text }) => {
  const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voice}/stream-input`
    + `?model_id=eleven_flash_v2_5&output_format=pcm_22050&single_use_token=${token}`
  return await new Promise((resolve) => {
    const out = { wsOpenMs: null, firstAudioMs: null, chunks: 0, bytes: 0, error: null }
    const t0 = performance.now()
    let tSend = null
    const ws = new WebSocket(url)
    const timeout = setTimeout(() => { try { ws.close() } catch { /* done */ } resolve(out) }, 15000)
    ws.onopen = () => {
      out.wsOpenMs = performance.now() - t0
      tSend = performance.now()
      ws.send(JSON.stringify({ text: ' ' }))
      ws.send(JSON.stringify({ text: text + ' ' }))
      ws.send(JSON.stringify({ text: '' })) // EOS — flush and close
    }
    ws.onerror = () => { out.error = 'ws-error'; clearTimeout(timeout); resolve(out) }
    ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data) } catch { return }
      if (msg.audio) {
        if (out.firstAudioMs === null) out.firstAudioMs = performance.now() - tSend
        out.chunks += 1
        out.bytes += atob(msg.audio).length
      }
      if (msg.error) { out.error = JSON.stringify(msg).slice(0, 200) }
      if (msg.isFinal) { clearTimeout(timeout); try { ws.close() } catch { /* done */ } resolve(out) }
    }
    ws.onclose = () => { clearTimeout(timeout); resolve(out) }
  })
}

const SS_RUN = async ({ text }) => {
  const voices = speechSynthesis.getVoices()
  if (!voices.length) {
    await new Promise(r => { speechSynthesis.onvoiceschanged = r; setTimeout(r, 1500) })
  }
  const have = speechSynthesis.getVoices().length
  if (!have) return { voices: 0, firstAudibleMs: null }
  return await new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text)
    const t0 = performance.now()
    u.onstart = () => { const ms = performance.now() - t0; speechSynthesis.cancel(); resolve({ voices: have, firstAudibleMs: ms }) }
    u.onerror = (e) => resolve({ voices: have, firstAudibleMs: null, error: e.error })
    speechSynthesis.speak(u)
    setTimeout(() => resolve({ voices: have, firstAudibleMs: null, error: 'timeout' }), 8000)
  })
}

const browser = await chromium.launch()
const page = await browser.newPage()
for (let i = 1; i <= 3; i++) {
  const token = await mint()
  const r = await page.evaluate(EL_RUN, { token, voice: VOICE, text: TEXT })
  console.log(`[el-flash ${i}] wsOpen=${r.wsOpenMs?.toFixed(0)}ms firstAudio=${r.firstAudioMs?.toFixed(0)}ms chunks=${r.chunks} bytes=${r.bytes} err=${r.error}`)
}
const ss = await page.evaluate(SS_RUN, { text: TEXT })
console.log(`[speechSynthesis headless] voices=${ss.voices} firstAudible=${ss.firstAudibleMs?.toFixed(0) ?? 'n/a'}ms err=${ss.error ?? ''}`)
await browser.close()

// Headed pass for speechSynthesis (real system voices).
const browser2 = await chromium.launch({ headless: false })
const page2 = await browser2.newPage()
const ss2 = await page2.evaluate(SS_RUN, { text: TEXT })
console.log(`[speechSynthesis headed] voices=${ss2.voices} firstAudible=${ss2.firstAudibleMs?.toFixed(0) ?? 'n/a'}ms err=${ss2.error ?? ''}`)
await browser2.close()
