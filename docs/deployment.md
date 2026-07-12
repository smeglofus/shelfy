# Production deployment (Kubernetes / k3s)

Shelfy production (`shelfy.cz`) runs on a two-node k3s homelab cluster since
**2026-07-12** (ADR 011). This guide covers day-to-day deployment operations.
The one-time migration itself is documented in
[`infra/k8s/CUTOVER.md`](../infra/k8s/CUTOVER.md).

> Historic note: the previous Docker Swarm guide (never used for the real
> production, which ran on Docker Compose) lives in git history and ADR 005.

## 1) Topology

```
internet → Cloudflare Tunnel (cloudflared, systemd on homelab2)
         → Traefik (k3s svclb :80)
         → Ingress `shelfy` (/api + /health → backend, / → frontend)
```

- Cluster: `homelab2` (amd64, control plane + app workloads) and
  `raspberrypi` (arm64, auxiliary workloads such as pgAdmin).
- Namespaces: `shelfy` (production), `shelfy-staging` (staging, same
  manifests via overlay).
- Manifests: [`infra/k8s/`](../infra/k8s/README.md) — kustomize `base/` +
  `overlays/staging|prod`. App images are amd64-only and pinned to amd64
  nodes via `nodeSelector`.
- TLS terminates at Cloudflare; the tunnel forwards plain HTTP to Traefik
  with the original `Host` header.

## 2) Continuous deployment (code changes)

Merging to `main` deploys automatically:

1. **`images` workflow** builds `backend`, `worker`, and `frontend` images and
   pushes them to GHCR tagged `sha-<commit>` (frontend additionally per
   environment: `prod-sha-<commit>` / `staging-sha-<commit>`, because
   `VITE_API_BASE_URL` is baked at build time).
2. **`Deploy` workflow** (chained via `workflow_run`) pins the new tags with
   `kubectl set image` — including the alembic `migrate` initContainer — waits
   for `kubectl rollout status`, then health-checks `https://shelfy.cz/health`
   end-to-end through the tunnel.

Production never runs a mutable `:latest` tag; every pod image is traceable to
a commit. Database migrations run in the backend's initContainer before the
new pod serves traffic.

## 3) Manifest and secret changes (manual for now)

```bash
export KUBECONFIG=~/.kube/config

# manifests
kubectl apply -k infra/k8s/overlays/staging   # verify on staging first
kubectl apply -k infra/k8s/overlays/prod

# secrets (idempotent; existing datastore passwords are preserved)
infra/k8s/scripts/gen-secrets.sh staging|prod

# smoke test through Traefik (no DNS needed)
infra/k8s/scripts/smoke.sh staging.shelfy.cz|shelfy.cz
```

Secrets are never committed — `gen-secrets.sh` builds the `shelfy-secrets`
Secret out-of-band. Adding a new env var = add it to the script (or patch the
Secret) + reference it in the manifests.

## 4) Rollback

```bash
# roll back to the previous ReplicaSet (per deployment)
kubectl -n shelfy rollout undo deploy/backend deploy/worker deploy/beat deploy/frontend

# or redeploy a known-good commit explicitly
gh workflow run deploy.yml   # after reverting the bad commit on main
```

Database migrations are not rolled back automatically — if a migration must be
reverted, handle it explicitly (`alembic downgrade`) before rolling pods back.

## 5) Releases

Tag milestones on the commit that is actually running in production:

```bash
git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z
gh release create vX.Y.Z --title "..." --generate-notes
```

SemVer: patch = hotfix, minor = feature/infra milestone. First release:
[`v1.0.0` — Kubernetes platform](https://github.com/smeglofus/shelfy/releases/tag/v1.0.0).

## 6) Backups & data

- Nightly Postgres dumps to R2 run via Celery beat (in-cluster) —
  `BACKUP_KEEP_DAYS` retention.
- Manual dump/restore (also the DR path):

```bash
kubectl -n shelfy exec deploy/postgres -- pg_dump -U shelfy -Fc shelfy > backup.dump
kubectl -n shelfy exec -i deploy/postgres -- pg_restore -U shelfy -d shelfy \
  --clean --if-exists --no-owner < backup.dump
# after restoring a dump produced on a different glibc, reindex:
kubectl -n shelfy exec deploy/postgres -- psql -U shelfy -d shelfy \
  -c "REINDEX DATABASE shelfy;" -c "ALTER DATABASE shelfy REFRESH COLLATION VERSION;"
```

## 7) Monitoring

Prometheus + Grafana still run in Docker Compose on the host (ADR 010);
Prometheus scrapes the in-cluster backend via the LAN-only NodePort
`192.168.88.3:30800`. Moving monitoring into the cluster
(kube-prometheus-stack) is a planned follow-up. See
[`docs/monitoring/README.md`](monitoring/README.md).

## 8) Smoke test checklist (after risky changes)

- [ ] `infra/k8s/scripts/smoke.sh shelfy.cz` passes
- [ ] Login works (HttpOnly cookie flow)
- [ ] Create/edit a book; upload a photo → processing job completes
- [ ] `kubectl -n shelfy get pods` — all Running, no restarts climbing
- [ ] Grafana dashboards show traffic; no `frontend_runtime_error` burst

---

## 9) Local Docker Compose troubleshooting (dev)

Local development still uses Docker Compose (`infra/docker-compose.yml`).

### White screen on `/login`

Most common cause in local dev is missing frontend API base URL.

Create `frontend/.env` (local, gitignored):

```env
VITE_API_BASE_URL=http://192.168.88.3:8000
```

Then restart frontend service:

```bash
cd infra
docker compose restart frontend
```

### "Network error" on login

Usually CORS mismatch between frontend origin and backend allowlist.

Create/update `infra/.env` (local, gitignored):

```env
CORS_ALLOWED_ORIGINS=["http://localhost:5173","http://192.168.88.3:5173"]
```

Recreate backend so env change is applied:

```bash
cd infra
docker compose up -d --force-recreate backend
```

Validate preflight:

```bash
curl -i -X OPTIONS http://127.0.0.1:8000/api/v1/auth/login   -H "Origin: http://192.168.88.3:5173"   -H "Access-Control-Request-Method: POST"   -H "Access-Control-Request-Headers: content-type"
```

Expected: `HTTP/1.1 200 OK` and `access-control-allow-origin: http://192.168.88.3:5173`.
