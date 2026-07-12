# shelfy on k3s

Kubernetes manifests for running the shelfy stack on the homelab k3s cluster,
replacing `infra/docker-compose.prod.yml`. Plain kustomize — no Helm yet
(charts are a planned follow-up).

## Layout

```
base/                  # environment-agnostic manifests (host + tags patched per overlay)
overlays/staging/      # namespace shelfy-staging, host staging.shelfy.cz, beat scaled to 0
overlays/prod/         # namespace shelfy, host shelfy.cz, + NodePort 30800 for compose Prometheus
scripts/gen-secrets.sh # builds the shelfy-secrets Secret from the live compose stack
scripts/mirror-minio.sh# mirrors the prod MinIO bucket into a k3s environment
scripts/smoke.sh       # curl smoke test through Traefik (Host-header based, no DNS needed)
CUTOVER.md             # production cutover runbook (Czech)
```

## Architecture notes

- **Traffic**: Cloudflare Tunnel → Traefik (k3s svclb on :80) → Ingress routes
  `/api` + `/health` to the backend, everything else to the frontend. TLS
  terminates at Cloudflare, same as the compose setup.
- **Images**: built by `.github/workflows/images.yml` into GHCR. Backend and
  worker are env-agnostic (`:latest`, `:sha-*`); the frontend bakes
  `VITE_API_BASE_URL` at build time so it has per-env tags (`:staging`, `:prod`).
- **Migrations**: `alembic upgrade head` runs as an initContainer on the
  backend, mirroring `deploy-prod.local.sh`.
- **Data**: local-path PVCs, pinned to homelab2 via the amd64 nodeSelector
  (images are amd64-only for now; the rpi node runs other workloads).
- **Secrets**: `shelfy-secrets` is created out-of-band by `gen-secrets.sh` and
  never committed. Postgres/Redis passwords are rotated to random values on
  first generation (the compose ones were placeholders). SOPS is a planned
  follow-up.
- **Exactly one beat**: beat drives scheduled jobs (reminder e-mails, R2
  backups). It runs only in prod, never in staging, and never concurrently
  with the compose beat.

## Deploy

```bash
export KUBECONFIG=~/.kube/config

# staging
infra/k8s/scripts/gen-secrets.sh staging
kubectl apply -k infra/k8s/overlays/staging
infra/k8s/scripts/smoke.sh staging.shelfy.cz

# prod — follow CUTOVER.md, do not just apply
```
