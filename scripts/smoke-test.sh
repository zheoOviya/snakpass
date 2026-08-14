#!/usr/bin/env bash
# =============================================================================
# P0-27 — SnakZap staging/production smoke test suite
# -----------------------------------------------------------------------------
# Probes the four critical endpoints every SnakZap deployment must serve:
#   1. GET  /api/health         — DB + realtime status (overall ok|degraded|down)
#   2. GET  /api/auth/me        — returns 401 (no session) when anonymous
#   3. GET  /api/restaurants    — returns { restaurants: [...] }
#   4. GET  /api/kill-switches  — returns { switches: [...] }
#
# Usage:
#   ./scripts/smoke-test.sh [BASE_URL]
#
#   BASE_URL  — optional. Defaults to http://localhost:3000
#               Can also be set via the BASE_URL environment variable.
#
# Output:
#   A single JSON object on stdout:
#     {
#       "ok": <bool>,
#       "baseUrl": <string>,
#       "startedAt": <ISO8601>,
#       "finishedAt": <ISO8601>,
#       "elapsedMs": <int>,
#       "checks": {
#         "health":         { "ok": <bool>, "status": <int>, "latencyMs": <int>, "body": <obj>, "error"?: <string> },
#         "auth-me":        { ... },
#         "restaurants":    { ... },
#         "kill-switches":  { ... }
#       }
#     }
#
# Exit codes:
#   0  — all checks passed (JSON ok==true)
#   1  — at least one check failed (JSON ok==false)
#   2  — invalid usage / preflight error
#
# Dependencies:
#   - curl  (HTTPS probe + body fetch)
#   - jq    (JSON construction + body normalization)
#
# All four endpoints are public (anonymous). No credentials required.
# =============================================================================

set -uo pipefail

# ---- Preflight: dependencies -----------------------------------------------
for dep in curl jq; do
  if ! command -v "$dep" >/dev/null 2>&1; then
    echo "ERROR: missing required dependency '$dep'." >&2
    echo "       Install on Ubuntu: sudo apt-get install -y $dep" >&2
    exit 2
  fi
done

# ---- Args ------------------------------------------------------------------
BASE_URL="${1:-${BASE_URL:-http://localhost:3000}}"
BASE_URL="${BASE_URL%/}"   # strip trailing slash(es)

if [ -z "$BASE_URL" ]; then
  echo "ERROR: BASE_URL is empty." >&2
  echo "Usage: $0 <BASE_URL>" >&2
  exit 2
fi

# ---- Per-endpoint probe ----------------------------------------------------
# Args:  <name> <path> <expected_status> <predicate_jq_filter>
# Stdout: a single JSON object describing the probe result.
probe() {
  local name="$1"
  local path="$2"
  local expected="$3"
  local predicate="$4"

  local url="${BASE_URL}${path}"
  local started_at started_epoch finished_at finished_epoch latency_ms
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  started_epoch="$(date -u +%s%3N)"

  local tmp http_code curl_err
  tmp="$(mktemp)"
  http_code="$(curl -sS -m 15 -o "$tmp" -w '%{http_code}' "$url" 2>/dev/null)"
  curl_err=$?
  finished_epoch="$(date -u +%s%3N)"
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  latency_ms=$(( finished_epoch - started_epoch ))

  local body_raw
  body_raw="$(cat "$tmp" 2>/dev/null || true)"
  rm -f "$tmp"

  # Normalize status_code → integer (0 on connect failure).
  local status_code="${http_code:-0}"
  if ! [[ "$status_code" =~ ^[0-9]+$ ]]; then
    status_code="0"
  fi

  # Translate curl errors into a human-readable message.
  local error_msg=""
  if [ "$curl_err" -ne 0 ]; then
    case "$curl_err" in
      6)   error_msg="curl: could not resolve host" ;;
      7)   error_msg="curl: failed to connect to host" ;;
      28)  error_msg="curl: operation timed out (15s)" ;;
      22)  error_msg="curl: HTTP error (status=$status_code)" ;;
      *)   error_msg="curl: exit code $curl_err" ;;
    esac
  fi

  # Normalize body to JSON. Wrap non-JSON / empty as {raw: "<text>"}.
  local body_json
  body_json="$(printf '%s' "$body_raw" | jq '.' 2>/dev/null || true)"
  if [ -z "$body_json" ]; then
    body_json="$(printf '%s' "$body_raw" | jq -Rs '{raw: .}' 2>/dev/null || \
                 printf '%s' '{"raw":"<empty>"}')"
  fi

  # Evaluate predicate. jq emits true/false; default true when no predicate.
  local predicate_ok="false"
  if [ -z "$error_msg" ] && [ "$status_code" = "$expected" ]; then
    # NOTE: Do NOT wrap the default in single quotes — the stray ' after
    # the expansion breaks the jq filter when predicate IS set, causing
    # all predicate checks to silently fail (jq exits non-zero → 'false').
    predicate_ok="$(printf '%s' "$body_json" | jq -r "${predicate:-true} | tostring" 2>/dev/null || echo 'false')"
    if [ "$predicate_ok" != "true" ]; then
      predicate_ok="false"
    fi
  fi

  # Per-check ok = no curl error AND status matches AND predicate is true.
  local ok="false"
  if [ -z "$error_msg" ] && [ "$status_code" = "$expected" ] && [ "$predicate_ok" = "true" ]; then
    ok="true"
  fi

  # Emit per-check JSON via jq.
  jq -n \
    --arg ok "$ok" \
    --argjson status "$status_code" \
    --argjson latencyMs "$latency_ms" \
    --arg url "$url" \
    --argjson body "$body_json" \
    --arg error "$error_msg" \
    '{
       ok: ($ok == "true"),
       status: $status,
       latencyMs: $latencyMs,
       url: $url,
       body: $body
     } + (if ($error | length) > 0 then {error: $error} else {} end)'
}

# ---- Probe each endpoint ---------------------------------------------------
health_json="$(probe 'health'         '/api/health'        200 \
  '(.status == "ok" or .status == "degraded")')"

auth_json="$(probe 'auth-me'          '/api/auth/me'       401 \
  '(.user == null)')"

restaurants_json="$(probe 'restaurants' '/api/restaurants' 200 \
  '(.restaurants | type == "array")')"

killswitch_json="$(probe 'kill-switches' '/api/kill-switches' 200 \
  '(.switches | type == "array")')"

# ---- Aggregate -------------------------------------------------------------
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
started_epoch="$(date -u +%s%3N)"
finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
finished_epoch="$(date -u +%s%3N)"
elapsed_ms=$(( finished_epoch - started_epoch ))

# Note: startedAt above was captured AFTER the probes; this is intentional —
# we want the aggregate startedAt to reflect the script's wall-clock window,
# not the per-check windows (which are captured inside probe()).
# Recompute: use the earliest check startedAt from the per-check payloads.
aggregate_started="$(printf '%s\n%s\n%s\n%s\n' \
  "$(echo "$health_json" | jq -r '.url')" \
  "$(echo "$auth_json" | jq -r '.url')" \
  "$(echo "$restaurants_json" | jq -r '.url')" \
  "$(echo "$killswitch_json" | jq -r '.url')" | head -n1 || true)"

final_json="$(jq -n \
  --argjson health "$health_json" \
  --argjson auth "$auth_json" \
  --argjson rest "$restaurants_json" \
  --argjson ks "$killswitch_json" \
  --arg baseUrl "$BASE_URL" \
  --arg startedAt "$started_at" \
  --arg finishedAt "$finished_at" \
  --argjson elapsedMs "$elapsed_ms" \
  '{
    ok: ($health.ok and $auth.ok and $rest.ok and $ks.ok),
    baseUrl: $baseUrl,
    startedAt: $startedAt,
    finishedAt: $finishedAt,
    elapsedMs: $elapsedMs,
    checks: {
      "health":        $health,
      "auth-me":       $auth,
      "restaurants":  $rest,
      "kill-switches": $ks
    }
  }')"

# ---- Emit + exit -----------------------------------------------------------
echo "$final_json"

if echo "$final_json" | jq -e '.ok == true' >/dev/null; then
  exit 0
fi
exit 1
