'use client'

import { createContext, useContext, useState } from 'react'

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

interface RunnerContextValue {
  // null = the real online status hasn't loaded yet (flicker class: a false default flashed
  // "Offline" + the go-online empty state at an ONLINE runner on every page load).
  isOnline: boolean | null
  setIsOnline: (v: boolean) => void
  // null = the real status hasn't loaded yet. NEVER defaulted to 'APPROVED': that briefly
  // showed an unapproved runner the approved UI (no pending banner, an enabled online
  // toggle) — a capability they don't have — before the fetch corrected it. null gates the
  // toggle OFF and hides the banner until the truth arrives (loading, not a lie).
  approvalStatus: ApprovalStatus | null
  setApprovalStatus: (v: ApprovalStatus) => void
}

const RunnerContext = createContext<RunnerContextValue>({
  isOnline: null,
  setIsOnline: () => {},
  approvalStatus: null,
  setApprovalStatus: () => {},
})

export function RunnerProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState<boolean | null>(null)
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus | null>(null)
  return (
    <RunnerContext.Provider value={{ isOnline, setIsOnline, approvalStatus, setApprovalStatus }}>
      {children}
    </RunnerContext.Provider>
  )
}

export function useRunner() {
  return useContext(RunnerContext)
}
