# Disaster Recovery — Full Restore Runbook

**Scope:** Full restoration of Shelfy on a fresh homelab2 server from backups.  
**Target RTO:** < 1 hour from backup available to app serving requests.  
**Prerequisites:** Backup automation from [issue #182](https://github.com/smeglofus/shelfy/issues/182) must be in place. Without backups this doc is theoretical.

---

## 1. What lives where

| Data | Storage | Backup method |
|------|---------|---------------|
| PostgreSQL (users, books, libraries) | Docker volume `pg_data` | Daily `pg_dump` → gzip → Backblaze B2 |
| MinIO (book cover images, scan uploads) | Docker volume `minio_data` | Daily `mc mirror` → Backblaze B2 |
| App config / secrets | Docker Swarm secrets + `.env.prod` | Manual — stored in password manager |
| Source code | GitHub `smeglofus/shelfy` | Git |

---

## 2. Prerequisites on fresh server

```bash
# Docker Engine + Swarm mode
curl -fsSL https://get.docker.com | sh
docker swarm init

# rclone (for pulling from Backblaze B2)
curl https://rclone.org/install.sh | sudo bash
rclone config  # configure b2 remote named "b2-shelfy"

# mcli (MinIO client)
wget https://dl.min.io/client/mc/release/linux-amd64/mc -O /usr/local/bin/mc
chmod +x /usr/local/bin/mc
```

DNS: point `shelfy.cz`, `api.shelfy.cz`, etc. at the new server IP before deploying
(Traefik needs DNS resolvable to issue Let's Encrypt cert on first boot).

---

## 3. Pull latest backups from B2

```bash
# Create restore working directory
RESTORE_DIR="/opt/shelfy-restore/$(date +%Y%m%d)"
mkdir -p "$RESTORE_DIR"

# List available Postgres dumps
rclone ls b2-shelfy:shelfy-backups/postgres/ | sort | tail -10

# Download latest dump (adjust filename)
LATEST_DUMP=$(rclone ls b2-shelfy:shelfy-backups/postgres/ | sort | tail -1 | awk '{print $2}')
rclone copy "b2-shelfy:shelfy-backups/postgres/$LATEST_DUMP" "$RESTORE_DIR/"

# Download MinIO mirror (full sync)
rclone sync b2-shelfy:shelfy-backups/minio/ "$RESTORE_DIR/minio-data/"
```

---

## 4. Restore PostgreSQL

```bash
# Start a temporary Postgres container to restore into the named volume
docker run -d \
  --name pg-restore \
  -e POSTGRES_USER=shelfy \
  -e POSTGRES_PASSWORD=<password-from-secret> \
  -e POSTGRES_DB=shelfy \
  -v pg_data:/var/lib/postgresql/data \
  postgres:16.6

# Wait for Postgres to be ready
until docker exec pg-restore pg_isready -U shelfy; do sleep 1; done

# Restore
gunzip -c "$RESTORE_DIR/$LATEST_DUMP" | \
  docker exec -i pg-restore psql -U shelfy -d shelfy

# Quick sanity check — should return row counts > 0 for a non-empty library
docker exec pg-restore psql -U shelfy -d shelfy \
  -c "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM books;"

# Cleanup
docker stop pg-restore && docker rm pg-restore
```

---

## 5. Restore MinIO images

Once the Swarm stack is running (step 6), restore the MinIO data:

```bash
# Configure mc to point at the new MinIO instance
mc alias set local http://localhost:9000 minioadmin <minio-password>

# Mirror backup into the production bucket
mc mirror --overwrite "$RESTORE_DIR/minio-data/" local/shelfy-images/
```

---

## 6. Deploy application stack

Follow `docs/deployment.md` from step 3 onwards. The PostgreSQL volume already contains
restored data so skip the "first deploy" admin seed (or re-seed if user data is intact).

```bash
# Deploy stack (uses existing pg_data volume)
docker stack deploy -c infra/swarm-stack.yml shelfy

# Run migrations (safe — idempotent)
BACKEND=$(docker ps --filter "name=shelfy_backend" --format '{{.ID}}' | head -1)
docker exec "$BACKEND" alembic upgrade head
```

---

## 7. Post-restore verification

```bash
# Health checks
curl -sf https://api.shelfy.cz/health        # {"status":"ok"}
curl -sf https://api.shelfy.cz/health/ready   # 200

# Stack status
docker stack services shelfy
docker service ls | grep shelfy
```

Manual checks:
- [ ] Login with admin account succeeds
- [ ] Book list shows expected data (not empty if library had books)
- [ ] Upload a test book cover — image appears in MinIO
- [ ] Password reset email delivered (Resend integration live)
- [ ] Sentry receives a test error (`curl https://api.shelfy.cz/debug/sentry-test` if endpoint exists)

---

## 8. Secret recovery reference

All secrets must be available before running step 6. Retrieve from password manager:

| Secret | Where stored |
|--------|-------------|
| `postgres_password` | Bitwarden → Shelfy Prod |
| `redis_password` | Bitwarden → Shelfy Prod |
| `minio_root_password` | Bitwarden → Shelfy Prod |
| `jwt_secret_key` | Bitwarden → Shelfy Prod |
| `STRIPE_SECRET_KEY` | Stripe dashboard → Developers → API keys |
| `RESEND_API_KEY` | Resend dashboard → API keys |
| `GEMINI_API_KEY` | Google Cloud Console → shelfy project |
| `SENTRY_DSN` | Sentry → shelfy project → Settings → Client Keys |
| `traefik_dashboard_auth` | Bitwarden → Shelfy Prod |

---

## 9. Rollback (bad deploy, no data loss)

If the new deploy is broken but the previous version was fine:

```bash
# Re-tag previous image as current
docker pull ghcr.io/smeglofus/shelfy-backend:<previous-tag>
export SHELFY_BACKEND_IMAGE=ghcr.io/smeglofus/shelfy-backend:<previous-tag>
# repeat for frontend and worker
docker stack deploy -c infra/swarm-stack.yml shelfy
```

---

## 10. RTO checklist

Estimated timeline for a complete restore from scratch:

| Step | Time |
|------|------|
| Server provisioning + Docker setup | ~10 min |
| Pull backups from B2 | ~5 min (depends on data size) |
| Postgres restore | ~5 min |
| Stack deploy + cert issue | ~10 min |
| MinIO restore | ~10 min (parallel with DNS propagation) |
| Post-restore checks | ~5 min |
| **Total** | **~45 min** |

If DNS propagation is slow, Let's Encrypt cert issuance blocks on port 443.
Mitigation: pre-create the DNS record before decommissioning old server.
