// Review grid masonry (Ivan 2026-10-31: "inbox is still fucked with different spacings").
// The card grid is a CSS grid, so every row was as tall as its tallest card and shorter cards
// left holes under them. With this on, the grid runs on 1px rows and each card spans exactly
// its own height + the 12px gap: same left-to-right order, every card 12px under the one above.
// Only while the list is a multi-column grid; a one-column list (phone, narrow, Details open)
// is left alone.
export const MASON_UNIT = 1
export const MASON_GAP = 12

function multiColumn(el: HTMLElement): boolean {
  const cs = getComputedStyle(el)
  return cs.display === 'grid' && cs.gridTemplateColumns.trim().split(/\s+/).length > 1
}

export function masonry(el: HTMLElement): () => void {
  const kids = () => Array.from(el.children) as HTMLElement[]
  const place = (c: HTMLElement) => {
    const h = c.getBoundingClientRect().height
    c.style.gridRowEnd = `span ${Math.max(1, Math.ceil((h + MASON_GAP) / MASON_UNIT))}`
  }
  const layout = () => {
    if (multiColumn(el)) { el.classList.add('cv2-mason'); kids().forEach(place) }
    else { el.classList.remove('cv2-mason'); kids().forEach(c => { c.style.gridRowEnd = '' }) }
  }
  const cards = new ResizeObserver(entries => {
    if (!el.classList.contains('cv2-mason')) return
    for (const e of entries) place(e.target as HTMLElement)
  })
  const box = new ResizeObserver(layout)
  const watch = () => { kids().forEach(c => cards.observe(c)); layout() }
  const mo = new MutationObserver(watch)
  mo.observe(el, { childList: true })
  box.observe(el)
  watch()
  return () => {
    mo.disconnect(); cards.disconnect(); box.disconnect()
    el.classList.remove('cv2-mason'); kids().forEach(c => { c.style.gridRowEnd = '' })
  }
}
