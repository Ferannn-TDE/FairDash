import { redirect } from 'next/navigation'
import { safeRedirect } from '@/lib/safe-redirect'

// The 4-in-1 login is retired. The front door is now the landing at `/`, each
// operator role has its own dedicated login, and customers sign in at
// `/sign-in/customer`. This stub stays as a compatibility shim so legacy links
// keep working:
//   - `?role=` deep links map to the right operator login.
//   - `?redirect=` (customer flow: checkout, order tracking, order history) is
//     forwarded to the customer sign-in WITH the return URL preserved.
//   - everything else goes home.
export default async function LegacyLoginRedirect({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; redirect?: string }>
}) {
  const { role, redirect: rawReturnTo } = await searchParams
  // Validate the deep link before forwarding it downstream (open-redirect guard).
  // '' fallback = no usable return URL, so we don't append ?redirect= at all.
  const returnTo = safeRedirect(rawReturnTo, '')
  const map: Record<string, string> = {
    vendor: '/sign-in/vendor',
    runner: '/sign-in/runner',
    organizer: '/organizer/login',
    admin: '/admin/login',
  }
  if (role && map[role]) {
    // Preserve the deep link (e.g. /organizer/fairs) so the role login returns
    // the user there after sign-in — RoleAuthCard reads ?redirect=.
    redirect(returnTo ? `${map[role]}?redirect=${encodeURIComponent(returnTo)}` : map[role])
  }
  if (returnTo) redirect(`/sign-in/customer?redirect=${encodeURIComponent(returnTo)}`)
  redirect('/')
}
