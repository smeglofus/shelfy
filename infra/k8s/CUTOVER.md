# Cutover: shelfy.cz z Docker Compose do k3s

> **✅ PROVEDENO 12. 7. 2026** — produkce běží v k3s (namespace `shelfy`).
> Dokument zůstává jako runbook-záznam a podklad pro rollback okno (14 dní).

Runbook pro přepnutí produkce. Piš si k němu časy a poznámky — je to zároveň
podklad pro pohovorovou historku. Všechno se spouští na homelab2 jako `suslik`
(kroky se `sudo` jsou označené).

**Než začneš:** staging běží a proklikal sis ho, `gen-secrets.sh` proběhl,
images jsou public, máš ~30 min klidu. Výpadek během cutoveru: ~10–20 minut.

```bash
cd ~/shelfy && export KUBECONFIG=~/.kube/config
```

---

## Fáze A — jednorázová příprava (kdykoli předem)

### A1. Images v GHCR — ✅ hotovo

Cluster stahuje `shelfy-backend`, `shelfy-worker` i `shelfy-frontend` bez
pull secretu (ověřeno staging deployem 12. 7.). Kdyby někdy nová image skončila
v ImagePullBackOff: GitHub → Packages → Package settings → Change visibility → Public.

### A2. Staging přes tunel (sudo)

```bash
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak-pre-k3s
sudo nano /etc/cloudflared/config.yml
```

Nad pravidla pro `shelfy.cz` přidej:

```yaml
  - hostname: staging.shelfy.cz
    service: http://127.0.0.1:80
```

```bash
sudo cloudflared tunnel route dns eff8a021-6a73-4bef-968d-a22b848bc669 staging.shelfy.cz
sudo systemctl restart cloudflared && systemctl status cloudflared --no-pager
```

### A3. Ověřit staging

- https://staging.shelfy.cz — přihlásit se, proklikat knihovnu, výpůjčky, hledání.
- Volitelně e2e z tvého stroje: `cd e2e && E2E_BASE_URL=https://staging.shelfy.cz npx playwright test --project=chromium tests/smoke-regressions.spec.ts`
- Pozn.: Google OAuth na stagingu nefunguje (redirect URI není v Google konzoli) — e-mail login ano. Stripe checkout netestuj na stagingu (vede na ostrý Stripe).

---

## Fáze B — předpříprava produkce (den/hodinu předem, bez výpadku)

```bash
infra/k8s/scripts/gen-secrets.sh prod          # secret vč. NOVÉHO pg/redis hesla
kubectl apply -k infra/k8s/overlays/prod
kubectl -n shelfy scale deploy backend worker beat frontend --replicas=0
kubectl -n shelfy get pods                     # postgres/redis/minio Running, app 0/0
infra/k8s/scripts/mirror-minio.sh prod         # bulk kopie obálek atd. (delta se dožene ve fázi C)
```

> Nové DB heslo je schválně — staré bylo `CHANGE_ME_DB`. Skript ho drží
> v Secretu, při reruns se nemění.

---

## Fáze C — cutover (výpadek začíná)

**C1. Freeze zápisů** (frontend nech běžet — jen statická landing, API bude mrtvé):

```bash
docker compose --env-file infra/.env.prod.local -f infra/docker-compose.prod.yml \
  stop backend worker beat
```

**C2. Finální dump:**

```bash
mkdir -p ~/backups
docker exec infra-postgres-1 pg_dump -U shelfy -Fc shelfy \
  > ~/backups/shelfy-cutover-$(date +%F-%H%M).dump
ls -lh ~/backups/ | tail -1     # sanity: nenulová velikost
```

**C3. Restore do k3s** (přes lokální socket v podu, heslo netřeba):

```bash
kubectl -n shelfy exec -i deploy/postgres -- \
  pg_restore -U shelfy -d shelfy --clean --if-exists --no-owner \
  < ~/backups/shelfy-cutover-*.dump
kubectl -n shelfy exec deploy/postgres -- \
  psql -U shelfy -d shelfy -c "select count(*) from users;"   # sanity

# glibc collation dumpu a podu se liší (staging to potvrdil) — bez reindexu
# můžou být textové indexy potichu špatně seřazené:
kubectl -n shelfy exec deploy/postgres -- \
  psql -U shelfy -d shelfy -c "REINDEX DATABASE shelfy;" \
  -c "ALTER DATABASE shelfy REFRESH COLLATION VERSION;"
```

**C4. MinIO delta:** `infra/k8s/scripts/mirror-minio.sh prod`

**C5. Start aplikace v k3s:**

```bash
kubectl -n shelfy scale deploy backend worker beat frontend --replicas=1
kubectl -n shelfy rollout status deploy/backend    # initContainer = alembic (no-op)
infra/k8s/scripts/smoke.sh shelfy.cz
```

**C6. Přepnout tunel (sudo).** V `/etc/cloudflared/config.yml` nahraď tři
pravidla pro `shelfy.cz` (path `/api/*`, `/health*` a catch-all na :5173)
jedním — cesty teď routuje Traefik:

```yaml
  - hostname: shelfy.cz
    service: http://127.0.0.1:80
```

```bash
sudo systemctl restart cloudflared
```

**C7. Ověření** (výpadek končí):

```bash
curl -fsS https://shelfy.cz/health/ready && echo OK
kubectl -n shelfy logs -f deploy/backend   # sleduj při proklikávání
```

Prohlížeč: login, výpůjčka, hledání knihy (ověří MinIO obálky), demo stránka.

**C8. Dostop compose frontend + retarget Prometheus:**

```bash
docker compose --env-file infra/.env.prod.local -f infra/docker-compose.prod.yml stop frontend
```

V `infra/prometheus/prometheus.yml` změň target backendu na
`192.168.88.3:30800` a `docker compose --env-file infra/.env.prod.local -f
infra/docker-compose.prod.yml restart prometheus` (compose Grafana/Prometheus
zatím zůstávají — do k3s se stěhují v týdnu 3 plánu).

---

## Rollback (kdykoli, ~5 minut)

```bash
sudo cp /etc/cloudflared/config.yml.bak-pre-k3s /etc/cloudflared/config.yml
sudo systemctl restart cloudflared
docker compose --env-file infra/.env.prod.local -f infra/docker-compose.prod.yml \
  start backend worker beat frontend
```

Data: compose DB je nedotčená ve stavu z C1. Zápisy, které mezitím přijal k3s,
v ní nejsou — když rollbackuješ po delším ostrém provozu, přenes je dumpem
z k3s (`kubectl -n shelfy exec deploy/postgres -- pg_dump -U shelfy -Fc shelfy > ...`
a restore do compose postgresu).

## Po cutoveru

- **14 dní nemazat** compose stack ani jeho volumes; pak `docker compose down` (bez `-v`!) a volumes ruč po dalším týdnu.
- `free -h` a `kubectl top nodes/pods -n shelfy` první dny hlídej — 8 GB RAM je těsných.
- Staging namespace po týdnu smaž: `kubectl delete ns shelfy-staging` (uvolní ~1,5 GB RAM).
- Beat v k3s převzal R2 zálohy — druhý den zkontroluj, že v R2 přibyl nový dump.
- Follow-upy (dny 10–20 plánu): deploy pipeline s pinovaným `sha-*` tagem místo `latest`, SOPS pro secrets, kube-prometheus-stack, rotace MinIO root credentials, doplnit `host` do pgadmin ingressu (teď chytá všechno na :80).
