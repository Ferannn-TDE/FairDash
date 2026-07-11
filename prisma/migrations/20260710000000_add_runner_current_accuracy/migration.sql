-- Live-location Phase 1/3: GPS accuracy (meters) reported alongside the runner's
-- current coordinates. Nullable; written by POST /api/runners/me/location. Phase 3
-- uses it for stale/precision UX. No index — it is only ever read via the Runner row.
ALTER TABLE "Runner" ADD COLUMN "currentAccuracy" DOUBLE PRECISION;
