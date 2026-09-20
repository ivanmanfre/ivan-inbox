// @vitest-environment jsdom
// The plan's own fixture test (plan line 293-307), included verbatim below
// the one line every test on this surface needs: `InputsPanel` pulls in
// `Failed`/`CalmEmpty` from `../parts`, which transitively imports
// `lib/supabase` (via `lib/leadMagnets`/`lib/inbox`), and that module throws
// at load with no VITE_SUPABASE_URL in this test environment — the same
// reason proposals.test.ts and every other lib test here mock it first.
import { it, expect, vi } from 'vitest'
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
// `toBeVisible` is a jest-dom matcher; this file-scoped import registers it
// on vitest's `expect` without touching the shared `src/test-setup.ts`.
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { InputsPanel } from './InputsPanel'
it('shows an unavailable study without claiming there are no market posts', () => {
  render(<InputsPanel data={{ clientId: 'arch', state: 'partial',
    storedPosts: 439, eligiblePosts: null, studyState: 'missing',
    gaps: ['Author baselines have not been reviewed.'] }} />)
  expect(screen.getByText(/439/)).toBeVisible()
  expect(screen.getByText(/baselines have not been reviewed/i)).toBeVisible()
  expect(screen.queryByText(/ready to recommend/i)).toBeNull()
})
