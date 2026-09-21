import { describe, expect, it } from 'vitest'
import { planNativeFinalization, planNativeRoute } from './editorialNativeRoute'

describe('native editorial route', () => {
  it('keeps single-image identity while dispatching held text copy', () => {
    expect(planNativeRoute('ivan','single_image',true,null)).toMatchObject({
      path:'post-gen-v2',postFormat:'text',
    })
    expect(planNativeRoute('ivan','single_image',false,null)).toBeNull()
    expect(planNativeRoute('arch','carousel',true,null)).toMatchObject({
      path:'arch-post-gen-v2',postFormat:'carousel',
    })
  })

  it('refuses video clients without an exact spoken-voice route', () => {
    expect(planNativeRoute('ivan','video',false,null)).toMatchObject({path:'video-script'})
    expect(planNativeRoute('risedtc','video',false,null)).toBeNull()
    expect(planNativeRoute('arch','video',false,null)).toBeNull()
  })

  it('requires the exact resource state before LM dispatch', () => {
    expect(planNativeRoute('risedtc','lm_promo',true,{readiness:'ready'})).toMatchObject({
      path:'lm-gen-v2',phase:'editorial_promo',
    })
    expect(planNativeRoute('risedtc','lm_promo',false,{readiness:'ready'})).toBeNull()
    expect(planNativeRoute('risedtc','resource',false,{readiness:'needs_material',artifact_role:'guide'})).toBeNull()
    expect(planNativeRoute('risedtc','resource',false,{readiness:'ready',artifact_role:'guide'})).toMatchObject({
      path:'lm-gen-v2',phase:'editorial_resource',
    })
  })
})

describe('terminal dispatch reconciliation', () => {
  const base = {
    artifactId: 'art-1', requestId: 'req-1', briefHash: 'a'.repeat(64),
    selectedQaCopy: 'the selected final copy', selectedAssessmentId: 'qa-1',
  }

  it('never labels a claimed or transport-ambiguous job complete', () => {
    expect(planNativeFinalization({ ...base, dispatchState: 'claimed', transportAmbiguous: true }))
      .toMatchObject({ decision: 'hold_unreconciled', reported_state: 'claimed', persist: false })
    expect(planNativeFinalization({ ...base, dispatchState: 'claimed', transportAmbiguous: false }))
      .toMatchObject({ decision: 'persist_final', reported_state: 'complete', persist: true })
  })

  it('refuses to persist a failed original as the corrected final', () => {
    expect(planNativeFinalization({ ...base, dispatchState: 'failed', transportAmbiguous: false }))
      .toMatchObject({ decision: 'failed_original_retained', reported_state: 'failed', persist: false })
  })

  it('replays an identical completed job without a second native write', () => {
    expect(planNativeFinalization({ ...base, dispatchState: 'complete',
      transportAmbiguous: false, persistedCopy: base.selectedQaCopy, persistedAssessmentId: 'qa-1' }))
      .toMatchObject({ decision: 'idempotent_replay', reported_state: 'complete', persist: false })
  })

  it('refuses a completed job whose stored copy is not the selected QA copy', () => {
    expect(planNativeFinalization({ ...base, dispatchState: 'complete',
      transportAmbiguous: false, persistedCopy: 'something else', persistedAssessmentId: 'qa-1' }))
      .toMatchObject({ decision: 'persisted_copy_conflict', reported_state: 'complete', persist: false })
  })

  it('refuses an empty final copy rather than persisting a blank draft', () => {
    expect(planNativeFinalization({ ...base, dispatchState: 'claimed',
      transportAmbiguous: false, selectedQaCopy: '   ' }))
      .toMatchObject({ decision: 'no_selected_copy', persist: false })
  })
})
