import { useRef } from 'react'
import { useKeyboardInset } from '../../desk/useKeyboardInset'
import type { PlaceProps } from '../../places'
import ClaudeDrawer from '../Drawer'

export function ClaudeWorkspace({ layout, route }: Pick<PlaceProps, 'layout' | 'route'>) {
  const panel = useRef<HTMLDivElement>(null)
  useKeyboardInset(panel, layout === 'phone')
  return (
    <div className="dcl-page dcl-wsp" ref={panel}>
      <ClaudeDrawer layout={layout} route={route} onClose={() => {}} variant="page" />
    </div>
  )
}
