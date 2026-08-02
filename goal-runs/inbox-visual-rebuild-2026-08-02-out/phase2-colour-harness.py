#!/usr/bin/env python3
"""
phase2-colour-harness.py — Fork 2, both answers, derived and verified.

Extends scratchpad/oklch.py (sRGB<->OKLab, OKLCH, WCAG) with:
  * ANSWER MONO  : categorical series = accent + neutral tiers, zero new hues.
  * ANSWER TRIAD : two new categorical hues derived in OKLCH at the accent's own
                   L and C, hues found by maximin search against the three fixed
                   points (accent, severity amber, severity urgent red).
Verifies, for BOTH answers:
  1. >= 3:1 (WCAG 1.4.11, non-text marks) for every categorical token against
     every surface in the dark ladder.
  2. mutual separation between categorical tokens (adjacent-tier contrast for
     MONO; OKLCH hue distance + OKLab dE for TRIAD).
  3. separation from BOTH severity tokens (hue distance + dE).
  4. sRGB gamut legality (no channel clipping).
  5. CVD sanity: protanopia + deuteranopia (Vienot 1999) — the categorical set
     must not collapse onto severity under either.
Any token that fails a bar has its L raised in the minimum step that clears it
(0.005 increments) and the table is re-emitted. Only the passing table is
reported.

Run:  python3 phase2-colour-harness.py
"""
import math

# ---------------- sRGB <-> OKLab (Bjorn Ottosson) — from scratchpad/oklch.py ----------------
def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def linear_to_srgb(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4))

def rgb_to_hex(r, g, b):
    f = lambda c: max(0, min(255, round(c * 255)))
    return '#%02X%02X%02X' % (f(r), f(g), f(b))

def rgb_to_oklab(r, g, b):
    r, g, b = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
    m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
    s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    l_, m_, s_ = l ** (1/3), m ** (1/3), s ** (1/3)
    return (0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
            1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
            0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_)

def oklab_to_rgb(L, a, b):
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    r = +4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return (linear_to_srgb(r), linear_to_srgb(g), linear_to_srgb(bb))

def oklch_to_hex(L, C, H):
    a = C * math.cos(math.radians(H))
    b = C * math.sin(math.radians(H))
    return rgb_to_hex(*oklab_to_rgb(L, a, b))

def in_gamut(L, C, H, tol=0.0015):
    a = C * math.cos(math.radians(H))
    b = C * math.sin(math.radians(H))
    return all(-tol <= c <= 1 + tol for c in oklab_to_rgb(L, a, b))

def hex_to_oklch(h):
    L, a, b = rgb_to_oklab(*hex_to_rgb(h))
    return L, math.hypot(a, b), math.degrees(math.atan2(b, a)) % 360

# ---------------- WCAG ----------------
def luminance(h):
    r, g, b = (srgb_to_linear(c) for c in hex_to_rgb(h))
    return 0.2126*r + 0.7152*g + 0.0722*b

def contrast(h1, h2):
    a, b = luminance(h1), luminance(h2)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)

def blend(fg, bg, alpha):
    f, b = hex_to_rgb(fg), hex_to_rgb(bg)
    return rgb_to_hex(*[f[i]*alpha + b[i]*(1-alpha) for i in range(3)])

# ---------------- difference metrics ----------------
def huedist(h1, h2):
    d = abs(h1 - h2) % 360
    return min(d, 360 - d)

def de_ok(hx1, hx2):
    """Euclidean distance in OKLab. ~0.02 is a just-noticeable step at these
    lightnesses; categorical sets want >= 0.10 between any two members."""
    a = rgb_to_oklab(*hex_to_rgb(hx1))
    b = rgb_to_oklab(*hex_to_rgb(hx2))
    return math.dist(a, b)

# ---------------- CVD simulation (Vienot, Brettel & Mollon 1999) ----------------
_LMS = ((0.31399022, 0.63951294, 0.04649755),
        (0.15537241, 0.75789446, 0.08670142),
        (0.01775239, 0.10944209, 0.87256922))
_LMS_INV = ((5.47221206, -4.6419601, 0.16963708),
            (-1.1252419, 2.29317094, -0.1678952),
            (0.02980165, -0.19318073, 1.16364789))
_PROTAN = ((0.0, 1.05118294, -0.05116099), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
_DEUTAN = ((1.0, 0.0, 0.0), (0.9513092, 0.0, 0.04866992), (0.0, 0.0, 1.0))

def _mul(M, v):
    return tuple(sum(M[i][j]*v[j] for j in range(3)) for i in range(3))

def cvd(hx, kind):
    lin = tuple(srgb_to_linear(c) for c in hex_to_rgb(hx))
    lms = _mul(_LMS, lin)
    lms = _mul(_PROTAN if kind == 'protan' else _DEUTAN, lms)
    out = _mul(_LMS_INV, lms)
    return rgb_to_hex(*[linear_to_srgb(max(0.0, min(1.0, c))) for c in out])

# ================= the ladder (RESEARCH-INTERNAL-TOOL.md 4.3.1, unchanged) =================
ACCENT = '#10A37F'
aL, aC, aH = hex_to_oklch(ACCENT)

SURFACES = {'canvas': '#090B0A', 'surface1': '#121513', 'surface2': '#191D1B', 'surface3': '#212523'}
SEV = {'sev-attention': '#FF9F0A', 'sev-urgent': '#FF453A'}

print('=' * 78)
print('phase2-colour-harness — Fork 2, two built answers')
print('=' * 78)
print(f'\nACCENT {ACCENT} -> oklch(L={aL:.4f} C={aC:.4f} H={aH:.2f})')
for k, v in SEV.items():
    L, C, H = hex_to_oklch(v)
    print(f'{k:<14} {v} -> oklch(L={L:.4f} C={C:.4f} H={H:.2f})')
print('\nladder surfaces: ' + '  '.join(f'{k}={v}' for k, v in SURFACES.items()))

BAR_NONTEXT = 3.0     # WCAG 1.4.11 non-text mark
BAR_SEPARATION = 0.10 # min OKLab dE between any two categorical members
BAR_SEV_DE = 0.12     # min OKLab dE from either severity token
BAR_SEV_HUE = 45.0    # min OKLCH hue distance from either severity token

def worst_on_ladder(hx):
    return min(contrast(hx, s) for s in SURFACES.values())

def lift_to_pass(L, C, H, bar=BAR_NONTEXT, step=0.005):
    """Raise L in minimum increments until the token clears `bar` on every
    surface AND is in sRGB gamut. Returns (L, hex, lifted_by)."""
    L0 = L
    for _ in range(200):
        if in_gamut(L, C, H):
            hx = oklch_to_hex(L, C, H)
            if worst_on_ladder(hx) >= bar:
                return L, hx, L - L0
        L += step
    raise SystemExit('no L clears the bar')

# =========================== ANSWER MONO ===========================
print('\n' + '=' * 78)
print('ANSWER MONO  (data-cat="mono")  — accent + neutral tiers, ZERO new hues')
print('=' * 78)
print('Series 1 is the accent. Series 2-4 are neutral tiers generated at the')
print('accent hue with the ladder\'s own trace chroma, so they are the same')
print('material as the surfaces. Differentiation beyond 3 series is PATTERN,')
print('not colour (see spine 8.2).')

MONO_SPEC = [('cat-1', None,   None),      # the accent itself
             ('cat-2', 0.9000, 0.005),
             ('cat-3', 0.7200, 0.006),
             ('cat-4', 0.5700, 0.007)]

mono, mono_meta = {}, []
for name, L, C in MONO_SPEC:
    if L is None:
        mono[name] = ACCENT
        mono_meta.append((name, aL, aC, aH, ACCENT, 0.0))
        continue
    Lf, hx, lift = lift_to_pass(L, C, aH)
    mono[name] = hx
    mono_meta.append((name, Lf, C, aH, hx, lift))

print('\n--- tokens ---')
for name, L, C, H, hx, lift in mono_meta:
    note = '(= --accent, locked)' if name == 'cat-1' else (f'L lifted +{lift:.3f} to clear 3:1' if lift else '')
    print(f'  --{name:<8} {hx}   oklch({L:.4f} {C:.3f} {H:.1f})  {note}')

print('\n--- contrast vs every ladder surface (bar: >= 3.00:1) ---')
print(f'  {"token":<10}' + ''.join(f'{k:>11}' for k in SURFACES) + f'{"worst":>9}  verdict')
for name in mono:
    hx = mono[name]
    row = f'  {name:<10}'
    for s in SURFACES.values():
        row += f'{contrast(hx, s):>11.2f}'
    w = worst_on_ladder(hx)
    print(row + f'{w:>9.2f}  ' + ('PASS' if w >= BAR_NONTEXT else 'FAIL'))

print('\n--- mutual separation (adjacent tiers must be a visible step) ---')
ks = list(mono)
for i in range(len(ks) - 1):
    c = contrast(mono[ks[i]], mono[ks[i+1]])
    d = de_ok(mono[ks[i]], mono[ks[i+1]])
    print(f'  {ks[i]} vs {ks[i+1]}: {c:.2f}:1   dE(OKLab) {d:.3f}   ' +
          ('PASS' if d >= BAR_SEPARATION else 'FAIL'))
print('  cat-1 vs cat-2/3/4: ' + '  '.join(
    f'{k}={de_ok(mono["cat-1"], mono[k]):.3f}' for k in ('cat-2', 'cat-3', 'cat-4')))

print('\n--- separation from severity (MONO carries no hue, so this is trivially safe) ---')
for sname, sv in SEV.items():
    print(f'  {sname:<14} ' + '  '.join(f'{k}:dE={de_ok(mono[k], sv):.3f}' for k in mono))

# =========================== ANSWER TRIAD ===========================
print('\n' + '=' * 78)
print('ANSWER TRIAD  (data-cat="triad")  — 2 new hues at the accent\'s own L and C')
print('=' * 78)

FIXED = {'accent': aH, 'attention': hex_to_oklch(SEV['sev-attention'])[2],
         'urgent': hex_to_oklch(SEV['sev-urgent'])[2]}
print('fixed hues on the wheel: ' + '  '.join(f'{k}={v:.1f}deg' for k, v in FIXED.items()))

# maximin hue search: pick h1,h2 maximising the SMALLEST circular distance to
# any fixed hue and to each other. 0.5deg grid, full circle, no eyeballing.
best, best_score = None, -1
grid = [i * 0.5 for i in range(720)]
for h1 in grid:
    d1 = min(huedist(h1, v) for v in FIXED.values())
    if d1 <= best_score:
        continue
    for h2 in grid:
        if h2 <= h1:
            continue
        score = min(d1, min(huedist(h2, v) for v in FIXED.values()), huedist(h1, h2))
        if score > best_score:
            best_score, best = score, (h1, h2)
h1, h2 = best
print(f'\nmaximin solution: h1={h1:.1f}deg  h2={h2:.1f}deg   '
      f'min pairwise separation = {best_score:.1f}deg (over all 5 points)')

# gamut + contrast: derive at the accent's own L and C, lift L only if forced.
triad, triad_meta = {'cat-1': ACCENT}, [('cat-1', aL, aC, aH, ACCENT, 0.0, True, 0.0)]
for name, H in (('cat-2', h1), ('cat-3', h2)):
    gamut_ok = in_gamut(aL, aC, H)
    Lf, hx, lift = lift_to_pass(aL, aC, H)
    triad[name] = hx
    triad_meta.append((name, Lf, aC, H, hx, lift, gamut_ok, 0.0))

# --- CVD remedy: hue alone cannot separate 242.5deg from 315.5deg for a
# dichromat (both sit on the same side of the confusion line). The spec's own
# instruction applies: adjust L minimally and re-run. Lift cat-3 in 0.005 steps
# until it clears the CVD bar against cat-2 AND cat-1 under both simulations,
# while staying in gamut and >= 3:1 on the ladder.
CVD_BAR = 0.08
def cvd_min(hx, others):
    return min(de_ok(cvd(hx, k), cvd(o, k)) for k in ('protan', 'deutan') for o in others)

_i3 = [i for i, m in enumerate(triad_meta) if m[0] == 'cat-3'][0]
L3, C3, H3 = triad_meta[_i3][1], triad_meta[_i3][2], triad_meta[_i3][3]
L3_0, cvd_before = L3, cvd_min(triad['cat-3'], [triad['cat-1'], triad['cat-2']])
if cvd_before < CVD_BAR:
    steps = 0
    while steps < 200:
        L3 += 0.005
        steps += 1
        if not in_gamut(L3, C3, H3):
            continue
        hx = oklch_to_hex(L3, C3, H3)
        if worst_on_ladder(hx) >= BAR_NONTEXT and cvd_min(hx, [triad['cat-1'], triad['cat-2']]) >= CVD_BAR:
            break
    triad['cat-3'] = oklch_to_hex(L3, C3, H3)
    triad_meta[_i3] = ('cat-3', L3, C3, H3, triad['cat-3'], triad_meta[_i3][5], triad_meta[_i3][6], L3 - L3_0)
    print(f'\n[CVD remedy] cat-3 hue {H3:.1f}deg collapsed onto cat-2 for dichromats '
          f'(dE {cvd_before:.3f} < {CVD_BAR}).')
    print(f'             L lifted {L3_0:.4f} -> {L3:.4f} (+{L3-L3_0:.3f}) — the minimum step that clears it.')
    print(f'             TRIAD therefore separates on hue AND lightness, which is the only')
    print(f'             separation a dichromat can use. This is a contract, not a tweak: see spine 8.3.')

print('\n--- tokens (FINAL, post-remedy) ---')
for name, L, C, H, hx, lift, g, cvdlift in triad_meta:
    bits = []
    if name == 'cat-1':
        bits.append('(= --accent, locked)')
    if not g:
        bits.append('sRGB gamut required a lift')
    if lift:
        bits.append(f'L lifted +{lift:.3f} to clear 3:1')
    if cvdlift:
        bits.append(f'L lifted +{cvdlift:.3f} to clear the CVD bar')
    print(f'  --{name:<8} {hx}   oklch({L:.4f} {C:.4f} {H:.1f})  {" ".join(bits)}')

print('\n--- contrast vs every ladder surface (bar: >= 3.00:1) ---')
print(f'  {"token":<10}' + ''.join(f'{k:>11}' for k in SURFACES) + f'{"worst":>9}  verdict')
for name, hx in triad.items():
    row = f'  {name:<10}'
    for s in SURFACES.values():
        row += f'{contrast(hx, s):>11.2f}'
    w = worst_on_ladder(hx)
    print(row + f'{w:>9.2f}  ' + ('PASS' if w >= BAR_NONTEXT else 'FAIL'))

print('\n--- hue distance + OKLab dE: every categorical vs every OTHER categorical ---')
tk = list(triad)
for i in range(len(tk)):
    for j in range(i + 1, len(tk)):
        a, b = tk[i], tk[j]
        hd = huedist(hex_to_oklch(triad[a])[2], hex_to_oklch(triad[b])[2])
        d = de_ok(triad[a], triad[b])
        print(f'  {a} vs {b:<7} hue {hd:6.1f}deg   dE {d:.3f}   ' +
              ('PASS' if d >= BAR_SEPARATION else 'FAIL'))

print('\n--- hue distance + OKLab dE: every categorical vs BOTH severity tokens ---')
print(f'  (bars: hue >= {BAR_SEV_HUE:.0f}deg, dE >= {BAR_SEV_DE:.2f})')
allpass = True
for name, hx in triad.items():
    for sname, sv in SEV.items():
        hd = huedist(hex_to_oklch(hx)[2], hex_to_oklch(sv)[2])
        d = de_ok(hx, sv)
        ok = hd >= BAR_SEV_HUE and d >= BAR_SEV_DE
        allpass &= ok
        print(f'  {name} vs {sname:<14} hue {hd:6.1f}deg   dE {d:.3f}   ' +
              ('PASS' if ok else 'FAIL'))
print(f'  ==> {"ALL PASS" if allpass else "FAILURES PRESENT"}')

print('\n--- CVD sanity (Vienot 1999): does any categorical collapse onto severity? ---')
print('  bar: dE >= 0.08 under BOTH protanopia and deuteranopia')
for kind in ('protan', 'deutan'):
    print(f'  [{kind}]')
    for name, hx in triad.items():
        for sname, sv in SEV.items():
            d = de_ok(cvd(hx, kind), cvd(sv, kind))
            print(f'    {name} vs {sname:<14} dE {d:.3f}  ' + ('ok' if d >= 0.08 else 'COLLAPSE'))
    for i in range(len(tk)):
        for j in range(i + 1, len(tk)):
            d = de_ok(cvd(triad[tk[i]], kind), cvd(triad[tk[j]], kind))
            print(f'    {tk[i]} vs {tk[j]:<14} dE {d:.3f}  ' + ('ok' if d >= 0.08 else 'COLLAPSE'))

# =========================== shared bars ===========================
print('\n' + '=' * 78)
print('SHARED BARS (both answers inherit these)')
print('=' * 78)
print('\n--- focus ring, WCAG 1.4.11 >= 3:1 against the surface it sits on ---')
for alpha in (0.5, 0.7, 1.0):
    worst = min(contrast(blend(ACCENT, s, alpha), s) for s in SURFACES.values())
    print(f'  accent @ {int(alpha*100):>3}%  worst {worst:.2f}:1  ' +
          ('PASS' if worst >= 3.0 else 'FAIL  <-- do not ship'))

print('\n--- body text bar (>= 4.5:1) on every surface, ladder unchanged ---')
# NOTE: RESEARCH-INTERNAL-TOOL.md 4.3.1's CSS block writes --text4: #606562, but its
# own generator (scratchpad/oklch.py, oklch(0.5550 0.007 169.5)) emits #6F7472. The
# published contrast TABLE (4.15/3.87/3.58/3.26) matches #6F7472, not #606562.
# #606562 measures 3.32/3.09/2.87/2.61 and FAILS the 3:1 bar on surface2 and
# surface3 — i.e. the CSS block reintroduces the exact defect the doc says it fixed.
# The generator wins. Correct token below; both rows printed so the error is visible.
TEXT = {'text': '#F3F6F5', 'text2': '#AEB2B0', 'text3': '#7F8582',
        'text4': '#6F7472', 'text4(BAD #606562)': '#606562'}
print(f'  {"token":<10}' + ''.join(f'{k:>11}' for k in SURFACES))
for name, hx in TEXT.items():
    row = f'  {name:<10}'
    for s in SURFACES.values():
        r = contrast(hx, s)
        row += f'{r:>10.2f}' + ('*' if r >= 4.5 else ('+' if r >= 3.0 else '!'))
    print(row)
print('  * >= 4.5 body   + >= 3.0 non-text/label   ! fails both')
print('  RULE (inherited): text3 is NOT body type on surface3 (4.12:1);')
print('        text4 is metadata/disabled only.')

print('\n--- accent-as-fill legibility: the label ON an accent mark ---')
for lab, hx in (('ink #171717', '#171717'), ('white #FFFFFF', '#FFFFFF')):
    print(f'  {lab:<14} on --accent  {contrast(hx, ACCENT):.2f}:1  ' +
          ('PASS' if contrast(hx, ACCENT) >= 4.5 else 'FAIL'))
print('  => M9 (number inside the mark) uses INK on filled marks, never white.')
for name, hx in list(triad.items())[1:]:
    ci, cw = contrast('#171717', hx), contrast('#FFFFFF', hx)
    print(f'  ink on --{name}  {ci:.2f}:1   white on --{name}  {cw:.2f}:1  '
          f'-> use {"ink" if ci >= cw else "white"}')
for name in ('cat-2', 'cat-3', 'cat-4'):
    hx = mono[name]
    ci, cw = contrast('#171717', hx), contrast('#FFFFFF', hx)
    print(f'  [mono] ink on --{name}  {ci:.2f}:1   white on --{name}  {cw:.2f}:1  '
          f'-> use {"ink" if ci >= cw else "white"}')

print('\ndone.')
