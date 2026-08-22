// A CLEAN draft window, in a fresh context with no DM thread peer co-mounted.
// measure.mjs opens the thread first (the shell's peer survives a hash change
// and eats the first click otherwise), so its `draft-open` row carries the
// thread's lime bubbles too. This is the honest draft-window-only before-count.
//   node draft-only.mjs
import { writeFileSync } from 'node:fs'
import { boot, openDraft } from './_open-draft.mjs'

const { browser, page } = await boot()
if (!(await openDraft(page))) { console.error('draft did not open'); await browser.close(); process.exit(1) }

const out = await page.evaluate(() => {
  const px = s => parseFloat(s) || 0
  const sel = el => {
    const t = el.tagName.toLowerCase()
    const c = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 4).join('.')
    return c ? `${t}.${c}` : t
  }
  const LIME = /184,\s*255,\s*102|90,\s*138,\s*0/
  const dw = document.querySelector('.dw')
  const scope = dw || document.querySelector('.wb')
  const all = [...scope.querySelectorAll('*')].filter(el => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    return r.width >= 4 && r.height >= 4 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'
  })
  const accents = []
  for (const el of all) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect()
    const hits = []
    if (/^rgb\(184, 255, 102\)$|^rgb\(90, 138, 0\)$/.test(cs.backgroundColor)) hits.push('bg-fill')
    else if (LIME.test(cs.backgroundColor)) hits.push('bg-tint')
    if (LIME.test(cs.color)) hits.push('text')
    if (LIME.test(cs.borderTopColor + cs.borderRightColor + cs.borderBottomColor + cs.borderLeftColor)) hits.push('border')
    if (LIME.test(cs.boxShadow)) hits.push('shadow')
    if (!hits.length) continue
    accents.push({ sel: sel(el), hits, text: (el.textContent || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height), area: Math.round(r.width * r.height) })
  }
  // the five/six/eight action-row buttons, exactly as computed
  const acts = [...document.querySelectorAll('.dw-acts button, .dw-acts .dw-key')].map(b => {
    const cs = getComputedStyle(b), r = b.getBoundingClientRect()
    return {
      label: (b.textContent || '').trim(), cls: sel(b),
      h: +r.height.toFixed(1), w: +r.width.toFixed(1), minH: cs.minHeight,
      pad: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      radius: cs.borderRadius, fs: cs.fontSize, fw: cs.fontWeight, ls: cs.letterSpacing, tt: cs.textTransform,
      bg: cs.backgroundColor, color: cs.color,
      border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
      disabled: b.disabled === true,
    }
  })
  const postNote = [...document.querySelectorAll('button')].filter(b => /Post note/.test(b.textContent || ''))
    .map(b => { const cs = getComputedStyle(b), r = b.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor, color: cs.color, cls: sel(b),
        parentW: Math.round(b.parentElement.getBoundingClientRect().width) } })
  return { scoped: !!dw, accents, acts, postNote, n: all.length }
})

writeFileSync(new URL('./out-draft-only.json', import.meta.url), JSON.stringify(out, null, 1))
await browser.close()
console.log('scoped to .dw:', out.scoped, '| elements:', out.n)
console.log('accent-weighted inside the draft window:', out.accents.length)
out.accents.sort((a, b) => b.area - a.area).forEach(a => console.log(`  ${String(a.area).padStart(7)}px2 [${a.hits}] ${a.sel} "${a.text}"`))
console.log('\naction row (' + out.acts.length + ' buttons):')
out.acts.forEach(a => console.log(`  ${a.label.padEnd(14)} ${a.cls.padEnd(22)} h=${a.h} minH=${a.minH} pad=${a.pad} r=${a.radius} fs=${a.fs} fw=${a.fw} bg=${a.bg} border=${a.border}`))
console.log('\nPost note:', JSON.stringify(out.postNote))
