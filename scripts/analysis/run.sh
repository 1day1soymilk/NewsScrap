#!/usr/bin/env bash
# Run a SQL file against the deployed database and print the result as a table.
#
# There is no local Postgres, Docker or Deno in this project, so analysis SQL
# goes through the Management API the same way ad-hoc queries do (see CLAUDE.md).
#
#   scripts/analysis/run.sh scripts/analysis/10_sieve_eval.sql
#   scripts/analysis/run.sh -c "select * from keyword_signals('2026-08-01') limit 5"
#
# Credentials come from .env.supabase, which is git-ignored.
set -euo pipefail

# Every result set here is mostly Korean. Without this, Python picks the Windows
# console codepage for stdout and every word comes back as replacement characters.
export PYTHONIOENCODING=utf-8

cd "$(dirname "$0")/../.."

if [[ ! -f .env.supabase ]]; then
  echo "run.sh: .env.supabase not found — it holds SUPABASE_ACCESS_TOKEN and _PROJECT_REF" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env.supabase
set +a

if [[ "${1:-}" == "-c" ]]; then
  sql="${2:?run.sh -c needs a SQL string}"
else
  file="${1:?usage: run.sh <file.sql> | run.sh -c \"<sql>\"}"
  sql="$(cat "$file")"
fi

# The API takes JSON, so the SQL has to be encoded rather than interpolated —
# these scripts are full of quotes, backslashes and newlines.
SQL="$sql" python -c '
import json, os, sys
sys.stdout.write(json.dumps({"query": os.environ["SQL"]}))
' > "${TMPDIR:-/tmp}/run-sh-query.json"

response="$(curl -sS -X POST \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @"${TMPDIR:-/tmp}/run-sh-query.json")"

RESPONSE="$response" python -c '
import json, os, sys

body = os.environ["RESPONSE"]
try:
    rows = json.loads(body)
except json.JSONDecodeError:
    sys.exit("run.sh: unparseable response: " + body[:400])

if isinstance(rows, dict):                 # the API reports errors as an object
    sys.exit("run.sh: " + json.dumps(rows, ensure_ascii=False)[:800])
if not rows:
    print("(no rows)")
    sys.exit()

# East Asian characters occupy two terminal columns, so padding on len() alone
# would leave the Korean columns visibly ragged.
import unicodedata
def width(s):
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in str(s))
def pad(s, w):
    return str(s) + " " * (w - width(s))

cols = list(rows[0])
w = {c: max(width(c), max(width(r.get(c, "")) for r in rows)) for c in cols}
print(" | ".join(pad(c, w[c]) for c in cols))
print("-+-".join("-" * w[c] for c in cols))
for r in rows:
    print(" | ".join(pad("" if r.get(c) is None else r.get(c), w[c]) for c in cols))
print("\n(%d rows)" % len(rows))
'
