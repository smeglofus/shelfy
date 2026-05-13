# Self-hosted GitHub Actions runner — homelab box

Operational runbook for the self-hosted CI runner that handles the four
cheap CI jobs (`backend / lint`, `backend / tests`, `frontend`,
`security-scan`) for the `smeglofus/shelfy` repository.

The two expensive jobs (`e2e`, `e2e-p0-mobile`) stay on GitHub-hosted
runners — Playwright + a headless browser want ~2 GB on top of the test
process, which is more than this 7.5 GB host can spare alongside prod.

## Why this runner exists

Free-tier GitHub Actions caps private repos at 2000 min/month. Iterative
PR cycles on the borrower epic regularly burned 1500+ min/month; one
docs-only PR cost ~14 min. Moving the cheap jobs locally saves an
estimated 70–80 % of those minutes:

| Job                | Old cost      | New cost (per PR)            |
|--------------------|---------------|------------------------------|
| backend / lint     | ~1 min on GHA | runs on homelab — 0 GHA min  |
| backend / tests    | ~3–4 min on GHA | runs on homelab — 0 GHA min |
| frontend           | ~1 min on GHA | runs on homelab — 0 GHA min  |
| security-scan      | ~0.5 min on GHA | runs on homelab — 0 GHA min |
| e2e                | ~5–8 min on GHA | unchanged — still on GHA   |
| e2e-p0-mobile      | dispatch only | unchanged — still on GHA     |

Concurrency cancel + `paths-ignore` + draft-skip in the same PR cut
another chunk of the GHA-side minutes.

## Architecture

- One Docker container on the homelab host, image
  `myoung34/github-runner` (community-maintained wrapper around the
  official actions-runner). Compose service defined in
  `infra/docker-compose.runner.yml`.
- Repo-scoped runner: registered against `smeglofus/shelfy` only.
  Labelled `self-hosted,linux,x64,shelfy`. Workflows opt in via
  `runs-on: [self-hosted, shelfy]`.
- Ephemeral worker (`EPHEMERAL=true`): each job tears down its worker
  process when finished so leftover env / files cannot leak across
  jobs. The container itself stays up and re-registers.
- Resource fence: 2 GB mem limit, 3.0 CPU shares. With prod sitting at
  ~5 GB resident, that leaves ~500 MB of headroom (some swap activity
  during peak is acceptable).

## One-time setup

### 1. Create a fine-grained PAT

`https://github.com/settings/tokens?type=beta`

- **Resource owner:** `smeglofus`
- **Repository access:** Only select repositories → `shelfy`
- **Permissions:**
  - Repository / **Actions** → Read and write
  - Repository / **Administration** → Read and write
- **Expiration:** 90 days (set a calendar reminder to rotate)

Copy the token. It looks like `github_pat_AAA...`.

### 2. Add to `infra/.env.prod.local`

```bash
# Self-hosted CI runner (see docs/runner-setup.md)
RUNNER_PAT=github_pat_AAA…
RUNNER_NAME=shelfy-prod-runner
```

The file is gitignored. Do not commit.

### 3. Bring the runner up

From the repo root:

```bash
docker compose \
  --env-file infra/.env.prod.local \
  -f infra/docker-compose.yml \
  -f infra/docker-compose.runner.yml \
  up -d github-runner
```

Watch logs to verify registration:

```bash
docker compose -f infra/docker-compose.runner.yml logs -f github-runner
```

Expect to see `Connected to GitHub` and `Listening for Jobs` within ~20
seconds.

### 4. Verify in GitHub

`https://github.com/smeglofus/shelfy/settings/actions/runners`

The runner should show **Online** with the four labels
`self-hosted, linux, x64, shelfy`.

### 5. Run a test workflow

Push a trivial change or use the **Re-run all jobs** button on a recent
PR. The four cheap jobs should now show `Self-hosted` next to them in
the GitHub UI. `e2e` should still show `ubuntu-latest`.

## Operations

### Bumping the runner image

`myoung34/github-runner` tracks upstream `actions/runner` releases.
Edit the pinned tag in `infra/docker-compose.runner.yml`, then:

```bash
docker compose -f infra/docker-compose.runner.yml pull github-runner
docker compose --env-file infra/.env.prod.local \
  -f infra/docker-compose.yml \
  -f infra/docker-compose.runner.yml \
  up -d github-runner
```

The container re-registers automatically.

### Stopping the runner

```bash
docker compose -f infra/docker-compose.runner.yml stop github-runner
```

While stopped, workflows that target `[self-hosted, shelfy]` will queue
indefinitely — GitHub does not fall back to a hosted runner. If you
need to take it down for a while, also temporarily switch the four
affected jobs back to `runs-on: ubuntu-latest`.

### Rotating the PAT

When the PAT is about to expire:

1. Create a new PAT with the same scopes.
2. Update `RUNNER_PAT` in `infra/.env.prod.local`.
3. `docker compose ... up -d github-runner` (compose detects the env
   change and restarts the container).
4. The runner re-registers itself. Old PAT can be revoked.

### Watching resource usage

```bash
docker stats infra-github-runner-1 --no-stream
```

Expect ~50–80 MB resident at idle. Peak during `pytest --cov` is
~600–900 MB; `npm ci` is similar. If you see steady-state above 1.5 GB
or repeated OOM kills (`docker compose logs | grep -i killed`), drop
`cpus: 3.0` to `2.0` first; only raise `mem_limit: 2g` to `3g` if the
prod containers can spare it.

## Troubleshooting

| Symptom | First thing to check |
|---|---|
| Workflow stuck in `queued` for `[self-hosted, shelfy]` | `docker compose ps github-runner` — is the container `Up`? `docker logs github-runner --tail 50` for registration errors. |
| Runner shows `Offline` in GitHub | PAT expired or revoked. Renew and restart. |
| `apt-get install trivy` step fails | The runner image ships with `sudo` for the `runner` user. If you locked it down, re-enable for the security-scan job specifically or move that one job back to `ubuntu-latest`. |
| `pytest` runs out of memory | A test (or a fixture leak) probably opens too many DB connections. Cap pytest workers (`-n 2` if you use pytest-xdist) or bump the mem limit temporarily. Don't leave it raised — it eats prod memory. |
| Prod containers start swapping during a CI job | The mem_limit on the runner isn't being honored (you're using compose v2 with `mem_limit` ignored). Verify with `docker inspect infra-github-runner-1 \| grep -i mem`. Switch to the `deploy.resources.limits` syntax if needed. |
| Job completed but artifacts (Trivy SARIF, etc.) missing | The runner image has Docker but not the `actions/upload-artifact` binary cache; the action falls back to fetch it on first run. Subsequent runs are fast. If it persistently fails, the runner doesn't have internet egress to GitHub blob storage. |

## What this runner is NOT

- **Not a build server for prod.** The prod backend image is still
  built by `infra/deploy-prod.local.sh`. The runner only runs CI tests.
- **Not org-wide.** Repo-scoped to `smeglofus/shelfy`. Adding more
  repositories means more PATs and more concurrent jobs competing for
  the same 2 GB / 3 CPU envelope — likely not worth it on this box.
- **Not a substitute for GitHub-hosted runners.** When this homelab
  box is down (electricity, ISP, host reboot), workflows targeting
  `[self-hosted, shelfy]` queue until it's back. For day-job
  guaranteed availability, you'd want a hot-standby on a VPS or stay
  on GHA-hosted for safety-critical jobs.

## Decision log

- **2026-05-12** — first self-hosted runner spun up to relieve the
  Free-tier 2000 min/month cap that was about to bite. Initially scoped
  to lint + backend tests + frontend + security-scan; e2e stays on GHA.
  Resource limits set conservatively (2 GB / 3 CPU) based on prod
  sitting at ~5 GB / 8 threads. Pinned to `myoung34/github-runner:2.321.0`
  for reproducibility — revisit on a quarterly schedule.
