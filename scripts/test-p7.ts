/**
 * P7 Validation — worker isolation
 *
 * All checks are static (source inspection) since running two processes
 * simultaneously requires a live environment.
 *
 * Tests:
 *  1. workers/index.ts exists and imports startOrderWorker
 *  2. workers/index.ts registers SIGTERM + SIGINT handlers
 *  3. workers/index.ts does NOT start a BullMQ Worker inline
 *  4. workers/order-worker.ts exports startOrderWorker()
 *  5. workers/order-worker.ts has NO top-level worker instantiation outside the export
 *  6. workers/order-worker.ts has NO top-level process.on (moved to workers/index.ts)
 *  7. package.json "worker" script points to workers/index.ts
 *
 * The server.ts and render.yaml checks were removed with those files (the Render service is gone;
 * webhooks run on Vercel, the worker on Railway).
 */

let passed = 0
let failed = 0
function pass(msg: string) { console.log(`  ✅ ${msg}`); passed++ }
function fail(msg: string) { console.log(`  ❌ ${msg}`); failed++ }

async function main() {
  console.log('P7 Validation — worker isolation')
  console.log('─'.repeat(60))

  const fs  = await import('fs')
  const base = new URL('..', import.meta.url).pathname

  // ── workers/index.ts ──────────────────────────────────────────────────────
  console.log('\nworkers/index.ts')
  const indexSrc = fs.readFileSync(`${base}/workers/index.ts`, 'utf8')

  if (indexSrc.includes('startOrderWorker'))
    pass('imports startOrderWorker')
  else
    fail('does not import startOrderWorker')

  if (indexSrc.includes("process.on('SIGTERM'") && indexSrc.includes("process.on('SIGINT'"))
    pass('registers SIGTERM + SIGINT handlers')
  else
    fail('missing SIGTERM or SIGINT handler')

  if (!indexSrc.match(/new Worker\s*[(<]/))
    pass('no inline Worker instantiation')
  else
    fail('has inline Worker instantiation — should delegate to startOrderWorker()')

  // ── workers/order-worker.ts ───────────────────────────────────────────────
  console.log('\nworkers/order-worker.ts')
  const workerSrc = fs.readFileSync(`${base}/workers/order-worker.ts`, 'utf8')

  if (workerSrc.includes('export function startOrderWorker'))
    pass('exports startOrderWorker()')
  else
    fail('does not export startOrderWorker()')

  // Top-level (outside any function) Worker instantiation should be gone
  // Heuristic: "new Worker" should only appear inside the export function body
  const exportFnStart = workerSrc.indexOf('export function startOrderWorker')
  const firstNewWorker = workerSrc.indexOf('new Worker')
  if (firstNewWorker === -1 || firstNewWorker > exportFnStart)
    pass('no top-level Worker instantiation outside startOrderWorker()')
  else
    fail('Worker instantiated at top level (outside startOrderWorker)')

  // Top-level process.on should be gone — moved to index.ts
  const topSrc = exportFnStart > 0 ? workerSrc.slice(0, exportFnStart) : workerSrc
  if (!topSrc.includes('process.on('))
    pass('no top-level process.on (correctly moved to workers/index.ts)')
  else
    fail('top-level process.on still present — should be in workers/index.ts')

  // ── package.json ──────────────────────────────────────────────────────────
  console.log('\npackage.json')
  const pkg = JSON.parse(fs.readFileSync(`${base}/package.json`, 'utf8'))

  if (pkg.scripts?.worker?.includes('workers/index.ts'))
    pass('"worker" script points to workers/index.ts')
  else
    fail(`"worker" script is "${pkg.scripts?.worker}" — should point to workers/index.ts`)

  console.log('\n' + '─'.repeat(60))
  if (failed === 0) {
    console.log(`All ${passed} assertions passed. ✅`)
  } else {
    console.log(`${passed} passed, ${failed} failed.`)
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
