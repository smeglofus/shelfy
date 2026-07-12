# shelfy on k3s

Kubernetes manifests for the shelfy stack on the homelab k3s cluster. Plain
kustomize — no Helm yet (charts are a planned follow-up).

**Status: production (`shelfy.cz`) runs from the `prod` overlay since
2026-07-12** (cutover per [CUTOVER.md](CUTOVER.md)). Staging lives in the
`shelfy-staging` namespace alongside it. The compose files in `infra/` are the
short-term rollback path only.

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

**Code changes (CD):** merge to `main` → the `images` workflow builds and
pushes sha-tagged images to GHCR → the `Deploy` workflow pins them with
`kubectl set image` and waits for the rollout + an end-to-end health check
through the tunnel. Never deploys mutable `:latest`.

**Manifest changes (manual for now):**

```bash
export KUBECONFIG=~/.kube/config

kubectl apply -k infra/k8s/overlays/staging   # or overlays/prod
infra/k8s/scripts/smoke.sh staging.shelfy.cz  # or shelfy.cz
```

Secrets are managed by `scripts/gen-secrets.sh <env>` (idempotent; safe to
rerun — existing datastore passwords are preserved).
