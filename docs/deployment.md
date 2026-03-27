# Homelab deployment (Docker Swarm)

This guide deploys Shelfy to a Docker Swarm homelab host using `infra/swarm-stack.yml`.

## 1) Prerequisites

- Docker Engine with Swarm mode enabled.
- Public DNS records pointed at your Swarm manager node:
  - `SHELFY_APP_HOST`
  - `API_HOST`
  - `MINIO_API_HOST`
  - `MINIO_CONSOLE_HOST`
  - `TRAEFIK_DASHBOARD_HOST`
- TLS e-mail for Let's Encrypt (`TRAEFIK_ACME_EMAIL`).
- Built and published images for backend/frontend/worker.

Initialize Swarm (one-time):

```bash
docker swarm init
```

## 2) Build and publish application images

From the repository root:

```bash
# Choose your registry path and tag
export REGISTRY=ghcr.io/<your-user-or-org>
export TAG=latest
export API_BASE_URL=https://api.library.example.com

# Backend
docker build -t "$REGISTRY/shelfy-backend:$TAG" backend
# Frontend (Vite variable is baked in at build time)
docker build \
  --build-arg VITE_API_BASE_URL="$API_BASE_URL" \
  -t "$REGISTRY/shelfy-frontend:$TAG" frontend
# Worker
docker build -t "$REGISTRY/shelfy-worker:$TAG" worker

# Push all three
docker push "$REGISTRY/shelfy-backend:$TAG"
docker push "$REGISTRY/shelfy-frontend:$TAG"
docker push "$REGISTRY/shelfy-worker:$TAG"
```

## 3) Create Docker secrets

Create local files in a temporary directory (avoid writing secrets in the repo checkout). Ensure `htpasswd` is installed (`apache2-utils` on Debian/Ubuntu or `httpd-tools` on RHEL/Fedora):

```bash
SECRETS_DIR="$(mktemp -d)"
trap 'rm -rf "$SECRETS_DIR"' EXIT

openssl rand -base64 32 > "$SECRETS_DIR/postgres_password.txt"
openssl rand -base64 32 > "$SECRETS_DIR/redis_password.txt"
openssl rand -base64 32 > "$SECRETS_DIR/minio_root_password.txt"
openssl rand -base64 64 > "$SECRETS_DIR/jwt_secret_key.txt"
htpasswd -nB admin > "$SECRETS_DIR/traefik_dashboard_auth.txt"
printf 'admin@example.com' > "$SECRETS_DIR/admin_email.txt"
printf 'change-this-admin-password' > "$SECRETS_DIR/admin_password.txt"
```

Create Swarm secrets:

```bash
docker secret create postgres_password "$SECRETS_DIR/postgres_password.txt"
docker secret create redis_password "$SECRETS_DIR/redis_password.txt"
docker secret create minio_root_password "$SECRETS_DIR/minio_root_password.txt"
docker secret create jwt_secret_key "$SECRETS_DIR/jwt_secret_key.txt"
docker secret create traefik_dashboard_auth "$SECRETS_DIR/traefik_dashboard_auth.txt"
docker secret create admin_email "$SECRETS_DIR/admin_email.txt"
docker secret create admin_password "$SECRETS_DIR/admin_password.txt"
```

> Important (secret rotation): Swarm secrets are immutable. Use a versioned-secret flow:
> 1) Create new secret name (example: `postgres_password_v2`), 2) update `infra/swarm-stack.yml` to reference the new name, 3) redeploy with `docker stack deploy`, 4) remove old secret after no running service references it.

## 4) Export required stack environment variables

```bash
# Hostnames (replace with your real domains)
export SHELFY_APP_HOST=library.example.com
export API_HOST=api.library.example.com
export MINIO_API_HOST=minio.library.example.com
export MINIO_CONSOLE_HOST=minio-console.library.example.com
export TRAEFIK_DASHBOARD_HOST=traefik.library.example.com

# Traefik ACME e-mail
export TRAEFIK_ACME_EMAIL=ops@example.com

# Image references produced in step 2
export SHELFY_BACKEND_IMAGE=ghcr.io/<your-user-or-org>/shelfy-backend:latest
export SHELFY_FRONTEND_IMAGE=ghcr.io/<your-user-or-org>/shelfy-frontend:latest
export SHELFY_WORKER_IMAGE=ghcr.io/<your-user-or-org>/shelfy-worker:latest

# Optional overrides
export POSTGRES_DB=shelfy
export POSTGRES_USER=shelfy
export MINIO_ROOT_USER=minioadmin
export MINIO_BUCKET=shelfy-images
export MINIO_REGION=us-east-1
```

**Optional:** To override allowed CORS origins:
`CORS_ALLOWED_ORIGINS='["https://library.example.com"]'`

## 5) Deploy the stack

```bash
docker stack deploy -c infra/swarm-stack.yml library-app
```

Check service status:

```bash
docker stack services library-app
docker service ls | grep library-app
```

## 6) Run Alembic migrations (first deploy and upgrades)

After backend service is running, run migrations once inside the backend container:

```bash
BACKEND_CONTAINER=$(docker ps --filter "name=library-app_backend" --format '{{.ID}}' | head -n 1)
docker exec "$BACKEND_CONTAINER" alembic upgrade head
```

## 7) Create the initial admin user (first deploy)

The stack reads `admin_email` + `admin_password` secrets and sets `SEED_ADMIN_ON_STARTUP=true` for the backend process.

On the first successful backend startup, Shelfy creates the admin account automatically.

To verify:
- open `https://$SHELFY_APP_HOST`
- sign in with the credentials from `admin_email` / `admin_password`

## 8) Update to a new version

1. Build and push new image tags.
2. Export new `SHELFY_BACKEND_IMAGE`, `SHELFY_FRONTEND_IMAGE`, and `SHELFY_WORKER_IMAGE` values.
3. Redeploy:

```bash
docker stack deploy -c infra/swarm-stack.yml library-app
```

Swarm performs rolling updates for services whose image references changed.

## 9) Manual smoke test checklist

After each deployment, validate:

- [ ] `https://$SHELFY_APP_HOST` loads the frontend.
- [ ] Login succeeds with admin credentials.
- [ ] `https://$API_HOST/health` returns `{"status":"ok"}`.
- [ ] `https://$API_HOST/health/ready` returns 200.
- [ ] Create a location and a book through the UI.
- [ ] Upload a cover image; job finishes successfully.
- [ ] MinIO console (`https://$MINIO_CONSOLE_HOST`) is reachable and object appears in bucket.
- [ ] Worker logs show job processing without errors.

Useful diagnostics:

```bash
docker service logs library-app_backend --tail 100
docker service logs library-app_worker --tail 100
docker service logs library-app_traefik --tail 100
```


## 10) Production security checklist

Before exposing Shelfy publicly, confirm:

- [ ] ENVIRONMENT=production is set for backend/worker services.
- [ ] JWT_SECRET_KEY is unique and not change-me.
- [ ] MINIO_ACCESS_KEY / MINIO_SECRET_KEY are not default values.
- [ ] ADMIN_PASSWORD is at least 12 characters.
- [ ] Docker secrets are used for all credentials and rotated periodically.
- [ ] CORS allowlist contains only trusted frontend origins.
- [ ] Images are pinned to explicit tags (avoid latest).


## 11) Local Docker Compose troubleshooting

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
