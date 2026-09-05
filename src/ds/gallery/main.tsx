import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Motion } from '../MotionProvider'
import '../ds.css'
import { Gallery } from './Gallery'

/* The gallery reads the same two boot switches the app writes (theme,
   density) so a specimen here is the specimen the app renders. */
const params = new URLSearchParams(location.search)
if (params.get('theme') === 'light') document.documentElement.dataset.theme = 'light'
if (params.get('density') === 'compact') document.documentElement.dataset.density = 'compact'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Motion>
      <Gallery />
    </Motion>
  </StrictMode>,
)
