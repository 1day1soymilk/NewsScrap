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
#
# The temp file carries the pid because several of these can be in flight at once
# — the analysis harness is routinely driven by more than one agent, and a fixed
# name means one run's SQL is executed under another run's name.
query_file="${TMPDIR:-/tmp}/run-sh-query.$$.json"
trap 'rm -f "$query_file"' EXIT

SQL="$sql" python -c '
import json, os, sys
sys.stdout.write(json.dumps({"query": os.environ["SQL"]}))
' > "$query_file"

# `--retry` covers the Management API's transient 5xx, which showed up on roughly
# one call in three on 2026-08-04 and cost a measurement run each time. curl
# retries 408/429/500/502/503/504 on its own; nothing here has to know which.
response="$(curl -sS -X POST \
  --retry 3 --retry-delay 2 --retry-connrefused \
  --write-out '\n%{http_code}' \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @"$query_file")"

status="${response##*$'\n'}"
response="${response%$'\n'*}"

# **The split is on whether the body is JSON, not on the status code**, and that
# is the whole point of carrying the status down here. The API answers a SQL
# error with HTTP 400 and a JSON object naming it, so a status check alone would
# call a malformed query a transport failure. A gateway 5xx answers with an HTML
# page, which is not JSON — and that used to print "unparseable response",
# indistinguishable at a glance from a bad query, so the natural reaction was to
# go and debug SQL that had never run.
RESPONSE="$response" STATUS="$status" python -c '
import json, os, sys

body, status = os.environ["RESPONSE"], os.environ["STATUS"]
try:
    rows = json.loads(body)
except json.JSONDecodeError:
    sys.exit(
        "run.sh: HTTP %s and the body is not JSON — a transport failure, not a\n"
        "        SQL error. The query never reached Postgres.\n        %s"
        % (status, body[:400].replace("\n", " "))
    )

if isinstance(rows, dict):                 # the API reports errors as an object
    sys.exit("run.sh: HTTP %s %s" % (status, json.dumps(rows, ensure_ascii=False)[:800]))
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
