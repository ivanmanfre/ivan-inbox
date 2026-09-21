import { it, expect } from 'vitest'
import { assertMeasurementWording } from './editorialSynthesis'
import type { SynthesisSource, SynthesisSuggestion } from './editorialSynthesis'
const source = { passage: 'Not just likes, replies tell you what people actually have something to say about.', candidate_fields: { observed_metrics: { impressions: 790, comments: 0 }, linked_findings: [{formula:'likes + 3 * reposts'}] } } as unknown as SynthesisSource
const proposal = (hook: string) => ({hook,structural_beats:[],claims:[]}) as Pick<SynthesisSuggestion,'hook'|'structural_beats'|'claims'>
it('rejects real unit and qualification distortions without rewriting the model reply', () => {
  for (const copy of ['790 people saw it.', '0 said anything.', '8x its own baseline reach.', 'Replies, not likes, are the real signal.'])
    expect(() => assertMeasurementWording([source], proposal(copy))).toThrow()
})
it('accepts exact public observation units and explicitly labelled proxy limits', () => {
  for (const copy of ['790 impressions, 0 public comments as of September 20.', 'The likes + 3 × reposts proxy scored 8x its author’s baseline; actual reach is unknown.', 'Pay attention to replies as well as likes.', "The finding says crossing a baseline does not indicate the format caused the reach."])
    expect(() => assertMeasurementWording([source], proposal(copy))).not.toThrow()
})
