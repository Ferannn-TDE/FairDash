// Module-resolution hook for running a real route handler outside Next: everything
// _clerk-loader.mjs does (Clerk identity from globalThis.__MOCK_CLERK), plus `next/cache` as a
// no-op, since revalidateTag needs Next's request store, which only exists inside Next.
// Cache invalidation is not under test where this is used; every other line of the route is real.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@clerk/nextjs/server') {
    return { url: new URL('./_clerk-mock.mjs', import.meta.url).href, shortCircuit: true }
  }
  if (specifier === 'next/cache') {
    return { url: new URL('./_next-cache-mock.mjs', import.meta.url).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
