import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { git, harness, repository, type Harness } from './harness.ts'

let fixture: string | undefined
let live: Harness | undefined

afterEach(async () => {
  await live?.ctx.fiber.dispose()
  live = undefined
  if (fixture !== undefined) await rm(fixture, { recursive: true, force: true })
  fixture = undefined
})

const signal = (): AbortSignal => new AbortController().signal

/** Add a worktree at the official pool so the source table has something to claim. */
async function worktreeAt(root: string, name: string): Promise<string> {
  const path = join(root, '.agents', 'worktrees', name)
  await git(root, 'worktree', 'add', '-b', name, path)
  return path
}

async function registered(root: string): Promise<string> {
  return await git(root, 'worktree', 'list', '--porcelain')
}

describe('worktree console Remote', () => {
  it('lists a worktree with its origin and leaves the repository itself out', async () => {
    fixture = await repository()
    const one = await worktreeAt(fixture, 'brave-otter')
    live = await harness(fixture, [fixture])

    const snapshot = await live.ctx.worktreeConsole.list(signal())

    expect(snapshot.repositories).toHaveLength(1)
    expect(snapshot.repositories[0]?.path).toBe(fixture)
    expect(snapshot.repositories[0]?.worktrees).toEqual([
      { path: one, branch: 'brave-otter', head: expect.stringMatching(/^[0-9a-f]{40}$/) as string,
        stale: false, dirtyFiles: [], ignoredFiles: [], outsideRepository: false, locked: false, origin: 'official' },
    ])
  })

  it('reports a repository with no worktrees as an empty list, not a missing one', async () => {
    fixture = await repository()
    live = await harness(fixture, [fixture])

    expect((await live.ctx.worktreeConsole.list(signal())).repositories[0]?.worktrees).toEqual([])
  })

  /**
   * A read that spans repositories names no single resource, so the Gateway
   * decides it on `global` and the method filters later. A caller bound to one
   * workspace must therefore lose the others here — the filter is the only
   * place that decision exists, and the Host still refuses a direct `prune` or
   * removal outside those bindings.
   */
  it('drops the repositories the caller may not see, and asks once per repository', async () => {
    // Both fixtures live under one tracked directory so the cleanup above takes
    // them together; `repository()` would otherwise leave the second behind.
    fixture = await mkdtemp(join(tmpdir(), 'dsh-console-access-'))
    const visible = await repository(fixture)
    const hidden = await repository(fixture)
    live = await harness(visible, [visible, hidden])

    live.access.allows = resource => resource.id !== hidden
    const snapshot = await live.ctx.worktreeConsole.list(signal())

    expect(snapshot.repositories.map(row => row.path)).toEqual([visible])
    expect(live.access.checked.map(resource => resource.id)).toEqual([visible, hidden])
    expect(live.access.checked.every(resource => resource.kind === 'workspace')).toBe(true)
  })

  it('skips a registered workspace that is not a repository root', async () => {
    fixture = await repository()
    const container = await mkdtemp(join(tmpdir(), 'dsh-console-container-'))
    try {
      live = await harness(fixture, [container, fixture])
      expect((await live.ctx.worktreeConsole.list(signal())).repositories.map(row => row.path)).toEqual([fixture])
    } finally {
      await rm(container, { recursive: true, force: true })
    }
  })

  it('reports the changed files of a dirty worktree', async () => {
    fixture = await repository()
    const one = await worktreeAt(fixture, 'brave-otter')
    await writeFile(join(one, 'fresh.txt'), 'draft\n')
    await writeFile(join(one, 'tracked.txt'), 'edited\n')
    live = await harness(fixture, [fixture])

    const rows = (await live.ctx.worktreeConsole.list(signal())).repositories[0]?.worktrees ?? []

    // Git lists tracked modifications before untracked entries, so compare as
    // a set: the page shows the files, the order is Git's.
    expect([...(rows[0]?.dirtyFiles ?? [])].sort()).toEqual(['fresh.txt', 'tracked.txt'])
  })

  it('refuses a dirty removal without confirmation and leaves the repository unchanged', async () => {
    fixture = await repository()
    const one = await worktreeAt(fixture, 'brave-otter')
    await writeFile(join(one, 'fresh.txt'), 'draft\n')
    live = await harness(fixture, [fixture])

    const failure = await live.ctx.worktreeConsole.removeWorktree(fixture, one, false, signal()).catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({ code: 'worktree/dirty', details: { path: one, files: ['fresh.txt'] } })
    expect(await registered(fixture)).toContain(one)
  })

  it('removes a confirmed dirty worktree and its registration', async () => {
    fixture = await repository()
    const one = await worktreeAt(fixture, 'brave-otter')
    await writeFile(join(one, 'fresh.txt'), 'draft\n')
    live = await harness(fixture, [fixture])

    expect(await live.ctx.worktreeConsole.removeWorktree(fixture, one, true, signal())).toEqual({ removed: one })
    expect(await registered(fixture)).not.toContain(one)
  })

  it('clears a stale registration, reports only what Git cleared, and stays idempotent', async () => {
    fixture = await repository()
    const one = await worktreeAt(fixture, 'brave-otter')
    const kept = await worktreeAt(fixture, 'calm-heron')
    await rm(one, { recursive: true, force: true })
    live = await harness(fixture, [fixture])

    expect(await live.ctx.worktreeConsole.prune(fixture, signal())).toEqual({ pruned: [one] })
    expect(await live.ctx.worktreeConsole.prune(fixture, signal())).toEqual({ pruned: [] })
    expect(await registered(fixture)).toContain(kept)
  })

  // An ignored file is a file the removal deletes. Reporting the checkout as
  // clean would let the delete happen without ever showing the user what went.
  it('reports an ignored file on the row and refuses to discard it unconfirmed', async () => {
    fixture = await repository()
    const one = await worktreeAt(fixture, 'brave-otter')
    await writeFile(join(one, '.env'), 'SECRET=1\n')
    live = await harness(fixture, [fixture])

    const rows = (await live.ctx.worktreeConsole.list(signal())).repositories[0]?.worktrees ?? []
    expect(rows[0]?.dirtyFiles).toEqual([])
    expect(rows[0]?.ignoredFiles).toEqual(['.env'])

    const failure = await live.ctx.worktreeConsole.removeWorktree(fixture, one, false, signal()).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'worktree/dirty', details: { files: ['.env'] } })
    expect(await registered(fixture)).toContain(one)
  })

  // A third-party pool may keep its checkouts outside the repository, and the
  // page shows them: refusing to remove one left a visible row no action could
  // act on. Nothing here is fenced — the user asked for this — so the checkout's
  // own location is not a boundary.
  it('removes a checkout registered from outside the repository', async () => {
    fixture = await repository()
    // Git reports realpaths, and macOS hands out /var symlinks.
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'dsh-console-outside-')))
    try {
      await git(fixture, 'worktree', 'add', '-b', 'elsewhere', outside)
      live = await harness(fixture, [fixture])

      const rows = (await live.ctx.worktreeConsole.list(signal())).repositories[0]?.worktrees ?? []
      expect(rows[0]?.outsideRepository).toBe(true)

      const outcome = await live.ctx.worktreeConsole.removeWorktree(fixture, outside, true, signal())
      expect(outcome).toEqual({ removed: outside })
      expect(await registered(fixture)).not.toContain(outside)

      // The page is the caller, so nothing here is fenced: the sandbox seam is
      // never consulted at all, which is what an unconfined policy records as.
      expect(live.sandbox.policies).toEqual([])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('refuses a stale registration, because pruning is the repair', async () => {
    fixture = await repository()
    const one = await worktreeAt(fixture, 'brave-otter')
    await rm(one, { recursive: true, force: true })
    live = await harness(fixture, [fixture])

    const failure = await live.ctx.worktreeConsole.removeWorktree(fixture, one, true, signal()).catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({ code: 'worktree/stale', details: { path: one } })
  })

  it('rejects a checkout the repository does not know', async () => {
    fixture = await repository()
    live = await harness(fixture, [fixture])

    const failure = await live.ctx.worktreeConsole.removeWorktree(fixture, join(fixture, 'nowhere'), true, signal())
      .catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({ code: 'worktree/not-found', details: { repositoryId: fixture } })
  })

  it('rejects an unknown repository id', async () => {
    fixture = await repository()
    live = await harness(fixture, [fixture])

    const failure = await live.ctx.worktreeConsole.prune('not-a-repository', signal()).catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'worktree/repository-not-found',
      details: { repositoryId: 'not-a-repository' },
    })
  })
})

describe('worktree console branch choices', () => {
  it('reads the Session directory’s repository and marks the branch it has out', async () => {
    fixture = await repository()
    await git(fixture, 'branch', 'feature/one')
    live = await harness(fixture, [fixture])

    expect(await live.ctx.worktreeConsole.branches('session-1', signal())).toEqual({
      repositoryRoot: fixture,
      branches: [
        { name: 'feature/one', kind: 'local', current: false },
        { name: 'main', kind: 'local', current: true },
      ],
    })
  })

  // A remote-tracking ref is the only way to start from a revision the local
  // branch has not caught up to, so the picker offers it beside the local one
  // rather than hiding it behind the branch of the same name.
  it('offers remote-tracking refs beside local branches', async () => {
    fixture = await repository()
    const head = await git(fixture, 'rev-parse', 'HEAD')
    await git(fixture, 'remote', 'add', 'origin', 'https://example.invalid/dsh.git')
    await git(fixture, 'update-ref', 'refs/remotes/origin/main', head)
    await git(fixture, 'update-ref', 'refs/remotes/origin/release/1.0', head)
    live = await harness(fixture, [fixture])

    expect(await live.ctx.worktreeConsole.branches('session-1', signal())).toEqual({
      repositoryRoot: fixture,
      branches: [
        { name: 'main', kind: 'local', current: true },
        { name: 'origin/main', kind: 'remote', current: false },
        { name: 'origin/release/1.0', kind: 'remote', current: false },
      ],
    })
  })

  // The picker has to be able to say "there is nothing to choose here" instead
  // of showing an empty list, which reads as a repository with no branches.
  it('reports no repository for a directory that is outside every one', async () => {
    fixture = await repository()
    const elsewhere = await mkdtemp(join(tmpdir(), 'dsh-console-outside-'))
    try {
      live = await harness(fixture, [fixture], undefined, { directory: elsewhere })

      expect(await live.ctx.worktreeConsole.branches('session-1', signal()))
        .toEqual({ repositoryRoot: null, branches: [] })
    } finally {
      await rm(elsewhere, { recursive: true, force: true })
    }
  })

  it('rejects an unknown Session id', async () => {
    fixture = await repository()
    live = await harness(fixture, [fixture], undefined, { known: [] })

    const failure = await live.ctx.worktreeConsole.branches('session-1', signal()).catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({ code: 'worktree/unknown-session', details: { sessionId: 'session-1' } })
  })
})

// A namespace service owns a surface of its own, and `$mount` installs the
// Remote methods onto it. A method named `remove` landed on the service's own
// `remove` and the mount refused the whole contribution — which surfaced as an
// entry that never activated, with the boot reporting a bare `failed` and no
// cause. Reserved names, mirrored from `packages/api/gateway/src/client/index.ts`:
// the `REMOTE_NAMESPACE_FIELDS` set (line 750) plus the members of
// `RemoteNamespaceService.prototype` — `assertMethodAvailable`, `empty`, `has`,
// `installDirect`, `installScoped`, `remove` — and the cordis `Service` base's
// `ctx` and `name`. A rename is the repair; this test is what keeps the next
// one from shipping the same fault.
const RESERVED_WIRE_NAMES = new Set([
  'ctx', 'empty', 'invokeRemote', 'methods', 'name', 'namespace',
  'assertMethodAvailable', 'has', 'installDirect', 'installScoped', 'remove',
])

describe('worktree console wire names', () => {
  it('keeps every Remote method off the namespace service surface', async () => {
    fixture = await repository()
    live = await harness(fixture, [fixture])

    const wire = remoteMethods(live.ctx.worktreeConsole).map(marker => marker.exportName ?? marker.method)

    expect([...wire].sort()).toEqual(['arm', 'branches', 'disarm', 'list', 'prune', 'removeWorktree', 'state'])
    expect(wire.filter(name => RESERVED_WIRE_NAMES.has(name))).toEqual([])
  })
})
