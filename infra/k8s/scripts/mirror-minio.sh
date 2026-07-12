#!/usr/bin/env bash
# Mirror the production MinIO bucket (compose) into the k3s MinIO of the given
# environment. Idempotent — reruns copy only the delta. Run on homelab2.
#
# Usage: ./mirror-minio.sh staging|prod
set -euo pipefail

export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"

ENV_NAME="${1:?usage: mirror-minio.sh staging|prod}"
case "$ENV_NAME" in
  staging) NS=shelfy-staging ;;
  prod)    NS=shelfy ;;
  *) echo "usage: mirror-minio.sh staging|prod" >&2; exit 1 ;;
esac

container_env() { docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}'; }

SRC_IP="$(docker inspect infra-minio-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')"
DST_IP="$(kubectl -n "$NS" get svc minio -o jsonpath='{.spec.clusterIP}')"
ROOT_USER="$(container_env infra-minio-1 | sed -n 's/^MINIO_ROOT_USER=//p')"
ROOT_PW="$(container_env infra-minio-1 | sed -n 's/^MINIO_ROOT_PASSWORD=//p')"
BUCKET="$(container_env infra-backend-1 | sed -n 's/^MINIO_BUCKET=//p')"

echo "Mirroring bucket '$BUCKET': $SRC_IP:9000 (compose) -> $DST_IP:9000 (k3s/$NS)"

# host network: reaches both the docker bridge IP and the k3s ClusterIP.
docker run --rm --network host --entrypoint sh \
  -e SRC_IP="$SRC_IP" -e DST_IP="$DST_IP" \
  -e ROOT_USER="$ROOT_USER" -e ROOT_PW="$ROOT_PW" -e BUCKET="$BUCKET" \
  minio/mc -c '
    set -eu
    mc alias set src "http://$SRC_IP:9000" "$ROOT_USER" "$ROOT_PW" >/dev/null
    mc alias set dst "http://$DST_IP:9000" "$ROOT_USER" "$ROOT_PW" >/dev/null
    mc mb --ignore-existing "dst/$BUCKET"
    mc mirror --overwrite "src/$BUCKET" "dst/$BUCKET"
  '

echo "OK: bucket '$BUCKET' mirrored into $NS"
