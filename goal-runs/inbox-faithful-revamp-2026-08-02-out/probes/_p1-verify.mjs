import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT='/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/inbox-faithful-revamp-2026-08-02-out/phase1-shots';
const raw = fs.readFileSync('.session.json','utf8');
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:1440,height:900} });
const p = await c.newPage();
await p.addInitScript(r=>localStorage.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', r), raw);
await p.goto('http://localhost:5431/#exp/v2/content',{waitUntil:'domcontentloaded'});
for(let i=0;i<40;i++){const s=await p.evaluate(()=>({sk:document.querySelectorAll('.sk').length,len:document.body.innerText.length}));if(s.sk===0&&s.len>2000)break;await p.waitForTimeout(500);}
await p.waitForTimeout(1200);
const out={};
// contract probes on the new controls
out.controls = await p.evaluate(()=>{
  const sel = '.ct-fpill,.ct-fx,.ct-fclear-all,.wb-fopt,.ct-fsheet-grab';
  const els = Array.from(document.querySelectorAll(sel));
  const tags = {}; const cursors = {}; const trans = new Set(); const eases = new Set();
  for(const e of els){ const cs=getComputedStyle(e);
    tags[e.tagName]=(tags[e.tagName]||0)+1; cursors[cs.cursor]=(cursors[cs.cursor]||0)+1;
    trans.add(cs.transitionProperty+' '+cs.transitionDuration); eases.add(cs.transitionTimingFunction); }
  return { n: els.length, tags, cursors, transitions:[...trans], eases:[...eases] };
});
// keyboard: tab into a pill and check the ring
out.focus = await p.evaluate(()=>{
  const pill = document.querySelector('.ct-fpill');
  pill.focus();
  const cs = getComputedStyle(pill);
  return { active: document.activeElement.className, tabIndex: pill.tabIndex, outline: cs.outlineWidth+' '+cs.outlineStyle };
});
// open the "Filters" disclosure and screenshot it
await p.evaluate(()=>{ Array.from(document.querySelectorAll('.ct-fpill')).find(x=>/^Filters/.test(x.innerText))?.click(); });
await p.waitForTimeout(300);
out.morePanel = await p.evaluate(()=>{
  const m=document.querySelector('.ct-fmenu-wide'); if(!m) return null;
  const groups=Array.from(m.querySelectorAll('.ct-fgrp-h')).map(g=>g.innerText.trim());
  return { groups, optionCount:m.querySelectorAll('.wb-fopt').length, h:Math.round(m.getBoundingClientRect().height), scrollH:m.scrollHeight };
});
await p.screenshot({path:`${OUT}/filters-panel-1440.png`});
// pick two demoted values, check the badge
await p.evaluate(()=>{ const o=document.querySelectorAll('.ct-fmenu-wide .wb-fopt'); o[1]?.click(); });
await p.waitForTimeout(250);
await p.evaluate(()=>{ const o=Array.from(document.querySelectorAll('.ct-fmenu-wide .wb-fopt')); const i=o.findIndex(x=>/^Any/.test(x.innerText)&&o.indexOf(x)>3); o[i+1]?.click(); });
await p.waitForTimeout(300);
out.badge = await p.evaluate(()=>({
  pill: Array.from(document.querySelectorAll('.ct-fpill')).find(x=>/^Filters/.test(x.innerText))?.innerText.replace(/\s+/g,' ').trim(),
  note: document.querySelector('.ct-fnote')?.innerText.replace(/\s+/g,' ').trim(),
  ls: localStorage.getItem('wb-section:content.posts.ivan'),
}));
await p.keyboard.press('Escape');
await p.waitForTimeout(200);
out.escClosed = await p.evaluate(()=>document.querySelectorAll('.ct-fmenu').length===0);
await p.evaluate(()=>document.querySelector('.ct-fclear-all')?.click());
await p.waitForTimeout(300);
// LM lane: scroll to it and shoot
await p.evaluate(()=>document.getElementById('wb-lm-lane')?.scrollIntoView({block:'start'}));
await p.waitForTimeout(600);
out.lm = await p.evaluate(()=>{
  const lane=document.getElementById('wb-lm-lane');
  const f=lane?.querySelector('.ct-filters');
  return { h: f?Math.round(f.getBoundingClientRect().height):null,
    pills: Array.from(lane.querySelectorAll('.ct-fpill')).map(x=>x.innerText.replace(/\s+/g,' ').trim()),
    search: !!lane.querySelector('.ct-fsearch-in') };
});
await p.screenshot({path:`${OUT}/lm-lane-1440.png`});
// Mattan lane
await p.evaluate(()=>{ Array.from(document.querySelectorAll('.chips .chip')).find(c=>/Mattan/i.test(c.innerText))?.click(); });
for(let i=0;i<30;i++){const s=await p.evaluate(()=>document.querySelectorAll('.sk').length);if(s===0)break;await p.waitForTimeout(400);}
await p.waitForTimeout(1500);
out.mattan = await p.evaluate(()=>({
  h: Math.round(document.querySelector('.ct-filters')?.getBoundingClientRect().height??-1),
  firstCardY: Math.round(document.querySelector('.ct-card')?.getBoundingClientRect().top??-1),
  pills: Array.from(document.querySelectorAll('.ct-fpill')).map(x=>x.innerText.replace(/\s+/g,' ').trim()),
}));
await p.screenshot({path:`${OUT}/mattan-1440.png`});
await b.close();
console.log(JSON.stringify(out,null,1));
