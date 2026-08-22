// Assembles BALLOT.html: one self-contained file, every image inlined as a
// data URI, all CSS and JS inline, zero external requests. It opens from disk.
//
// Every "after" image on the page comes from ONE build, served at
// http://localhost:4188/ and captured by evidence/frame-arms*.mjs and
// evidence/ballot-density.mjs. The "before" images are the phase-0 baseline in
// before/, which is a different build by definition, that being the point.
//
// Usage: node build-ballot.mjs

import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..')
const BALLOT = join(OUT, 'ballot')
const BEFORE = join(OUT, 'before')

const missing = []
function dataUri(p) {
  if (!existsSync(p)) { missing.push(p); return '' }
  const ext = p.endsWith('.png') ? 'image/png' : 'image/jpeg'
  return `data:${ext};base64,${readFileSync(p).toString('base64')}`
}
const b = f => dataUri(join(BALLOT, f))
const bf = f => dataUri(join(BEFORE, f))

const REPO = '/Users/ivanmanfredi/Desktop/ivan-inbox'
const head = execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim()
// Two sibling branches had uncommitted work in src/ while these were captured.
// Naming the count is the difference between "commit X" being true and being
// approximately true.
const dirtyCount = execSync('git status --porcelain -- src/', { cwd: REPO })
  .toString().trim().split('\n').filter(Boolean).length
const dirty = dirtyCount ? `, plus ${dirtyCount} file${dirtyCount === 1 ? '' : 's'} of parallel work still uncommitted in src/` : ''

// ---------------------------------------------------------------------------
// The images. Named once here so the count in the report is countable.
// ---------------------------------------------------------------------------
const IMG = {
  frameCalA: b('frame-a-calendar-1440x900-dark.jpg'),
  frameCalB: b('frame-b-calendar-1440x900-dark.jpg'),
  frameCalC: b('frame-c-calendar-1440x900-dark.jpg'),
  frameListA: b('frame-a-content-list-1440x900-dark.jpg'),
  frameListB: b('frame-b-content-list-1440x900-dark.jpg'),
  frameListC: b('frame-c-content-list-1440x900-dark.jpg'),
  frameDw: b('frame-a-draft-window-1440x900-dark.jpg'),
  frameSettings: b('frame-settings-control-1440x900-dark.jpg'),

  dCompDms: b('bal-density-comfortable-dms-1440x900-dark.jpg'),
  dCompactDms: b('bal-density-compact-dms-1440x900-dark.jpg'),
  dCompContent: b('bal-density-comfortable-content-1440x900-dark.jpg'),
  dCompactContent: b('bal-density-compact-content-1440x900-dark.jpg'),
  dCompStyles: b('bal-density-comfortable-styles-1440x900-dark.jpg'),
  dCompactStyles: b('bal-density-compact-styles-1440x900-dark.jpg'),
  dCompSettings: b('bal-density-comfortable-settings-1440x900-dark.jpg'),
  dCompactSettings: b('bal-density-compact-settings-1440x900-dark.jpg'),

  dwBefore: bf('03-draft-window-1440x900-dark.jpg'),
  dwAfter: b('frame-a-draft-window-1440x900-dark.jpg'),
  calBefore: bf('02-content-calendar-1440x900-dark.jpg'),
  calAfter: b('frame-a-calendar-1440x900-dark.jpg'),
}

const imgCount = Object.values(IMG).filter(Boolean).length

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Workbench ballot</title>
<style>
  :root{
    --ground:#c5e1a5;
    --bg:#0b0b0a;
    --card:#141412;
    --card2:#1b1b18;
    --line:#2b2b26;
    --ink:#ecece6;
    --ink2:#a3a39a;
    --ink3:#75756c;
    --accent:#b8ff66;
    --pick:#c5e1a5;
    --r:14px;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{
    background:var(--bg); color:var(--ink);
    font:400 16px/1.55 -apple-system,system-ui,"SF Pro Text","Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .wrap{max-width:1180px;margin:0 auto;padding:40px 24px 140px}

  header.top{border-bottom:1px solid var(--line);padding-bottom:26px;margin-bottom:14px}
  header.top h1{font-size:30px;line-height:1.2;margin:0 0 10px;font-weight:600;letter-spacing:-0.01em}
  header.top .sub{color:var(--ink2);font-size:16px;max-width:78ch;margin:0 0 8px}
  header.top .meta{color:var(--ink3);font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:14px}

  section.d{border-top:1px solid var(--line);padding:34px 0 8px;scroll-margin-top:20px}
  section.d:first-of-type{border-top:none}
  .dnum{font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;color:var(--ground);text-transform:uppercase}
  section.d h2{font-size:23px;line-height:1.25;margin:10px 0 6px;font-weight:600;letter-spacing:-0.01em}
  section.d .q{color:var(--ink2);font-size:16px;max-width:80ch;margin:0 0 18px}

  .note{
    background:var(--card); border:1px solid var(--line); border-left:3px solid var(--ground);
    border-radius:var(--r); padding:16px 18px; margin:0 0 22px; max-width:88ch;
  }
  .note h3{margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--ground)}
  .note p{margin:0 0 9px;color:var(--ink2);font-size:15px;line-height:1.55}
  .note p:last-child{margin-bottom:0}
  .note b{color:var(--ink);font-weight:600}
  table.n{border-collapse:collapse;margin:10px 0 12px;font-size:14px}
  table.n td,table.n th{padding:5px 18px 5px 0;text-align:left;border-bottom:1px solid var(--line)}
  table.n th{color:var(--ink3);font-weight:500;font-size:12px;letter-spacing:.06em;text-transform:uppercase}
  table.n td{color:var(--ink2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  table.n td:first-child{color:var(--ink);font-family:inherit}

  .arms{display:grid;gap:16px;margin:0 0 10px}
  .arms.three{grid-template-columns:repeat(3,1fr)}
  .arms.two{grid-template-columns:repeat(2,1fr)}
  @media (max-width:900px){.arms.three,.arms.two{grid-template-columns:1fr}}

  .arm{background:var(--card);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;display:flex;flex-direction:column}
  .arm .shot{display:block;width:100%;height:auto;cursor:zoom-in;background:#000;border-bottom:1px solid var(--line)}
  .arm .cap{padding:12px 14px 6px}
  .arm .cap .t{font-weight:600;font-size:15px}
  .arm .cap .s{color:var(--ink3);font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:3px}
  .arm .cap .w{color:var(--ink2);font-size:14px;margin-top:6px}

  label.pick{
    display:flex;align-items:center;gap:10px;margin:8px 12px 12px;padding:9px 12px;
    border:1px solid var(--line);border-radius:10px;cursor:pointer;background:var(--card2);
    font-size:15px;user-select:none;
  }
  label.pick:hover{border-color:#3d3d36}
  label.pick input{accent-color:var(--pick);width:17px;height:17px;margin:0;cursor:pointer}
  .arm:has(input:checked){border-color:var(--pick)}
  .arm:has(input:checked) label.pick{border-color:var(--pick);background:#1f2418}
  .arm:has(input:checked) label.pick .lt{color:var(--pick);font-weight:600}

  .strip{margin:18px 0 6px}
  .strip h4{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3);margin:0 0 10px;font-weight:600}
  .single{background:var(--card);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;max-width:720px}
  .single img{display:block;width:100%;height:auto;cursor:zoom-in;background:#000}
  .single .cap{padding:11px 14px;color:var(--ink2);font-size:14px}

  /* The summary is sticky so he can see his four answers from anywhere on the
     page, and it is kept to roughly one hundred pixels because a taller one
     eats a third of the window and covers the very screens he is judging. */
  footer.sum{
    position:sticky;bottom:0;margin-top:46px;background:#100f0dfa;
    backdrop-filter:blur(6px);
    border:1px solid var(--line);border-radius:var(--r);padding:12px 16px;
    display:flex;align-items:center;gap:16px;flex-wrap:wrap;
  }
  footer.sum .lead{font-size:14px;font-weight:600;white-space:nowrap}
  footer.sum .lead span{display:block;color:var(--ink3);font-size:12px;font-weight:400}
  #picks{margin:0;flex:1 1 420px;display:flex;flex-wrap:wrap;gap:6px 10px;
    font:400 13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
  #picks .it{border:1px solid var(--line);border-radius:8px;padding:4px 9px;white-space:nowrap}
  #picks .un{color:var(--ink3)}
  #picks .on{color:var(--pick);border-color:#3f4a30;background:#1a1f14}
  .reset{background:transparent;border:1px solid var(--line);color:var(--ink2);
    border-radius:9px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
  .reset:hover{border-color:#3d3d36;color:var(--ink)}

  #lb{position:fixed;inset:0;background:rgba(0,0,0,.94);display:none;z-index:60;overflow:auto;padding:24px;cursor:zoom-out}
  #lb.on{display:block}
  #lb img{display:block;margin:0 auto;max-width:none}
  #lbhint{position:fixed;top:14px;right:20px;color:var(--ink3);font-size:13px;z-index:61;display:none}
  #lb.on ~ #lbhint{display:block}
</style>
</head>
<body>
<div class="wrap">

<header class="top">
  <h1>Four things to pick, then we ship</h1>
  <p class="sub">Each one below is a real screen at 1440 wide with your own data on it, not a description of one.
     Look, pick an arm, move on. Your answers collect at the bottom of the page so you can read them back in one place.
     Nothing here sends anywhere and nothing changes until you say so.</p>
  <p class="sub">Everything marked "after" was photographed from one build, taken today after the calendar and
     draft window work landed. The "before" shots are the baseline set from the start of the run, which is a
     different build on purpose.</p>
  <p class="meta">${imgCount} screens inlined. No network. Works offline, from the file.
     After build: commit ${head}${dirty}.</p>
</header>

<!-- ==================== 1. FRAME ==================== -->
<section class="d" id="d1">
  <div class="dnum">Decision 1</div>
  <h2>The green border around the work area</h2>
  <p class="q">You said there is a green background taking space from us. Here is that border at three widths.
     Which one do you want?</p>

  <div class="note">
    <h3>Read this before you pick</h3>
    <p>The honest number: at 1440 wide the green border costs <b>40px of 1440</b>, which is <b>2.8% of the width</b>.
       That is a smaller cost than it looks on screen. Measured on the running build, not estimated:</p>
    <table class="n">
      <tr><th>Arm</th><th>Border</th><th>Share of width</th><th>Work area</th><th>Corner</th></tr>
      <tr><td>A, wide, what ships today</td><td>40px</td><td>2.78%</td><td>1400px</td><td>40px</td></tr>
      <tr><td>B, tight</td><td>20px</td><td>1.39%</td><td>1420px</td><td>22px</td></tr>
      <tr><td>C, flush</td><td>6px</td><td>0.42%</td><td>1434px</td><td>0px</td></tr>
    </table>
    <p>The space you were actually losing on the calendar came from somewhere else and <b>is already fixed</b>.
       The calendar chips were oversized boxes eating their own cells; they now sit at 37% of the cell instead of
       filling it, which is where the room came back. So this pick is about how the app looks, not about
       reclaiming room. Pick the one you like.</p>
    <p>The green itself does not move in any arm. It is the same <code>#c5e1a5</code> in all three, verified by
       computed value on each one.</p>
  </div>

  <div class="arms three">
    <div class="arm">
      <img class="shot" src="${IMG.frameCalA}" alt="Calendar, arm A">
      <div class="cap"><div class="t">A. Wide</div><div class="s">gap 20px / corner 40px</div>
        <div class="w">What ships today. This is the one you complained about.</div></div>
      <label class="pick"><input type="radio" name="frame" value="A. Wide (as shipped)"><span class="lt">Pick A</span></label>
    </div>
    <div class="arm">
      <img class="shot" src="${IMG.frameCalB}" alt="Calendar, arm B">
      <div class="cap"><div class="t">B. Tight</div><div class="s">gap 10px / corner 22px</div>
        <div class="w">Half the border, softer corner. The green still reads as a frame.</div></div>
      <label class="pick"><input type="radio" name="frame" value="B. Tight"><span class="lt">Pick B</span></label>
    </div>
    <div class="arm">
      <img class="shot" src="${IMG.frameCalC}" alt="Calendar, arm C">
      <div class="cap"><div class="t">C. Flush</div><div class="s">gap 3px / corner 0px</div>
        <div class="w">Work area goes edge to edge. The green survives as a thin line.</div></div>
      <label class="pick"><input type="radio" name="frame" value="C. Flush"><span class="lt">Pick C</span></label>
    </div>
  </div>

  <div class="strip">
    <h4>The same three arms on the Content list</h4>
    <div class="arms three">
      <div class="arm"><img class="shot" src="${IMG.frameListA}" alt="Content list, arm A">
        <div class="cap"><div class="t">A. Wide</div><div class="s">gap 20px / corner 40px</div></div></div>
      <div class="arm"><img class="shot" src="${IMG.frameListB}" alt="Content list, arm B">
        <div class="cap"><div class="t">B. Tight</div><div class="s">gap 10px / corner 22px</div></div></div>
      <div class="arm"><img class="shot" src="${IMG.frameListC}" alt="Content list, arm C">
        <div class="cap"><div class="t">C. Flush</div><div class="s">gap 3px / corner 0px</div></div></div>
    </div>
  </div>

  <div class="strip">
    <h4>The draft window does not change, in any arm</h4>
    <div class="single">
      <img src="${IMG.frameDw}" alt="Draft window">
      <div class="cap">One picture, not three, because all three arms render this screen
        <b>byte for byte identical</b>. The draft window covers the whole screen when it opens, so the border is
        entirely behind it. Verified: same file hash for A, B and C at 1440 and again at 2560, with the arm
        confirmed live on the page each time. Your pick above will not touch this screen.</div>
    </div>
  </div>

  <div class="strip">
    <h4>Where you change it yourself, any time</h4>
    <div class="single">
      <img src="${IMG.frameSettings}" alt="Settings, Appearance group">
      <div class="cap">Settings, Appearance. Sits next to Theme and Density and works the same way.
        <b>Wide stays the default</b> until you say otherwise, so nothing moves under you.</div>
    </div>
  </div>
</section>

<!-- ==================== 2. DENSITY ==================== -->
<section class="d" id="d2">
  <div class="dnum">Decision 2</div>
  <h2>How tight the rows sit</h2>
  <p class="q">Comfortable is what you have now. Compact tightens scanning surfaces only.
     What changed: <b>the type size did not move</b>. The leading and the padding did.</p>

  <div class="note">
    <h3>Read this before you pick</h3>
    <p>The gain is real and it is modest. Measured on the running build:</p>
    <table class="n">
      <tr><th>Surface</th><th>Comfortable</th><th>Compact</th><th>What you get</th></tr>
      <tr><td>DM rows</td><td>93.8px</td><td>87.8px</td><td>one more thread on screen, 9 becomes 10</td></tr>
      <tr><td>Settings rows</td><td>72.4px</td><td>60.4px</td><td>less scrolling in Settings</td></tr>
      <tr><td>Styles cards</td><td>3 of 17 visible</td><td>4 of 17 visible</td><td>one more card</td></tr>
      <tr><td>Content list</td><td>105.3px</td><td>105.3px</td><td>nothing, and that is deliberate</td></tr>
    </table>
    <p>Do not expect it to feel dramatic. <b>The bigger density win already shipped and is not on this ballot</b>:
       the rail counts and the calendar chip, both of which went in unconditionally and are in every arm above.
       This toggle is the last few percent on top of that.</p>
    <p>Reading surfaces are untouched. The post body, the message bubbles and the draft window prose keep their
       current leading in both modes. Compact only reaches rows you scan.</p>
  </div>

  <div class="arms two">
    <div class="arm">
      <img class="shot" src="${IMG.dCompDms}" alt="DMs, comfortable">
      <div class="cap"><div class="t">DMs, comfortable</div><div class="s">row 93.8px / 16px type</div></div>
    </div>
    <div class="arm">
      <img class="shot" src="${IMG.dCompactDms}" alt="DMs, compact">
      <div class="cap"><div class="t">DMs, compact</div><div class="s">row 87.8px / 16px type</div></div>
    </div>
    <div class="arm">
      <img class="shot" src="${IMG.dCompStyles}" alt="Styles, comfortable">
      <div class="cap"><div class="t">Styles, comfortable</div><div class="s">3 cards without scrolling</div></div>
    </div>
    <div class="arm">
      <img class="shot" src="${IMG.dCompactStyles}" alt="Styles, compact">
      <div class="cap"><div class="t">Styles, compact</div><div class="s">4 cards without scrolling</div></div>
    </div>
    <div class="arm">
      <img class="shot" src="${IMG.dCompSettings}" alt="Settings, comfortable">
      <div class="cap"><div class="t">Settings, comfortable</div><div class="s">row 72.4px</div></div>
    </div>
    <div class="arm">
      <img class="shot" src="${IMG.dCompactSettings}" alt="Settings, compact">
      <div class="cap"><div class="t">Settings, compact</div><div class="s">row 60.4px</div></div>
    </div>
    <div class="arm">
      <img class="shot" src="${IMG.dCompContent}" alt="Content list, comfortable">
      <div class="cap"><div class="t">Content list, comfortable</div><div class="s">row 105.3px</div></div>
    </div>
    <div class="arm">
      <img class="shot" src="${IMG.dCompactContent}" alt="Content list, compact">
      <div class="cap"><div class="t">Content list, compact</div><div class="s">row 105.3px, unchanged on purpose</div></div>
    </div>
  </div>

  <div class="arms two">
    <div class="arm" style="padding:4px 0">
      <label class="pick"><input type="radio" name="density" value="Comfortable (as shipped)"><span class="lt">Keep comfortable</span></label>
    </div>
    <div class="arm" style="padding:4px 0">
      <label class="pick"><input type="radio" name="density" value="Compact"><span class="lt">Switch to compact</span></label>
    </div>
  </div>
</section>

<!-- ==================== 3. DRAFT WINDOW ==================== -->
<section class="d" id="d3">
  <div class="dnum">Decision 3</div>
  <h2>The draft window</h2>
  <p class="q">This is the screen you said looked like an internal tool. Left is what it was, right is what it is now.
     Is the new one better?</p>
  <div class="arms two">
    <div class="arm">
      <img class="shot" src="${IMG.dwBefore}" alt="Draft window, before">
      <div class="cap"><div class="t">Before</div><div class="s">baseline build</div>
        <div class="w">Field labels borrowed from the database, competing buttons, no clear place to look first.</div></div>
    </div>
    <div class="arm">
      <img class="shot" src="${IMG.dwAfter}" alt="Draft window, after">
      <div class="cap"><div class="t">After</div><div class="s">today\u2019s build</div>
        <div class="w">Rebuilt through a blind comparison, then four fixes on top of the winner.
          Internal names replaced with words you would say out loud.</div></div>
    </div>
  </div>
  <div class="arms two">
    <div class="arm" style="padding:4px 0">
      <label class="pick"><input type="radio" name="draft" value="Keep the new draft window"><span class="lt">Keep the new one</span></label>
    </div>
    <div class="arm" style="padding:4px 0">
      <label class="pick"><input type="radio" name="draft" value="Go back to the old draft window"><span class="lt">Put the old one back</span></label>
    </div>
  </div>
</section>

<!-- ==================== 4. CALENDAR ==================== -->
<section class="d" id="d4">
  <div class="dnum">Decision 4</div>
  <h2>The calendar</h2>
  <p class="q">You said the pills looked like ugly 3d. Left is what it was, right is what it is now.
     Is the new one better?</p>
  <div class="arms two">
    <div class="arm">
      <img class="shot" src="${IMG.calBefore}" alt="Calendar, before">
      <div class="cap"><div class="t">Before</div><div class="s">baseline build</div>
        <div class="w">Chips filling their cells, plastic-looking edges, days hard to separate.</div></div>
    </div>
    <div class="arm">
      <img class="shot" src="${IMG.calAfter}" alt="Calendar, after">
      <div class="cap"><div class="t">After</div><div class="s">today\u2019s build, arm A</div>
        <div class="w">Chip is 32px on an 86px cell, 37% instead of filling it. Flat, its own lightness step,
          one soft shadow. Holds at every width and in both themes.</div></div>
    </div>
  </div>
  <div class="arms two">
    <div class="arm" style="padding:4px 0">
      <label class="pick"><input type="radio" name="calendar" value="Keep the new calendar"><span class="lt">Keep the new one</span></label>
    </div>
    <div class="arm" style="padding:4px 0">
      <label class="pick"><input type="radio" name="calendar" value="Go back to the old calendar"><span class="lt">Put the old one back</span></label>
    </div>
  </div>
</section>

<footer class="sum">
  <div class="lead">Your answers<span>nothing is sent anywhere</span></div>
  <div id="picks"></div>
  <button class="reset" id="reset" type="button">Clear all four</button>
</footer>

</div>

<div id="lb"></div>
<div id="lbhint">click anywhere to close</div>

<script>
(function(){
  var Q = [
    {name:'frame',    label:'1 border'},
    {name:'density',  label:'2 density'},
    {name:'draft',    label:'3 draft'},
    {name:'calendar', label:'4 calendar'}
  ];
  var out = document.getElementById('picks');

  function store(k,v){ try{ localStorage.setItem('wb-ballot-'+k, v); }catch(e){} }
  function load(k){ try{ return localStorage.getItem('wb-ballot-'+k); }catch(e){ return null; } }

  function render(){
    var lines = Q.map(function(q){
      var el = document.querySelector('input[name="'+q.name+'"]:checked');
      var cls = el ? 'on' : 'un';
      var val = el ? el.value : 'not picked yet';
      return '<span class="it '+cls+'">'+q.label+'  '+val+'</span>';
    });
    out.innerHTML = lines.join('');
  }

  Q.forEach(function(q){
    var saved = load(q.name);
    if (saved){
      var el = document.querySelector('input[name="'+q.name+'"][value="'+saved.replace(/"/g,'&quot;')+'"]');
      if (el) el.checked = true;
    }
  });

  document.addEventListener('change', function(e){
    var t = e.target;
    if (t && t.type === 'radio'){ store(t.name, t.value); render(); }
  });

  document.getElementById('reset').addEventListener('click', function(){
    document.querySelectorAll('input[type=radio]').forEach(function(r){ r.checked = false; });
    Q.forEach(function(q){ try{ localStorage.removeItem('wb-ballot-'+q.name); }catch(e){} });
    render();
  });

  // Click any screen to see it at full size.
  // The lightbox image is created here rather than in the markup so the page
  // never contains an <img> without a src. An empty <img> counts as a broken
  // image to every checker that looks, including the one that verified this
  // file, and a ballot that reports a broken image is not worth arguing about.
  var lb = document.getElementById('lb');
  var lbi = null;
  function lbOpen(src){
    if (!lbi){ lbi = document.createElement('img'); lbi.alt = 'full size'; }
    lbi.src = src;
    if (!lbi.parentNode) lb.appendChild(lbi);
    lb.classList.add('on'); lb.scrollTop = 0;
  }
  function lbClose(){
    lb.classList.remove('on');
    if (lbi && lbi.parentNode) lbi.parentNode.removeChild(lbi);
  }
  document.querySelectorAll('.shot, .single img').forEach(function(im){
    im.addEventListener('click', function(){
      lbOpen(im.src);
    });
  });
  lb.addEventListener('click', lbClose);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') lbClose(); });

  render();
})();
</script>
</body>
</html>
`

const outPath = join(OUT, 'BALLOT.html')
writeFileSync(outPath, html)
const bytes = statSync(outPath).size
console.log(`wrote ${outPath}`)
console.log(`images inlined: ${imgCount}`)
console.log(`size: ${bytes} bytes  (${(bytes / 1024 / 1024).toFixed(2)} MB)`)
if (missing.length) {
  console.log('MISSING SOURCE FILES:')
  for (const m of missing) console.log('  ' + basename(m) + '   ' + m)
  process.exit(2)
}
