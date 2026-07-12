# ADR 011: Migrate production to Kubernetes (k3s)

- **Status:** Accepted
- **Date:** 2026-07-12
- **Supersedes:** ADR 005 (Docker Swarm + Traefik deployment)

## Context

Production ran on Docker Compose on a single homelab host (the Swarm setup
from ADR 005 was never adopted for the live site; Swarm mode ended up
inactive). The compose setup had accumulated real operational debt:

- deploys were an SSH script doing `docker compose up --build` on the prod
  host — no rollout strategy, no image provenance (`:latest` builds in place),
- datastore credentials were unrotated placeholders,
- no declarative record of the runtime (env drift between `.env` files and
  running containers had already happened once),
- rollback meant "rebuild the previous commit and hope".

Independently, the operator's stated goal is a DevOps career path where
Kubernetes is the central skill gap — running the real production on it provides
learning with actual stakes. The migration window was deliberately chosen
**before** onboarding paying customers.

## Decision

Run production on a **two-node k3s cluster** (amd64 miniPC as control plane +
app node, arm64 Raspberry Pi 5 as auxiliary node):

- **Manifests:** plain kustomize (`infra/k8s/`), one base + `staging`/`prod`
  overlays in the same cluster. Helm charts are a deliberate later step.
- **Edge unchanged:** Cloudflare Tunnel → Traefik (bundled with k3s) →
  Ingress. TLS stays at Cloudflare; cutover and rollback are a tunnel-config
  switch.
- **Images:** GHCR, built by GitHub Actions, deployed by immutable
  `sha-<commit>` tags only. The frontend is built per environment
  (`VITE_API_BASE_URL` is a build arg).
- **CD:** merge to `main` → `images` workflow → `Deploy` workflow
  (`kubectl set image` + `rollout status` + tunnel-level health check).
- **Migrations:** alembic as an initContainer on the backend deployment.
- **Secrets:** k8s Secrets generated out-of-git (`gen-secrets.sh`), datastore
  credentials rotated during migration. SOPS-in-git is a planned follow-up.
- **Storage:** k3s local-path PVCs pinned to the amd64 node.

## Consequences

### Positive
- Declarative, git-versioned runtime; drift is visible in `kubectl diff`.
- Rollouts gated by readiness probes; rollback is `kubectl rollout undo` or
  redeploying a previous sha tag.
- Staging is the same manifests as production (overlay), not a separate stack.
- Credential rotation happened as part of the migration.
- Zero-data-loss cutover with a ~15-minute window; the compose stack remains
  a frozen rollback path for 14 days.

### Tradeoffs
- Single control plane node — the cluster itself is a SPOF (acceptable:
  identical to the previous single-host reality).
- 8 GB RAM on the main node is tight; monitoring stays in Docker Compose on
  the host for now (Prometheus scrapes the cluster via a LAN NodePort) until
  kube-prometheus-stack replaces it.
- More moving parts than compose; mitigated by runbooks
  (`infra/k8s/CUTOVER.md`, `docs/deployment.md`).

### Follow-ups
- kube-prometheus-stack + in-cluster alerting, Helm charts, SOPS secrets,
  RBAC-scoped ServiceAccount for CD (today it uses the admin kubeconfig),
  explicit `host` on the pgAdmin ingress.
