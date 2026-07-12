#!/usr/bin/env bash
# Smoke test a shelfy deployment through Traefik, without needing DNS or the
# tunnel: talks to the node's :80 and sets the Host header explicitly.
#
# Usage: ./smoke.sh staging.shelfy.cz | ./smoke.sh shelfy.cz
set -euo pipefail

HOST="${1:?usage: smoke.sh <ingress-host>}"
BASE="http://127.0.0.1:80"

check() {
  local label="$1" path="$2" expect="${3:-200}"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $HOST" "$BASE$path")"
  if [ "$code" = "$expect" ]; then
    echo "OK   $label ($path -> $code)"
  else
    echo "FAIL $label ($path -> $code, expected $expect)"
    return 1
  fi
}

rc=0
check "backend liveness " /health        || rc=1
check "backend readiness" /health/ready  || rc=1
check "frontend         " /              || rc=1
check "api 404 passthru " /api/definitely-not-a-route 404 || rc=1

if [ "$rc" -eq 0 ]; then
  echo "SMOKE PASSED for $HOST"
else
  echo "SMOKE FAILED for $HOST" >&2
fi
exit "$rc"
