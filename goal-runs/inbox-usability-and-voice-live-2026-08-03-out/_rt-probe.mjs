import { chromium } from 'playwright'
const XI = process.env.XI_KEY
// fresh single-use token (previous may be consumed)
const tr = await fetch('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', { method: 'POST', headers: { 'xi-api-key': XI } })
const { token } = await tr.json()
console.log('token minted:', token.slice(0, 12) + '…')
const browser = await chromium.launch()
const page = await browser.newPage()
const out = await page.evaluate(async ([token]) => {
  const log = []
  const t0 = performance.now()
  const kt = ['Supabase','n8n','UniPile','Smartlead','PostgREST','ClickUp','RLS','OAuth'].map(k => 'keyterms=' + encodeURIComponent(k)).join('&')
  const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?token=${encodeURIComponent(token)}&model_id=scribe_v2_realtime&audio_format=pcm_16000&${kt}`
  const ws = new WebSocket(url)
  await new Promise((res, rej) => {
    ws.onopen = () => { log.push(['open', Math.round(performance.now() - t0)]); res() }
    ws.onerror = e => { log.push(['error-connect']); rej(new Error('ws error')) }
    setTimeout(() => rej(new Error('connect timeout')), 10000)
  }).catch(e => log.push(['connfail', String(e)]))
  if (ws.readyState !== 1) return log
  ws.onmessage = m => { log.push(['msg', Math.round(performance.now() - t0), String(m.data).slice(0, 220)]) }
  // send 2s of silence PCM16 @16k in 250ms chunks, base64
  const chunk = new Int16Array(4000) // 250ms
  const b64 = btoa(String.fromCharCode(...new Uint8Array(chunk.buffer).subarray(0, 8000)))
  for (let i = 0; i < 8; i++) {
    ws.send(JSON.stringify({ type: 'audio', audio_chunk: b64 }))
    await new Promise(r => setTimeout(r, 250))
  }
  await new Promise(r => setTimeout(r, 2500))
  ws.close()
  return log
}, [token])
console.log(JSON.stringify(out, null, 1))
await browser.close()
