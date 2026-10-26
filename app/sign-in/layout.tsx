import { robotsFor } from '@/lib/seo'

// Sign-in pages are never indexed.
export const metadata = { robots: robotsFor('private') }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
