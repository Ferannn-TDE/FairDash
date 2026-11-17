// Which tab a RoleAuthCard opens on (BATCH-1 §21, Q2). `?mode=apply` opens on sign-up so other
// pages (e.g. /organizers "Get started") can link straight to it. Any other value, or none, opens on
// sign-in. A card without sign-up (runner, admin) ignores it. The sign-in redesign keeps this same URL.
// Pure, so scripts/organizers-page-test.ts can pin it.

export type AuthMode = 'sign-in' | 'sign-up'

export const AUTH_MODE_PARAM = 'mode'
export const AUTH_MODE_APPLY = 'apply'

export function initialAuthMode(modeParam: string | null, allowSignUp: boolean): AuthMode {
  return allowSignUp && modeParam === AUTH_MODE_APPLY ? 'sign-up' : 'sign-in'
}

