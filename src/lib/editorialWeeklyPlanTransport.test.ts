import { describe, expect, it } from 'vitest'
import { packWeeklyPlan, unpackWeeklyPlan } from './editorialWeeklyPlanTransport'

const slots=[
  {slot_id:'weekly:ivan:v1:2026-09-28:1',ordinal:1,purpose:'reach',format:'text'},
  {slot_id:'weekly:ivan:v1:2026-09-28:2',ordinal:2,purpose:'reach',format:'video'},
  {slot_id:'weekly:ivan:v1:2026-09-28:3',ordinal:3,purpose:'buyer',format:'carousel'},
]

describe('lossless whole-week plan transport',()=>{
  it('includes all identities once, selects exact targets by ordinal, and roundtrips all fields',()=>{
    const packed=packWeeklyPlan(slots,[slots[2]])
    expect(packed.week).toEqual(slots.map(slot=>[slot.slot_id,slot.purpose,slot.format]))
    expect(packed.target_ordinals).toEqual([3])
    expect(unpackWeeklyPlan(packed)).toEqual({slots,target:[slots[2]]})
  })
  it('rejects mismatched tenant/version identities, mutated format, and duplicate target',()=>{
    expect(()=>packWeeklyPlan(slots,[{...slots[2],slot_id:'weekly:arch:v1:2026-09-28:3'}])).toThrow()
    expect(()=>packWeeklyPlan(slots,[{...slots[2],format:'video'}])).toThrow()
    expect(()=>packWeeklyPlan(slots,[slots[2],slots[2]])).toThrow()
    expect(()=>packWeeklyPlan([{...slots[0],ordinal:2},...slots.slice(1)],[slots[2]])).toThrow()
  })
  it('rejects unknown, noninteger, and repeated target ordinals when decoding',()=>{
    const packed=packWeeklyPlan(slots,[slots[0]])
    for(const target_ordinals of [[0],[4],[1.2],[1,1]])
      expect(()=>unpackWeeklyPlan({...packed,target_ordinals})).toThrow()
  })
})
