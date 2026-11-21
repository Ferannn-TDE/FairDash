// Test substitute for next/cache (see _route-loader.mjs). Records calls, invalidates nothing.
// `revalidated` holds tags only (existing suites read it); `revalidatedWith` adds the second
// argument, so a suite can tell an immediate expiry ({ expire: 0 }) from a stale-while-revalidate
// profile ('default', 'max').
export const revalidated = []
export const revalidatedWith = []
export function revalidateTag(tag, profile) { revalidated.push(tag); revalidatedWith.push({ tag, profile }) }
export function revalidatePath(path) { revalidated.push(path) }
export function unstable_cache(fn) { return fn }
