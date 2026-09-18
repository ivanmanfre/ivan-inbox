import { describe, expect, it } from 'vitest'
import {
  ACCOUNTS, INSIGHTS_EMPTY, accountsWithPosts, answer, askRows, coverageLine, dec, firstLine,
  floorReason, insightBase, insightRows, int, medianWithheld, one, ownState, planThinLine, plu,
  sectionTitle, shapeLine, shownTests, testCopy, themeLine, widerLine,
  type MarketOffer, type MarketReadout,
} from './markets'

/* A readout with every section filled the way a healthy lane fills it. Each test
   changes only the field it is about, so a failure names the field. */
function offer(over: Partial<MarketOffer> = {}): MarketOffer {
  return {
    post_ref: 'https://www.linkedin.com/posts/a_one-activity-1',
    author: 'Alex Vacca',
    author_url: 'https://www.linkedin.com/in/alex',
    posted_at: '2026-09-01T10:00:00Z',
    likes: 100, comments: 40, reposts: 2,
    follower_count: 12000, followers_source: 'unipile_seat',
    per_1k: 3.3, cta_kind: 'comment_gate', gate_keyword: 'GTM',
    offer: 'a go to market checklist', confidence: 0.9,
    vs_median: 1.5, why_followers: null, why_comments: null,
    ...over,
  }
}

function readout(over: Partial<MarketReadout> = {}): MarketReadout {
  const ranked = [offer(), offer({ post_ref: 'p2', author: 'Dara Denney', per_1k: 2.2, comments: 30, vs_median: 1 })]
  return {
    since: '2026-06-19T00:00:00Z', window_days: 91,
    client_id: 'risedtc', display_name: 'Mattan Danino',
    floor: { comments: 10, followers: 1000 }, min_test_base: 5,
    populations: {
      roster_size: 20, roster_authors: 19, roster_posts: 328,
      roster_median_comments: 7, roster_max_post_comments: 210,
      wider_posts: 327, wider_authors: 33,
    },
    offers: {
      roster_offers: 16, wider_offers: 23, ranked_count: 9, below_count: 7,
      roster_max_comments: 88, roster_offer_median: 12,
      cta: { link: 14, comment_gate: 2, dm_gate: 0 }, with_keyword: 3,
      rank: { median_per1k: 2.2, max_per1k: 3.3, min_per1k: 0.3 },
      ranked, below: [], wider: [],
      top_by_comments: ranked[0], top_leads_ranking: true, roster_judged: 182,
    },
    themes: { run_id: 'r1', total: 5, rows: [] },
    own: {
      posts: 54, median_comments: 2.5, best_comments: 22,
      best: { url: 'https://x/1', title: 'A post\nwith two lines', comments: 22, at: '2026-09-02T00:00:00Z' },
      unmeasured: 2, measured: 52, median_measured: 2.5, best_measured: 22,
      attributed: 3, unattributed: 51, lm_catalog: 18, lm_used: 3,
    },
    tests: [], coverage: { judged: 314, unjudged: 341, total: 655 },
    insights: { run_id: null, rows: [] },
    ...over,
  }
}

describe('numbers', () => {
  it('a count reads with its thousands separator and a rate keeps one decimal', () => {
    expect(int(12000)).toBe('12,000')
    expect(int(null)).toBe('0')
    expect(one(3.35)).toBe('3.4')
    expect(one(null)).toBe('0.0')
    // A median of 2.5 is not 3, and a whole number stays whole.
    expect(dec(2.5)).toBe('2.5')
    expect(dec(7)).toBe('7')
  })

  it('counts its own noun', () => {
    expect(plu(1, 'offer')).toBe('offer')
    expect(plu(9, 'offer')).toBe('offers')
    expect(plu(1, 'person', 'people')).toBe('person')
  })

  it('takes the first readable line of a post and cuts it at a word', () => {
    expect(firstLine('\n\nfirst line\nsecond line')).toBe('first line')
    expect(firstLine(`${'word '.repeat(40)}`, 20)).toMatch(/…$/)
    expect(firstLine(null)).toBeNull()
  })
})

describe('the populations stay apart', () => {
  it('names how many of the accounts we follow actually published', () => {
    expect(accountsWithPosts(readout().populations)).toBe('19 of the 20 accounts we follow for you')
    const all = readout({ populations: { ...readout().populations, roster_authors: 20 } })
    expect(accountsWithPosts(all.populations)).toBe('20 accounts we follow for you')
  })

  it('says the wider feed is unvetted and keeps it out of the ranking', () => {
    const line = widerLine(readout())
    expect(line).toContain('327 posts')
    expect(line).toContain('33 other authors')
    expect(line).toContain('not vetted')
    expect(line).toContain('out of the ranking')
  })

  it('prints no wider sentence when the harvest stored nothing outside the roster', () => {
    const m = readout({ populations: { ...readout().populations, wider_posts: 0, wider_authors: 0 } })
    expect(widerLine(m)).toBe('')
  })

  it('the coverage line counts both populations and says so', () => {
    const line = coverageLine(readout())
    expect(line).toContain('314 of the 655 posts')
    expect(line).toContain('48 in a hundred')
    expect(line).toContain(ACCOUNTS)
    expect(line).toContain('the wider feed')
  })
})

describe('the answer', () => {
  it('opens on the loudest offer from the accounts we follow, never the wider feed', () => {
    const a = answer(readout())
    expect(a.figure).toBe('88')
    expect(a.unit).toContain('accounts we follow for you')
    expect(a.lines[0]).toContain('Alex Vacca offered')
    expect(a.lines[0]).toContain('12,000 people followed')
  })

  it('says plainly when the loudest by comments is not the one leading the ranking', () => {
    const base = readout()
    const m = readout({
      offers: { ...base.offers, top_leads_ranking: false, top_by_comments: offer({ author: 'Nick Shackelford', per_1k: null, follower_count: null }) },
    })
    expect(answer(m).lines[0]).toContain('no follower count')
    expect(answer(m).lines[1]).toContain('Alex Vacca leads at')
  })

  it('falls back to the read count when no offer is on file', () => {
    const base = readout()
    const m = readout({ offers: { ...base.offers, roster_offers: 0, ranked_count: 0, ranked: [], top_by_comments: null } })
    const a = answer(m)
    expect(a.figure).toBe('314')
    expect(a.unit).toContain('posts read')
    expect(a.lines[0]).toContain('none of them carried an offer')
  })
})

describe('the ask ledger', () => {
  it('puts the loudest ask first and closes on the keyword row', () => {
    const rows = askRows(readout())
    expect(rows.map(r => r.id)).toEqual(['link', 'comment_gate', 'dm_gate', 'with_keyword'])
    expect(rows[0].value).toBe(14)
    expect(rows[3].label).toContain('of those 16')
  })
})

describe('the floor', () => {
  it('names both halves of the reason when both fail', () => {
    const o = offer({ why_followers: 'small', why_comments: true, per_1k: 0.2 })
    expect(floorReason(o, { comments: 10, followers: 1000 }))
      .toBe('the account is under 1,000 followers and it drew under 10 comments')
  })

  it('says we hold no follower count rather than calling the account small', () => {
    const o = offer({ why_followers: 'missing', why_comments: false, follower_count: null, per_1k: null })
    expect(floorReason(o, { comments: 10, followers: 1000 })).toBe('we hold no follower count for the account')
  })

  it('falls back to one honest sentence when neither half explains it', () => {
    const o = offer({ why_followers: null, why_comments: false })
    expect(floorReason(o, { comments: 10, followers: 1000 })).toBe('it carries no reach we can size')
  })

  it('the ranked section states the floor it applied and how many cleared it', () => {
    const line = shapeLine(readout())
    expect(line).toContain('9 of the 16 offers')
    expect(line).toContain('cleared 10 comments and 1,000 followers')
    expect(line).toContain('The other 7')
  })
})

describe('thin states', () => {
  it('says nothing is on file rather than printing an empty ranking', () => {
    const base = readout()
    const m = readout({ offers: { ...base.offers, roster_offers: 0, ranked_count: 0, below_count: 0 } })
    expect(shapeLine(m)).toBe(`No offer from ${ACCOUNTS} is on file yet, so there is nothing to rank.`)
  })

  it('says none cleared the floor when offers exist and none can be ranked', () => {
    const base = readout()
    const m = readout({ offers: { ...base.offers, ranked_count: 0 } })
    expect(shapeLine(m)).toContain('None of the 16 offers')
  })

  it('ARCH: one rankable offer of four writes the plan as a sentence, never as a test', () => {
    const base = readout()
    const m = readout({
      offers: { ...base.offers, roster_offers: 4, ranked_count: 1, below_count: 3 },
      tests: [],
    })
    const line = planThinLine(m)
    expect(line).toContain('4 offers')
    expect(line).toContain('1 of them cleared')
    expect(line).toContain('once 5 offers')
  })

  it('the themes section names its own floor when no idea has been named', () => {
    const m = readout({ themes: { run_id: null, total: 0, rows: [] } })
    expect(themeLine(m)).toContain('have not named')
    expect(themeLine(m)).toContain('3 posts from 2')
  })
})

describe('measured or not, which is not the same question as zero or not', () => {
  it("Ivan's lane: 18 unmeasured of 72 leaves the median standing, and the screen names the 18", () => {
    const base = readout()
    const m = readout({
      own: { ...base.own, posts: 72, unmeasured: 18, measured: 54, median_comments: 0, median_measured: 0, best_comments: 26, best_measured: 26 },
    })
    // 18 * 2 < 72: the median position sits on a post we read, so it is a reading.
    expect(medianWithheld(m.own)).toBe(false)
    const s = ownState(m)
    expect(s.kind).toBe('ready')
    if (s.kind !== 'ready') throw new Error('expected a ready state')
    expect(s.line).toContain('we have measured 54 of them, at a median of 0 comments')
    expect(s.line).toContain('18 carry no reading we can trust')
    const own = s.rows.find(r => r.id === 'own_median_comments')
    expect(own?.display).toBe('0')
    expect(own?.base).toContain('Across the 54 posts we measured of the 72 you published')
  })

  it('a lane over half unmeasured withholds the comparison and says why', () => {
    const base = readout()
    const m = readout({ own: { ...base.own, posts: 40, unmeasured: 24, measured: 16, median_comments: 0, median_measured: 1, best_measured: 9 } })
    expect(medianWithheld(m.own)).toBe(true)
    const s = ownState(m)
    expect(s.kind).toBe('withheld')
    if (s.kind !== 'withheld') throw new Error('expected a withheld state')
    expect(s.line).toContain('24 carry no reading we can trust')
    expect(s.line).toContain('withhold the comparison against the market median')
    expect(s.measured).toContain('Across the 16 we did measure, the median is 1 comment')
  })

  it('exactly half unmeasured already carries the median position', () => {
    const base = readout()
    expect(medianWithheld({ ...base.own, posts: 10, unmeasured: 5, measured: 5 })).toBe(true)
    expect(medianWithheld({ ...base.own, posts: 10, unmeasured: 4, measured: 6 })).toBe(false)
  })

  it('a lane we measured whole says nothing about a gap', () => {
    const base = readout()
    const m = readout({ own: { ...base.own, posts: 11, unmeasured: 0, measured: 11, median_comments: 0, median_measured: 0, best_comments: 5, best_measured: 5 } })
    const s = ownState(m)
    expect(s.kind).toBe('ready')
    if (s.kind !== 'ready') throw new Error('expected a ready state')
    expect(s.line).not.toContain('no reading we can trust')
    expect(s.rows.find(r => r.id === 'own_median_comments')?.base).not.toContain('The other')
  })

  it('a lane with no own post asks for nothing and says the section fills in later', () => {
    const base = readout()
    const m = readout({ own: { ...base.own, posts: 0, unmeasured: 0, measured: 0 } })
    const s = ownState(m)
    expect(s.kind).toBe('none')
    expect(s.line).toContain('fills in from the first post')
  })

  it('the offer share divides the offers we read by the posts we read, and says so', () => {
    const s = ownState(readout())
    if (s.kind !== 'ready') throw new Error('expected a ready state')
    // 16 offers over the 182 roster posts we judged, never over all 328.
    expect(s.line).toContain('9 in a hundred across the 182 posts we have read')
    expect(s.line).toContain('of 328 they published')
  })
})

describe('a test never argues from a number the same screen refuses to print', () => {
  const withOwnMedian = (own: Partial<MarketReadout['own']>) => {
    const base = readout()
    return readout({
      own: { ...base.own, ...own },
      tests: [{ kind: 'own_median', base: Number(own.measured ?? 0), n: { own_posts: own.posts, measured: own.measured, unmeasured: own.unmeasured, own_median: 0, roster_median: 7, roster_posts: 328 } }],
    })
  }

  it('drops the own-median test on a lane whose median is withheld', () => {
    const m = withOwnMedian({ posts: 40, unmeasured: 24, measured: 16, median_measured: 1 })
    expect(medianWithheld(m.own)).toBe(true)
    expect(shownTests(m)).toEqual([])
  })

  it('keeps it on a lane whose median stands', () => {
    const m = withOwnMedian({ posts: 72, unmeasured: 18, measured: 54, median_measured: 0 })
    expect(medianWithheld(m.own)).toBe(false)
    expect(shownTests(m).map(t => t.kind)).toEqual(['own_median'])
  })

  it('the test says how many posts it measured, and how many it left out', () => {
    const m = withOwnMedian({ posts: 72, unmeasured: 18, measured: 54, median_measured: 0 })
    const c = testCopy(shownTests(m)[0], m)
    expect(c.body).toContain('We measured 54 of the 72 posts you published')
    expect(c.body).toContain('The other 18 carry no reading we can trust')
  })

  it('leaves every other test alone', () => {
    const base = readout()
    const m = readout({
      own: { ...base.own, posts: 40, unmeasured: 24, measured: 16 },
      tests: [{ kind: 'shape', base: 9, n: {} }, { kind: 'own_median', base: 16, n: {} }, { kind: 'theme', base: 5, n: {} }],
    })
    expect(shownTests(m).map(t => t.kind)).toEqual(['shape', 'theme'])
  })
})

describe('the tests each start from a number already on the screen', () => {
  it('the shape test names the offer, its rate and its base', () => {
    const m = readout()
    const c = testCopy({ kind: 'shape', base: 9, n: { top: offer(), median_per1k: 2.2 } }, m)
    expect(c.body).toContain('Alex Vacca drew 3.3 comments')
    expect(c.body).toContain('1.5 times the 2.2')
    expect(c.body).toContain('9 ranked offers')
  })

  it('the ask test compares the two loudest asks by count', () => {
    const c = testCopy({ kind: 'ask', base: 16, n: { roster_offers: 16, link: 14, comment_gate: 2, dm_gate: 0 } }, readout())
    expect(c.body).toContain('14 asked for a link in the post')
    expect(c.body).toContain('2 asked for a word in the comments')
  })

  it('a theme under ten posts says out loud that the base is small', () => {
    const c = testCopy({ kind: 'theme', base: 5, n: { theme: 'AI in creative work', posts: 5, authors: 4, med: 29 } }, readout())
    expect(c.title).toContain('4 of them')
    expect(c.body).toContain('5 posts is a small base')
  })
})

describe('a stored reading renders from whatever the pass could fill', () => {
  it('reads headline, number, base, examples and the change', () => {
    const m = readout({
      insights: {
        run_id: 'r9',
        rows: [{
          section: 'hook_shape',
          reading: {
            headline: 'Posts opening on a number draw 2.1 times the comments',
            number: '2.1x', base: '142 posts',
            examples: [{ url: 'https://x/1', first_line: 'We spent 40,000 dollars to learn this', comments: 88 }],
            change: 'We open the next four posts on a number.',
          },
        }],
      },
    })
    const [r] = insightRows(m)
    expect(r.headline).toContain('2.1 times')
    expect(insightBase(r)).toBe('2.1x on a base of 142 posts')
    expect(r.examples[0].line).toContain('40,000 dollars')
    expect(r.change).toBe('We open the next four posts on a number.')
  })

  it('a reading with nothing but a section still renders a title and no invented number', () => {
    const m = readout({ insights: { run_id: 'r9', rows: [{ section: 'post_length', reading: {} }] } })
    const [r] = insightRows(m)
    expect(r.headline).toBe('Post length')
    expect(r.number).toBeNull()
    expect(r.base).toBeNull()
    expect(r.change).toBeNull()
    expect(r.examples).toEqual([])
    expect(insightBase(r)).toBeNull()
  })

  it('an example with no opening line says so rather than rendering a blank link', () => {
    const m = readout({
      insights: { run_id: 'r9', rows: [{ section: 'ask', reading: { examples: [{ url: 'https://x/2' }, {}, { first_line: 'only a line' }] } }] },
    })
    const [r] = insightRows(m)
    expect(r.examples).toHaveLength(3)
    expect(r.examples[0].line).toBe('We hold no opening line for this post.')
    expect(r.examples[0].comments).toBeNull()
    expect(r.examples[2].url).toBeNull()
  })

  it('keeps at most three examples and drops a row with no section', () => {
    const m = readout({
      insights: {
        run_id: 'r9',
        rows: [
          { section: 'timing', reading: { examples: [{ first_line: 'a' }, { first_line: 'b' }, { first_line: 'c' }, { first_line: 'd' }] } },
          { section: '  ', reading: { headline: 'nameless' } },
        ],
      },
    })
    const rows = insightRows(m)
    expect(rows).toHaveLength(1)
    expect(rows[0].examples).toHaveLength(3)
  })

  it('an empty key is an empty state, not an empty market', () => {
    expect(insightRows(readout())).toEqual([])
    expect(INSIGHTS_EMPTY).toBe('No readings stored for this market yet.')
  })

  it('a machine section id never reaches the screen unchanged', () => {
    expect(sectionTitle('author_size')).toBe('Author size')
    expect(sectionTitle('')).toBe('A reading')
  })
})

describe('the copy rules hold on every sentence this module writes', () => {
  const sentences = () => {
    const m = readout()
    const withheld = readout({ own: { ...m.own, posts: 40, unmeasured: 24, measured: 16, median_comments: 0, median_measured: 1 } })
    const s = ownState(withheld)
    const r = ownState(m)
    return [
      ...answer(m).lines, coverageLine(m), widerLine(m), shapeLine(m), themeLine(m), planThinLine(m),
      accountsWithPosts(m.populations),
      s.kind === 'withheld' ? s.line : '', s.kind === 'withheld' ? s.measured : '',
      r.kind === 'ready' ? r.line : '',
      ...askRows(m).map(x => x.label),
    ].filter(Boolean)
  }

  it('carries no em dash and no internal lane id', () => {
    for (const line of sentences()) {
      expect(line).not.toMatch(/—/)
      expect(line).not.toMatch(/\brisedtc\b|\bzz-selftest\b|client_id/)
    }
  })

  it('never hands the reader a job', () => {
    for (const line of sentences()) expect(line).not.toMatch(/your turn|needs you|action required/i)
  })
})
