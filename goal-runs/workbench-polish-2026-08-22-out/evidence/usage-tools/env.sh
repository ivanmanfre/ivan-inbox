# shared env for all usage queries. source this.
cd /Users/ivanmanfredi/Desktop/ivan-inbox
export URL="$(grep -o 'VITE_SUPABASE_URL=.*' .env.local | head -1 | cut -d= -f2-)"
export ANON="$(grep -o 'VITE_SUPABASE_ANON_KEY=.*' .env.local | head -1 | cut -d= -f2-)"
export TOK="$(python3 -c "import json;print(json.load(open('.session.json'))['access_token'])")"
q() { curl -s "$URL/rest/v1/$1" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" "${@:2}"; }
qc() { curl -s -D - -o /dev/null "$URL/rest/v1/$1" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" -H "Prefer: count=exact" -H "Range: 0-0" "${@:2}" | grep -i content-range; }
