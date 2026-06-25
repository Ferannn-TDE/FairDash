import { redirect } from 'next/navigation'
// Resolve the runner's real event via /runner (no hardcoded fair slug).
export default function RunnerDashboardRedirect() {
  redirect('/runner')
}
