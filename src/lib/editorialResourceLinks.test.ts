import { describe, expect, it } from 'vitest'
import { classifyResourceRecord, resolveInspectedResource, toSynthesisResourceAsset } from './editorialResourceLinks'

const inspected = {
  client_id: 'risedtc' as const, asset_id: 'asset-1', version: 1, slug: 'kit', title: 'Kit',
  public_url: 'https://example.com/kit', public_body_sha256: 'a'.repeat(64),
  route_kind: 'open_download' as const, readiness: 'inspected_route' as const,
  inspection_evidence: 'resource/inspection.json', promised_quote: 'Download all 5 skills',
  delivery_limit: 'Direct download inspected; no comment delivery is configured.', catalog_state: 'draft',
}

describe('editorial resource identity and route contracts', () => {
  it('classifies candidates, resources, promotions and sales demos without deleting demos', () => {
    expect(classifyResourceRecord({ surface: 'resource_draft', source: 'hypertarget_demo' })).toBe('sales_demo')
    expect(classifyResourceRecord({ surface: 'catalog' })).toBe('resource')
    expect(classifyResourceRecord({ surface: 'resource_draft', asset_id: 'a', publication_id: 'p' })).toBe('promotion')
    expect(classifyResourceRecord({ surface: 'resource_draft' })).toBe('candidate')
  })

  it('resolves only an exact inspected client/asset/version relationship', () => {
    expect(resolveInspectedResource([inspected], 'risedtc', 'asset-1', 1)).toEqual(inspected)
    expect(() => resolveInspectedResource([inspected], 'arch', 'asset-1', 1)).toThrow('exact inspected resource')
    expect(() => resolveInspectedResource([{ ...inspected, inspection_evidence: '' }], 'risedtc', 'asset-1', 1))
      .toThrow('inspection evidence')
  })

  it('hands synthesis explicit inspection, route and version metadata', () => {
    expect(toSynthesisResourceAsset(inspected)).toEqual({ id: 'asset-1', version: '1', slug: 'kit',
      access_route: 'https://example.com/kit', permission_basis: 'client-owned inspected resource',
      status: 'ready', catalog_state: 'draft', inspection_state: 'inspected_route',
      route_kind: 'open_download', inspection_evidence: 'resource/inspection.json',
      delivery_limit: 'Direct download inspected; no comment delivery is configured.' })
  })

  it('does not call an inspected request form verified delivery or a staged identity live', () => {
    const request = toSynthesisResourceAsset({ ...inspected, client_id: 'arch', route_kind: 'request_form',
      readiness: 'route_inspected_delivery_unverified', delivery_limit: 'No form submission or email delivery test.' })
    expect(request.status).toBe('needs_material')
    const staged = toSynthesisResourceAsset({ ...inspected, client_id: 'ivan', asset_id: 'staged:new',
      route_kind: 'form', readiness: 'staged_registration', delivery_limit: 'No live catalog identity.' })
    expect(staged.status).toBe('needs_material')
  })
})
