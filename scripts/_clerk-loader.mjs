// Module-resolution hook: redirect '@clerk/nextjs/server' to the test mock, so the
// real route handlers run with a controllable identity. Everything else resolves
// normally (chains to tsx's TS loader).
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@clerk/nextjs/server') {
    return { url: new URL('./_clerk-mock.mjs', import.meta.url).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
