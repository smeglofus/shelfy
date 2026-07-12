# Incident Runbook

Production runs in k3s (namespace `shelfy`); all commands assume
`export KUBECONFIG=~/.kube/config` on homelab2. General triage:

```bash
kubectl -n shelfy get pods                     # anything not Running / restarting?
kubectl -n shelfy logs deploy/backend --tail=100
kubectl -n shelfy describe pod <pod>           # events: OOMKilled, probes, pulls
```

## 1) Frontend blank/white screen

Symptoms:
- Route loads but page is blank (often after UI change).

Actions:
1. Check browser console for runtime error.
2. Frontend images are immutable builds — if a recent deploy caused it,
   roll back instead of rebuilding in place:
   ```bash
   kubectl -n shelfy rollout undo deploy/frontend
   ```
3. If it is not deploy-related, restart the pod:
   ```bash
   kubectl -n shelfy rollout restart deploy/frontend
   ```
4. Validate key routes: `/books`, `/bookshelf`, `/scan`.

## 2) Shelf scan extraction failure

Symptoms:
- User sees extraction error despite valid photo.

Actions:
1. Inspect backend/worker logs for timeout/provider errors.
2. Verify Gemini API key is present and valid.
3. Retry same scan once (provider flakiness).

## 3) Queue/worker stuck

Symptoms:
- Upload accepted but processing never completes.

Actions:
1. Check the pods are healthy:
   ```bash
   kubectl -n shelfy get pods -l 'app in (redis,worker,backend,beat)'
   ```
2. Inspect worker logs for task failures/retries:
   ```bash
   kubectl -n shelfy logs deploy/worker --tail=100
   ```
3. Restart the worker if needed and re-run the failed flow:
   ```bash
   kubectl -n shelfy rollout restart deploy/worker
   ```

## 4) Ordering inconsistencies on shelves

Symptoms:
- Duplicate `shelf_position` values or gaps.

Actions:
1. Run normalization SQL operation in controlled window.
2. Verify duplicates query returns zero rows.
3. Re-test move/reorder flows from detail, bulk, and bookshelf DnD.


## 5) Frontend runtime telemetry
- Backend logs now include `frontend_runtime_error` events from browser runtime failures.
- Metrics include `frontend_runtime_errors_total{kind=...}` for trend monitoring.


## 6) Alerting references
- Prometheus alert rules: `docs/monitoring/alerts.prometheus.yml`
- Monitoring overview: `docs/monitoring/README.md`
