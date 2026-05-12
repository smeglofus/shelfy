#!/usr/bin/env bash
# Local pre-push check for OpenAPI spec drift (#243).
#
# Runs the same two steps the CI ``backend / lint`` job runs:
#   1. regenerate ``docs/openapi.yaml`` from the live FastAPI app
#   2. ``git diff --exit-code`` on that file
#
# Exit codes:
#   0 — spec is up to date
#   1 — drift detected; the regenerated file is left in place for staging
#   2 — environment problem (script could not even run the generator)
#
# Why this exists: every backend schema change that touches a Pydantic
# model also has to refresh ``docs/openapi.yaml``. Forgetting to do that
# costs one CI cycle per affected PR. Running this script before pushing
# catches the drift locally and shaves ~3–5 minutes per occurrence.
#
# Usage:
#   scripts/check-openapi-drift.sh
#
# Requires python3 on PATH plus the backend Python deps importable
# (i.e. you ran ``pip install -r backend/requirements.txt`` in the
# environment the script invokes). The script does **not** create a
# venv — it deliberately reuses whatever the existing ``AGENTS.md``
# workflow already set up.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GENERATOR="${REPO_ROOT}/scripts/generate_openapi.py"
TARGET="${REPO_ROOT}/docs/openapi.yaml"

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 not found on PATH" >&2
  echo "       this script reuses your existing backend env; see AGENTS.md" >&2
  exit 2
fi

if [[ ! -f "$GENERATOR" ]]; then
  echo "error: generator script missing at $GENERATOR" >&2
  exit 2
fi

if ! python3 "$GENERATOR" >/dev/null; then
  echo "error: scripts/generate_openapi.py failed — likely a missing backend dependency." >&2
  echo "       install backend deps and retry: cd backend && pip install -r requirements.txt" >&2
  exit 2
fi

if git -C "$REPO_ROOT" diff --exit-code -- "$TARGET" >/dev/null; then
  echo "openapi.yaml is up to date."
  exit 0
fi

echo "drift detected in docs/openapi.yaml — regenerated copy is staged for review."
echo "review the diff and commit:"
echo "    git add docs/openapi.yaml"
echo "    git commit -m 'chore(openapi): regenerate spec'"
exit 1
