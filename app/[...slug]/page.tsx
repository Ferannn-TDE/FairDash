'use client'

import dynamic from 'next/dynamic'

// ---------------------------------------------------------------------------
// ClerkProvider is NOT here — it lives in app/layout.tsx via ClerkClientProvider
// (imported from @clerk/clerk-react, Core 3 context). The SPA inherits it.
// Duplicating it here caused: "You've added multiple <ClerkProvider> components"
// ---------------------------------------------------------------------------

// Disable SSR — the SPA uses BrowserRouter which needs window.location.
const App = dynamic(() => import('../../src/App'), { ssr: false })

export default function Page() {
  return <App />
}
