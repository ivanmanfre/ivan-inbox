import { describe, expect, it } from 'vitest'
import { planNativeRoute } from './editorialNativeRoute'

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
