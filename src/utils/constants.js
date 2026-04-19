// Client-side constants — mirrors lib/constants.ts for SPA consumption.
// NEVER import lib/constants.ts directly from the SPA (it's a server module).

/** How often vendor dashboard writes a heartbeat to Firebase RTDB (ms). */
export const ADMIN_HEARTBEAT_INTERVAL_MS = 30_000 // 30 seconds
