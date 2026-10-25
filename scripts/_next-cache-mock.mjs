// Test substitute for next/cache (see _route-loader.mjs). Records calls, invalidates nothing.
export const revalidated = []
export function revalidateTag(tag) { revalidated.push(tag) }
export function revalidatePath(path) { revalidated.push(path) }
export function unstable_cache(fn) { return fn }
