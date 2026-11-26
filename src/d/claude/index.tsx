import { lazy, Suspense } from 'react'
import type { PlaceProps } from '../places'
import { ClaudeWorkspace } from './v4/ClaudeWorkspace'

const CloudPage = lazy(() => import('../cloud'))

export default function ClaudePage({ layout, route, navigate }: PlaceProps) {
  if (route.sub === 'cloud') {
    return <Suspense fallback={null}><CloudPage layout={layout} query={route.query} navigate={navigate} /></Suspense>
  }
  return <ClaudeWorkspace layout={layout} route={route} />
}
