export type PlanSlot = {slot_id:string; purpose:string; format:string; ordinal:number}
export type PackedWeeklyPlan = {encoding:'weekly-plan-tuples-v1';week:Array<[string,string,string]>;target_ordinals:number[]}

/** Every immutable slot identity appears exactly once in the request. Ordinals
 * select the target partition without a second copy of the long slot ID. */
export function packWeeklyPlan(slots:PlanSlot[],target:PlanSlot[]):PackedWeeklyPlan {
  if(slots.some((slot,index)=>slot.ordinal!==index+1 || !slot.slot_id || !slot.purpose || !slot.format) ||
      new Set(slots.map(slot=>slot.slot_id)).size!==slots.length)
    throw new Error('Frozen weekly plan has invalid ordinal or duplicate slot identity')
  const byId=new Map(slots.map(slot=>[slot.slot_id,slot]))
  const target_ordinals=target.map(slot=>{
    const pinned=byId.get(slot.slot_id)
    if(!pinned || pinned.ordinal!==slot.ordinal || pinned.purpose!==slot.purpose || pinned.format!==slot.format)
      throw new Error('Target group differs from frozen whole-week plan')
    return slot.ordinal
  })
  if(new Set(target_ordinals).size!==target_ordinals.length)
    throw new Error('Target group repeats a frozen slot')
  return {encoding:'weekly-plan-tuples-v1',week:slots.map(slot=>[slot.slot_id,slot.purpose,slot.format]),target_ordinals}
}

export function unpackWeeklyPlan(packed:PackedWeeklyPlan):{slots:PlanSlot[];target:PlanSlot[]} {
  if(packed.encoding!=='weekly-plan-tuples-v1' || !Array.isArray(packed.week) || !Array.isArray(packed.target_ordinals))
    throw new Error('Invalid weekly plan encoding')
  const slots=packed.week.map((tuple,index)=>{
    if(!Array.isArray(tuple) || tuple.length!==3 || tuple.some(value=>typeof value!=='string'||!value))
      throw new Error('Invalid weekly plan tuple')
    return {slot_id:tuple[0],purpose:tuple[1],format:tuple[2],ordinal:index+1}
  })
  if(new Set(slots.map(slot=>slot.slot_id)).size!==slots.length)
    throw new Error('Duplicate weekly plan identity')
  const target=packed.target_ordinals.map(index=>{
    if(!Number.isSafeInteger(index)||index<1||index>slots.length)
      throw new Error('Unknown target ordinal')
    return slots[index-1]
  })
  if(new Set(packed.target_ordinals).size!==target.length)
    throw new Error('Duplicate target ordinal')
  return {slots,target}
}
