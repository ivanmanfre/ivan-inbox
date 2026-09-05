import { useEffect, useState } from 'react'
import { Button, Segmented } from '..'
import { Specimens } from './Specimens'

type Theme = 'dark' | 'light'
type Density = 'comfortable' | 'compact'

const params = new URLSearchParams(location.search)
const EMBED = params.get('view') === 'phone'

/**
 * The living gallery. Two columns: the page itself is the desktop column, and
 * a 390px iframe of the same page is the phone column — an iframe because the
 * phone tokens live behind a viewport media query, so a 390px div inside a
 * 1440px window would render desktop sizes and lie.
 */
export function Gallery() {
  const [theme, setTheme] = useState<Theme>((params.get('theme') as Theme) ?? 'dark')
  const [density, setDensity] = useState<Density>((params.get('density') as Density) ?? 'comfortable')

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') root.dataset.theme = 'light'
    else delete root.dataset.theme
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    if (density === 'compact') root.dataset.density = 'compact'
    else delete root.dataset.density
  }, [density])

  if (EMBED) {
    return <div className="gal-plate gal-phone-page"><Specimens /></div>
  }

  const src = `./index.html?view=phone&theme=${theme}`  // rewritten to a bare query by tools/inline-gallery.mjs for the file:// copy

  return (
    <div className="gal">
      <div className="gal-plate">
      <div className="gal-bar">
        <span className="gal-bar-title ds-t-title">Inbox design system</span>
        <span className="ds-t-meta">33 primitive modules · 48 named parts · one spring · one duration</span>
        <Segmented
          label="Theme"
          markerId="gal-theme"
          value={theme}
          onChange={(v) => setTheme(v as Theme)}
          options={[{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }]}
        />
        <Segmented
          label="Density"
          markerId="gal-density"
          value={density}
          onChange={(v) => setDensity(v as Density)}
          options={[{ id: 'comfortable', label: 'Comfortable' }, { id: 'compact', label: 'Compact' }]}
        />
        <Button variant="quiet" size="sm" icon="refresh" onClick={() => location.reload()}>Reload</Button>
      </div>

      <div className="gal-cols">
        <div className="gal-desktop">
          <Specimens compact={density === 'compact'} />
        </div>
        <aside className="gal-phone">
          <div className="gal-phone-cap gal-label">phone · 390 · body 16</div>
          <div className="gal-phone-frame">
            <iframe key={src} src={src} title="Phone column, 390 wide" />
          </div>
        </aside>
      </div>
      </div>
    </div>
  )
}
