// alertKinds.ts: client-side access to the one family-to-KIND map the push
// payload is built from (supabase/functions/_shared/alert-kinds.ts). A
// straight re-export, not a copy: this repo already crosses the src/ <->
// supabase/functions/ boundary with plain relative .ts imports elsewhere
// (supabase/functions/editorial-refresh/bridge.ts imports from
// src/lib/editorialCollectorBridge.ts, and src/lib/editorialCollectorBridge.
// test.ts imports back from supabase/functions/editorial-refresh/bridge.ts),
// so `tsc -b` and vite both already resolve this shape. A copy here would be
// a second definition of the same map that could silently drift from the one
// the push payload actually uses; re-exporting makes that impossible.
//
// The in-app feed (Feed.tsx / NotificationRow.tsx, owned by a different
// builder this run) can import `kindFor`, `presentPush` and `ALERT_KINDS`
// from here to draw the same glyph/label/tone a push already carries, mapping
// `tone` onto real `src/ds` tokens at the call site rather than in this file.
export * from '../../supabase/functions/_shared/alert-kinds.ts'
