/**
 * MENU-REQUEST FILTER GUARD — the ?status= server filter and its stale-guard.
 *
 * This is the riskiest change in the menu arc: it touches the polling code the flicker fix
 * stabilised. Four things ship as ONE unit because landing any subset ships a bug the rest
 * prevent, and this suite has one control per half plus the count fix:
 *
 *   [1] the filter is in the fetch closure, so changing a tab refetches
 *   [2] a response issued under one filter is DROPPED, not merged, if the filter moved
 *   [3] BOTH fetches carry the status — loadMore is a separate fetch from the poll
 *   [4] loadedCountRef resets on filter change, or "Load more" is silently dead on page TWO
 *   [5] the count comes from the badge route and is invalidated on approve/reject
 *
 * WHY [3] AND [4] EXIST AT ALL. They are the two that a casual reading calls done. loadMore is
 * a second fetch: wiring the param into the poll does not wire it into loadMore, and a loadMore
 * without it pages UNFILTERED rows into a filtered list — the same result-set mixing [2] exists
 * to prevent, arriving through the back door. And [4] fails only on the SECOND page: the first
 * load under a new tab looks perfect while nextCursor was never set.
 *
 * STRUCTURAL HALVES SCAN CODE, NOT PROSE — comments are stripped first (the trap that turned
 * a step-1 guard red on its own documentation).
 *
 * BEHAVIOURAL HALVES READ THROUGH A FUNCTION so TypeScript's control-flow analysis cannot fold
 * the assertions into compile-time constants — tsc caught exactly that in the flash fix's
 * simulation ("types 'true' and 'false' have no overlap"). A guard the compiler can pre-solve
 * proves nothing at runtime.
 *
 * Pure — no database, no server. Run: npx tsx scripts/menu-request-filter-guard.ts
 */

import { readFileSync } from 'node:fs'

const PAGE = 'app/organizer/fairs/[fairSlug]/menu-requests/page.tsx'
const SHELL = 'app/organizer/_components/OrganizerShell.tsx'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/** Strip block and line comments so a scan matches code rather than the prose beside it. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
}

// Read through a function boundary so CFA cannot narrow these to literals.
const valueOf = <T,>(x: T): T => x

function main() {
  const page = codeOf(PAGE)
  const shell = codeOf(SHELL)

  // ── [0] THE SCANNER SEES CODE, NOT COMMENTS ────────────────────────────────────────────
  console.log('\n[0] the scanner reads code, not the prose beside it')
  const raw = readFileSync(PAGE, 'utf8')
  assert(/silently DEAD under that tab/.test(raw) && !/silently DEAD under that tab/.test(page),
    'comment-stripping works — prose in the raw file is absent from the scanned code')

  // ── [1] A FILTER CHANGE REFETCHES ──────────────────────────────────────────────────────
  console.log('\n[1] the filter is in the fetch closure, so changing tabs refetches')
  const DEPS = /\}, \[fairSlug, filter\]\)/
  assert(DEPS.test('  }, [fairSlug, filter])'), '[0] positive control: the deps scanner matches the fixed form')
  assert(!DEPS.test('  }, [fairSlug])'), '[0] baseline: it does NOT match the old fairSlug-only deps')
  assert(DEPS.test(page), 'fetchRequests closes over [fairSlug, filter]')
  assert(/useEffect\(\(\) => \{[\s\S]{0,400}?void fetchRequests\(false\)[\s\S]{0,80}?\}, \[fetchRequests\]\)/.test(page),
    'and the effect keyed on fetchRequests reloads NON-silently — a real result-set change earns a skeleton')

  // ── [2] THE STALE-DROP ─────────────────────────────────────────────────────────────────
  console.log('\n[2] a response from the old filter is dropped, not merged')
  assert(/const key = filter\s*\n\s*fetchKeyRef\.current = key/.test(page),
    'the request records the filter it was issued under, before the await')
  assert(/if \(fetchKeyRef\.current !== key\) return/.test(page),
    'and drops its response if the filter moved while it was in flight')
  // Order matters: the drop must come BEFORE the merge, or it drops nothing.
  assert(page.indexOf('fetchKeyRef.current !== key') < page.indexOf('setRequests(prev => mergeRequests'),
    'the drop is checked BEFORE setRequests — after it, the stale rows would already be merged')
  assert(/mergeRequests\(prev, json\.data\.requests\)/.test(page),
    'the id-keyed merge itself is unchanged — the filter guards identity, it does not replace the merge')

  // The property, modelled on the code's control flow: a poll issued under ALL resolving after
  // a switch to PENDING must not land.
  const ref = { current: 'PENDING' as 'PENDING' | 'ALL' }
  const merged: string[] = []
  const settle = (key: 'PENDING' | 'ALL', rows: string[]) => {
    if (ref.current !== key) return
    merged.push(...rows)
  }
  ref.current = 'ALL'
  const pollKey = ref.current              // a poll goes out under ALL
  ref.current = 'PENDING'                  // the organizer switches tab
  settle(pollKey, ['approved-row'])        // the stale poll lands
  assert(valueOf(merged).length === 0,
    'a poll issued under ALL does NOT land after a switch to PENDING')
  settle('PENDING', ['pending-row'])       // the current filter's response lands
  assert(valueOf(merged).length === 1,
    '[0] positive control: the CURRENT filter’s response DOES land — the guard is not dropping everything')

  // ── [3] BOTH FETCHES CARRY THE FILTER ──────────────────────────────────────────────────
  console.log('\n[3] loadMore carries the status too — it is a separate fetch')
  const fetchUrls = [...page.matchAll(/menu-requests\?take=\$\{[^`]*/g)].map(m => m[0])
  assert(fetchUrls.length === 2, `both fetch URLs found (${fetchUrls.length}) — the poll and loadMore`)
  assert(fetchUrls.every(u => u.includes('statusQuery(filter)')),
    'EVERY menu-requests fetch appends statusQuery(filter) — not just the poll')
  assert(/function statusQuery\(filter: TabFilter\): string/.test(page),
    'the status fragment is built in ONE place, so the two fetches cannot spell it differently')
  // [0] control: the scanner would notice a URL WITHOUT it.
  assert(!'menu-requests?take=${take}'.includes('statusQuery'),
    '[0] positive control: a URL lacking the param is detectable')

  // ── [4] loadedCountRef RESETS ON FILTER CHANGE (the page-TWO trap) ──────────────────────
  console.log('\n[4] the window counter resets, or Load more dies on page two')
  assert(/loadedCountRef\.current = 0/.test(page),
    'loadedCountRef is reset explicitly on a filter change')
  const resetIdx = page.indexOf('loadedCountRef.current = 0')
  const loadIdx = page.indexOf('void fetchRequests(false)', resetIdx)
  assert(resetIdx > 0 && loadIdx > resetIdx,
    'and it resets BEFORE the load that reads it — after, the fetch would size to the old list')
  assert(/setRequests\(\[\]\)[\s\S]{0,120}?setNextCursor\(null\)/.test(page),
    'the list and the cursor are cleared in the same effect')

  // The property: isFirstFill decides whether nextCursor is set, and it reads the counter.
  const withReset = (loadedBefore: number, didReset: boolean) => {
    const loaded = didReset ? 0 : loadedBefore
    return { isFirstFill: loaded === 0 }
  }
  assert(valueOf(withReset(50, true).isFirstFill) === true,
    'after a reset the first load under the new filter IS a first fill — so nextCursor gets set')
  assert(valueOf(withReset(50, false).isFirstFill) === false,
    '[0] positive control: WITHOUT the reset it is not — nextCursor never set, Load more silently dead')

  // ── [5] ONE COUNT, TWO READERS, INVALIDATED ON THE WRITE ───────────────────────────────
  console.log('\n[5] the count comes from the badge route and refreshes after a review')
  assert(/badgesQuery\.data\?\.menuRequests \?\? null/.test(page),
    'pendingCount is sourced from the badge route')
  assert(!/const pendingCount = requests\.filter/.test(page),
    'and NOT derived from the loaded list — which ?status= would make wrong, differently per tab')
  assert(/pendingCount: number \| null/.test(page),
    'it is null while loading — no plausible-but-wrong number is rendered before the real one')
  assert(/pendingCount != null && pendingCount > 0/.test(page),
    'and the render sites handle that null rather than printing "Pending (0)" during load')

  // The two readers must share ONE key, or invalidating one leaves the other stale.
  const pageKey = page.match(/queryKey: \['organizer-badges', (\w+)\]/)
  const shellKey = shell.match(/queryKey: \['organizer-badges', (\w+)\]/)
  assert(!!pageKey && !!shellKey, 'both the page and the sidebar shell query organizer-badges')
  assert(/invalidateQueries\(\{ queryKey: \['organizer-badges', fairSlug\] \}\)/.test(page),
    'an approve/reject INVALIDATES that key — the #5 staleness was client-side, not the server tag')
  const reviewIdx = page.indexOf('function handleReviewed')
  const invalidateIdx = page.indexOf('invalidateQueries', reviewIdx)
  assert(reviewIdx > 0 && invalidateIdx > reviewIdx && invalidateIdx - reviewIdx < 600,
    'the invalidation lives INSIDE the review handler — it fires on the mutation, not on mount')

  console.log(`\n${'─'.repeat(72)}`)
  if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
  else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
  console.log(`${'─'.repeat(72)}\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
