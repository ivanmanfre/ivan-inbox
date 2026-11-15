#!/usr/bin/env python3
"""Ivan Listener: stop reading Supabase with the public (anon) key.

Run from the ivan-listener repo root:
    python3 <this file> --check     # says what it would change, changes nothing
    python3 <this file>             # changes 3 files in menubar/Sources
Then build and install:  bash menubar/deploy.sh

What it changes:
  SupabaseClient.swift   the key constant the app already uses for listener_state loses `private`,
                         so the two fetchers below can use it. No new key is added to the app.
  CalendarFetcher.swift  the public-key literal becomes a reference to that constant
                         (calendar_events, audience_audits, transcripts reads).
  SalesScript.swift      same, for the sales_scripts read.
It prints file names only, never a key. Safe to run twice.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path("menubar/Sources")
JWT = r'"eyJ[A-Za-z0-9._-]{20,}"'
EDITS = [
    ("SupabaseClient.swift", r"^private let SUPABASE_KEY = ", "let SUPABASE_KEY = ", r"^let SUPABASE_KEY = "),
    ("CalendarFetcher.swift", r"^(\s*)private let key = " + JWT, r"\1private let key = SUPABASE_KEY",
     r"^\s*private let key = SUPABASE_KEY"),
    ("SalesScript.swift", r"^(\s*)private let key = " + JWT, r"\1private let key = SUPABASE_KEY",
     r"^\s*private let key = SUPABASE_KEY"),
]


def main() -> int:
    check = "--check" in sys.argv
    if not ROOT.is_dir():
        print("run this from the ivan-listener repo root (menubar/Sources not found)")
        return 2
    plan = []
    for name, pattern, repl, done in EDITS:
        path = ROOT / name
        text = path.read_text()
        hits = len(re.findall(pattern, text, flags=re.M))
        if hits == 1:
            plan.append((path, re.sub(pattern, repl, text, count=1, flags=re.M)))
            print(f"{name}: 1 line to change")
        elif hits == 0 and re.search(done, text, flags=re.M):
            print(f"{name}: already changed")
        else:
            print(f"{name}: expected exactly 1 matching line, found {hits}. Nothing was changed.")
            return 1
    if check:
        print("check only, nothing written")
        return 0
    for path, text in plan:
        path.write_text(text)
    print(f"{len(plan)} file(s) written. Next: bash menubar/deploy.sh")
    return 0


if __name__ == "__main__":
    sys.exit(main())
