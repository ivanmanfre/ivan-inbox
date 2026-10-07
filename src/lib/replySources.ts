import { supabase } from './supabase'

export type Days = 7 | 30 | 90;
export type Touch = 'connection_note' | 'dm1' | 'dm2' | 'dm3' | 'dm4' | 'dm5'
  | 'recycle' | 'followup' | 'conversation_reply' | 'requested_delivery' | 'inmail' | 'email' | 'unknown';
export type ReplySource = {
  reply_id: string; reply_at: string; source_id: string | null; sent_at: string | null;
  touch: Touch; sequence_step: number | null; campaign_id: string | null;
  method: 'inferred_same_chat' | 'unknown'; reason: string | null;
  channel: 'linkedin' | 'email' | 'unknown'; product: 'dm' | 'inmail' | 'email' | 'unknown';
  channel_basis: 'recorded' | 'chat_inferred' | 'unknown';
  followup_ordinal: number | null; episode_outcome: 'replied' | 'interrupted' | 'unknown' | null;
};
export type ReplyMetrics = {
  schema_version: 1; client_id: string; as_of: string; configured: true;
  period: { days: Days; from: string; to: string; basis: 'rolling_utc'; observation_days: 7 };
  coverage: {
    history_complete: false; first_event_at: string | null; feature_started_on: '2026-10-07';
    classifier_version: 'reply-touch-v1'; seat_basis: 'registered_client_lane';
    campaign_basis: 'current_prospect_membership'; population_basis: 'message_history_v1';
    unknown_campaign_basis: 'inbound_current_campaign';
    record_identities: number; excluded_people: number; missing_receipts: number;
    uncertain_sends: number; duplicate_rows: number; identity_conflicts: number;
    missing_chats: number; channel_conflicts: number; unknown_purpose: number;
    unknown_sources: number; unknown_episodes: number; interrupted_episodes: number;
    current_template_purpose: number;
  };
  totals: { first_responders: number; recipients: number; reactions: number; followup_responders: number };
  sources: { touch: Touch; responders: number; positive: number; unclassified: number; share_pct: number | null }[];
  touches: { touch: Touch; sends: number; recipients: number; eligible: number; mature: number;
    pending: number; replies_7d: number; rate_pct: number | null; late: number; repeated: number }[];
  followups: { ordinal: number; episodes: number; responders: number; mature: number; pending: number;
    replies_7d: number; rate_pct: number | null; late: number }[];
};
export type SourceDetail = {
  schema_version: 1; as_of: string;
  first_reply: ReplySource | null; latest_reply: ReplySource | null;
};
export type ReadResult<T> = { status: 'ok'; data: T }
  | { status: 'preview' | 'not_configured' | 'not_found'; data: null };
export type ReadState<T> = { kind: 'loading' }
  | { kind: 'ready'; data: T }
  | { kind: 'preview' | 'not_configured' | 'empty' | 'unavailable' | 'denied' }
  | { kind: 'error'; message: string };

export type ReplyScope =
  | { kind: 'operator'; clientId: string; campaignId?: string }
  | { kind: 'board-token'; slug: string; token: string }
  | { kind: 'board-session'; slug: string; session: string }
  | { kind: 'preview' };

export const TOUCHES: readonly Touch[] = ['connection_note', 'dm1', 'dm2', 'dm3', 'dm4', 'dm5', 'recycle', 'followup', 'conversation_reply', 'requested_delivery', 'inmail', 'email', 'unknown']
const LABELS: Record<Touch, string> = { connection_note: 'Connection note', dm1: 'DM1', dm2: 'DM2', dm3: 'DM3', dm4: 'DM4', dm5: 'DM5', recycle: 'Recycle', followup: 'Conversation follow-up', conversation_reply: 'Conversation reply', requested_delivery: 'Requested delivery', inmail: 'InMail', email: 'Email', unknown: 'Unknown touch' }
export const formatReplyPct = (value: number | null): string => value === null ? '—' : `${value.toFixed(1)}%`
export const touchLabel = (touch: Touch): string => LABELS[touch]

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const pct = (v: unknown) => v === null || typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
const date = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Number.isFinite(Date.parse(v))
const nullable = (v: unknown, check: (v: unknown) => boolean) => v === null || check(v)
const string = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const counts = (v: Record<string, unknown>, keys: readonly string[]) => keys.every(k => count(v[k]))
const fixedRows = (v: unknown, check: (v: Record<string, unknown>) => boolean) => Array.isArray(v) && v.length === TOUCHES.length && v.every((r, i) => object(r) && r.touch === TOUCHES[i] && check(r))
function metrics(v: unknown): v is ReplyMetrics {
  if (!object(v) || v.schema_version !== 1 || !string(v.client_id) || !date(v.as_of) || v.configured !== true) return false
  const p = v.period, c = v.coverage, t = v.totals
  if (!object(p) || ![7, 30, 90].includes(p.days as number) || p.basis !== 'rolling_utc' || p.observation_days !== 7 || !date(p.from) || !date(p.to) || Date.parse(p.to) !== Date.parse(v.as_of) || Date.parse(p.to) - Date.parse(p.from) !== Number(p.days) * 86400000) return false
  if (!object(c) || c.history_complete !== false || !nullable(c.first_event_at, date) || c.feature_started_on !== '2026-10-07' || c.classifier_version !== 'reply-touch-v1' || c.seat_basis !== 'registered_client_lane' || c.campaign_basis !== 'current_prospect_membership' || c.population_basis !== 'message_history_v1' || c.unknown_campaign_basis !== 'inbound_current_campaign') return false
  if (!counts(c, ['record_identities', 'excluded_people', 'missing_receipts', 'uncertain_sends', 'duplicate_rows', 'identity_conflicts', 'missing_chats', 'channel_conflicts', 'unknown_purpose', 'unknown_sources', 'unknown_episodes', 'interrupted_episodes', 'current_template_purpose'])) return false
  if (!object(t) || !counts(t, ['first_responders', 'recipients', 'reactions', 'followup_responders'])) return false
  if (!fixedRows(v.sources, r => counts(r, ['responders', 'positive', 'unclassified']) && pct(r.share_pct) && Number(r.positive) + Number(r.unclassified) <= Number(r.responders) && (t.first_responders === 0 ? r.share_pct === null : r.share_pct !== null))) return false
  const rate = (r: Record<string, unknown>) => pct(r.rate_pct) && (r.mature === 0 ? r.rate_pct === null : r.rate_pct !== null) && Number(r.replies_7d) <= Number(r.mature)
  if (!fixedRows(v.touches, r => counts(r, ['sends', 'recipients', 'eligible', 'mature', 'pending', 'replies_7d', 'late', 'repeated']) && rate(r) && Number(r.mature) + Number(r.pending) === r.eligible)) return false
  if (!Array.isArray(v.followups) || !v.followups.every((r, i, rows) => object(r) && count(r.ordinal) && r.ordinal > 0 && (i === 0 || Number(rows[i - 1].ordinal) < r.ordinal) && counts(r, ['episodes', 'responders', 'mature', 'pending', 'replies_7d', 'late']) && rate(r) && Number(r.mature) + Number(r.pending) === r.episodes)) return false
  return true
}
function source(v: unknown): v is ReplySource {
  if (!object(v)) return false
  return string(v.reply_id) && date(v.reply_at) && nullable(v.source_id, string) && nullable(v.sent_at, date)
    && TOUCHES.includes(v.touch as Touch) && nullable(v.sequence_step, count) && nullable(v.campaign_id, string)
    && ['inferred_same_chat', 'unknown'].includes(v.method as string) && nullable(v.reason, string)
    && ['linkedin', 'email', 'unknown'].includes(v.channel as string) && ['dm', 'inmail', 'email', 'unknown'].includes(v.product as string)
    && ['recorded', 'chat_inferred', 'unknown'].includes(v.channel_basis as string)
    && nullable(v.followup_ordinal, x => count(x) && x > 0) && (v.episode_outcome === null || ['replied', 'interrupted', 'unknown'].includes(v.episode_outcome as string))
}
function detail(v: unknown): v is SourceDetail {
  return object(v) && v.schema_version === 1 && date(v.as_of) && nullable(v.first_reply, source) && nullable(v.latest_reply, source)
}
const readError = { kind: 'error', message: 'Could not read reply sources. Try again.' } as const
async function read<T>(name: string, params: Record<string, unknown>, check: (v: unknown) => v is T): Promise<ReadState<T>> {
  try {
    const { data, error } = await supabase.rpc(name, params)
    if (error) {
      if (['42501', 'PGRST301', 'PGRST302', 'PGRST303', '401', '403'].includes(error.code) || [401, 403].includes(Number((error as unknown as { status?: number }).status))) return { kind: 'denied' }
      if (['PGRST202', '42883'].includes(error.code)) return { kind: 'unavailable' }
      return readError
    }
    if (!object(data)) return { kind: 'unavailable' }
    if (['preview', 'not_configured', 'not_found'].includes(data.status as string) && data.data === null) return { kind: data.status === 'not_found' ? 'empty' : data.status as 'preview' | 'not_configured' }
    if (data.status !== 'ok' || !check(data.data)) return { kind: 'unavailable' }
    return { kind: 'ready', data: data.data }
  } catch { return readError }
}
export function loadReplySources(scope: ReplyScope, days: Days): Promise<ReadState<ReplyMetrics>> {
  if (scope.kind === 'preview') return Promise.resolve({ kind: 'preview' })
  if (scope.kind === 'operator') return read('outreach_reply_sources', { p_client_id: scope.clientId, p_days: days, p_campaign_id: scope.campaignId ?? null }, metrics)
  if (scope.kind === 'board-session') return read('client_board_reply_sources_v2', { p_slug: scope.slug, p_session: scope.session, p_days: days }, metrics)
  return read('client_board_reply_sources', { p_slug: scope.slug, p_token: scope.token, p_days: days }, metrics)
}
export function loadReplySource(scope: ReplyScope, prospectId: string): Promise<ReadState<SourceDetail>> {
  if (scope.kind === 'preview') return Promise.resolve({ kind: 'preview' })
  if (scope.kind === 'operator') return read('inbox_reply_source', { p_prospect_id: prospectId }, detail)
  if (scope.kind === 'board-session') return read('client_board_reply_source_v2', { p_slug: scope.slug, p_session: scope.session, p_prospect_id: prospectId }, detail)
  return read('client_board_reply_source', { p_slug: scope.slug, p_token: scope.token, p_prospect_id: prospectId }, detail)
}
