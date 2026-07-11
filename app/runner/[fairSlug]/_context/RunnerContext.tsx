'use client'

import { createContext, useContext, useState } from 'react'

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

interface RunnerContextValue {
  isOnline: boolean
  setIsOnline: (v: boolean) => void
  approvalStatus: ApprovalStatus
  setApprovalStatus: (v: ApprovalStatus) => void
}

const RunnerContext = createContext<RunnerContextValue>({
  isOnline: true,
  setIsOnline: () => {},
  approvalStatus: 'APPROVED',
  setApprovalStatus: () => {},
})

export function RunnerProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(false)
  // Assume APPROVED until the real status loads, so an already-approved runner
  // never sees a flash of the "awaiting approval" banner on mount.
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>('APPROVED')
  return (
    <RunnerContext.Provider value={{ isOnline, setIsOnline, approvalStatus, setApprovalStatus }}>
      {children}
    </RunnerContext.Provider>
  )
}

export function useRunner() {
  return useContext(RunnerContext)
}
