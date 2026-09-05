import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
// `src/styles.css` is the stock shell's own sheet from Phase 3 W1 on
// (DECISIONS D4): it is loaded by the lazy module the `#exp/stock` branch in
// App.tsx mounts, so the live app never carries it. The design system brings
// its own reset (src/ds/ds.css §0).
import { ConfirmProvider } from './wb/chrome/ConfirmSheet'
import { PushLaterProvider } from './components/PushLaterSheet'

if (localStorage.getItem('inbox-theme') === 'light') {
  document.documentElement.dataset.theme = 'light'
}

// Density mode (polish/dens): comfortable is the default and the absence of
// the attribute IS comfortable, so only 'compact' is ever written. Same
// persistence pattern as inbox-theme above, one key, read once at boot.
if (localStorage.getItem('inbox-density') === 'compact') {
  document.documentElement.dataset.density = 'compact'
}

// Frame geometry (polish/frame): the pistachio border around the work area,
// the thing Ivan complained about ("there is a green background that is taking
// some space from us"). Three arms live in src/exp/v2c/wbcal.css §5 as token
// sets behind :root[data-frame='b'|'c']; arm A is the shipped geometry and
// carries no declarations, so the ABSENCE of the attribute is arm A and only
// 'b' and 'c' are ever written. Same persistence pattern as inbox-theme and
// inbox-density above: one key, read once at boot.
//
// B IS THE DEFAULT AS OF 2026-08-22, and the reason is that Ivan made the call
// and handed the pick back: "you choose".
//
// Judged off the rendered arms, not the description. A is 20px of pistachio on
// every side with a 40px corner radius, which reads as a mat the app is resting
// on, and that 40px radius on a full-window plate is the single most dated
// geometry left in the app. C cuts the frame to a hairline and the pistachio
// stops reading as a deliberate frame at all, which loses the identity that
// locked fork 1 says stays. B is 10px and 22px: the green is unmistakably still
// the frame, and it stops being furniture.
//
// He can still overrule it in Settings, and picking A is a real write now
// rather than the absence of one, so the three states stay distinguishable.
const frame = localStorage.getItem('inbox-frame')
document.documentElement.dataset.frame =
  frame === 'a' || frame === 'b' || frame === 'c' ? frame : 'b'

// A new worker skips waiting and claims this page immediately (src/sw.ts) -- but a
// CLAIMED page is still running the bundle it loaded with. Nothing re-fetches
// index.html, so the assets in memory stay whatever they were when the tab opened.
// Ivan keeps this open for days: the draft-card fix was live on the server and
// invisible in his tab for an hour (2026-08-20, "i still cant fucking scroll here").
// Reload once when control passes to a NEW worker. `hadController` is the guard --
// on a first-ever visit the controller also changes, and reloading a fresh install
// is a pointless flash.
if ('serviceWorker' in navigator) {
  // Reload when control passes to a NEW worker, but not on the first claim of a
  // first-ever visit, where reloading a page that just loaded is a pointless
  // flash.
  //
  // 🔴 THIS WAS A LATCH, AND THE LATCH NEVER OPENED. The old guard captured
  // `hadController` once, at script execution, which on a first visit is BEFORE
  // clientsClaim() has run and is therefore always false. It never got
  // recomputed, so that tab skipped the reload for its first claim AND for every
  // deploy afterwards, for as long as it stayed open. Measured: the worker
  // installed and activated on schedule and the page sat on the old bundle.
  //
  // Tracking it as state instead of a snapshot: the first handover is absorbed,
  // every later one reloads.
  let controlled = Boolean(navigator.serviceWorker.controller)
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return }
    if (reloading) return
    reloading = true
    window.location.reload()
  })

  // ASK WHETHER A NEWER BUILD EXISTS. Nothing else in this app ever did.
  //
  // Everything above assumes the browser has FOUND a new worker. It only looks
  // for one on a navigation inside the scope, or roughly once a day. This app
  // is hash-routed, so moving between lanes is not a navigation, and a tab left
  // open never triggers the check. Meanwhile precacheAndRoute answers the
  // reload from cache, so even Cmd+R returns the same bundle. The result is the
  // failure Ivan has now reported four times across five months, most recently
  // twice in one hour on 2026-08-21 ("dyde its still the same one wtf"): the
  // deploy is genuinely live, verified in a fresh browser, and his tab cannot
  // see it. The two fixes before this one made the update APPLY instantly; none
  // of them made the browser LOOK.
  //
  // update() is a conditional request. When the worker is unchanged the server
  // answers 304 and nothing happens, so a check a minute costs nothing and the
  // visible-only guard keeps background tabs quiet.
  navigator.serviceWorker.ready.then(reg => {
    const check = () => {
      if (document.visibilityState !== 'visible') return
      reg.update().catch(() => { /* offline, or the check raced a reload */ })
    }
    check()
    setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
  }).catch(() => { /* no registration yet; the next load registers one */ })
}

console.log('[inbox] build', __BUILD__)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      <PushLaterProvider>
        <App />
      </PushLaterProvider>
    </ConfirmProvider>
  </StrictMode>,
)
