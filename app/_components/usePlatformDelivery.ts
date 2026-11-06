'use client'

import { useEffect, useState } from 'react'

/** The platform home-delivery switch (item 6). null while loading — callers hide or disable the
 *  delivery toggle until it's known, never guess (flicker-class rule). */
export function usePlatformDelivery(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let active = true
    fetch('/api/platform/delivery', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (active) setEnabled(j?.success ? j.data.enabled === true : false) })
      .catch(() => { if (active) setEnabled(false) })
    return () => { active = false }
  }, [])
  return enabled
}
