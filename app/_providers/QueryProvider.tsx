'use client'

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Single client per browser session. Default staleTime 30s aligns with the
// unstable_cache windows on the organizer API routes — revisits within 30s
// render instantly from cache, then revalidate in the background.
export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
