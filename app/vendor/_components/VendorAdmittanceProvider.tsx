'use client'

import { createContext, useContext } from 'react'
import type { VendorOperatorState } from '@/lib/vendor-operator-state'

/**
 * Carries the door's admittance verdict from the SERVER layout down to the client shell.
 *
 * WHY A PROVIDER AND NOT A SECOND READ. app/vendor/layout.tsx already computes this — one query,
 * one call to vendorOperatorState — to decide whether to render the gate screen. The shell needs
 * the same answer to decide which nav to offer. Re-deriving it in the shell would be a second
 * source that can disagree with the door (and a second DB round-trip on every portal page); this
 * threads the value the door actually used. One derivation, two consumers.
 *
 * ⚠️ IMPORT DISCIPLINE (§7). This is a `'use client'` file, so it must never reach a server-only
 * module — the reverted attempt at this feature died exactly that way, a client file pulling
 * lib/db → @prisma/client into the browser bundle and killing the portal on first page load,
 * having passed tsc and the whole suite twice. The only import here is a TYPE from
 * lib/vendor-operator-state, which is itself import-free by invariant.
 *
 * FAIL-CLOSED DEFAULT. An absent provider yields 'AWAITING', not 'ADMITTED': a shell rendered
 * somewhere the door never ran shows the exits-only nav rather than the full portal. The safe
 * default is the restrictive one.
 */
const VendorAdmittanceContext = createContext<VendorOperatorState>('AWAITING')

export function VendorAdmittanceProvider({
  state,
  children,
}: {
  state: VendorOperatorState
  children: React.ReactNode
}) {
  return (
    <VendorAdmittanceContext.Provider value={state}>{children}</VendorAdmittanceContext.Provider>
  )
}

export function useVendorAdmittance(): VendorOperatorState {
  return useContext(VendorAdmittanceContext)
}
