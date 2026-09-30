// Generated from tools/stalled/cadence.cjs in Ivan - Content System.
// Shared legacy conversational follow-up cadence. Pure; never sends or changes state.
// Inlined into the Code node by build-workflow.cjs. Native history is authoritative
// for LinkedIn delivery; the ledger supplies operator, email and lane ownership.
export function evaluate({seat, prospect = {}, rows = [], messages = [], complete, now = Date.now(), firstGap, allowEmail = false}) {
  const DAY = 86400000, stamp = x => Date.parse(x || '') || 0;
  const no = reason => ({ok:false, reason});
  if (!complete || !Array.isArray(rows) || !Array.isArray(messages)) return no('history_incomplete');
  if (!['ivan','risedtc','arch'].includes(seat)) return no('unknown_seat');
  if(Object.prototype.hasOwnProperty.call(prospect,'icp_score') && !(prospect.icp_score >= (seat==='risedtc'?6:7) || seat==='arch' && prospect.icp_score===null)) return no('icp_below_floor');
  if (prospect.blacklisted || prospect.call_booked_at || prospect.needs_manual_reply || prospect.skip_state || prospect.skip_reason || /customer|booked|won|disqualified|archived|do_not_contact/i.test(prospect.stage || '')) return no('prospect_held');
  if (stamp(prospect.next_touch_after) > now) return no('future_date');
  const ed = prospect.enrichment_data || {};
  if (['copy_hold','lang_hold','qualification_hold','ledger_hold','person_hold','reply_hold','ops_hold','scan_delivery_hold','customer','is_customer'].some(k=>ed[k])) return no('structured_hold');
  if (rows.some(r=>stamp(r.snoozed_until)>now)) return no('snoozed');
  if (rows.some(r=>r.direction==='outbound' && !r.sent_at && !r.send_blocked_at && ['dm','email','manual_reply'].includes(r.message_type))) return no('pending_draft');
  // ARCH has an existing email composer. Its complete ledger supplies actual email
  // exchanges; unsent email drafts remain holds and never become delivery events.
  if(seat==='arch') messages=messages.concat(rows.filter(r=>r.channel==='email' && (r.direction==='inbound'||r.sent_at)).map(r=>({id:'email:'+r.id,is_sender:r.direction==='outbound',text:r.message_text,timestamp:r.sent_at||r.created_at,is_reaction:r.is_reaction,channel:'email'})));
  const nativeOutAt=Math.max(0,...messages.filter(m=>m.is_sender).map(m=>stamp(m.timestamp||m.date)));
  const ledgerOutAt=Math.max(0,...rows.filter(m=>m.direction==='outbound' && m.sent_at).map(m=>stamp(m.sent_at)));
  const latestOutAt=Math.max(nativeOutAt,ledgerOutAt);
  const nativeReactionAt=Math.max(0,...messages.filter(m=>!m.is_sender && (m.is_reaction || /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\uFE0F]+$/u.test(String(m.text||'')))).map(m=>stamp(m.timestamp||m.date)));
  const ledgerReactionAt=Math.max(0,...rows.filter(m=>m.direction==='inbound' && m.is_reaction).map(m=>stamp(m.sent_at||m.created_at)));
  if(Math.max(nativeReactionAt,ledgerReactionAt)>latestOutAt)return no('reaction_awaiting_reply');
  const real = [], seen = new Set();
  for (const m of messages) {
    if (m.is_reaction || /^\s*(?:.* reacted\s+)?[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\uFE0F]+\s*$/u.test(String(m.text || ''))) continue;
    if (!String(m.text || '').trim()) continue;
    const at=stamp(m.timestamp || m.date); if (!at) return no('invalid_timestamp');
    const key=m.id || m.message_id || `${m.is_sender}:${at}:${m.text}`;
    if (seen.has(key)) continue; seen.add(key); real.push({...m,at});
  }
  real.sort((a,b)=>a.at-b.at);
  const last=real.at(-1); if (!last) return no('empty_thread');
  if (!last.is_sender) return no('they_spoke_last');
  const inbound=real.filter(m=>!m.is_sender); const latest=inbound.at(-1);
  if (!latest) return no('no_substantive_inbound');
  const lastIn=latest.at;
  const denied=/\b(?:not interested|no thanks|stop (?:messaging|contacting)|do not contact|don['’]?t contact|we(?:'re| are) (?:all set|covered)|not for us|no relevant work)\b/i;
  const deferred=/\b(?:once .{0,100}(?:built|ready|launch|finish|budget)|(?:after|when) .{0,80}(?:launch|budget|ready)|(?:i|we)(?:'ll| will) (?:let you know|get back|be in touch) (?:when|once)|wait for me)\b/i;
  if (denied.test(latest.text)) return no('explicit_decline');
  if (deferred.test(latest.text)) return no('conditional_deferral');
  const lastLedger=rows.filter(r=>r.direction==='inbound' || (r.direction==='outbound' && r.sent_at)).filter(r=>!r.is_reaction && r.message_type!=='connection_note').sort((a,b)=>stamp(b.sent_at||b.created_at)-stamp(a.sent_at||a.created_at))[0];
  if (seat!=='arch' && !allowEmail && lastLedger?.channel==='email' && stamp(lastLedger.sent_at||lastLedger.created_at)>=last.at) return no('email_owned');
  if (rows.some(r=>/^ivan_revival/.test(r.ai_model || '') && Math.max(stamp(r.created_at),stamp(r.sent_at),stamp(r.send_blocked_at))>=lastIn)) return no('revival_owned');
  // Rejected/abandoned drafts hold this turn, but never advance the delivered-touch clock.
  if (rows.some(r=>r.direction==='outbound' && !r.sent_at && r.send_blocked_reason!=='superseded_by_followup_repair' && (r.send_blocked_at || r.send_blocked_reason) && Math.max(stamp(r.created_at),stamp(r.send_blocked_at))>=lastIn)) return no('blocked_draft');
  // Provider history must not silently lose a known delivered touch. Allow clock
  // skew/multi-bubble send latency, but fail closed on a missing delivery in this turn.
  if(rows.some(r=>r.direction==='outbound' && r.sent_at && r.channel!=='email' && stamp(r.sent_at)>lastIn && !real.some(m=>m.is_sender && Math.abs(m.at-stamp(r.sent_at))<=10*60000))) return no('delivery_history_mismatch');
  const outgoing=real.filter(m=>m.is_sender && m.at>lastIn);
  if (outgoing.some(m=>/\b(?:last (?:message|touch|follow.?up)|final (?:message|touch|follow.?up)|leave you alone|won['’]?t (?:bother|message|follow up)|will not (?:bother|message|follow up)|close (?:the|this) loop)\b/i.test(m.text))) return no('terminal_promise');
  const bursts=[];
  for (const m of outgoing) {
    const b=bursts.at(-1);
    if(b && m.at-b.last_at<=30*60000){b.last_at=m.at;b.text+='\n'+m.text;} else bursts.push({first_at:m.at,last_at:m.at,text:m.text});
  }
  if (!bursts.length) return no('no_delivered_response');
  const count=Math.max(0,bursts.length-1),gap=count===0?(firstGap || (seat==='ivan'?5:2)):[7,14,30,60,90][Math.min(count-1,4)];
  const lastAt=bursts.at(-1).last_at,due=lastAt+gap*DAY;
  return {ok:now>=due,reason:now>=due?'due':'not_due',followup_count:count,stage:count+1,gap_days:gap,last_inbound_at:new Date(lastIn).toISOString(),last_delivered_touch_at:new Date(lastAt).toISOString(),due_at:new Date(due).toISOString(),touches:bursts.map(b=>({at:new Date(b.last_at).toISOString(),text:b.text})),messages:real.slice().reverse(),quarterly_review:count>=5};
}

