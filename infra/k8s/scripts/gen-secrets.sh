#!/usr/bin/env bash
# Create/update the shelfy-secrets Secret for staging or prod.
#
# Source of truth is the RUNNING compose stack (docker inspect), not the env
# files — .env.prod.local drifted from reality once already. Datastore
# passwords (Postgres, Redis) are rotated to fresh random values on first run
# because the compose ones are CHANGE_ME placeholders; reruns keep whatever
# the existing Secret already holds so an initialized PVC never mismatches.
#
# Usage: ./gen-secrets.sh staging|prod
set -euo pipefail

export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"

ENV_NAME="${1:?usage: gen-secrets.sh staging|prod}"
case "$ENV_NAME" in
  staging) NS=shelfy-staging; PUBLIC_URL="https://staging.shelfy.cz" ;;
  prod)    NS=shelfy;         PUBLIC_URL="https://shelfy.cz" ;;
  *) echo "usage: gen-secrets.sh staging|prod" >&2; exit 1 ;;
esac

container_env() { docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}'; }

TMP="$(mktemp)"
trap 'rm -f "$TMP" "$TMP.n"' EXIT
chmod 600 "$TMP"

# Everything the backend runs with, minus image-runtime noise.
container_env infra-backend-1 \
  | grep -vE '^(PATH|HOSTNAME|LANG|GPG_KEY|PYTHON_VERSION|PYTHON_SHA256|PYTHONDONTWRITEBYTECODE|PYTHONUNBUFFERED)=' \
  | grep -vE '^$' > "$TMP"

# Beat-only knobs the backend env doesn't carry.
container_env infra-beat-1 | grep -E '^(BACKUP_KEEP_DAYS|STRIPE_EVENTS_KEEP_DAYS)=' >> "$TMP"

set_kv() {
  grep -v "^$1=" "$TMP" > "$TMP.n" || true
  mv "$TMP.n" "$TMP"
  printf '%s=%s\n' "$1" "$2" >> "$TMP"
}

existing() {
  kubectl -n "$NS" get secret shelfy-secrets -o "jsonpath={.data.$1}" 2>/dev/null | base64 -d || true
}

# --- datastore credentials: reuse if the Secret exists, else generate fresh ---
PG_DB="$(container_env infra-postgres-1 | sed -n 's/^POSTGRES_DB=//p')"
PG_USER="$(container_env infra-postgres-1 | sed -n 's/^POSTGRES_USER=//p')"
PG_PW="$(existing POSTGRES_PASSWORD)"
[ -n "$PG_PW" ] || PG_PW="$(openssl rand -hex 24)"
REDIS_PW="$(existing REDIS_PASSWORD)"
[ -n "$REDIS_PW" ] || REDIS_PW="$(openssl rand -hex 24)"

set_kv POSTGRES_DB "$PG_DB"
set_kv POSTGRES_USER "$PG_USER"
set_kv POSTGRES_PASSWORD "$PG_PW"
set_kv REDIS_PASSWORD "$REDIS_PW"
set_kv DATABASE_URL "postgresql+asyncpg://$PG_USER:$PG_PW@postgres:5432/$PG_DB"
set_kv DATABASE_URL_SYNC "postgresql+psycopg2://$PG_USER:$PG_PW@postgres:5432/$PG_DB"
set_kv REDIS_URL "redis://:$REDIS_PW@redis:6379/0"
set_kv CELERY_BROKER_URL "redis://:$REDIS_PW@redis:6379/0"
set_kv CELERY_RESULT_BACKEND "redis://:$REDIS_PW@redis:6379/0"

# MinIO root credentials come from the live minio container (unchanged — the
# bucket data is mirrored, rotating them is a post-cutover follow-up).
container_env infra-minio-1 | grep -E '^MINIO_ROOT_(USER|PASSWORD)=' | while IFS='=' read -r k v; do
  set_kv "$k" "$v"
done

set_kv APP_URL "$PUBLIC_URL"
set_kv CORS_ALLOWED_ORIGINS "[\"$PUBLIC_URL\"]"
set_kv GOOGLE_REDIRECT_URI "$PUBLIC_URL/auth/callback"

if [ "$ENV_NAME" = "staging" ]; then
  # Staging must never e-mail real people or pollute prod Sentry.
  set_kv RESEND_API_KEY ""
  set_kv SENTRY_DSN ""
fi

kubectl get namespace "$NS" >/dev/null 2>&1 || kubectl create namespace "$NS"
kubectl -n "$NS" create secret generic shelfy-secrets \
  --from-env-file="$TMP" --dry-run=client -o yaml | kubectl apply -f -

echo "OK: secret shelfy-secrets applied in namespace $NS ($(grep -c '=' "$TMP") keys)"
