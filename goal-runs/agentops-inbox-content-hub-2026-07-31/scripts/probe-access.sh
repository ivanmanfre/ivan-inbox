#!/bin/zsh
# Phase 1e access probe — read-only. For each table name on stdin, hit PostgREST
# with the ANON key (no auth header beyond apikey) and record: HTTP status,
# row visibility (0 rows can mean RLS-filtered OR empty — recorded as such).
# Usage: probe-access.sh tables.txt > matrix-raw.tsv
set -u
ENVF="$HOME/Desktop/ivan-inbox/.env.local"
URL=$(grep '^VITE_SUPABASE_URL=' "$ENVF" | cut -d= -f2)
KEY=$(grep '^VITE_SUPABASE_ANON_KEY=' "$ENVF" | cut -d= -f2)
printf "object\tkind\thttp\trows_visible\tnote\n"
while read -r t; do
  [ -z "$t" ] && continue
  case "$t" in \#*) continue;; esac
  resp=$(curl -s -w '\n%{http_code}' "$URL/rest/v1/$t?select=*&limit=1" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
  code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')
  if [ "$code" = "200" ]; then
    if [ "$body" = "[]" ]; then rows="0"; note="200 but empty: RLS-filtered OR truly empty — needs count check"
    else rows="≥1"; note="anon-readable"; fi
  else rows="-"; note=$(echo "$body" | head -c 160); fi
  printf "%s\ttable\t%s\t%s\t%s\n" "$t" "$code" "$rows" "$note"
done < "$1"
