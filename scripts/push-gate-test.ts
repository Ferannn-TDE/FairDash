// PUSH GATE — no commit reaches GitHub unless `npm run gate` passed on that exact commit.
//
// 2026-10-26: 8c0abc7 was pushed before anyone saw the gate pass. scripts/gate.sh now writes
// .gate-pass with the commit it passed on, and scripts/git-hooks/pre-push refuses any push
// whose commit is not that one. Docs-only commits are not exempt.
//
// Everything runs in throwaway repos under the OS temp dir, pushing to a local bare remote,
// through the real git hook machinery (the global dispatcher, when configured, then
// .git/hooks/pre-push). gate.sh runs for real with npm and the test-db wrapper stubbed, so
// the stamp logic is exercised without the 2-minute suite.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync, copyFileSync, rmSync, realpathSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

let pass = 0
let fail = 0
function assert(cond: unknown, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) } else { fail++; console.log(`  ✗ ${label}`) }
}

const REPO = process.cwd()
const root = realpathSync(mkdtempSync(join(tmpdir(), 'push-gate-')))

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
function run(cwd: string, cmd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

// A working repo with the real hook installed by the real installer, plus a bare remote.
function makeRepo(name: string) {
  const remote = join(root, `${name}-remote.git`)
  const dir = join(root, name)
  git(root, 'init', '-q', '--bare', remote)
  git(root, 'init', '-q', '-b', 'main', dir)
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  mkdirSync(join(dir, 'scripts/git-hooks'), { recursive: true })
  for (const f of ['scripts/gate.sh', 'scripts/install-git-hooks.sh', 'scripts/git-hooks/pre-push']) {
    copyFileSync(join(REPO, f), join(dir, f))
    chmodSync(join(dir, f), 0o755)
  }
  // Stubs: npm is a no-op; the test-db wrapper runs GATE_STUB_DURING (to change the tree while
  // the gate is running), then exits with GATE_STUB_EXIT.
  writeFileSync(join(dir, 'scripts/with-test-db.sh'), '#!/bin/sh\n[ -n "$GATE_STUB_DURING" ] && sh -c "$GATE_STUB_DURING"\nexit "${GATE_STUB_EXIT:-0}"\n')
  chmodSync(join(dir, 'scripts/with-test-db.sh'), 0o755)
  mkdirSync(join(dir, 'bin'))
  writeFileSync(join(dir, 'bin/npm'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(dir, 'bin/npm'), 0o755)
  writeFileSync(join(dir, '.gitignore'), '.gate-pass\nbin/\n')
  writeFileSync(join(dir, 'README.md'), 'v1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'Initial')
  git(dir, 'remote', 'add', 'origin', remote)
  execFileSync('sh', ['scripts/install-git-hooks.sh'], { cwd: dir })
  return dir
}
const push = (dir: string, ...extra: string[]) => run(dir, 'git', ['push', 'origin', ...extra])
const gate = (dir: string, args: string[] = [], exit = 0, during = '') =>
  run(dir, './scripts/gate.sh', args, { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, GATE_STUB_EXIT: String(exit), GATE_STUB_DURING: during })
const stamp = (dir: string) => (existsSync(join(dir, '.gate-pass')) ? readFileSync(join(dir, '.gate-pass'), 'utf8').trim() : null)
const commitDoc = (dir: string, text: string) => {
  writeFileSync(join(dir, 'README.md'), text)
  git(dir, 'commit', '-q', '-am', 'Update notes')
  return git(dir, 'rev-parse', 'HEAD')
}

try {
  console.log('\n[0] positive control: the hook runs, and a gated commit pushes')
  const a = makeRepo('a')
  const head0 = git(a, 'rev-parse', 'HEAD')
  const g0 = gate(a)
  assert(g0.status === 0 && stamp(a) === head0, 'a green full gate on a clean tree stamps HEAD')
  const p0 = push(a, 'main:main')
  assert(p0.status === 0, 'push of the stamped commit is allowed')
  assert(git(a, 'ls-remote', 'origin', 'refs/heads/main').startsWith(head0), 'the remote received it')

  console.log('\n[1] the hook refuses what the gate has not passed')
  const head1 = commitDoc(a, 'v2 docs only\n')
  const p1 = push(a, 'main:main')
  assert(p1.status !== 0 && /gate last passed on/.test(p1.out), 'a docs-only commit after the gated one is refused')
  assert(git(a, 'ls-remote', 'origin', 'refs/heads/main').startsWith(head0), 'the remote did not move')
  rmSync(join(a, '.gate-pass'))
  const p1b = push(a, 'main:main')
  assert(p1b.status !== 0 && /no gate pass recorded/.test(p1b.out), 'with no stamp at all, the push is refused')
  writeFileSync(join(a, '.gate-pass'), `${head1}\n`)
  const p1c = push(a, 'main:main', 'main:other')
  assert(p1c.status === 0, 'every ref pointing at the stamped commit pushes')
  git(a, 'checkout', '-q', '-b', 'side', head0)
  const p1d = push(a, 'main:main2', 'side:side')
  assert(p1d.status !== 0 && /refused refs\/heads\/side/.test(p1d.out), 'one ungated ref in a multi-ref push refuses the push')
  git(a, 'checkout', '-q', 'main')
  const p1e = push(a, ':other')
  assert(p1e.status === 0, 'deleting a remote ref (no code pushed) is allowed')

  console.log('\n[2] gate.sh writes the stamp only for a full green run over the committed tree')
  const b = makeRepo('b')
  const headB = git(b, 'rev-parse', 'HEAD')
  writeFileSync(join(b, '.gate-pass'), `${headB}\n`)
  const g2a = gate(b, [], 1)
  assert(g2a.status !== 0, 'a failing suite run fails the gate')
  assert(stamp(b) === null, 'a failing run removes any earlier stamp')
  const g2b = gate(b, ['--fast'])
  assert(g2b.status === 0 && stamp(b) === null && /partial run/.test(g2b.out), '--fast passes but writes no stamp')
  const g2c = gate(b, ['--for', 'payouts'])
  assert(g2c.status === 0 && stamp(b) === null, 'a filtered run writes no stamp')
  writeFileSync(join(b, 'README.md'), 'uncommitted edit\n')
  const g2d = gate(b)
  assert(g2d.status === 0 && stamp(b) === null && /did not test a commit/.test(g2d.out), 'an unstaged edit to a tracked file means no stamp')
  git(b, 'add', 'README.md')
  const g2e = gate(b)
  assert(stamp(b) === null && /did not test a commit/.test(g2e.out), 'a staged but uncommitted edit means no stamp')
  const g2g = gate(b, [], 0, 'git checkout -q HEAD -- README.md')
  assert(stamp(b) === null && /did not test a commit/.test(g2g.out), 'an edit present at the start and reverted mid-run still means no stamp')
  writeFileSync(join(b, 'README.md'), 'uncommitted edit\n')
  git(b, 'commit', '-q', '-am', 'Edit')
  const g2h = gate(b, [], 0, 'echo mid-run > README.md')
  assert(stamp(b) === null && /did not test a commit/.test(g2h.out), 'an edit made mid-run means no stamp')
  git(b, 'checkout', '-q', 'HEAD', '--', 'README.md')
  const g2i = gate(b, [], 0, 'git commit -q --allow-empty -m Moved')
  assert(stamp(b) === null && /HEAD moved/.test(g2i.out), 'a commit made mid-run means no stamp')
  writeFileSync(join(b, 'untracked.txt'), 'scratch\n')
  const g2f = gate(b)
  assert(stamp(b) === git(b, 'rev-parse', 'HEAD'), 'untracked files do not block the stamp; it names the new HEAD')

  console.log('\n[3] installation')
  const linked = join(b, '.git/hooks/pre-push')
  assert(existsSync(linked) && resolve(join(b, '.git/hooks'), readlinkSync(linked)) === join(b, 'scripts/git-hooks/pre-push'), 'the installer links .git/hooks/pre-push to the tracked hook')
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
  assert(pkg.scripts.prepare === 'sh scripts/install-git-hooks.sh', 'npm install runs the installer (prepare)')
  assert(pkg.scripts.gate === './scripts/gate.sh', '`npm run gate` goes through gate.sh')
  assert(pkg.scripts['gate:fast'] === './scripts/gate.sh --fast', '`npm run gate:fast` goes through gate.sh (and so never stamps)')
  assert(readFileSync(join(REPO, '.gitignore'), 'utf8').split('\n').includes('.gate-pass'), '.gate-pass is git-ignored')
  const outside = run(root, 'sh', [join(REPO, 'scripts/install-git-hooks.sh')])
  assert(outside.status === 0, 'outside a git checkout (Vercel, Railway) the installer does nothing and succeeds')
} catch (err) {
  console.error(err)
  fail++
} finally {
  rmSync(root, { recursive: true, force: true })
  console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} push-gate: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
