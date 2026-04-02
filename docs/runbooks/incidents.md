# Incident Runbook

## 1) Frontend blank/white screen

Symptoms:
- Route loads but page is blank (often after UI change).

Actions:
1. Check browser console for runtime error.
2. Build frontend:
   ```bash
   docker exec infra-frontend-1 sh -lc "cd /app && npm run build"
   ```
3. Restart frontend container:
   ```bash
   cd infra && docker compose restart frontend
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
1. Check `redis`, `worker`, `backend` containers are healthy.
2. Inspect worker logs for task failures/retries.
3. Restart worker if needed and re-run failed flow.

## 4) Ordering inconsistencies on shelves

Symptoms:
- Duplicate `shelf_position` values or gaps.

Actions:
1. Run normalization SQL operation in controlled window.
2. Verify duplicates query returns zero rows.
3. Re-test move/reorder flows from detail, bulk, and bookshelf DnD.
