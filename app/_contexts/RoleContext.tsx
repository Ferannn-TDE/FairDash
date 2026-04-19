'use client'

import { createContext, useContext } from 'react'
import { useUser } from '@clerk/clerk-react'

type Role = 'customer' | 'vendor' | 'driver' | 'organizer' | 'admin'

interface RoleContextValue {
  role: Role | null
  roles: Role[]
  isVendor: boolean
  isOrganizer: boolean
  isDriver: boolean
  isAdmin: boolean
}

const RoleContext = createContext<RoleContextValue>({
  role: null,
  roles: [],
  isVendor: false,
  isOrganizer: false,
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

  const value: RoleContextValue = {
    role: primaryRole,
    roles: rolesArr,
    isVendor: rolesArr.includes('vendor'),
    isOrganizer: rolesArr.includes('organizer'),
    isDriver: rolesArr.includes('driver'),
    isAdmin: rolesArr.includes('admin'),
  }

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export function useRole() {
  return useContext(RoleContext)
}
