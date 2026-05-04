#!/usr/bin/env bash
# Sets up Sentry alert rules for Shelfy (shelfy-4p / python-fastapi)
# Usage: SENTRY_TOKEN=sntrys_... bash scripts/setup_sentry_alerts.sh

set -euo pipefail

TOKEN="${SENTRY_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  echo "Error: set SENTRY_TOKEN=sntrys_... before running" >&2
  echo "Generate one at: https://shelfy-4p.sentry.io/settings/auth-tokens/" >&2
  exit 1
fi

ORG="shelfy-4p"
PROJECT="python-fastapi"
BASE="https://de.sentry.io/api/0"
HDR=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

echo "→ Using org=$ORG project=$PROJECT"
echo ""

# ── 1. New Issue alert ────────────────────────────────────────────────────────
echo "[1/4] New Issue alert..."
curl -fsS -X POST "$BASE/projects/$ORG/$PROJECT/rules/" "${HDR[@]}" -d '{
  "name": "New Issue",
  "environment": "production",
  "actionMatch": "all",
  "filterMatch": "all",
  "frequency": 30,
  "conditions": [
    {"id": "sentry.rules.conditions.first_seen_event.FirstSeenEventCondition"}
  ],
  "filters": [],
  "actions": [
    {
      "id": "sentry.mail.actions.NotifyEmailAction",
      "targetType": "IssueOwners",
      "fallthroughType": "ActiveMembers"
    }
  ]
}' | python3 -c "import sys,json; r=json.load(sys.stdin); print('  ✓ id=' + str(r['id']) + '  name=' + r['name'])"

# ── 2. Frequency alert (>10 occurrences / 1 hour) ────────────────────────────
echo "[2/4] Frequency alert (>10 / 1h)..."
curl -fsS -X POST "$BASE/projects/$ORG/$PROJECT/rules/" "${HDR[@]}" -d '{
  "name": "High Frequency Error (>10 / 1h)",
  "environment": "production",
  "actionMatch": "all",
  "filterMatch": "all",
  "frequency": 60,
  "conditions": [
    {
      "id": "sentry.rules.conditions.event_frequency.EventFrequencyCondition",
      "value": 10,
      "comparisonType": "count",
      "interval": "1h"
    }
  ],
  "filters": [],
  "actions": [
    {
      "id": "sentry.mail.actions.NotifyEmailAction",
      "targetType": "IssueOwners",
      "fallthroughType": "ActiveMembers"
    }
  ]
}' | python3 -c "import sys,json; r=json.load(sys.stdin); print('  ✓ id=' + str(r['id']) + '  name=' + r['name'])"

# ── 3. Regression alert ───────────────────────────────────────────────────────
echo "[3/4] Regression alert..."
curl -fsS -X POST "$BASE/projects/$ORG/$PROJECT/rules/" "${HDR[@]}" -d '{
  "name": "Regression",
  "environment": "production",
  "actionMatch": "all",
  "filterMatch": "all",
  "frequency": 30,
  "conditions": [
    {"id": "sentry.rules.conditions.regression_event.RegressionEventCondition"}
  ],
  "filters": [],
  "actions": [
    {
      "id": "sentry.mail.actions.NotifyEmailAction",
      "targetType": "IssueOwners",
      "fallthroughType": "ActiveMembers"
    }
  ]
}' | python3 -c "import sys,json; r=json.load(sys.stdin); print('  ✓ id=' + str(r['id']) + '  name=' + r['name'])"

# ── 4. Performance alert — P95 latency > 2 000 ms ────────────────────────────
echo "[4/4] Performance alert (P95 > 2s)..."
curl -fsS -X POST "$BASE/organizations/$ORG/alert-rules/" "${HDR[@]}" -d '{
  "name": "API P95 latency > 2s",
  "environment": "production",
  "dataset": "transactions",
  "aggregate": "p95(transaction.duration)",
  "query": "transaction.op:http.server",
  "timeWindow": 10,
  "thresholdType": 0,
  "resolveThreshold": 1500,
  "projects": ["python-fastapi"],
  "owner": "user:4514584",
  "triggers": [
    {
      "label": "critical",
      "alertThreshold": 2000,
      "actions": [
        {
          "type": "email",
          "targetType": "user",
          "targetIdentifier": "4514584"
        }
      ]
    },
    {
      "label": "warning",
      "alertThreshold": 1000,
      "actions": []
    }
  ]
}' | python3 -c "import sys,json; r=json.load(sys.stdin); print('  ✓ id=' + str(r['id']) + '  name=' + r['name'])"

echo ""
echo "Done. Verify at: https://shelfy-4p.sentry.io/alerts/rules/"
