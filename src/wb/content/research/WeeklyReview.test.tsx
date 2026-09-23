// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
vi.mock('../../../lib/supabase',()=>({supabase:{}}))
vi.mock('../../../lib/editorialWeeklyRead',()=>({readEditorialWeeklyReview:vi.fn()}))
vi.mock('../../../lib/editorialDirection',()=>({readEditorialDirection:vi.fn(),adoptEditorialDirection:vi.fn()}))
vi.mock('../../../lib/editorialBriefs',async original=>({...await original<typeof import('../../../lib/editorialBriefs')>(),readBrief:vi.fn(),readBriefs:vi.fn()}))
import { readEditorialWeeklyReview } from '../../../lib/editorialWeeklyRead'
import { readEditorialDirection } from '../../../lib/editorialDirection'
import { readBrief, readBriefs } from '../../../lib/editorialBriefs'
import { brief } from '../../../lib/editorialBriefs.fixtures'
import { ThisWeekPanel, EditorialClientProvider } from './ResearchWorkspace'
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it('renders frozen slot gaps and exact brief versions after current direction changed, without substituting latest batch',async()=>{
 const b=brief(); const id=b.identity.client_id; const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 vi.mocked(readEditorialDirection).mockResolvedValue({client_id:id,active_version:'new-direction',direction:{statement:'New strategy'},status:'active',audience:null,source:'fixture',updated_at:'2026-09-23'})
 vi.mocked(readEditorialWeeklyReview).mockResolvedValue({state:'ready',client_id:id,manifest_hash:'a'.repeat(64),available_weeks:['2026-09-28'],links:[{slot_id:'slot1',brief_id:b.identity.brief_id,brief_version:b.identity.version,linked_at:'2026-09-23'}],manifest:{contract_version:1,client_id:id,direction_version:b.purpose.direction_version,week_start:'2026-09-28',policy_status:'proposed',active_client_proof_credit:true,purpose_counts:{reach:2},slot_requirements:[],slots:[1,2].map(n=>({slot_id:`slot${n}`,ordinal:n,purpose:'reach',format:'text',client_id:id,direction_version:b.purpose.direction_version,week_start:'2026-09-28',route_ready:true,asset_gap:null}))}})
 vi.mocked(readBrief).mockResolvedValue({found:true,brief:b})
 try {await act(async()=>root.render(<ThisWeekPanel lane={id}/>));expect(host.textContent).toContain('Saved week · 2026-09-28');expect(host.querySelectorAll('[data-slot-id]')).toHaveLength(2);expect(host.textContent).toContain('No exact linked brief yet; content gap');expect(host.textContent).toContain('earlier direction');expect(host.textContent).toContain(b.editorial_direction.topic);expect(readBrief).toHaveBeenCalledWith(expect.anything(),id,b.identity.brief_id,b.identity.version);expect(readBriefs).not.toHaveBeenCalled()}finally{await act(async()=>root.unmount());host.remove()}
})

it('refreshes the exact saved proposed week and refuses refreshing a stale direction', async()=>{
 vi.clearAllMocks()
 const b=brief();const lane=b.identity.client_id;const version=b.purpose.direction_version
 const client={rpc:vi.fn(),functions:{invoke:vi.fn(async()=>({data:{status:'accepted'},error:null}))}}
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 vi.mocked(readEditorialDirection).mockResolvedValue({client_id:lane,active_version:version,direction:{statement:'Current strategy'},status:'active',audience:null,source:'fixture',updated_at:'2026-09-23'})
 const manifest={contract_version:1 as const,client_id:lane,direction_version:version,week_start:'2026-09-28',policy_status:'proposed' as const,active_client_proof_credit:true,purpose_counts:{reach:1},slot_requirements:[],slots:[{slot_id:'slot1',ordinal:1,purpose:'reach',format:'text',client_id:lane,direction_version:version,week_start:'2026-09-28',route_ready:true,asset_gap:null}],policy_snapshot:{suggestion_id:'proposal-9'}}
 vi.mocked(readEditorialWeeklyReview).mockResolvedValue({state:'ready',client_id:lane,manifest_hash:'b'.repeat(64),available_weeks:['2026-09-28'],available_plans:[{week_start:'2026-09-28',direction_version:version,manifest_hash:'b'.repeat(64)}],links:[],manifest})
 try{
  await act(async()=>root.render(<EditorialClientProvider client={client}><ThisWeekPanel lane={lane}/></EditorialClientProvider>))
  const refresh=()=>Array.from(host.querySelectorAll('button')).find(x=>x.textContent==='Refresh suggestions')!
  await act(async()=>refresh().click())
  expect(client.functions.invoke).toHaveBeenCalledWith('editorial-refresh',{body:expect.objectContaining({client_id:lane,expected_direction_version:version,week_start:'2026-09-28',expected_manifest_hash:'b'.repeat(64),provisional_policy_suggestion_id:'proposal-9'})})
  vi.mocked(readEditorialDirection).mockResolvedValue({client_id:lane,active_version:'newer',direction:{statement:'Changed'},status:'active',audience:null,source:'fixture',updated_at:'2026-09-23'})
  await act(async()=>refresh().click())
  expect(client.functions.invoke).toHaveBeenCalledTimes(1)
  expect(host.textContent).toContain('refresh requires a plan for the current direction')
 }finally{await act(async()=>root.unmount());host.remove()}
})

it('opens an exact linked brief without reading or substituting the latest batch', async()=>{
 vi.clearAllMocks()
 const b=brief(); const lane=b.identity.client_id; const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 vi.mocked(readEditorialDirection).mockResolvedValue({client_id:lane,active_version:'new-direction',direction:{statement:'Current'},status:'active',audience:null,source:'fixture',updated_at:'2026-09-23'})
 vi.mocked(readEditorialWeeklyReview).mockResolvedValue({state:'empty',client_id:lane,manifest:null,links:[],available_weeks:[]})
 vi.mocked(readBrief).mockResolvedValue({found:true,brief:b})
 try {await act(async()=>root.render(<ThisWeekPanel lane={lane} exactBrief={{id:b.identity.brief_id,version:b.identity.version}}/>))
  expect(host.textContent).toContain(`Exact brief link · ${b.identity.brief_id} v${b.identity.version}`)
  expect(host.textContent).toContain(b.editorial_direction.topic)
  expect(readBrief).toHaveBeenCalledWith(expect.anything(),lane,b.identity.brief_id,b.identity.version)
  expect(readBriefs).not.toHaveBeenCalled()
 }finally{await act(async()=>root.unmount());host.remove()}
})
