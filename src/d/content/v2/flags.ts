import { useSkin } from '../../../ds/useSkin'

// BRIEF 4 CONTENT FLAGS (SPEC-content §2.0, BUILD_PLAN decision 1). One skin
// flag for the frame (`content`: tab counts, the sub-nav row) and one per
// sub-tab. Off = today's tree, mounted unchanged. The keys live in src/ds/skin.ts
// (`?skin=brief:content.review`, sessionStorage / localStorage 'ds-skin');
// a sub-tab key implies `content`. Every hook here runs unconditionally.
export type ContentFlags = { frame: boolean; brain: boolean; calendar: boolean; ideas: boolean; review: boolean; lms: boolean }

export function useContentFlags(): ContentFlags {
  const frame = useSkin('content')
  const brain = useSkin('content.brain')
  const calendar = useSkin('content.calendar')
  const ideas = useSkin('content.ideas')
  const review = useSkin('content.review')
  const lms = useSkin('content.lms')
  return { frame, brain, calendar, ideas, review, lms }
}
