// Shared fetch helper for React Query. API routes return { success, data, error }.
// On non-ok or success:false we throw so React Query treats it as an error.
export async function fetchJson<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url)
  const json = await res.json().catch(() => null) as { success?: boolean; data?: T; error?: { message?: string } } | null
  if (!res.ok || !json) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
  if (json.success === false) throw new Error(json.error?.message ?? 'Request failed')
  return (json.data ?? json) as T
}
