// The "ordering paused" wording and code (item 10 stage 3). A plain module with no server imports,
// so the browser checkout can share it with POST /api/orders (lib/ordering-paused.ts).
export const ORDERING_PAUSED_MESSAGE = 'Ordering is paused, please try again shortly'
export const ORDERING_PAUSED_CODE = 'ORDERING_PAUSED'
