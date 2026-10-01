// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { ScheduleSheet, ScheduledSends } from './Schedule'
import { drafted, threads } from './fixtures'
import * as schedule from '../../lib/dmSchedule'
import * as context from '../../lib/context'
vi.mock('../../lib/context', () => ({ fetchProspectContext: vi.fn(async () => ({ location: 'Los Angeles, California, United States' })) }))
vi.mock('../../lib/dmSchedule', async orig => ({ ...(await orig<typeof import('../../lib/dmSchedule')>()), scheduleDm: vi.fn(async () => {}), fetchScheduledDms: vi.fn(async () => []), cancelScheduledDm: vi.fn(async () => {}) }))
const t=threads(drafted('s', {prospect_name:'Shaun'}))[0]
beforeEach(()=>{ vi.clearAllMocks(); vi.useFakeTimers({shouldAdvanceTime:true}); vi.setSystemTime(new Date('2026-10-01T10:00:00Z')) })
afterEach(()=>{ cleanup(); vi.useRealTimers() })
it('suggests profile timezone, allows override, and schedules only on explicit submission',async()=>{
 const saved=vi.fn(), closed=vi.fn()
 renderInFrame(<ScheduleSheet t={t} target={{ids:['draft-1'],texts:['Exact words :)']}} onSaved={saved} onClose={closed}/>)
 const zone=screen.getByLabelText('Recipient timezone')
 await waitFor(()=>expect((zone as HTMLSelectElement).value).toBe('America/Los_Angeles'))
 expect(schedule.scheduleDm).not.toHaveBeenCalled()
 fireEvent.change(screen.getByLabelText('Send date'),{target:{value:'2026-10-02'}})
 fireEvent.change(zone,{target:{value:'America/New_York'}})
 fireEvent.change(screen.getByLabelText('Recipient local send time'),{target:{value:'09:00'}})
 fireEvent.click(screen.getByRole('button',{name:'Schedule send'}))
 await waitFor(()=>expect(saved).toHaveBeenCalledOnce())
 expect(schedule.scheduleDm).toHaveBeenCalledWith(t,['draft-1'],['Exact words :)'],'2026-10-02T13:00:00.000Z','America/New_York')
 expect(closed).toHaveBeenCalledOnce()
})
it('requires a timezone when the profile is missing and refuses a past time',async()=>{
 vi.mocked(context.fetchProspectContext).mockResolvedValueOnce({location:null} as never)
 renderInFrame(<ScheduleSheet t={t} target={{ids:[],texts:['Exact']}} onSaved={()=>{}} onClose={()=>{}} />)
 await screen.findByText(/No location saved/)
 expect(screen.getByRole('button',{name:'Schedule send'})).toBeDisabled()
 fireEvent.change(screen.getByLabelText('Recipient timezone'),{target:{value:'America/Los_Angeles'}})
 fireEvent.change(screen.getByLabelText('Send date'),{target:{value:'2026-09-30'}})
 expect(screen.getByRole('button',{name:'Schedule send'})).toBeDisabled()
 expect(schedule.scheduleDm).not.toHaveBeenCalled()
})
it('keeps the sheet and exact copy on a failed schedule write',async()=>{
 vi.mocked(schedule.scheduleDm).mockRejectedValueOnce({message:'The draft changed. Refresh.'})
 renderInFrame(<ScheduleSheet t={t} target={{ids:['draft'],texts:['Original copy'],timezone:'America/Los_Angeles',at:'2026-10-02T14:00:00Z'}} onSaved={()=>{}} onClose={()=>{}}/>)
 await waitFor(()=>expect(screen.getByRole('button',{name:'Save schedule'})).not.toBeDisabled())
 fireEvent.click(screen.getByRole('button',{name:'Save schedule'}))
 expect(await screen.findByRole('alert')).toHaveTextContent('The draft changed. Refresh.')
 expect(screen.getByText('Original copy')).toBeTruthy()
})
it('shows the actual scheduled time and offers edit or cancellation',async()=>{
 vi.mocked(schedule.fetchScheduledDms).mockResolvedValueOnce([{id:'s1',message_text:'Exact copy',channel:'linkedin',at:'2026-10-01T14:00:00Z',timezone:'America/Los_Angeles',ids:['s1']}])
 const reload=vi.fn(),edit=vi.fn()
 renderInFrame(<ScheduledSends t={t} reload={reload} onEdit={edit}/>)
 await screen.findByText(/Scheduled:.*07:00/)
 fireEvent.click(screen.getByRole('button',{name:'Edit schedule'})); expect(edit).toHaveBeenCalledWith(expect.objectContaining({ids:['s1'],texts:['Exact copy']}))
 fireEvent.click(screen.getByRole('button',{name:'Cancel scheduled send'}))
 await waitFor(()=>expect(reload).toHaveBeenCalledOnce())
 expect(schedule.cancelScheduledDm).toHaveBeenCalledWith('s1')
})
