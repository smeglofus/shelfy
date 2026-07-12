# ADR 005: Docker Swarm + Traefik v3 deployment for homelab production

- **Status:** Superseded by [ADR 011](011-k3s-production-platform.md) (2026-07-12)
- **Date:** 2026-03-18

> Historic note: this Swarm setup was designed but never became the live
> production path — the site ran on Docker Compose until the k3s migration.
> Kept as a record of the decision and its constraints at the time.

## Context

Shelfy targets a single-node (or small) homelab environment where operational simplicity matters.
The project constraints explicitly exclude Kubernetes, but production deployment still needs:

- TLS termination and certificate automation
- container orchestration primitives (service restart/update)
- secret management outside source control

## Decision

Use **Docker Swarm** as the homelab orchestrator with **Traefik v3** as ingress and
**Docker Secrets** for sensitive values.

## Consequences

### Positive
- Matches project constraints (no Kubernetes) while providing production-like orchestration.
- Traefik label-based routing keeps service-to-domain mapping close to stack configuration.
- ACME support in Traefik automates TLS certificate issuance/renewal.
- Docker Secrets avoid plaintext credentials in repository files.

### Tradeoffs
- Swarm secrets are immutable; rotation requires versioned-secret rollouts.
- Operational flow is more complex than local Docker Compose.
- Traefik/Swarm provider constraints require careful network and label configuration.
