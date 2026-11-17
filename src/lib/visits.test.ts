import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVisitLogger, surfaceOf } from './visits'

describe('visit logger', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('logs after three seconds on a page', () => { const s = vi.fn(); const l = createVisitLogger(s); l.seen('dms', null, 'brief'); vi.advanceTimersByTime(3000); expect(s).toHaveBeenCalledWith('dms', null, 'brief') })
  it('does not log a pass-through', () => { const s = vi.fn(); const l = createVisitLogger(s); l.seen('home', null, 'brief'); vi.advanceTimersByTime(1000); l.seen('dms', null, 'brief'); vi.advanceTimersByTime(3000); expect(s).toHaveBeenCalledTimes(1); expect(s).toHaveBeenCalledWith('dms', null, 'brief') })
  it('logs a repeated page once', () => { const s = vi.fn(); const l = createVisitLogger(s); l.seen('dms', null, 'web'); vi.advanceTimersByTime(3000); l.seen('dms', null, 'web'); vi.advanceTimersByTime(3000); expect(s).toHaveBeenCalledTimes(1) })
  it('logs the same page again after another page was logged', () => { const s = vi.fn(); const l = createVisitLogger(s); l.seen('dms', null, 'web'); vi.advanceTimersByTime(3000); l.seen('home', null, 'web'); vi.advanceTimersByTime(3000); l.seen('dms', null, 'web'); vi.advanceTimersByTime(3000); expect(s).toHaveBeenCalledTimes(3) })
  it('does not log after stop', () => { const s = vi.fn(); const l = createVisitLogger(s); l.seen('dms', null, 'web'); vi.advanceTimersByTime(1000); l.stop(); vi.advanceTimersByTime(5000); expect(s).not.toHaveBeenCalled() })
  it('swallows a send that throws', () => { const l = createVisitLogger(() => { throw new Error('boom') }); l.seen('dms', null, 'web'); expect(() => vi.advanceTimersByTime(3000)).not.toThrow() })
  it('names the surface', () => { expect(surfaceOf('phone', false)).toBe('phone'); expect(surfaceOf('desktop', true)).toBe('brief'); expect(surfaceOf('desktop', false)).toBe('web') })
})
