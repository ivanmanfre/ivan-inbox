import { describe, expect, it } from 'vitest'
import { DRAWER_COL, drawerMode, isNarrowing, targetFor, tierOf } from './tier'

describe('tierOf', () => {
  it('boundaries 680 / 840 / 1000', () => {
    expect(tierOf(679)).toBe('t4'); expect(tierOf(680)).toBe('t3')
    expect(tierOf(839)).toBe('t3'); expect(tierOf(840)).toBe('t2')
    expect(tierOf(999)).toBe('t2'); expect(tierOf(1000)).toBe('t1')
  })
  it('16px hysteresis on the way up, none on the way down', () => {
    expect(tierOf(1010, 't2')).toBe('t2')
    expect(tierOf(1016, 't2')).toBe('t1')
    expect(tierOf(999, 't1')).toBe('t2')
    expect(tierOf(850, 't3')).toBe('t3')
    expect(tierOf(1200, 't4')).toBe('t1')
  })
})

describe('drawerMode', () => {
  it('docks at 1080 and leaves dock below 1064', () => {
    expect(drawerMode(1080)).toBe('dock'); expect(drawerMode(1079)).toBe('over')
    expect(drawerMode(1070, 'dock')).toBe('dock'); expect(drawerMode(1063, 'dock')).toBe('over')
    expect(drawerMode(1070, 'over')).toBe('over')
  })
})

describe('targetFor: the SPEC-shell-spacing §5.1 matrix', () => {
  const cells: [string, number, string, string, number, string][] = [
    ['A', 1144, 't1', 'dock', 746, 't3'],
    ['B', 1272, 't1', 'dock', 874, 't2'],
    ['C', 1092, 't1', 'dock', 694, 't3'],
    ['D', 964, 't2', 'over', 964, 't2'],
    ['E', 936, 't2', 'over', 936, 't2'],
    ['F', 808, 't3', 'over', 808, 't3'],
    ['G', 764, 't3', 'over', 764, 't3'],
  ]
  for (const [cell, c, closedTier, mode, main, openTier] of cells) {
    it(`cell ${cell} (C=${c})`, () => {
      expect(targetFor(c, { drawerOpen: false, shell: true }).tier).toBe(closedTier)
      const open = targetFor(c, { drawerOpen: true, shell: true })
      expect(open).toEqual({ mode, main, tier: openTier })
    })
  }
  it('shell off keeps today: always docked at the given width', () => {
    expect(targetFor(964, { drawerOpen: true, shell: false, drawerWidth: 390 })).toEqual({ mode: 'dock', main: 574, tier: 't4' })
    expect(DRAWER_COL).toBe(398)
  })
})

describe('isNarrowing', () => {
  it('a smaller tier or dock → over applies at the start', () => {
    expect(isNarrowing({ mode: 'dock', main: 874, tier: 't2' }, { mode: 'dock', main: 746, tier: 't3' })).toBe(true)
    expect(isNarrowing({ mode: 'dock', main: 694, tier: 't3' }, { mode: 'over', main: 964, tier: 't2' })).toBe(true)
    expect(isNarrowing({ mode: 'dock', main: 746, tier: 't3' }, { mode: 'dock', main: 874, tier: 't2' })).toBe(false)
  })
})
