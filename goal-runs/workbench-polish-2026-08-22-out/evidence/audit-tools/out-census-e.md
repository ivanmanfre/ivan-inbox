### E1 · padding values actually computed, bucketed by role

| role | elements | distinct padding values | the values (n = instances) | off-scale |
|---|---|---|---|---|
| **button** | 113 | **15** | 2px(4) 4px(14) 5px(64) 6px(68) 7px(10) 8px(32) 9px(6) 10px(38) 11px(4) 12px(46) 13px(18) 14px(18) 16px(12) 18px(8) 24px(8) | **2px**(4) **5px**(64) **6px**(68) **7px**(10) **9px**(6) **10px**(38) **11px**(4) **13px**(18) **14px**(18) **18px**(8) |
| **card** | 165 | **10** | 2px(38) 6px(336) 8px(2) 12px(21) 13px(12) 14px(38) 16px(16) 18px(2) 20px(2) 24px(52) | **2px**(38) **6px**(336) **13px**(12) **14px**(38) **18px**(2) **20px**(2) |
| **chip** | 139 | **8** | 1px(76) 2px(42) 3px(16) 5px(60) 6px(76) 8px(68) 11px(6) 16px(34) | **1px**(76) **2px**(42) **3px**(16) **5px**(60) **6px**(76) **11px**(6) |
| **input** | 3 | **4** | 9px(2) 10px(2) 11px(4) 16px(4) | **9px**(2) **10px**(2) **11px**(4) |
| **other** | 578 | **18** | 1px(76) 2px(15) 4px(25) 6px(43) 7px(48) 8px(62) 9px(6) 10px(264) 11px(8) 12px(106) 14px(209) 16px(78) 20px(3) 22px(2) 24px(6) 28px(4) 30px(1) 40px(1) | **1px**(76) **2px**(15) **6px**(43) **7px**(48) **9px**(6) **10px**(264) **11px**(8) **14px**(209) **20px**(3) **22px**(2) **28px**(4) **30px**(1) **40px**(1) |
| **pane** | 108 | **12** | 2px(21) 3px(10) 6px(14) 8px(42) 9px(1) 10px(50) 12px(24) 13px(1) 14px(55) 16px(26) 20px(10) 32px(11) | **2px**(21) **3px**(10) **6px**(14) **9px**(1) **10px**(50) **13px**(1) **14px**(55) **20px**(10) **32px**(11) |
| **row** | 101 | **8** | 2px(8) 6px(2) 10px(110) 12px(41) 13px(1) 14px(4) 16px(50) 24px(14) | **2px**(8) **6px**(2) **10px**(110) **13px**(1) **14px**(4) |
| **section** | 131 | **11** | 2px(25) 3px(2) 4px(33) 6px(17) 7px(2) 8px(5) 10px(17) 12px(12) 14px(19) 16px(59) 18px(4) | **2px**(25) **3px**(2) **6px**(17) **7px**(2) **10px**(17) **14px**(19) **18px**(4) |

### E2 · gap values

| gap | instances | on scale? |
|---|---|---|
| 1px | 60 | **NO** |
| 2px | 88 | **NO** |
| 3px | 41 | **NO** |
| 4px | 336 | yes (--sp-1) |
| 5px | 98 | **NO** |
| 6px | 307 | **NO** |
| 7px | 47 | **NO** |
| 8px | 321 | yes (--sp-2) |
| 9px | 38 | **NO** |
| 10px | 63 | **NO** |
| 11px | 200 | **NO** |
| 12px | 203 | yes (--sp-3) |
| 13px | 8 | **NO** |
| 16px | 19 | yes (--sp-4 / --gut) |
| 18px | 4 | **NO** |
| 20px | 4 | **NO** |
| 24px | 5 | yes (--sp-5 / --pad-card) |

### E3 · the most common padding pairs

Elements carrying any padding: **871**. Distinct padding quadruples: **96**.

| padding (T R B L) | instances | share of padded elements | roles | on scale? |
|---|---|---|---|---|
| `10 14 10 14` | 111 | 12.7% | other 100, pane 10, row 1 | **NO** |
| `6 6 6 6` | 84 | 9.6% | card 84 | **NO** |
| `1 6 1 6` | 52 | 6.0% | chip 34, other 18 | **NO** |
| `10 16 10 16` | 51 | 5.9% | row 25, other 18, section 8 | **NO** |
| `5 6 5 6` | 32 | 3.7% | button 32 | **NO** |
| `8 12 8 12` | 29 | 3.3% | other 28, button 1 | yes |
| `0 16 0 16` | 28 | 3.2% | chip 17, section 7, other 4 | yes |
| `5 8 5 8` | 26 | 3.0% | chip 26 | **NO** |
| `10 0 10 0` | 23 | 2.6% | row 22, other 1 | **NO** |
| `0 12 0 12` | 21 | 2.4% | button 18, other 2, card 1 | yes |
| `1 7 1 7` | 20 | 2.3% | other 20 | **NO** |
| `2 0 2 0` | 19 | 2.2% | chip 17, other 2 | **NO** |
| `2 14 2 14` | 19 | 2.2% | card 19 | **NO** |
| `24 24 24 24` | 15 | 1.7% | card 13, button 2 | yes |
| `12 16 12 16` | 15 | 1.7% | card 8, other 4, pane 2 | yes |
| `0 10 0 10` | 14 | 1.6% | button 11, other 3 | **NO** |

**Most common padding on a SECTION-level element** (pane, card or section: 293 elements, 40 distinct quadruples):

| padding | instances | share of sections |
|---|---|---|
| `6 6 6 6` | 84 | **28.7%** |
| `2 14 2 14` | 19 | **6.5%** |
| `24 24 24 24` | 13 | **4.4%** |
| `20 14 16 14` | 10 | **3.4%** |
| `2 8 16 8` | 10 | **3.4%** |
| `0 0 0 10` | 10 | **3.4%** |
| `0 0 3 2` | 10 | **3.4%** |
| `10 14 10 14` | 10 | **3.4%** |

### E4 · off-scale offenders (any padding or gap not in {0,4,8,12,16,24})

Off-scale declarations: **2972** of 4748 non-zero spacing values = **62.6%**. Distinct off-scale numbers: **18**.

| value | instances | roles | worst offenders |
|---|---|---|---|
| **6px** | 863 | pane, other, chip, section, button, card, row | `div.cal-day` x336, `div.cal-dn` x168, `span.client` x72 |
| **10px** | 544 | other, pane, section, row, card, button, input | `div.wb-rj` x200, `div.log-r` x51, `div.dd-row` x44 |
| **14px** | 343 | pane, other, row, button, card, section | `div.wb-rj` x200, `div.dd-card` x38, `nav.wb-rail` x20 |
| **2px** | 241 | pane, other, chip, section, card, row, button | `div.dd-card` x38, `div.ct-cmd-lanes` x36, `span.log-chip` x34 |
| **11px** | 222 | other, pane, chip, button, input | `div.wb-rj` x200, `button.wb-fpill` x6, `div.td-next` x4 |
| **5px** | 222 | other, chip, button, row | `button` x48, `span.cal-chip-h` x38, `div.mid` x36 |
| **1px** | 212 | other, chip, row | `span.client` x72, `span.wb-rj-n` x40, `button.cal-chip-t` x28 |
| **7px** | 107 | other, button, card, section | `span.wb-rj-n` x40, `span.wb-legend` x14, `div.ov-tile-h` x8 |
| **3px** | 69 | pane, section, other, chip | `div.sa-headmid` x20, `div.dd-vlist` x20, `span.ov-badge` x16 |
| **9px** | 53 | pane, card, other, button, section, input | `div.wb-rail-top` x20, `button.dw-qrow` x14, `div.pushbar` x4 |
| **13px** | 40 | button, card, row, pane | `div.td-qrow` x16, `div.td-tile` x12, `button.dw-key` x10 |
| **20px** | 19 | pane, card, other | `nav.wb-rail` x10, `div.ov-duo` x4, `div.td-card` x2 |
| **18px** | 18 | card, button, section | `div.td-qrow` x8, `div.t-nav` x4, `div.td-mast` x2 |
| **32px** | 11 | pane | `div.rows` x11 |
| **28px** | 4 | other | `div.msgs` x4 |
| **22px** | 2 | other | `div.gs` x2 |
| **30px** | 1 | other | `div.td-zones` x1 |
| **40px** | 1 | other | `div.wb-empty` x1 |

### E5 · rendered radii, static, at commit 0117a78 (pre-builder)

Distinct rendered radii: **11**. The phase-1 spec asks for 4.

| radius | declarations | sheets |
|---|---|---|
| 1px | 1 | faithful.css |
| 2px | 5 | faithful.css, styles.css |
| 4px | 2 | styles.css, wb2026.css |
| 8px | 30 | faithful.css, styles.css |
| 10px | 1 | styles.css |
| 12px | 57 | faithful.css, styles.css, wb2026.css |
| 20px | 36 | faithful.css, styles.css, wb2026.css |
| 40px | 1 | faithful.css |
| 99px | 34 | styles.css |
| 9999px | 2 | styles.css |
| 999 (pill) | 33 | faithful.css, styles.css, wb2026.css |