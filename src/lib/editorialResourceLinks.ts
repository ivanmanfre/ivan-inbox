import type { EditorialClientId } from './editorialTypes.ts'
import { EditorialContractError } from './editorialTypes.ts'
import type { SynthesisAsset } from './editorialSynthesisContext.ts'

export type ResourceRecordClass = 'candidate' | 'resource' | 'promotion' | 'sales_demo'
export type ResourceRecordIdentity = {
  surface: 'catalog' | 'resource_draft'
  source?: string | null
  asset_id?: string | null
  publication_id?: string | null
}

/** Classification changes the editorial surface, never the retained row. */
export function classifyResourceRecord(row: ResourceRecordIdentity): ResourceRecordClass {
  if (row.source === 'hypertarget_demo') return 'sales_demo'
  if (row.surface === 'catalog') return 'resource'
  if (row.asset_id && row.publication_id) return 'promotion'
  return 'candidate'
}

export type ResourceRouteKind = 'open_download' | 'open_tool' | 'request_form' | 'form'
export type ResourceInspectionState = 'inspected_route' | 'functional_local' |
  'route_inspected_delivery_unverified' | 'staged_registration'
export type InspectedResourceLink = {
  client_id: EditorialClientId
  asset_id: string
  version: number
  slug: string
  title: string
  public_url: string
  public_body_sha256: string
  route_kind: ResourceRouteKind
  readiness: ResourceInspectionState
  inspection_evidence: string
  promised_quote: string
  delivery_limit: string
  catalog_state: string
}

export function resolveInspectedResource(links: InspectedResourceLink[], clientId: EditorialClientId,
  assetId: string, version: number): InspectedResourceLink {
  const link = links.find(row => row.client_id === clientId && row.asset_id === assetId && row.version === version)
  if (!link) throw new EditorialContractError('read_failed', 'No exact inspected resource identity matches this client, asset and version.', assetId)
  if (!link.inspection_evidence.trim() || !/^[a-f0-9]{64}$/.test(link.public_body_sha256)) {
    throw new EditorialContractError('read_failed', 'Exact inspection evidence and public body hash are required.', assetId)
  }
  if (!link.public_url || !link.promised_quote.trim() || !link.delivery_limit.trim()) {
    throw new EditorialContractError('read_failed', 'The inspected route, promise and delivery boundary are incomplete.', assetId)
  }
  return link
}

export type InspectedSynthesisAsset = SynthesisAsset & {
  slug: string
  inspection_state: ResourceInspectionState
  route_kind: ResourceRouteKind
  inspection_evidence: string
  delivery_limit: string
}

/** Published/catalog presence is not readiness. Only the inspected route state
 * decides whether a resource may be proposed as ready. */
export function toSynthesisResourceAsset(link: InspectedResourceLink): InspectedSynthesisAsset {
  const ready = link.readiness === 'inspected_route' || link.readiness === 'functional_local'
  return {
    id: link.asset_id, version: String(link.version), slug: link.slug, access_route: link.public_url,
    permission_basis: 'client-owned inspected resource', status: ready ? 'ready' : 'needs_material',
    catalog_state: link.catalog_state, inspection_state: link.readiness, route_kind: link.route_kind,
    inspection_evidence: link.inspection_evidence, delivery_limit: link.delivery_limit,
  }
}
