// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import { CopySwitch } from './CopySwitch'
import { copyVersionsOf, wordCount } from '../../../lib/copyVersions'
const lib = vi.hoisted(() => ({ readCopyVersions: vi.fn(), switchDraftCopy: vi.fn() }))
vi.mock('../../../lib/copyVersions', async orig => ({ ...(await orig<typeof import('../../../lib/copyVersions')>()), ...lib }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

const SHORT = 'Poland is a Civilization of its own.\n\nStand with Poland.'
const LONG = `${SHORT}\n\nA paragraph that was added about what the day means.`
const d = { id: 'd1', updated_at: '2026-11-14T08:00:00Z', source_kind: 'x_tracked_outlier' }

it('reads both versions and the current side off the row', () => {
  expect(copyVersionsOf(LONG, {}, { short_copy: SHORT })).toEqual({ now: 'long', long: LONG, short: SHORT })
  expect(copyVersionsOf(SHORT, {}, { short_copy: SHORT, long_copy: LONG })).toEqual({ now: 'short', long: LONG, short: SHORT })
  // an edit on either side keeps its side: the switch's own stamp says which one the body is
  expect(copyVersionsOf(`${SHORT} Edited.`, { copy_choice: 'short' }, { short_copy: SHORT, long_copy: LONG })).toEqual({ now: 'short', long: LONG, short: `${SHORT} Edited.` })
  expect(copyVersionsOf(`${LONG} Edited.`, { copy_choice: 'long' }, { short_copy: SHORT, long_copy: LONG })).toEqual({ now: 'long', long: `${LONG} Edited.`, short: SHORT })
  // nothing to switch between
  expect(copyVersionsOf(LONG, {}, {})).toBeNull()
  expect(copyVersionsOf(LONG, {}, { short_copy: null })).toBeNull()
  expect(copyVersionsOf(SHORT, {}, { short_copy: SHORT })).toBeNull()
  expect(copyVersionsOf(LONG, {}, 'not an object')).toBeNull()
  expect(copyVersionsOf('', {}, { short_copy: SHORT })).toBeNull()
  expect(wordCount(SHORT)).toBe(10)
})

it('renders nothing on a draft that is not a copied X post, and reads nothing', () => {
  const { container } = renderInFrame(<CopySwitch d={{ ...d, source_kind: 'idea' }} body={LONG} onSaved={() => {}} onChanged={() => {}} />)
  expect(container.querySelector('.cv2-copy')).toBeNull()
  expect(lib.readCopyVersions).not.toHaveBeenCalled()
})

it('renders nothing when the draft holds one version only', async () => {
  lib.readCopyVersions.mockResolvedValue(null)
  const { container } = renderInFrame(<CopySwitch d={d} body={SHORT} onSaved={() => {}} onChanged={() => {}} />)
  await waitFor(() => expect(lib.readCopyVersions).toHaveBeenCalledWith('d1'))
  expect(container.querySelector('.cv2-copy')).toBeNull()
})

it('marks the current version, shows both word counts, and writes the other one once', async () => {
  lib.readCopyVersions.mockResolvedValue({ now: 'long', long: LONG, short: SHORT })
  lib.switchDraftCopy.mockResolvedValue(SHORT)
  const saved = vi.fn(), changed = vi.fn()
  renderInFrame(<CopySwitch d={d} body={LONG} onSaved={saved} onChanged={changed} />)
  const long = await screen.findByRole('button', { name: `Long version, ${wordCount(LONG)} words` })
  const short = screen.getByRole('button', { name: 'Short version, 10 words' })
  expect(long.getAttribute('aria-pressed')).toBe('true')
  expect(short.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(long)
  expect(lib.switchDraftCopy).not.toHaveBeenCalled()
  fireEvent.click(short)
  await waitFor(() => expect(changed).toHaveBeenCalled())
  expect(lib.switchDraftCopy).toHaveBeenCalledTimes(1)
  expect(lib.switchDraftCopy).toHaveBeenCalledWith('d1', 'short', LONG)
  expect(saved).toHaveBeenCalledWith(SHORT)
  expect(screen.getByRole('button', { name: 'Short version, 10 words' }).getAttribute('aria-pressed')).toBe('true')
})

it('keeps the stored version when the save is refused', async () => {
  lib.readCopyVersions.mockResolvedValue({ now: 'long', long: LONG, short: SHORT })
  lib.switchDraftCopy.mockRejectedValue(new Error('This post is already published. Nothing changed.'))
  const saved = vi.fn()
  renderInFrame(<CopySwitch d={d} body={LONG} onSaved={saved} onChanged={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Short version, 10 words' }))
  await screen.findByText('This post is already published. Nothing changed.')
  expect(saved).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: `Long version, ${wordCount(LONG)} words` }).getAttribute('aria-pressed')).toBe('true')
})

it('is off while the row is busy or an edit is open', async () => {
  lib.readCopyVersions.mockResolvedValue({ now: 'long', long: LONG, short: SHORT })
  renderInFrame(<CopySwitch d={d} body={LONG} onSaved={() => {}} onChanged={() => {}} disabled />)
  const short = await screen.findByRole('button', { name: 'Short version, 10 words' })
  expect((short as HTMLButtonElement).disabled).toBe(true)
})
