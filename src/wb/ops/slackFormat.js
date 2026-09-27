/* COPY of formatBookingForSlack in the n8n workflow "Ops Drafts → Slack"
   (4B3D9O9gvAaAWBe2): the booking card body -> Slack mrkdwn at post time.
   CHANGE ONE, CHANGE BOTH, or the card previews one message and Slack gets another.
   Kept as plain JS, byte-for-byte with the workflow, so a diff shows any drift. */
export function formatBookingForSlack(body, ctx) {
  ctx = ctx || {};
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cap = (w) => w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  const labelFor = (url) => {
    let u; try { u = new URL(url); } catch (e) { return "link"; }
    const host = u.hostname.replace(/^www\./, "");
    const segs = u.pathname.split("/").filter(Boolean);
    const last = (segs[segs.length - 1] || "").replace(/\.html?$/i, "");
    if (/audit/i.test(u.pathname) || (ctx.audit_url && url.replace(/\/$/, "") === String(ctx.audit_url).replace(/\/$/, ""))) {
      const m = last.match(/^(.+?)-audit$/i);
      return m ? m[1].split("-").map(cap).join(" ") + " audit" : "the audit";
    }
    if (segs[0] === "scan" || (ctx.scan_url && url === ctx.scan_url)) return "their scan";
    if (/precall|pre-call|\/brief\b/i.test(url) || (ctx.brief_url && url === ctx.brief_url)) return "Open the pre-call brief";
    return host;
  };
  // Escape plain text, keep any <...|...> Slack link Ivan typed by hand, embed every bare URL.
  const linkify = (text) => text.split(/(<(?:https?:\/\/|mailto:)[^>]*>)/).map((part, i) => {
    if (i % 2 === 1) return part;
    let out = "", last = 0;
    const rx = /https?:\/\/[^\s<>|]+/g; let m;
    while ((m = rx.exec(part))) {
      let url = m[0]; const trail = (url.match(/[.,;:!?)\]]+$/) || [""])[0];
      url = url.slice(0, url.length - trail.length);
      out += esc(part.slice(last, m.index)) + "<" + url + "|" + esc(labelFor(url)) + ">" + esc(trail);
      last = m.index + m[0].length;
    }
    return out + esc(part.slice(last));
  }).join("");
  const WEEKDAY = /^((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,[^.\n]*?\d{1,2}:\d{2}[^.\n]*?)(?:\.\s*|\s*$)/;
  const whenStr = String(ctx.when_str || "").trim();
  const out = [];
  const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  lines.forEach((raw) => {
    let line = raw.trim();
    if (!line) { out.push(""); return; }
    if (!out.some(Boolean)) {
      line = line.replace(/\.$/, "");
      if (/^🔥/.test(line)) { out.push(linkify(line)); return; }
      const hm = line.match(/^(New call booked)\b(.*)$/i);
      out.push("🔥🔥🔥 " + (hm ? "*" + esc(hm[1]) + "*" + linkify(hm[2]) : linkify(line)));
      return;
    }
    const brief = line.match(/^(?:📋\s*)?Pre-call brief(?: here)?:\s*(https?:\/\/\S+?)[.]?$/i);
    if (brief) { out.push("📋 <" + brief[1] + "|Open the pre-call brief>"); return; }
    let whenPart = null, rest = null;
    if (whenStr && line.startsWith(whenStr)) {
      whenPart = whenStr; rest = line.slice(whenStr.length).replace(/^\.\s*/, "").trim();
    } else {
      const wm = line.match(WEEKDAY);
      if (wm) { whenPart = wm[1].trim(); rest = line.slice(wm[0].length).trim(); }
    }
    if (whenPart !== null && !/^📅/.test(line)) {
      out.push("📅 " + esc(whenPart));
      if (rest) out.push(linkify(rest));
      return;
    }
    out.push(linkify(line));
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
