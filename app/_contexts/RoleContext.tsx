'use client'

import { createContext, useContext } from 'react'
import { useUser } from '@clerk/clerk-react'

type Role = 'customer' | 'vendor' | 'driver' | 'runner' | 'organizer' | 'admin'

interface RoleContextValue {
  role: Role | null
  roles: Role[]
  isVendor: boolean
  isOrganizer: boolean
  isRunner: boolean
  isDriver: boolean  // alias for isRunner — kept for backward compat
  isAdmin: boolean
}

const RoleContext = createContext<RoleContextValue>({
  role: null,
  roles: [],
  isVendor: false,
  isOrganizer: false,
  isRunner: false,
  isDriver: false,
  isAdmin: false,
})

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser()

  const meta = (user?.publicMetadata ?? {}) as Record<string, unknown>
  const primaryRole = (meta.role as Role) ?? null
  const rolesArr: Role[] = Array.isArray(meta.roles)
    ? (meta.roles as Role[])
    : primaryRole ? [primaryRole] : []

  const isRunner = rolesArr.includes('runner') || rolesArr.includes('driver')

  const value: RoleContextValue = {
    role: primaryRole,
    roles: rolesArr,
    isVendor: rolesArr.includes('vendor'),
    isOrganizer: rolesArr.includes('organizer'),
    isRunner,
    isDriver: isRunner,  // alias
    isAdmin: rolesArr.includes('admin'),
  }

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export function useRole() {
  return useContext(RoleContext)
}
