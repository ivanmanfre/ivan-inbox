import type { ReactNode } from 'react'

// What a candidate slot renders before its builder lands. Deliberately plain
// so a screenshot cannot be mistaken for a design.
export function Placeholder({ id, part, workSurface, windows }: {
  id: string; part: string; workSurface?: ReactNode; windows?: ReactNode
}) {
  return (
    <div className="app wb">
      <div className="wb-plate">
        <div style={{ padding: 16, font: '400 16px/1.5 system-ui', color: '#C7C7C7' }}>
          Candidate {id}: {part} not built yet.
        </div>
        {workSurface}
      </div>
      {windows}
    </div>
  )
}
