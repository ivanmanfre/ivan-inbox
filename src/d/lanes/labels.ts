// Plain-English names for the lane keys stored on prospects (LANES.md labels).
const LANE: Record<string, string> = {
  company_expansion: 'Colleagues of good leads', engager_warm: 'Engager', hiring_signal: 'Hiring signal', funding_signal: 'Funding', new_in_role: 'New in role',
  profile_view: 'Profile view', israel_trip: 'Israel', cold_games: 'Cold (games)', cold_apps: 'Cold (apps)', warm_games: 'Warm (games)', warm_apps: 'Warm (apps)',
  sponsor_team: 'Sponsor team', sponsor_mined: 'Sponsor', soft_launch: 'Soft launch', orbit_pilot_fintech: 'Orbit pilot (fintech)', orbit_pilot_csaas: 'Orbit pilot (SaaS)',
  test_geo_ads: 'Geo ads test', hand_raise: 'Hand raise', own_post_engager: 'Own post engager',
}
export const laneLabel = (k: string) => LANE[k] ?? k.replace(/_/g, ' ')

export const STAGE_LABEL: Record<string, string> = {
  enriched: 'Found', ballot_hold: 'Waiting for a look', expansion_hold: 'Held for a colleague', queued: 'Queued', connection_sent: 'Invited', connected: 'Connected',
  dm_sent: 'Messaged', replied: 'Replied', positive_reply: 'Positive reply', skipped: 'Skipped', archived: 'Archived', disqualified: 'Disqualified', inmail_failed: 'InMail failed',
}
export const LIVE_STAGES = new Set(['connection_sent', 'connected', 'dm_sent', 'replied', 'positive_reply'])
export const OFF_STAGES = new Set(['archived', 'skipped', 'disqualified', 'inmail_failed'])
