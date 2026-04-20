'use client'

import { createContext, useContext, useState } from 'react'

interface RunnerContextValue {
  isOnline: boolean
  setIsOnline: (v: boolean) => void
}

const RunnerContext = createContext<RunnerContextValue>({
  isOnline: true,
  setIsOnline: () => {},
})

export function RunnerProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(false)
  return (
    <RunnerContext.Provider value={{ isOnline, setIsOnline }}>
      {children}
    </RunnerContext.Provider>
  )
}

export function useRunner() {
  return useContext(RunnerContext)
}
