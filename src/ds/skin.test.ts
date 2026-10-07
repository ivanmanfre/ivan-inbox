// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BRIEF_DESKTOP, PHONE, WEB_DESKTOP, SECTIONS, SKIN_KEY,
  __resetSkinForTests, applySkin, parseSkin, resolveSkin, skinAttr, skinHas, subscribeSkin, type Section,
} from './skin'

const base = { search: '', session: null, local: null, briefNative: false, layout: 'desktop' as const }
const names = (s: Set<Section>) => [...s].sort()

describe('parseSkin', () => {
  it('reads off, all and a list', () => {
    expect(parseSkin('off')!.size).toBe(0)
    expect(parseSkin('brief:all')!.size).toBe(SECTIONS.length)
    expect(parseSkin('brief')!.size).toBe(SECTIONS.length)
    expect(names(parseSkin('brief:dms,home')!)).toEqual(['dms', 'home', 'motion', 'shell', 'tokens', 'type'])
  })
  it('a layout section implies the foundation; a content sub-tab implies content', () => {
    expect(names(parseSkin('brief:content.calendar')!)).toEqual(['content', 'content.calendar', 'motion', 'shell', 'tokens', 'type'])
    expect(names(parseSkin('tokens')!)).toEqual(['motion', 'shell', 'tokens', 'type'])
  })
  it('ignores junk', () => {
    expect(parseSkin(null)).toBeNull()
    expect(parseSkin('')).toBeNull()
    expect(parseSkin('brief:nope')).toBeNull()
  })
})

describe('resolveSkin', () => {
  it('defaults: Brief desktop, web desktop, phone (all empty today)', () => {
    expect(BRIEF_DESKTOP).toEqual([]); expect(WEB_DESKTOP).toEqual([]); expect(PHONE).toEqual([])
    expect(resolveSkin({ ...base, briefNative: true }).set.size).toBe(0)
    expect(resolveSkin({ ...base, layout: 'phone' }).from).toBe('default')
  })
  it('?skin=off wins over a stored list', () => {
    const r = resolveSkin({ ...base, search: '?skin=off', session: 'brief:all', local: 'brief:all' })
    expect(r.set.size).toBe(0); expect(r.from).toBe('url')
  })
  it('?skin=brief:dms implies tokens/type/motion/shell', () => {
    expect(names(resolveSkin({ ...base, search: '?skin=brief:dms' }).set)).toEqual(['dms', 'motion', 'shell', 'tokens', 'type'])
  })
  it('session beats local', () => {
    const r = resolveSkin({ ...base, session: 'brief:home', local: 'off' })
    expect(r.from).toBe('session'); expect(r.set.has('home')).toBe(true)
  })
  it('local beats defaults', () => {
    expect(resolveSkin({ ...base, local: 'off' }).from).toBe('local')
    expect(resolveSkin({ ...base, local: 'brief:shell' }).set.has('shell')).toBe(true)
  })
  it('skinAttr is stable', () => {
    expect(skinAttr(parseSkin('brief:shell')!)).toBe('tokens type motion shell')
  })
})

describe('applySkin (the live store)', () => {
  beforeEach(() => {
    __resetSkinForTests()
    sessionStorage.clear(); localStorage.clear()
    document.documentElement.removeAttribute('data-skin'); document.documentElement.removeAttribute('data-skin-on')
    history.replaceState(null, '', '/')
  })
  afterEach(() => { __resetSkinForTests(); history.replaceState(null, '', '/') })

  it('no flag writes no skin attribute, only the layout', () => {
    applySkin('desktop')
    expect(document.documentElement.dataset.skin).toBeUndefined()
    expect(document.documentElement.dataset.skinOn).toBeUndefined()
    expect(document.documentElement.dataset.layout).toBe('desktop')
  })
  it('a URL override is copied to the session, leaves the address, and survives hash navigation', () => {
    history.replaceState(null, '', '/?skin=brief:shell#exp/d/dms')
    applySkin('desktop')
    expect(document.documentElement.dataset.skinOn).toBe('tokens type motion shell')
    expect(document.documentElement.dataset.skin).toBe('brief')
    expect(sessionStorage.getItem(SKIN_KEY)).toBe('brief:shell')
    expect(location.search).toBe('')
    expect(location.hash).toBe('#exp/d/dms')
    location.hash = '#exp/d/home'
    applySkin('desktop')
    expect(skinHas('shell')).toBe(true)
  })
  it('a layout flip re-resolves and notifies only on change', () => {
    localStorage.setItem(SKIN_KEY, 'brief:tokens')
    let n = 0
    const off = subscribeSkin(() => { n++ })
    applySkin('desktop'); applySkin('phone')
    expect(document.documentElement.dataset.layout).toBe('phone')
    expect(n).toBe(1)
    off()
  })
  it('theme-color follows the tokens section and restores', () => {
    const meta = document.createElement('meta'); meta.name = 'theme-color'; meta.content = '#000000'
    document.head.appendChild(meta)
    sessionStorage.setItem(SKIN_KEY, 'brief:tokens'); applySkin('phone')
    expect(meta.content).toBe('#f6f8f3')
    sessionStorage.setItem(SKIN_KEY, 'off'); applySkin('phone')
    expect(meta.content).toBe('#000000')
    meta.remove()
  })
})
