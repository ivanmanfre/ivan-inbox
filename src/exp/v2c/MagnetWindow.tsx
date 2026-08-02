import { type ReactNode } from 'react'
import { useResourceDetail } from '../../hooks/useContent'
import {
  LANE_LABEL, normalizeAgentLog, normalizeImageUrls, normalizeQa, selfContainedHtml,
  type ContentLane,
} from '../../lib/content'
import { LM_STAGE_LABEL, stageOfLm, type ResourceDetail } from '../../lib/styles'
import { Block, Rows, Val } from './ContentBits'
import { AgentRegister, QaRegister } from './Register'
import { HtmlPreview, Takeover } from './Takeover'
import { absTime, relTime } from './fmt'
import { Failed } from './Surface'

// A lead-magnet row (lm_drafts_v2), opened into the same takeover register as a
// content draft. LM rows had NO detail surface at all before this — the row
// showed a title, a chip and a landing link, and everything else in the table
// (the rendered landing artifact, the QA verdict, the agent log, the email
// copy) was invisible.
//
// READ-ONLY on purpose, same rule as the lane that opens it: whether an n8n
// watcher treats lm_drafts_v2.status='approved' as a publish trigger is
// unverifiable from this repo, so no affordance here may write that table.

function textBlock(label: string, v: string | null | undefined): ReactNode {
  const s = (v ?? '').trim()
  if (!s) return null
  return (
    <Block label={label}>
      <div className="dd-card"><div className="dd-body dd-pre">{s}</div></div>
    </Block>
  )
}

function Body({ d }: { d: ResourceDetail }) {
  const stage = stageOfLm(d)
  const log = normalizeAgentLog(d.agent_log)
  const qa = normalizeQa(d.qa)
  // covers is agent-written; the sane shape is an array of URLs, and
  // normalizeImageUrls already reads exactly that plus its string variants.
  const covers = normalizeImageUrls(d.covers)
  const heroImgs = covers.length > 0 ? covers : (d.cover_url ? [d.cover_url] : [])
  const artifact = (d.resource_html ?? '').trim()

  const links: [string, string | null][] = [
    ['Landing page', d.landing_url],
    ['Resource', d.resource_url],
    ['OG image', d.og_url],
    ['Video', d.video_url],
  ]
  const liveLinks = links.filter((l): l is [string, string] => !!(l[1] && l[1].trim()))

  const meta: [string, ReactNode][] = []
  if (d.landing_slug) meta.push(['Landing slug', d.landing_slug])
  if (d.slug) meta.push(['Slug', d.slug])
  if (d.vertical_slug) meta.push(['Vertical', d.vertical_slug])
  if (d.gate_keyword) meta.push(['Gate keyword', d.gate_keyword])
  if (d.source) meta.push(['Source', d.source])
  if (d.source_ref) meta.push(['Ref', d.source_ref])
  if (d.campaign_id) meta.push(['Campaign', d.campaign_id])
  if (d.workflow_file_id) meta.push(['Workflow file', d.workflow_file_id])

  const dates: [string, ReactNode][] = []
  if (d.created_at) dates.push(['Created', <>{relTime(d.created_at)} <span className="dd-abs">{absTime(d.created_at)}</span></>])
  if (d.updated_at) dates.push(['Updated', <>{relTime(d.updated_at)} <span className="dd-abs">{absTime(d.updated_at)}</span></>])

  return (
    <>
      <div className="dd-head">
        <div className="dd-title">{d.topic ?? 'Untitled'}</div>
        <div className="ct-meta">
          {d.format && <span className="ct-chip">{d.format}</span>}
          <span className={`ct-chip${stage === 'error' ? ' ct-chip-bad' : ''}`}>{LM_STAGE_LABEL[stage]}</span>
          {/* The raw DB value rides along when the fold changed it, so the
              legacy-vocabulary fold stays auditable from the window. */}
          {d.status && LM_STAGE_LABEL[stage].toLowerCase() !== d.status.toLowerCase() && (
            <span className="ct-ref">status: {d.status}</span>
          )}
        </div>
      </div>

      {heroImgs.length > 0 && (
        <Block label={heroImgs.length === 1 ? 'Cover' : `Covers · ${heroImgs.length}`}>
          <div className="dd-imgs">
            {heroImgs.map((u, i) => <img className="dd-img" src={u} alt="" key={`${u}-${i}`} />)}
          </div>
        </Block>
      )}

      {/* The landing-page artifact — what this lead magnet actually IS. Only
          a self-contained document earns the frame; a kit-CSS fragment would
          render as raw text (same rule as the draft window). */}
      {selfContainedHtml(artifact) && (
        <Block label="Landing artifact">
          <HtmlPreview html={artifact} title="Landing page artifact" />
        </Block>
      )}

      {liveLinks.length > 0 && (
        <Block label="Live">
          {liveLinks.map(([k, url]) => (
            <a className="dd-link" href={url} target="_blank" rel="noreferrer" key={k}>{k} ↗</a>
          ))}
        </Block>
      )}
      {!artifact && liveLinks.length === 0 && (
        <div className="ct-subtle">No rendered artifact or live URL on this row yet.</div>
      )}

      {textBlock('Description', d.description)}
      {textBlock('Post body', d.post_body)}
      {textBlock('Email copy', d.email_copy)}

      {qa && <QaRegister qa={qa} />}

      {dates.length > 0 && <Block label="Dates"><Rows items={dates} /></Block>}
      {meta.length > 0 && <Block label="Fields"><Rows items={meta} /></Block>}

      <AgentRegister log={log} />

      {/* Agent-written shapes, rendered structurally — never as a JSX child. */}
      {d.landing_copy !== null && d.landing_copy !== undefined && (
        <Block label="Landing copy"><div className="dd-card"><div className="dd-row"><div className="dd-v"><Val v={d.landing_copy} /></div></div></div></Block>
      )}
      {d.spec !== null && d.spec !== undefined && (
        <Block label="Spec"><div className="dd-card"><div className="dd-row"><div className="dd-v"><Val v={d.spec} /></div></div></div></Block>
      )}
      {d.notes !== null && d.notes !== undefined && (
        <Block label="Notes"><div className="dd-card"><div className="dd-row"><div className="dd-v"><Val v={d.notes} /></div></div></div></Block>
      )}

      <div className="ct-subtle">
        Read-only. An approve here might be a publish — the watcher that owns
        this table is not readable from this app.
      </div>
      <div style={{ height: 28 }} />
    </>
  )
}

export function MagnetWindow({ id, lane, onClose, mobile }: {
  id: string
  lane: ContentLane
  onClose: () => void
  mobile: boolean
}) {
  const { detail, missing, loading, error } = useResourceDetail(id)
  return (
    <Takeover
      label="Lead magnet"
      sub={`${LANE_LABEL[lane]}${detail?.format ? ` · ${detail.format}` : ''}`}
      onClose={onClose}
      mobile={mobile}
    >
      {error ? (
        <Failed what="This lead magnet" message={error} loadedAt={null} />
      ) : loading && !detail ? (
        <div aria-hidden style={{ padding: '18px 16px 0' }}>
          <div className="sk sk-line" style={{ width: '70%', height: 20 }} />
          <div className="sk sk-line" style={{ width: '40%', marginTop: 12 }} />
          <div className="sk" style={{ height: 220, borderRadius: 16, marginTop: 18 }} />
        </div>
      ) : missing || !detail ? (
        <div className="wb-empty">
          <div className="wb-empty-l">This lead magnet is no longer in the database.</div>
          <div className="wb-empty-s">It was removed while the lane was open.</div>
        </div>
      ) : (
        <Body d={detail} />
      )}
    </Takeover>
  )
}
