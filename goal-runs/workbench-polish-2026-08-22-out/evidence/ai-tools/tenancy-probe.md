# Cross-object search: the read probes behind the tenancy claim

Every request below is a GET through PostgREST with Ivan's own session token.
Attempted writes: 0. Script: `probe.py` beside this file. Run 2026-08-22.

Row counts are `Content-Range` totals from `Prefer: count=exact`, not `len(rows)`.

## 1. Lane vocabulary differs per table, and getting it wrong returns a calm empty screen

| table | Ivan's rows | how Ivan is written |
|---|---|---|
| `inbox_messages_v` | 2,863 | `client_id = 'ivan'` (a literal) |
| `carousel_drafts` | 190 | `client_id IS NULL` |
| `lm_drafts_v2` | - | `client_id IS NULL` |

`inbox_messages_v?client_id=eq.arch` returns 0 rows: the DM side has two live tenants, the
content side has three. A search that used one filter shape for both tables would silently
return nothing on half of it.

## 2. The partition is exact, which is what makes lane scoping a real guarantee

Query term `margin`.

| surface | filter | rows |
|---|---|---|
| DMs | `message_text=ilike.*margin*` no lane filter | **10** |
| DMs | `+ client_id=eq.ivan` | 9 |
| DMs | `+ client_id=eq.risedtc` | 1 |
| DMs | `+ client_id=eq.arch` | 0 |
| drafts | `or=(title,topic,post_body ilike *margin*)` no lane filter | **30** |
| drafts | `+ client_id=is.null` (Ivan) | 5 |
| drafts | `+ client_id=eq.risedtc` | 25 |
| drafts | `+ client_id=eq.arch` | 0 |
| magnets | `or=(topic,description,post_body)` no lane filter | 4 |
| magnets | `+ client_id=is.null` (Ivan) | 4 |

9 + 1 + 0 = 10 and 5 + 25 + 0 = 30. The lane filters partition the result set with nothing
left over, so a lane-scoped search cannot be hiding a row in a fourth bucket and cannot be
leaking one from another tenant.

## 3. Why `post_body` matters, measured

On Ivan's lane, `margin`:

- `or=(title.ilike,topic.ilike)` which is what `ContentList.tsx:912` searches today: **1 row**
- `or=(title.ilike,topic.ilike,post_body.ilike)`: **5 rows**

Four of the five drafts that mention margins are invisible to today's content search.
