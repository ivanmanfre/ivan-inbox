import { describe, expect, it } from 'vitest'
import * as PB from './planBrain'
import { readLine, qaLine, factsLine, angleLine, dayWhy, flagsFor, ruleRow, warningOf, quoteFor, weekDays, answerOf, plainWhy, resultLine, mixLine, weekWhy, itemsOf, upcoming, lateRun, readsSummary, viewsLine, topicWord, traitLine, firstLineChecks, dimsOf, timeLabel, tzOf, reasonFor, type PlanItem, type Acct } from './planBrain'
import type { BrainStrip, PlanRead } from '../../../lib/contentPlan'
import ivanFx from './fixtures/ivan.json'
import riseFx from './fixtures/risedtc.json'
import archFx from './fixtures/arch.json'

const base = (over: Partial<PlanItem> = {}): PlanItem => ({ key: 'k', kind: 'post', week: '2026-10-12', which: 'this', day: '2026-10-14', suggested: false, at: '2026-10-14T14:00:00Z', title: 'T', st: 'review', draftId: 'd', slotId: null, ideaRef: null, ideaSource: null, format: 'text', brain: null, evidence: [], whyNow: null, ...over })
const brain = (b: object) => ({ draft_id: 'd', words: 120, edited: false, thumb: null, body_head: null, first_line: null, has_link: false, flags: { lm: false, boosted: false, founder: false, carousel: false, weekend: false, failed: false, low_score: false, fact_fail: false }, qa: null, facts: null, angle: null, trait: null, read: null, brief: null, quote: null, quote_pending: false, photo: null, replaced: null, result: null, time_set_by: null, ...b }) as PlanItem['brain']
const noFlags = { lm: false, boosted: false, founder: false, carousel: false, weekend: false, failed: false, low_score: false, fact_fail: false }

describe('readLine', () => {
  it('good sign with detail and proof words', () => {
    const r = readLine(base({ brain: brain({ read: { dim: 'proof_type', val: 'named_example', rate: 0.068, base: 0.045, n: 398, lo: null, hi: null, proven: true, small: false } }) }), 'risedtc')!
    expect(r.sign).toBe('Good sign')
    expect(r.text).toBe("Posts with a named example go viral 1.5x more often in Rise's niche.")
    expect(r.detail).toBe('6.8% of these posts went viral, vs 4.5% of all posts. Based on 398 posts.')
    expect(r.rel).toBe('Proven on recent posts')
  })
  it('bad sign, a bit less often, not proven', () => {
    const r = readLine(base({ brain: brain({ read: { dim: 'proof_type', val: 'numbers_result', rate: 0.038, base: 0.045, n: 902, lo: null, hi: null, proven: false, small: false } }) }), 'risedtc')!
    expect(r.sign).toBe('Bad sign'); expect(r.text).toBe("Posts with a result in numbers go viral a bit less often in Rise's niche."); expect(r.rel).toBe('Not proven yet')
  })
  it('half as often under .6', () => {
    expect(readLine(base({ brain: brain({ read: { dim: 'angle', val: 'news', rate: 0.02, base: 0.045, n: 300, lo: null, hi: null, proven: true, small: true } }) }), 'arch')!.text).toBe("News posts go viral about half as often in Arch's niche.")
  })
  it('neutral within 15 percent, no scale', () => {
    const r = readLine(base({ brain: brain({ read: { dim: 'stakes', val: 'time_effort', rate: 0.053, base: 0.053, n: 571, lo: null, hi: null, proven: false, small: false } }) }), 'ivan')!
    expect(r.sign).toBe('Neutral'); expect(r.flat).toBe(true); expect(r.text).toBe('Posts about time or effort do about average in your niche.')
  })
  it('few examples', () => {
    expect(readLine(base({ brain: brain({ read: { dim: 'angle', val: 'story', rate: 0.07, base: 0.05, n: 120, lo: null, hi: null, proven: true, small: true } }) }), 'arch')!.rel).toBe('Proven on recent posts, but few examples')
  })
  it('no read', () => { expect(readLine(base(), 'ivan')).toBeNull() })
  it('a zero base gives no read instead of Infinity', () => {
    expect(readLine(base({ brain: brain({ read: { dim: 'angle', val: 'story', rate: 0.07, base: 0, n: 120, lo: null, hi: null, proven: true, small: true } }) }), 'arch')).toBeNull()
  })
})

describe('qaLine / factsLine', () => {
  it('recovered', () => expect(qaLine(base({ brain: brain({ qa: { outcome: 'recovered', first: 60, final: 63, max: 80, pass_line: 59, rewrites: 1, approved_anyway: false, dims: null, weakest: null } }) }))).toBe('Passed: 63/80 (needs 59). It was rewritten once.'))
  it('low approved anyway', () => expect(qaLine(base({ st: 'scheduled', brain: brain({ qa: { outcome: 'low', first: 55, final: 57, max: 80, pass_line: 59, rewrites: 1, approved_anyway: true, dims: null, weakest: null } }) }))).toBe('Low score: 57/80, even after a rewrite. Approved anyway.'))
  it('failed', () => expect(qaLine(base({ st: 'failed' }))).toBe('Failed twice. The planner is picking a new topic for this slot.'))
  it('passed first time', () => expect(qaLine(base({ brain: brain({ qa: { outcome: 'passed', first: 66, final: 66, max: 80, pass_line: 59, rewrites: 0, approved_anyway: false, dims: null, weakest: null } }) }))).toBe('Passed: 66/80 (needs 59).'))
  it('hand checked', () => expect(qaLine(base({ brain: brain({ qa: { outcome: 'hand', first: null, final: null, max: 80, pass_line: null, rewrites: 0, approved_anyway: false, dims: null, weakest: null } }) }))).toBe('Checked by hand.'))
  it('uses the real scale: /120 and /90', () => {
    expect(qaLine(base({ brain: brain({ qa: { outcome: 'recovered', first: 71, final: 93, max: 120, pass_line: 84, rewrites: 3, approved_anyway: false, dims: null, weakest: null } }) }))).toBe('Passed: 93/120 (needs 84). It was rewritten 3 times.')
    expect(qaLine(base({ brain: brain({ qa: { outcome: 'recovered', first: 59, final: 73, max: 90, pass_line: null, rewrites: 1, approved_anyway: false, dims: null, weakest: null } }) }))).toBe('Passed: 73/90. It was rewritten once.')
  })
  it('max null shows just the number', () => expect(qaLine(base({ brain: brain({ qa: { outcome: 'recovered', first: 60, final: 63, max: null, pass_line: 59, rewrites: 1, approved_anyway: false, dims: null, weakest: null } }) }))).toBe('Passed: 63 (needs 59). It was rewritten once.'))
  it('no score saved', () => {
    expect(qaLine(base({ brain: brain({ qa: { outcome: 'passed', first: null, final: null, max: 80, pass_line: null, rewrites: 0, approved_anyway: false, dims: null, weakest: null } }) }))).toBe('Passed.')
    expect(qaLine(base({ brain: brain({ qa: { outcome: 'recovered', first: 66, final: null, max: 120, pass_line: null, rewrites: 1, approved_anyway: false, dims: null, weakest: null } }) }))).toBe('Passed. It was rewritten once.')
  })
  it('low, still waiting, no approval words', () => expect(qaLine(base({ brain: brain({ qa: { outcome: 'low', first: 52, final: 55, max: 80, pass_line: null, rewrites: 1, approved_anyway: false, dims: null, weakest: null } }) }))).toBe('Low score: 55/80, even after a rewrite.'))
  it('no qa', () => expect(qaLine(base())).toBeNull())
  it('facts all match / some missing', () => {
    expect(factsLine(base({ brain: brain({ facts: { pass: true, failed: 0, total: 8 } }) }))).toBe('All 8 facts match the call.')
    expect(factsLine(base({ brain: brain({ facts: { pass: false, failed: 2, total: 8 } }) }))).toBe('2 of 8 facts not found in the call. It will be held at publish until fixed.')
  })
  it('facts with no total (today)', () => {
    expect(factsLine(base({ brain: brain({ facts: { pass: true, failed: 0, total: null } }) }))).toBe('Facts match the call.')
    expect(factsLine(base({ brain: brain({ facts: { pass: false, failed: 3, total: null } }) }))).toBe('Fact check against the call: failed. It will be held at publish until fixed.')
    expect(factsLine(base())).toBeNull()
  })
})

describe('angleLine', () => {
  it('structure + opener', () => expect(angleLine(base({ brain: brain({ angle: { structure: 'TEARDOWN (pillar)', opener: 'specific_receipt' } }) }))).toBe('Written as a teardown. Opens with proof.'))
  it('opener only, unknown opener skipped', () => {
    expect(angleLine(base({ brain: brain({ angle: { structure: null, opener: 'data_led' } }) }))).toBe('Opens with a number.')
    expect(angleLine(base({ brain: brain({ angle: { structure: 'MIRROR', opener: 'universal_aspirational' } }) }))).toBe('Written as a copy of a past winner.')
  })
  it('none', () => expect(angleLine(base())).toBeNull())
})

describe('traitLine / firstLineChecks / dimsOf', () => {
  it('trait words in plain English per account', () => {
    expect(traitLine(base({ brain: brain({ trait: 'reputation status at stake' }) }), 'risedtc')).toBe("Top posts in Rise's niche have this too: a reputation at risk.")
    expect(traitLine(base({ brain: brain({ trait: 'a hook that opens with a number' }) }), 'ivan')).toBe('Top posts in your niche have this too: opening with a number.')
    expect(traitLine(base({ evidence: [{ type: 'brain_rule', label: 'Shares traits with top niche posts: personal angle, career at stake' }] }), 'arch')).toBe("Top posts in Arch's niche have this too: a personal angle, a career at risk.")
    expect(traitLine(base(), 'ivan')).toBeNull()
  })
  it('first line checks', () => {
    expect(firstLineChecks(base({ brain: brain({ first_line: 'I think I missed the boat on selling.', words: 90 }) }))).toEqual(['Short first line: posts like this do 9% better.', 'Under 100 words: 12% fewer views.'])
    expect(firstLineChecks(base({ brain: brain({ first_line: 'How do you sell a $1,000+ air purifier against much cheaper ones?', words: 200 }) }))).toEqual(['A question in the first line: 12% fewer views.'])
    expect(firstLineChecks(base({ brain: brain({ first_line: null, words: null }) }))).toEqual([])
    expect(PB.FIRST_LINE_SHORT).toBe('Short first line: posts like this do 9% better.')
  })
  it('dims in plain words with the weakest marked', () => {
    const d = dimsOf(base({ brain: brain({ qa: { outcome: 'passed', first: 63, final: 63, max: 80, pass_line: 59, rewrites: 0, approved_anyway: false, dims: { AI_TELLS: 9, VOICE: 8, ECONOMY: 6, HOOK: 7 }, weakest: 'ECONOMY' } }) }))
    expect(d).toEqual([{ key: 'VOICE', label: 'Voice', v: 8, low: false }, { key: 'ECONOMY', label: 'Short', v: 6, low: true }, { key: 'HOOK', label: 'Hook', v: 7, low: false }, { key: 'AI_TELLS', label: 'Sounds human', v: 9, low: false }])
    expect(dimsOf(base())).toEqual([])
  })
})

describe('dayWhy / timeLabel', () => {
  const strip = { rules: [{ rule_id: 'R11-weekend-risedtc', name: 'No weekend posts', metric: 'views', gain: 19, lo: 10.1, hi: 27, status: 'shadow', unclear: false, held_latest: null, your_rule: false, enforcer: 'scheduler', creators: 46 }] } as never
  it('suggested slot', () => expect(dayWhy(base({ kind: 'planned', suggested: true, day: null }), 'risedtc', strip, { name: 'America/Los_Angeles', label: 'PT' })).toBe('No day yet. It gets the first free weekday of its week when you approve it.'))
  it('weekday with the testing rule', () => expect(dayWhy(base({ day: '2026-10-14', at: '2026-10-14T14:00:00Z' }), 'risedtc', strip, { name: 'America/Los_Angeles', label: 'PT' })).toBe('Wed 14 Oct, 07:00 PT. A weekday: weekend posts get 19% fewer views for Rise creators (still testing).'))
  it('no strip: just the day', () => expect(dayWhy(base({ day: '2026-10-14', at: '2026-10-14T08:45:00Z' }), 'ivan', null, { name: 'Europe/Warsaw', label: 'Warsaw' })).toBe('Wed 14 Oct, 10:45 Warsaw.'))
  it('suggested slot with a day uses the same line', () => expect(dayWhy(base({ kind: 'planned', suggested: true, day: '2026-10-26', at: null }), 'ivan', null, { name: 'Europe/Warsaw', label: 'Warsaw' })).toBe('No day yet. It gets the first free weekday of its week when you approve it.'))
  it('weekend post for a client with a clear rule says the effect', () => expect(dayWhy(base({ day: '2026-10-17', at: '2026-10-17T14:00:00Z' }), 'risedtc', strip, { name: 'America/Los_Angeles', label: 'PT' })).toBe('Sat 17 Oct, 07:00 PT. A weekend day: weekend posts get 19% fewer views for Rise creators (still testing).'))
  it('no effect claimed when the gain is not positive or the range crosses zero', () => {
    const tz = { name: 'America/Los_Angeles', label: 'PT' }
    const neg = { rules: [{ rule_id: 'R11-weekend-risedtc', name: 'No weekend posts', metric: 'views', gain: -4, lo: -9, hi: -1, status: 'shadow', unclear: false, held_latest: null, your_rule: false, enforcer: 'scheduler', creators: 46 }] } as never
    const cross = { rules: [{ rule_id: 'R11-weekend-risedtc', name: 'No weekend posts', metric: 'views', gain: 6, lo: -3, hi: 14, status: 'shadow', unclear: false, held_latest: null, your_rule: false, enforcer: 'scheduler', creators: 46 }] } as never
    expect(dayWhy(base({ day: '2026-10-14' }), 'risedtc', neg, tz)).toBe('Wed 14 Oct, 07:00 PT. A weekday, as the rule says.')
    expect(dayWhy(base({ day: '2026-10-17', at: '2026-10-17T14:00:00Z' }), 'risedtc', cross, tz)).toBe('Sat 17 Oct, 07:00 PT. A weekend day, against the weekdays-only rule.')
    expect(PB.ruleClear({ gain: 6, lo: -3, hi: 14, unclear: false })).toBe(false)
    expect(PB.ruleClear({ gain: 19, lo: 10.1, hi: 27, unclear: false })).toBe(true)
  })
  it('weekend post against an unclear rule, set by hand', () => {
    const s = { rules: [{ rule_id: 'R11-weekend-ivan', name: 'Weekdays only', metric: 'views', gain: 5.7, lo: -4.1, hi: 14.6, status: 'live', unclear: true, held_latest: false, your_rule: true, enforcer: 'scheduler', creators: 69 }] } as never
    expect(dayWhy(base({ day: '2026-10-17', at: '2026-10-17T08:45:00Z', brain: brain({ time_set_by: 'hand' }) }), 'ivan', s, { name: 'Europe/Warsaw', label: 'Warsaw' })).toBe('Sat 17 Oct, 10:45 Warsaw. A weekend day, against your weekdays-only rule. Set by hand.')
  })
  it('time labels', () => {
    expect(timeLabel(base({ at: '2026-10-14T14:00:00Z' }), { name: 'America/Los_Angeles', label: 'PT' })).toBe('07:00 PT')
    expect(timeLabel(base({ at: '2026-10-14T08:45:00Z' }), { name: 'Europe/Warsaw', label: 'Warsaw' })).toBe('10:45 Warsaw')
    expect(timeLabel(base({ at: null }), { name: 'Europe/Warsaw', label: 'Warsaw' })).toBe('')
  })
  it('tzOf falls back per account', () => {
    expect(tzOf({ account: 'risedtc' } as PlanRead)).toEqual({ name: 'America/Los_Angeles', label: 'PT' })
    expect(tzOf({ account: 'arch' } as PlanRead)).toEqual({ name: 'Europe/Warsaw', label: 'Warsaw' })
    expect(tzOf({ account: 'ivan', tz: { name: 'Europe/Rome', label: 'Rome' } } as PlanRead)).toEqual({ name: 'Europe/Rome', label: 'Rome' })
  })
})

describe('flagsFor', () => {
  it('weekend post against a weekdays rule, low score not shown for Arch', () => {
    const strip = { rules: [{ rule_id: 'R11-weekend-ivan', name: 'Weekdays only', status: 'live' }] } as never
    const f = flagsFor(base({ day: '2026-10-17', brain: brain({ flags: { lm: false, boosted: false, founder: false, carousel: true, weekend: true, failed: false, low_score: false, fact_fail: false } }) }), strip).map(x => x.label)
    expect(f).toEqual(['Carousel', 'Weekend'])
    expect(flagsFor(base({ brain: brain({ flags: { ...noFlags, low_score: true } }) }), { rules: [] } as never, 'arch')).toEqual([])
  })
  it('no weekend flag without a weekdays rule', () => expect(flagsFor(base({ day: '2026-10-17' }), { rules: [] } as never)).toEqual([]))
  it('failed is red and replaces low score', () => {
    const f = flagsFor(base({ st: 'failed', brain: brain({ flags: { lm: false, boosted: false, founder: false, carousel: false, weekend: false, failed: true, low_score: true, fact_fail: false } }) }), { rules: [] } as never)
    expect(f.map(x => [x.label, x.tone])).toEqual([['Failed', 'red']])
  })
  it('low score amber, not on published', () => {
    const b = brain({ flags: { lm: false, boosted: false, founder: false, carousel: false, weekend: false, failed: false, low_score: true, fact_fail: false } })
    expect(flagsFor(base({ brain: b }), { rules: [] } as never).map(x => x.label)).toEqual(['Low score'])
    expect(flagsFor(base({ st: 'published', brain: b }), { rules: [] } as never)).toEqual([])
  })
  it('fact fail red', () => expect(flagsFor(base({ brain: brain({ flags: { lm: false, boosted: false, founder: false, carousel: false, weekend: false, failed: false, low_score: false, fact_fail: true } }) }), { rules: [] } as never).map(x => x.label)).toEqual(['Not backed by the call']))
  it('lead magnet ink, boosted, founder from the post when brain is missing', () => {
    const f = flagsFor(base({ post: { kind: 'post', title: 'T', day: '2026-10-14', at: '2026-10-14T14:00:00Z', status: 'scheduled', format: 'carousel', picture: 'carousel deck', lead_magnet: true, founder: true, evidence: [] } }), null)
    expect(f.map(x => [x.key, x.tone])).toEqual([['lm', 'ink'], ['founder', 'plain']])
    expect(flagsFor(base({ format: 'carousel' }), null).map(x => x.key)).toEqual(['carousel'])
  })
})

describe('ruleRow', () => {
  it('gain words', () => expect(ruleRow({ rule_id: 'R06-link-ivan', name: 'No links in the post', metric: 'views', gain: 13, lo: 3.3, hi: 21.7, status: 'live', unclear: false, held_latest: true, your_rule: false, enforcer: 'writer', creators: 69 })).toEqual({ name: 'No links in the post', effect: '13% more views', tone: 'pos' }))
  it('unclear', () => expect(ruleRow({ rule_id: 'R11-weekend-ivan', name: 'Weekdays only', metric: 'views', gain: 5.7, lo: -4.1, hi: 14.6, status: 'live', unclear: true, held_latest: false, your_rule: false, enforcer: 'scheduler', creators: 69 }).effect).toBe('your rule, not clear in the data'))
  it('your rule', () => expect(ruleRow({ rule_id: 'R04-short50-ivan', name: 'More than 50 words', metric: 'views', gain: null, lo: null, hi: null, status: 'live', unclear: false, held_latest: false, your_rule: true, enforcer: 'writer', creators: null }).effect).toBe('your rule'))
  it('comments', () => expect(ruleRow({ rule_id: 'R07-question-comments', name: 'A question gets more comments', metric: 'comments', gain: 7.93, lo: 2.78, hi: 13.35, status: 'shadow', unclear: false, held_latest: null, your_rule: false, enforcer: 'writer', creators: 140 }).effect).toBe('8% more comments'))
  it('a rule that costs views', () => expect(ruleRow({ rule_id: 'R99-x', name: 'Something', metric: 'views', gain: -12, lo: -20, hi: -4, status: 'shadow', unclear: false, held_latest: null, your_rule: false, enforcer: 'writer', creators: 40 })).toEqual({ name: 'Something', effect: '12% fewer views', tone: 'neg' }))
  it('not measured yet', () => expect(ruleRow({ rule_id: 'H01-author-voice-arch', name: 'Open with something you did or saw', metric: 'views', gain: null, lo: null, hi: null, status: 'shadow', unclear: false, held_latest: null, your_rule: false, enforcer: 'writer', creators: null })).toEqual({ name: 'Open with something you did or saw', effect: 'not measured yet', tone: 'tag' }))
})

describe('warningOf', () => {
  it('lm due links lead magnets', () => expect(warningOf({ code: 'lm_due', text: 'No lead magnet in the week of 26 Oct' }).link?.label).toBe('Lead magnets'))
  it('empty topic links ideas', () => expect(warningOf({ code: 'empty_topic_area', text: 'Out of ideas for sales posts (3 used in 8 weeks)' })).toEqual({ text: 'Out of ideas for sales posts (3 used in 8 weeks)', link: { label: 'Add ideas', sub: 'ideas' } }))
  it('old machine words are rewritten', () => expect(warningOf({ code: 'empty_topic_area', text: 'No open ideas for reach (4 posted in 8 weeks)' }).text).toBe('Out of ideas for posts that bring new followers (4 used in 8 weeks)'))
  it('rule breaks carry no link', () => expect(warningOf({ code: 'over_rule', text: 'Week of 12 Oct has 5 posts. Your rule is 2 to 4. Each extra post costs 9% of views.' }).link).toBeNull())
})

describe('quoteFor', () => {
  it('pending non-English shows nothing', () => expect(quoteFor(base({ brain: brain({ quote: null, quote_pending: true }) }))).toBeNull())
  it('cuts long quotes on a word with an ellipsis', () => { const q = quoteFor(base({ brain: brain({ quote: 'word '.repeat(60) }) }))!; expect(q.length).toBeLessThanOrEqual(201); expect(q.endsWith('…')).toBe(true) })
  it('the cut never splits a word, whatever the word lengths', () => {
    for (const w of ['abcdefg', 'ab', 'abcdefghijklm', 'abc,']) {
      const src = Array.from({ length: 80 }, (_, i) => `${w}${i}`).join(' ')
      const q = quoteFor(base({ brain: brain({ quote: src }) }))!
      expect(q.endsWith('…')).toBe(true)
      const kept = q.slice(0, -1)
      expect(kept.length).toBeLessThanOrEqual(200)
      expect(src.startsWith(kept)).toBe(true)
      const rest = src.slice(kept.length)
      // what follows the kept text is a word break (maybe after stripped punctuation), never the rest of a word
      expect(/^[,;:.]*\s/.test(rest)).toBe(true)
    }
  })
  it('a Croatian quote or a planner note is never shown', () => {
    expect(quoteFor(base({ brain: brain({ quote: 'Mislim da je to dobro, ali nije' }) }))).toBeNull()
    expect(quoteFor(base({ brain: brain({ quote: 'Extracts the pricing angle from the call' }) }))).toBeNull()
    expect(quoteFor(base({ brain: brain({ quote: 'I always thought Google was a little more true than Meta, but maybe.' }) }))).toBe('I always thought Google was a little more true than Meta, but maybe.')
  })
})

describe('weekDays', () => {
  it('adds Saturday only when a post sits there', () => {
    const w = { start: '2026-10-12', which: 'this', target: 4, filled: 5, open: 0, posts: [], planned: [] } as never
    expect(weekDays(w, [base({ day: '2026-10-17' })])).toEqual([0, 1, 2, 3, 4, 5])
    expect(weekDays(w, [base({ day: '2026-10-14' })])).toEqual([0, 1, 2, 3, 4])
    expect(weekDays(w, [base({ day: '2026-10-18' })])).toEqual([0, 1, 2, 3, 4, 6])
    expect(weekDays(w, [base({ day: '2026-10-24' })])).toEqual([0, 1, 2, 3, 4])
  })
})

describe('answerOf / plainWhy / mixLine / weekWhy / resultLine', () => {
  it('plainWhy rewrites machine phrases', () => expect(plainWhy("A ready Review draft adapted from a niche outlier at 4.5x its author's usual")).toBe("A written draft based on a post that got 4.5x its author's normal views"))
  it('plainWhy scrubs pattern and primer words', () => {
    expect(plainWhy('From your sales calls and fits a winning reputation pattern; no recent post has covered a site launch teardown.')).toBe('From your sales calls and is like top reputation posts. No recent post has covered a site launch teardown.')
    expect(plainWhy("A ready Review draft adapted from a niche outlier at 4.5x its author's usual, giving the week a beginner-friendly inbound primer.")).toBe("A written draft based on a post that got 4.5x its author's normal views, giving the week a beginner-friendly inbound guide.")
    expect(plainWhy("Niche outlier the Content Brain adapted, 3.6x its author's usual")).toBe("Based on a post that got 3.6x its author's normal views")
    expect(plainWhy('Mirror of a proven winner')).toBe('Copy of a past winner')
  })
  it('resultLine', () => expect(resultLine(base({ st: 'published', brain: brain({ result: { views: 27, reactions: 1, comments: 0, viral: false, young: false, url: null, engaged: null } }) }), { views: { median: 166 } } as never)).toBe('27 views. A normal post gets 166.'))
  it('resultLine young, viral, no numbers yet', () => {
    expect(resultLine(base({ st: 'published', brain: brain({ result: { views: 1677, reactions: 12, comments: 3, viral: true, young: false, url: null, engaged: null } }) }), { views: { median: 253 } } as never)).toBe('1,677 views. A normal post gets 253. It went viral.')
    expect(resultLine(base({ st: 'published', brain: brain({ result: { views: 28, reactions: 0, comments: 0, viral: false, young: true, url: null, engaged: null } }) }), null)).toBe('28 views so far.')
    expect(resultLine(base({ st: 'published', brain: brain({ result: { views: null, reactions: null, comments: null, viral: false, young: true, url: null, engaged: null } }) }), null)).toBe('Numbers are still coming in.')
    expect(resultLine(base(), null)).toBeNull()
  })
  it('weekWhy never repeats the post reason and uses the mix', () => expect(weekWhy([base({ evidence: [{ type: 'call', label: 'From the call on 3 Oct' }] }), base({ key: 'b', brain: brain({ flags: { lm: true, boosted: false, founder: false, carousel: false, weekend: false, failed: false, low_score: false, fact_fail: false } }) })], '2026-10-12')).toBe('This week: 1 from calls · 1 lead magnet.'))
  it('weekWhy differs from reasonFor on the same item', () => {
    const one = base({ evidence: [{ type: 'call', label: 'From the call on 3 Oct' }] })
    expect(weekWhy([one], one.week)).not.toBe(reasonFor(one, 'risedtc'))
    for (const fx of [ivanFx, riseFx, archFx]) {
      const read = fx as unknown as PlanRead
      const its = itemsOf(read)
      for (const it of its) expect(weekWhy(its, it.week)).not.toBe(reasonFor(it, read.account as Acct))
    }
  })
  it('mixLine counts founder stories and top posts', () => expect(mixLine([
    base({ brain: brain({ flags: { ...noFlags, founder: true } }) }), base({ brain: brain({ flags: { ...noFlags, founder: true } }) }),
    base({ evidence: [{ type: 'outlier', label: 'x' }] }),
  ])).toBe('2 founder stories · 1 based on top posts'))
  it('answerOf counts what waits', () => {
    const post = (day: string, status: string) => ({ kind: 'post', title: 'P', day, at: `${day}T08:00:00Z`, status, format: 'text', picture: 'no picture', lead_magnet: false, founder: false, evidence: [] })
    const read = { account: 'ivan', today: '2026-10-12', weeks: [
      { start: '2026-10-12', which: 'this', target: 4, filled: 3, open: 1, posts: [post('2026-10-13', 'review'), post('2026-10-14', 'review'), post('2026-10-15', 'scheduled'), post('2026-10-09', 'review')], planned: [] },
      { start: '2026-10-19', which: 'next', target: 4, filled: 2, open: 2, posts: [post('2026-10-20', 'error')], planned: [{ kind: 'planned', slot_id: 's1', topic: 'S', why_now: '', evidence: [], format: null, picture: null, idea_source: 'client_ideas', idea_ref: 'i', proposal: false, status: 'waiting_review', status_label: '', draft_id: 'd2', day: '2026-10-21' }] },
      { start: '2026-10-26', which: 'after', target: 4, filled: 0, open: 4, posts: [], planned: [] },
    ], done: [], warnings: [] } as unknown as PlanRead
    // The 9 Oct post still waits for approval: it counts, as this week's work.
    expect(answerOf(read)).toEqual({ need: 4, title: '4 posts wait for your OK', parts: ['3 this week', '1 later', '1 scheduled', '1 failed'] })
    const noPast = { ...read, weeks: read.weeks.map(w => ({ ...w, posts: w.posts.filter(p => p.day !== '2026-10-09') })) }
    expect(answerOf(noPast)).toEqual({ need: 3, title: '3 posts wait for your OK', parts: ['2 this week', '1 later', '1 scheduled', '1 failed'] })
    const none = { ...read, weeks: read.weeks.map(w => ({ ...w, posts: w.posts.filter(p => p.status !== 'review'), planned: [] })) }
    expect(answerOf(none).title).toBe('Nothing waits for you')
    expect(answerOf(none).need).toBe(0)
  })
})

describe('itemsOf / upcoming / lateRun', () => {
  const rise = riseFx as unknown as PlanRead
  it('maps posts and slots, sorted by day then time', () => {
    const its = itemsOf(rise)
    const days = its.map(i => i.day ?? '9999')
    expect([...days].sort()).toEqual(days)
    for (let k = 1; k < its.length; k++) if (its[k].day && its[k].day === its[k - 1].day && its[k].at && its[k - 1].at) expect(its[k - 1].at! <= its[k].at!).toBe(true)
    const shuffled = { ...rise, weeks: rise.weeks.map(w => ({ ...w, posts: [...w.posts].reverse().concat(w.posts.slice(0, 1).map(p => ({ ...p, draft_id: 'early', at: `${p.day}T01:00:00Z` }))) })) } as PlanRead
    const sh = itemsOf(shuffled)
    for (let k = 1; k < sh.length; k++) {
      expect((sh[k - 1].day ?? '9999') <= (sh[k].day ?? '9999')).toBe(true)
      if (sh[k].day === sh[k - 1].day && sh[k].at && sh[k - 1].at) expect(sh[k - 1].at! <= sh[k].at!).toBe(true)
    }
    const first = sh.filter(i => i.day === rise.weeks[0].posts[0].day)
    expect(first[0].draftId).toBe('early')
    const slot = its.find(i => i.kind === 'planned')!
    expect(slot.suggested).toBe(true); expect(slot.st).toBe('review'); expect(slot.slotId).toBeTruthy(); expect(slot.whyNow).toBeTruthy()
    const pub = its.find(i => i.post?.status === 'published')!
    expect(pub.st).toBe('published'); expect(pub.suggested).toBe(false)
    expect(its.every(i => ['this', 'next', 'after'].includes(i.which))).toBe(true)
  })
  it('status mapping', () => {
    expect(PB.statusOf({ kind: 'post', status: 'pending' } as never)).toBe('scheduled')
    expect(PB.statusOf({ kind: 'post', status: 'posted' } as never)).toBe('published')
    expect(PB.statusOf({ kind: 'post', status: 'error' } as never)).toBe('failed')
    expect(PB.statusOf({ kind: 'post', status: 'odd' } as never)).toBe('scheduled')
    expect(PB.statusOf({ kind: 'planned', status: 'drafting' } as never)).toBe('writing')
    expect(PB.statusOf({ kind: 'planned', status: 'proposal' } as never)).toBe('writing')
  })
  it('a planned slot with no day stays undated and suggested', () => {
    const r = { ...rise, weeks: rise.weeks.map(w => ({ ...w, planned: w.planned.map(s => ({ ...s, day: null })) })) } as PlanRead
    const s = itemsOf(r).filter(i => i.kind === 'planned')
    expect(s.length).toBeGreaterThan(0)
    expect(s.every(i => i.day === null && i.suggested)).toBe(true)
    expect(itemsOf(r).slice(-s.length).every(i => i.kind === 'planned')).toBe(true)
    expect(upcoming(itemsOf(r), '2026-10-12').filter(i => i.day === null).length).toBe(s.length)
  })
  it('upcoming drops past days but keeps posts still waiting', () => {
    expect(upcoming([base({ day: '2026-10-09', st: 'scheduled' }), base({ day: '2026-10-12' })], '2026-10-12').map(i => i.day)).toEqual(['2026-10-12'])
    expect(upcoming([base({ day: '2026-10-09', st: 'review' }), base({ day: '2026-10-08', st: 'published' })], '2026-10-12').map(i => i.day)).toEqual(['2026-10-09'])
  })
  it('lateRun after 26 hours', () => {
    const r = { last_run: { ran_at: '2026-10-12T05:20:00Z', target_week: null, open_before: 0, picked: 0 } } as PlanRead
    expect(lateRun(r, new Date('2026-10-13T07:00:00Z'))).toBe(false)
    expect(lateRun(r, new Date('2026-10-13T07:30:00Z'))).toBe(true)
    expect(lateRun({ last_run: null } as PlanRead, new Date())).toBe(true)
  })
})

describe('strip lines', () => {
  const strip = (riseFx as unknown as PlanRead).brain_strip as BrainStrip
  it('viewsLine', () => {
    expect(viewsLine({ views: { median: 253 } } as BrainStrip)).toBe('Last 90 days: 253 views on a normal post · viral = 3x that')
    expect(viewsLine(null)).toBe('')
  })
  it('readsSummary', () => {
    const r = (items: { proven: boolean; small: boolean }[], measured: number, validated = false) => ({ reads: { items: items.map(x => ({ title: 't', x: 1, lo: null, hi: null, ...x })), total: items.length }, predictions: { measured, need: 20, validated } }) as unknown as BrainStrip
    expect(readsSummary(r([{ proven: false, small: false }, { proven: false, small: false }], 17), 'ivan')).toBe('Not proven yet. The brain needs more of your recent posts. Predictions start at 20 measured posts: Ivan 17 of 20.')
    expect(readsSummary(r([{ proven: true, small: false }, { proven: false, small: false }], 24), 'risedtc')).toBe('1 of 2 proven on recent posts. Rise has 24 measured posts. Its guesses have not passed their test yet.')
    expect(readsSummary(r([{ proven: true, small: true }], 21), 'arch')).toBe('1 of 1 proven on recent posts, but few examples. Arch has 21 measured posts. Its guesses have not passed their test yet.')
    expect(readsSummary(r([{ proven: true, small: true }], 8), 'arch')).toBe('1 of 1 proven on recent posts, but few examples. Predictions start at 20 measured posts: Arch 8 of 20.')
    expect(readsSummary(r([{ proven: false, small: false }], 3), 'arch')).toBe("Not proven yet. The brain needs more of Arch's recent posts. Predictions start at 20 measured posts: Arch 3 of 20.")
    expect(readsSummary(null, 'ivan')).toBe('')
    expect(readsSummary(strip, 'risedtc')).toContain('Rise has')
  })
  it('topic words', () => {
    expect(topicWord('demand')).toBe('sales posts'); expect(topicWord('reach')).toBe('posts that bring new followers'); expect(topicWord('personal')).toBe('founder stories')
    expect(topicWord('authority')).toBe('expert posts'); expect(topicWord('case_study')).toBe('case studies'); expect(topicWord('proof')).toBe('proof posts')
  })
})

describe('reasonFor', () => {
  it('slot reason first, then the brain author, never a slug', () => {
    expect(reasonFor(base({ whyNow: 'From your sales calls; a fresh angle.' }), 'risedtc')).toBe('From your sales calls. A fresh angle.')
    expect(reasonFor(base({ brain: brain({ brief: { author: 'Monika Grycz', ratio: 4.58, url: null, why: 'raw ranker text' } }) }), 'ivan')).toBe('Based on a post by Monika Grycz that got 4.6x their normal views.')
    expect(reasonFor(base({ brain: brain({ brief: { author: null, ratio: null, url: null, why: 'outlier breaks out' } }) }), 'ivan')).toBe('Based on a top post.')
    expect(reasonFor(base({ evidence: [{ type: 'past_winner', label: 'Mirror of a proven winner' }, { type: 'call', label: 'From the call on 3 Oct' }] }), 'risedtc')).toBe('Copy of a past winner')
    expect(reasonFor(base({ evidence: [{ type: 'call', label: 'From the call on 3 Oct' }] }), 'risedtc')).toBe('From the call on 3 Oct')
    expect(reasonFor(base(), 'ivan')).toBeNull()
  })
})

// Every string the module can output, over the three real reads, with and without brain data.
const BANNED = /—|\bslots?\b|\bundefined\b|\bNaN\b|\bnull\b|\boutliers?\b|\busual\b|\bprimer\b|\bpillars?\b|\bcadence\b|\breview draft\b|\bniche winners?\b|\bpatterns?\b|\bbreakouts?\b|\bICP\b|\bQA\b|\bholdout\b|\brecipe\b/i
function allStrings(read: PlanRead, now: Date): string[] {
  const acct = read.account as Acct
  const strip = read.brain_strip ?? null
  const tz = tzOf(read)
  const its = itemsOf(read)
  const out: string[] = []
  const push = (...s: (string | null | undefined)[]) => s.forEach(x => { if (x != null) out.push(x) })
  for (const it of its) {
    push(timeLabel(it, tz), reasonFor(it, acct), quoteFor(it), traitLine(it, acct), qaLine(it), factsLine(it), angleLine(it), dayWhy(it, acct, strip, tz), resultLine(it, strip))
    const r = readLine(it, acct); if (r) push(r.sign, r.text, r.detail, r.rel, String(r.x))
    dimsOf(it).forEach(d => push(d.label, String(d.v)))
    push(...firstLineChecks(it))
    flagsFor(it, strip, acct).forEach(f => push(f.label))
    for (const e of it.evidence) push(plainWhy(e.label))
    if (it.whyNow) push(plainWhy(it.whyNow))
  }
  for (const w of read.weeks) { push(weekWhy(its, w.start)); weekDays(w, its).forEach(d => push(String(d))) }
  push(mixLine(its))
  const a = answerOf(read); push(a.title, String(a.need), ...a.parts)
  for (const w of read.warnings) { const x = warningOf(w); push(x.text, x.link?.label, x.link?.sub) }
  for (const r of strip?.rules ?? []) { const x = ruleRow(r); push(x.name, x.effect) }
  push(readsSummary(strip, acct), viewsLine(strip))
  for (const s of strip?.idea_stock ?? []) push(topicWord(s.topic))
  push(String(lateRun(read, now)), ...upcoming(its, read.today).map(i => i.st))
  return out
}
const stripBrain = (r: PlanRead): PlanRead => ({ ...r, brain_strip: null, weeks: r.weeks.map(w => ({ ...w, posts: w.posts.map(p => ({ ...p, brain: undefined })), planned: w.planned.map(s => ({ ...s, brain: undefined })) })) })

describe('real reads: no machine words, no em dash, no undefined/NaN/null', () => {
  for (const [name, fx] of [['ivan', ivanFx], ['risedtc', riseFx], ['arch', archFx]] as const) {
    it(name, () => {
      const read = fx as unknown as PlanRead
      expect(read.account).toBe(name)
      const s = allStrings(read, new Date('2026-10-12T12:00:00Z'))
      expect(s.length).toBeGreaterThan(50)
      const bad = s.filter(x => x !== PB.FAILED_LINE && BANNED.test(x))
      expect(bad).toEqual([])
      const bare = allStrings(stripBrain(read), new Date('2026-10-12T12:00:00Z'))
      expect(bare.filter(x => x !== PB.FAILED_LINE && BANNED.test(x))).toEqual([])
    })
  }
  it('fixtures stay small', () => {
    for (const fx of [ivanFx, riseFx, archFx]) expect(JSON.stringify(fx).length).toBeLessThan(60_000)
  })
})

describe('empty account', () => {
  const empty = { account: 'arch', today: '2026-10-12', target: 3, target_week: null, open: 0, state: 'planning', proposals_only: false, founder_story_max: 1, cadence_source: '', weeks: [
    { start: '2026-10-12', which: 'this', target: 3, filled: 0, open: 3, posts: [], planned: [] },
    { start: '2026-10-19', which: 'next', target: 3, filled: 0, open: 3, posts: [], planned: [] },
    { start: '2026-10-26', which: 'after', target: 3, filled: 0, open: 3, posts: [], planned: [] },
  ], done: [], warnings: [], last_run: null, brain_strip: null } as unknown as PlanRead
  it('every function returns its empty value without throwing', () => {
    expect(itemsOf(empty)).toEqual([])
    expect(upcoming([], '2026-10-12')).toEqual([])
    expect(answerOf(empty)).toEqual({ need: 0, title: 'Nothing waits for you', parts: [] })
    expect(mixLine([])).toBe('')
    expect(weekWhy([], '2026-10-12')).toBe('')
    expect(weekDays(empty.weeks[0], [])).toEqual([0, 1, 2, 3, 4])
    expect(readsSummary(null, 'arch')).toBe('')
    expect(viewsLine(null)).toBe('')
    expect(readsSummary({ reads: { items: [], total: 0 }, predictions: { measured: 0, need: 0, validated: false }, views: { median: null } } as unknown as BrainStrip, 'arch')).toBe('')
    expect(viewsLine({ views: { median: null } } as unknown as BrainStrip)).toBe('')
    const bare = base({ brain: null, at: null })
    expect([readLine(bare, 'arch'), qaLine(bare), factsLine(bare), angleLine(bare), traitLine(bare, 'arch'), quoteFor(bare), resultLine(bare, null), reasonFor(bare, 'arch')]).toEqual([null, null, null, null, null, null, null, null])
    expect([dimsOf(bare), firstLineChecks(bare), flagsFor(bare, null, 'arch')]).toEqual([[], [], []])
    expect(timeLabel(bare, tzOf(empty))).toBe('')
    expect(lateRun(empty, new Date())).toBe(true)
  })
})

describe('exported constants', () => {
  it('no em dash in any exported string', () => {
    const strings: string[] = []
    const walk = (v: unknown) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk) }
    Object.values(PB).filter(v => typeof v !== 'function').forEach(walk)
    expect(strings.length).toBeGreaterThan(20)
    expect(strings.filter(s => s.includes('—'))).toEqual([])
    expect(strings.filter(s => s !== PB.FAILED_LINE && BANNED.test(s))).toEqual([])
  })
  it('names', () => {
    expect(PB.ACCT_NAME).toEqual({ ivan: 'Ivan', risedtc: 'Rise', arch: 'Arch' })
    expect(PB.OWNER).toEqual({ ivan: 'you', risedtc: 'Mattan', arch: 'Davorin' })
    expect(PB.ST_WORD).toEqual({ published: 'Published', scheduled: 'Scheduled', review: 'Waiting for your OK', writing: 'Being written', failed: 'Failed' })
  })
})

describe('brain strip words (Task 9)', () => {
  const strips = { ivan: (ivanFx as unknown as PlanRead).brain_strip as BrainStrip, risedtc: (riseFx as unknown as PlanRead).brain_strip as BrainStrip, arch: (archFx as unknown as PlanRead).brain_strip as BrainStrip }
  it('nextCheckLine', () => {
    expect(PB.nextCheckLine(strips.ivan)).toBe('Mon 2 Nov. Under watch: more than 50 words and weekdays only.')
    expect(PB.nextCheckLine(strips.risedtc)).toBe('Mon 2 Nov. No rule is under watch.')
    expect(PB.nextCheckLine({ next_check: { date: '2026-11-02', watch: ['A', 'B', 'C'] } } as unknown as BrainStrip)).toBe('Mon 2 Nov. Under watch: a, b and c.')
    expect(PB.nextCheckLine({ next_check: { date: null, watch: [] } } as unknown as BrainStrip)).toBe('No check day is set yet.')
    expect(PB.nextCheckLine(null)).toBe('')
    expect(PB.nextCheckLine({} as BrainStrip)).toBe('')
  })
  it('sourceNote', () => {
    expect(PB.sourceNote({ collection: { posts: 10629, creators: 140 } } as BrainStrip)).toBe('From 10,629 posts by 140 creators.')
    expect(PB.sourceNote({ collection: null } as unknown as BrainStrip)).toBe('')
    expect(PB.sourceNote(null)).toBe('')
  })
  it('proposalLine and changeLine', () => {
    expect(PB.proposalLine({ id: 1, rule_id: 'R01', name: 'Add a picture', to_status: 'live', reason: 'raw machine text' })).toBe('Start following: add a picture')
    expect(PB.proposalLine({ id: 2, rule_id: 'R01', name: 'Add a picture', to_status: 'shadow', reason: null })).toBe('Go back to testing: add a picture')
    expect(PB.proposalLine({ id: 3, rule_id: 'R01', name: 'Add a picture', to_status: 'retired', reason: null })).toBe('Stop using: add a picture')
    expect(PB.changeLine({ rule_id: 'R01', name: 'Add a picture', to_status: 'live', at: '2026-10-12T12:00:00Z', undo_token: 'x' })).toBe('Add a picture: now followed, Mon 12 Oct')
    expect(PB.changeLine({ rule_id: 'R01', name: 'Add a picture', to_status: 'shadow', at: '2026-10-12T12:00:00Z', undo_token: null })).toBe('Add a picture: back to testing, Mon 12 Oct')
    expect(PB.changeLine({ rule_id: 'zz-selftest-1', name: 'Self test', to_status: 'live', at: '2026-10-12T12:00:00Z', undo_token: 'x' })).toBe('')
  })
  it('decisionLine and undoLine', () => {
    expect(PB.decisionLine({ name: 'Add a picture', to_status: 'live' }, true)).toBe('Now following: add a picture.')
    expect(PB.decisionLine({ name: 'Add a picture', to_status: 'shadow' }, true)).toBe('Back to testing: add a picture.')
    expect(PB.decisionLine({ name: 'Add a picture', to_status: 'retired' }, true)).toBe('Stopped using: add a picture.')
    expect(PB.decisionLine({ name: 'Add a picture', to_status: 'live' }, false)).toBe('Dismissed. The rule stays as it is.')
    expect(PB.undoLine({ name: 'Add a picture' })).toBe('Put back: add a picture.')
  })
  it('ruleNote', () => {
    const r = (o: object) => ({ rule_id: 'R', name: 'N', metric: 'views', gain: null, lo: null, hi: null, status: 'live', unclear: false, held_latest: null, your_rule: false, enforcer: 'writer', creators: null, ...o }) as never
    expect(PB.ruleNote(r({ held_latest: false, your_rule: true }))).toBe('Did not hold on the newest posts, kept because you set it.')
    expect(PB.ruleNote(r({ held_latest: false }))).toBe('Did not hold on the newest posts.')
    expect(PB.ruleNote(r({ held_latest: true, your_rule: true }))).toBeNull()
    expect(PB.ruleNote(r({}))).toBeNull()
  })
  it('viralLine', () => {
    expect(PB.viralLine({ views: { median: 166, measured: 29, breakouts: 7, posts: [] } } as unknown as BrainStrip)).toBe('7 of 29 went viral')
    expect(PB.viralLine({ views: { median: null, measured: 0, breakouts: 0, posts: [] } } as unknown as BrainStrip)).toBe('')
    expect(PB.viralLine(null)).toBe('')
  })
  it('readDotTip', () => {
    expect(PB.readDotTip({ title: 'Post A', x: 1.5, lo: 1.1, hi: 2, proven: true, small: false })).toBe('Post A: goes viral 1.5x more often. Proven on recent posts.')
    expect(PB.readDotTip({ title: 'Post B', x: 0.48, lo: 0.2, hi: 0.9, proven: false, small: false })).toBe('Post B: goes viral about half as often. Not proven yet.')
    expect(PB.readDotTip({ title: 'Post C', x: 0.8, lo: 0.5, hi: 1.1, proven: true, small: true })).toBe('Post C: goes viral a bit less often. Proven on recent posts, but few examples.')
    expect(PB.readDotTip({ title: 'Post D', x: 1.04, lo: 0.9, hi: 1.2, proven: true, small: false })).toBe('Post D: does about average. Proven on recent posts.')
  })
  it('stockRow', () => {
    expect(PB.stockRow({ topic: 'teardown', stock: 30, used: 7 })).toEqual({ name: 'Teardowns', stock: 30, used: 7, empty: false, tip: 'Teardowns: 30 ideas in stock, 7 used in 8 weeks.' })
    expect(PB.stockRow({ topic: 'demand', stock: 0, used: 3 })).toEqual({ name: 'Sales posts', stock: 0, used: 3, empty: true, tip: 'Sales posts: out of ideas, 3 used in 8 weeks.' })
  })
  it('stripNote', () => {
    expect(PB.stripNote(strips.risedtc)).toBe('Tested, not used yet: no weekend posts (19% more views), fewer posts a week (24% more views) and a picture (54% more views). Rise posts 5 a week.')
    expect(PB.stripNote(strips.ivan)).toBe('')
    expect(PB.stripNote(null)).toBe('')
  })
  for (const a of ['ivan', 'risedtc', 'arch'] as const) {
    it(`real strip words are plain: ${a}`, () => {
      const s = strips[a]
      const out: string[] = [PB.nextCheckLine(s), PB.sourceNote(s), PB.stripNote(s), PB.viralLine(s)]
      for (const r of PB.rulesOf(s).live.concat(PB.rulesOf(s).testing)) out.push(PB.ruleRow(r).name, PB.ruleRow(r).effect, PB.ruleNote(r) ?? '')
      for (const i of s.reads.items) out.push(PB.readDotTip({ ...i, title: 'T' }))
      for (const k of s.idea_stock) out.push(PB.stockRow(k).name, PB.stockRow(k).tip)
      expect(out.filter(x => BANNED.test(x))).toEqual([])
    })
  }
})
