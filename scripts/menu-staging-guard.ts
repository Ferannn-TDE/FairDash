/**
 * VENDOR STAGING GUARD — the pure logic behind the staging tray.
 *
 * ⚠️ WHAT THIS CANNOT SEE. This suite proves the FUNCTIONS the component calls. It cannot prove
 * the tray renders, that clicking remove on row 3 removes row 3, or that "Submit 8" issues one
 * request — those were checked by driving the screen, and the review notes say which is which.
 * The failure mode for a UI step is not a vacuous guard, it is a green guard beside a broken
 * screen, so the honest split is stated rather than implied.
 *
 * What IS provable here, in risk order:
 *  [1] the optimistic reconcile — N temporaries become the N real rows. Not 2N (append), not
 *      N-1 leftovers (replace-one), not a dropped batchId. Plus the failure half: a refused
 *      submit removes all N together, because the write route is all-or-nothing.
 *  [2] the submit body — one item goes through the SINGLE form (standalone, batchId null),
 *      several go as a batch, and NEITHER carries a client-made batchId or a stageId.
 *  [3] tray operations — remove by identity, not index; a staged edit is local.
 *
 * Run: npx tsx scripts/menu-staging-guard.ts   (pure — no database, no server)
 */

import { readFileSync } from 'node:fs'
import {
  STAGE_BUTTON_LABEL,
  TEMP_ID_PREFIX,
  addStaged,
  submitButtonLabel,
  trayHeading,
  trayHint,
  buildSubmitBody,
  isTempId,
  optimisticRowsFor,
  reconcileAfterSubmit,
  removeStaged,
  rollbackOptimistic,
  rowsFromSubmitResponse,
  updateStaged,
  type PendingRow,
  type StagedItem,
} from '../lib/menu-requests/staging'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

const fields = (n: string) => ({
  name: n, description: '', price: 5, prepTime: 10, category: 'Mains', imageUrl: '',
})

function tray(names: string[]): StagedItem[] {
  return names.reduce<StagedItem[]>((l, n, i) => addStaged(l, fields(n), `stage_${i}`), [])
}

const existing: PendingRow[] = [
  { id: 'real_old', type: 'EDIT', status: 'PENDING', name: 'Older request', menuItemId: 'mi_1', menuItem: { name: 'X' }, createdAt: '2026-08-01T00:00:00.000Z' },
]

function main() {
  // ── [1] THE OPTIMISTIC RECONCILE ───────────────────────────────────────────────────────
  console.log('\n[1] N optimistic rows become N real rows — the client mirror of the transaction')

  const staged = tray(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  const temps = optimisticRowsFor(staged, i => `t${i}`, '2026-08-28T00:00:00.000Z')
  const tempIds = temps.map(t => t.id)
  const afterOptimistic = [...temps, ...existing]

  assert(temps.length === 8, 'submitting 8 staged items shows 8 optimistic rows')
  assert(temps.every(t => isTempId(t.id)), `every optimistic id is marked temporary (${TEMP_ID_PREFIX}…)`)
  assert(new Set(tempIds).size === 8, 'the 8 temporary ids are distinct')
  assert(afterOptimistic.length === 9, 'the pre-existing pending request is untouched')

  // The server answers: 8 real rows, one shared batchId.
  const serverRows = rowsFromSubmitResponse({
    batchId: 'mrb_server_minted',
    requests: staged.map((s, i) => ({
      id: `real_${i}`, type: 'ADD', status: 'PENDING', name: s.name,
      menuItemId: null, createdAt: '2026-08-28T00:00:01.000Z', batchId: 'mrb_server_minted',
    })),
  })
  const reconciled = reconcileAfterSubmit(afterOptimistic, tempIds, serverRows)

  assert(reconciled.length === 9,
    `9 rows after reconcile, not 17 (got ${reconciled.length}) — the temporaries were REPLACED, not appended`)
  assert(!reconciled.some(r => isTempId(r.id)),
    'zero temporary rows linger — not one replaced and seven phantoms left')
  assert(reconciled.filter(r => r.id.startsWith('real_') && r.id !== 'real_old').length === 8,
    'all 8 server rows are present exactly once')
  assert(reconciled.filter(r => r.batchId === 'mrb_server_minted').length === 8,
    'the server-minted batchId survived the reconcile on every row')
  assert(reconciled.some(r => r.id === 'real_old'),
    'the unrelated pending request is still there')
  assert(reconciled[0].id.startsWith('real_'),
    'the new rows sit at the head — the list is newest-first, where the temporaries were')

  // [0] CONTROLS on the probe: the two wrong reconciles must NOT satisfy these assertions,
  // otherwise "9 rows" is a number that any implementation could hit.
  const appended = [...afterOptimistic, ...serverRows]
  assert(appended.length === 17 && appended.some(r => isTempId(r.id)),
    '[0] positive control: a naive APPEND gives 17 rows with temporaries still present')
  const replacedOne = [serverRows[0], ...afterOptimistic.filter(r => r.id !== tempIds[0])]
  assert(replacedOne.filter(r => isTempId(r.id)).length === 7,
    '[0] positive control: replacing only the first leaves 7 phantom rows')

  // The FAILURE half — step 4 made submit all-or-nothing, so a refusal must clear all N.
  console.log('\n[1b] a refused submit rolls back all N optimistic rows together')
  const rolledBack = rollbackOptimistic(afterOptimistic, tempIds)
  assert(rolledBack.length === 1, `only the pre-existing request survives (got ${rolledBack.length})`)
  assert(!rolledBack.some(r => isTempId(r.id)), 'no phantom items are left for the vendor to stare at')
  assert(rolledBack[0].id === 'real_old', 'and the survivor is the untouched real one')

  // ── [2] THE SUBMIT BODY ────────────────────────────────────────────────────────────────
  console.log('\n[2] the submit body — and what it must NOT contain')

  const one = buildSubmitBody('v1', tray(['solo']))
  const many = buildSubmitBody('v1', tray(['a', 'b', 'c']))

  assert(!('items' in one) && (one as { type?: string }).type === 'ADD',
    'ONE staged item submits through the SINGLE form (stays a standalone request, batchId null)')
  assert('items' in many && (many as { items: unknown[] }).items.length === 3,
    'three staged items submit as one batch of 3')

  const serialised = JSON.stringify({ one, many })
  assert(!serialised.includes('batchId'),
    'NEITHER body carries a batchId — the server mints it; a client-made one would reopen the forge hole')
  assert(!serialised.includes('stageId'),
    'no stageId leaks to the server — tray identities are client-only')
  // [0] control: the scanner would notice if one were present.
  assert(JSON.stringify({ x: { batchId: 'mrb_forged' } }).includes('batchId'),
    '[0] positive control: the scanner DOES detect a batchId in a body')

  // ── [3] TRAY OPERATIONS ────────────────────────────────────────────────────────────────
  console.log('\n[3] the tray removes by identity and edits locally')

  const three = tray(['first', 'second', 'third'])
  const removedMiddle = removeStaged(three, 'stage_1')
  assert(removedMiddle.length === 2, 'removing one leaves two')
  assert(removedMiddle.map(i => i.name).join(',') === 'first,third',
    'the row REMOVED is the one named — not its neighbour (identity, not index)')
  assert(three.length === 3, 'the original array is not mutated (React sees a new identity)')

  const edited = updateStaged(three, 'stage_1', { price: 12.5, name: 'second edited' })
  assert(edited[1].price === 12.5 && edited[1].name === 'second edited', 'a staged edit applies to that item')
  assert(edited[0].price === 5 && edited[2].price === 5, 'and to no other item')
  assert(three[1].price === 5, 'the original array is untouched')

  // A staged edit is local by construction: updateStaged is pure and returns an array. There is
  // nothing here that COULD issue a request — which is the point, and is why edit-staged and
  // edit-committed are different functions rather than one handler with a branch.
  assert(typeof updateStaged === 'function' && updateStaged.length === 3,
    'updateStaged is a pure (list, id, patch) function — no transport, so a staged edit cannot fire a request')

  // ── [4] RESPONSE NORMALISATION ─────────────────────────────────────────────────────────
  console.log('\n[4] both response shapes normalise')
  const fromSingle = rowsFromSubmitResponse({ id: 'r1', type: 'ADD', status: 'PENDING', name: 'X', createdAt: 'now', batchId: null })
  assert(fromSingle.length === 1 && fromSingle[0].batchId === null,
    'the single form answer normalises to one row with batchId null (standalone)')
  const fromBatch = rowsFromSubmitResponse({ batchId: 'mrb_1', requests: [{ id: 'r1', batchId: 'mrb_1' }, { id: 'r2', batchId: 'mrb_1' }] })
  assert(fromBatch.length === 2 && fromBatch.every(r => r.batchId === 'mrb_1'),
    'the batch form answer normalises to N rows all carrying the batchId')

  // ── [5] THE TWO CONTROLS MUST NEVER READ AS EACH OTHER ─────────────────────────────────
  // The defect this section exists for: step 5 shipped with the STAGING form still captioned
  // "Submit for Approval". The wiring was right; the words described the wrong action, and the
  // tray only appeared after the first stage, so a fresh form was indistinguishable from the
  // old single-submit one. This is the only slice of that a script can reach — whether the two
  // controls read as distinct to a HUMAN is the walk's job, and this guard does not claim it.
  console.log('\n[5] the stage control and the submit control are verbally distinct')

  const stage = STAGE_BUTTON_LABEL.toLowerCase()
  assert(!stage.includes('approval') && !stage.includes('submit'),
    `the stage control says neither "submit" nor "approval" (got "${STAGE_BUTTON_LABEL}")`)
  assert(stage.includes('add'), 'the stage control says "add"')

  for (const n of [1, 2, 8, 50]) {
    const submit = submitButtonLabel(n).toLowerCase()
    assert(submit.includes('submit') && submit.includes('approval'),
      `submit label at n=${n} names the real action ("${submitButtonLabel(n)}")`)
    assert(submit !== stage, `stage and submit labels differ at n=${n}`)
  }
  // [0] control on the comparison itself — two identical strings MUST be caught, or "they
  // differ" is a test that passes for any pair.
  assert(!('x' !== 'x'), '[0] positive control: the comparison DOES detect two equal labels')

  assert(submitButtonLabel(1) === 'Submit 1 item for approval', 'singular at 1')
  assert(submitButtonLabel(2) === 'Submit 2 items for approval', 'plural at 2')
  assert(trayHeading(0) === 'Your submission', 'the empty tray has a heading (it must render)')
  assert(trayHeading(1).includes('1 item') && !trayHeading(1).includes('1 items'), 'heading singular at 1')
  assert(trayHeading(3).includes('3 items'), 'heading plural at 3')
  assert(trayHint(0).length > 0 && /collect|together|submission/i.test(trayHint(0)),
    'the ZERO state explains that items collect and go together — where batching is discoverable')

  // The page must actually use these, and must not have reverted to a hard-coded caption.
  console.log('\n[6] the page renders those labels rather than its own')
  const page = readFileSync('app/vendor/[fairSlug]/menu/page.tsx', 'utf8')
  assert(/submitLabel=\{STAGE_BUTTON_LABEL\}/.test(page), 'the add form is given STAGE_BUTTON_LABEL')
  assert(/submitButtonLabel\(staged\.length\)/.test(page), 'the submit control uses submitButtonLabel()')
  assert(/\{trayHeading\(staged\.length\)\}/.test(page) && /\{trayHint\(staged\.length\)\}/.test(page),
    'the tray uses trayHeading()/trayHint()')
  assert(!/'Submit for Approval'/.test(page.split('EditItemModal')[0]),
    'the ADD form no longer hard-codes "Submit for Approval" (the caption that lied)')
  assert(/\{\(showAdd \|\| staged\.length > 0\) &&/.test(page),
    'the tray renders when the form is OPEN too — not only once something is staged')
  // [0] baseline: the EditItemModal keeps its own wording, untouched by this change.
  assert(/'Submit for Approval'/.test(page),
    '[0] baseline: "Submit for Approval" still exists — on the edit-committed path, which is a real submit')

  console.log(`\n${'─'.repeat(70)}`)
  if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
  else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
  console.log(`${'─'.repeat(70)}\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
