import { expect, it } from 'vitest'
import { mirror, barPct, supplyVerdict } from './Supply'
import { verdict } from '../Refill'
import type { Supply } from '../supply'
it('mirror shares a scale, marks Warsaw today and never invents a reading',()=>{
 const now=Date.parse('2026-10-07T22:30:00Z')
 expect(mirror(null,now).days).toBeNull()
 expect(mirror([{day:'2026-10-08',inn:12,out:6}],now)).toMatchObject({max:12,today:0})
})
it('keeps the existing supply verdict arithmetic',()=>{
 const s={ready:100,qualified14:20,sent14:40,refill:.5,runwayDays:5,netPerDay:-2,emptyDays:50} as unknown as Supply
 expect(verdict(s)).toBeTruthy()
})

it('flow conclusions require a verified flow read; zero bars imply no activity',()=>{
 const s={ready:100,out7:0,refill:null,runwayDays:null} as Supply
 expect(supplyVerdict(s,false)).toBeNull();expect(supplyVerdict(s,true)).toBeTruthy()
 expect(supplyVerdict({...s,ready:0},false)).toBeTruthy()
 expect(barPct(0,12)).toBe(0);expect(barPct(6,12)).toBe(50)
})
