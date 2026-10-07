import { useEffect, useState, type RefObject } from 'react'
import { useMotionLevel } from '../../ds/motionLevel'
/** Ambient motion stops outside the viewport and when the document is hidden. */
export function useVisibleMotion(ref: RefObject<Element | null>) {
  const level = useMotionLevel()
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [ref])
  return visible ? level : 'off'
}
