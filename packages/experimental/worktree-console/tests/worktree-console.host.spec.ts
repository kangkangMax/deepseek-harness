import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation, type SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
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
  it('requires confirmation before archiving live and persisted sessions in a removed worktree', async () => {
    fixture = await repository()
    const checkout = await worktreeAt(fixture, 'associated')
    live = await harness(fixture, [fixture], undefined, { entries: [
      { id: 'live', directory: checkout },
      { id: 'cold', directory: join(checkout, 'src'), persisted: true },
      { id: 'unrelated', directory: `${checkout}-other` },
      { id: 'main', directory: fixture },
    ] })

    const row = (await live.ctx.worktreeConsole.list(signal())).repositories[0]?.worktrees.find(row => row.path === checkout)
    expect(row?.sessionIds).toEqual(['live', 'cold'])
    await expect(live.ctx.worktreeConsole.removeWorktree(fixture, checkout, true, [], signal()))
      .rejects.toMatchObject({ code: 'worktree/sessions-unconfirmed' })
    expect(await registered(fixture)).toContain(checkout)
    expect(live.archived).toEqual([])

    await live.ctx.worktreeConsole.removeWorktree(fixture, checkout, false, ['live', 'cold'], signal())
    expect(await registered(fixture)).not.toContain(checkout)
    expect(live.archived).toEqual(['live', 'cold'])
  })

  it.each([new Error('session is active'), 'session is active'])('leaves the checkout registered when archiving fails: %s', async (failure) => {
    fixture = await repository()
    const checkout = await worktreeAt(fixture, 'active-session')
    live = await harness(fixture, [fixture], undefined, {
      entries: [{ id: 'active', directory: checkout }],
      archive: vi.fn<(id: string) => Promise<void>>().mockRejectedValue(failure),
    })
    await expect(live.ctx.worktreeConsole.removeWorktree(fixture, checkout, true, ['active'], signal()))
      .rejects.toMatchObject({ code: 'worktree/session-archive-failed' })
    expect(await registered(fixture)).toContain(checkout)
    expect(live.archived).toEqual([])
  })

  it('refuses removal when Session history is unavailable', async () => {
    fixture = await repository()
    const checkout = await worktreeAt(fixture, 'history-unavailable')
    live = await harness(fixture, [fixture])
    live.removeQuery()
    await expect(live.ctx.worktreeConsole.removeWorktree(fixture, checkout, false, [], signal()))
      .rejects.toMatchObject({ code: 'worktree/unavailable', details: { reason: 'no-session-query' } })
    expect(await registered(fixture)).toContain(checkout)
  })

  it('refuses removal when working-directory projections are unavailable and releases the observation', async () => {
    fixture = await repository()
    const checkout = await worktreeAt(fixture, 'projection-unavailable')
    live = await harness(fixture, [fixture], undefined, { entries: [{ id: 'associated', directory: checkout }] })
    const read = live.query.observeSession
    const dispose = vi.fn()
    live.query.observeSession = async (...args) => {
      const { projections: _projections, ...observation } = await read(...args)
      return { ...observation, [Symbol.dispose]: dispose }
    }
    await expect(live.ctx.worktreeConsole.removeWorktree(fixture, checkout, false, ['associated'], signal()))
      .rejects.toMatchObject({ code: 'worktree/unavailable', details: { reason: 'no-session-projections' } })
    expect(dispose).toHaveBeenCalledOnce()
    expect(await registered(fixture)).toContain(checkout)
  })

  it('uses the header directory when a Session has no directory-change projection', async () => {
    fixture = await repository()
    const checkout = await worktreeAt(fixture, 'header-directory')
    live = await harness(fixture, [fixture], undefined, { entries: [{ id: 'associated', directory: fixture }] })
    const read = live.query.observeSession
    live.query.observeSession = async (...args) => {
      const observation = await read(...args)
      return { ...observation, header: { ...observation.header, cwd: checkout }, projections: { asOfSeq: -1, values: {} } }
    }
    await expect(live.ctx.worktreeConsole.removeWorktree(fixture, checkout, false, [], signal()))
      .rejects.toMatchObject({ code: 'worktree/sessions-unconfirmed' })
    expect(live.archived).toEqual([])
  })

  it('uses the default directory when the Session has no recorded directory', async () => {
    fixture = await repository()
    const checkout = await worktreeAt(fixture, 'default-directory')
    live = await harness(fixture, [fixture], undefined, { entries: [{ id: 'associated', directory: fixture }] })
    const read = live.query.observeSession
    live.query.observeSession = async (...args) => {
      const observation = await read(...args)
      const { cwd: _cwd, ...header } = observation.header
      return { ...observation, header, projections: { asOfSeq: -1, values: {} } }
    }
    const working = live.ctx.get('workingDirectory')
    if (working === undefined) throw new Error('fixture workingDirectory missing')
    Object.defineProperty(working, 'defaultDirectory', { value: checkout })
    await expect(live.ctx.worktreeConsole.removeWorktree(fixture, checkout, false, [], signal()))
      .rejects.toMatchObject({ code: 'worktree/sessions-unconfirmed' })
    live.removeWorkingDirectory()
    await expect(live.ctx.worktreeConsole.removeWorktree(fixture, checkout, false, [], signal()))
      .rejects.toMatchObject({ code: 'worktree/unavailable', details: { reason: 'no-working-directory' } })
    expect(await registered(fixture)).toContain(checkout)
  })

  it('keeps an already archived Session archived without asking for another confirmation', async () => {
    fixture = await repository()
    const checkout = await worktreeAt(fixture, 'already-archived')
    live = await harness(fixture, [fixture], undefined, { entries: [{ id: 'archived', directory: checkout }] })
    live.archived.push('archived')
    await live.ctx.worktreeConsole.removeWorktree(fixture, checkout, false, [], signal())
    expect(live.archived).toEqual(['archived'])
    expect(await registered(fixture)).not.toContain(checkout)
  })

  it('reports retained archives when cancellation interrupts archiving', async () => {
    fixture = await repository()
    const checkout = await worktreeAt(fixture, 'cancel-archive')
    const controller = new AbortController()
    live = await harness(fixture, [fixture], undefined, {
      entries: [{ id: 'first', directory: checkout }, { id: 'second', directory: checkout }],
      archive: () => { controller.abort('cancelled by user'); return Promise.resolve() },
    })
    await expect(live.ctx.worktreeConsole.removeWorktree(fixture, checkout, false, ['first', 'second'], controller.signal))
      .rejects.toMatchObject({
        code: 'worktree/removal-incomplete',
        details: { archivedSessionIds: ['first'], reason: 'cancelled by user' },
      })
    expect(live.archived).toEqual(['first'])
    expect(await registered(fixture)).toContain(checkout)
  })

  it('requires confirmation again when another session enters after the inventory was read', async () => {
    fixture = await repository()
    const checkout = await worktreeAt(fixture, 'changed-association')
    const entries = [{ id: 'first', directory: checkout }]
    live = await harness(fixture, [fixture], undefined, { entries })
    await live.ctx.worktreeConsole.list(signal())
    entries.push({ id: 'second', directory: checkout })
    await expect(live.ctx.worktreeConsole.removeWorktree(fixture, checkout, false, ['first'], signal()))
      .rejects.toMatchObject({ code: 'worktree/sessions-unconfirmed' })
    expect(live.archived).toEqual([])
    expect(await registered(fixture)).toContain(checkout)
  })

  it('does not archive sessions when unconfirmed file changes refuse the removal', async () => {
    fixture = await repository()
    const checkout = await worktreeAt(fixture, 'dirty-associated')
    await writeFile(join(checkout, 'fresh.txt'), 'draft\n')
    live = await harness(fixture, [fixture], undefined, { entries: [{ id: 'associated', directory: checkout }] })
    await expect(live.ctx.worktreeConsole.removeWorktree(fixture, checkout, false, ['associated'], signal()))
      .rejects.toMatchObject({ code: 'worktree/dirty' })
    expect(live.archived).toEqual([])
  })

  it('archives persisted sessions when removing a stale worktree registration', async () => {
    fixture = await repository()
    const checkout = await worktreeAt(fixture, 'stale-associated')
    await rm(checkout, { recursive: true, force: true })
    live = await harness(fixture, [fixture], undefined, { entries: [{ id: 'cold', directory: checkout, persisted: true }] })
    await live.ctx.worktreeConsole.removeWorktree(fixture, checkout, false, ['cold'], signal())
    expect(live.archived).toEqual(['cold'])
    expect(await registered(fixture)).not.toContain(checkout)
  })

  it('reports retained archives when Git refuses removal after sessions were archived', async () => {
    fixture = await repository()
    const checkout = await worktreeAt(fixture, 'locked-associated')
    await git(fixture, 'worktree', 'lock', checkout)
    live = await harness(fixture, [fixture], undefined, { entries: [{ id: 'associated', directory: checkout }] })
    await expect(live.ctx.worktreeConsole.removeWorktree(fixture, checkout, false, ['associated'], signal()))
      .rejects.toMatchObject({
        code: 'worktree/removal-incomplete',
        details: { path: checkout, archivedSessionIds: ['associated'] },
      })
    expect(live.archived).toEqual(['associated'])
    expect(await registered(fixture)).toContain(checkout)
  })

  it('reports partial archives and leaves Git unchanged if a later session cannot be archived', async () => {
    fixture = await repository()
    const checkout = await worktreeAt(fixture, 'partial-archive')
    live = await harness(fixture, [fixture], undefined, {
      entries: [{ id: 'first', directory: checkout }, { id: 'active', directory: checkout }],
      archive: id => id === 'active' ? Promise.reject(new Error('session is active')) : Promise.resolve(),
    })
    await expect(live.ctx.worktreeConsole.removeWorktree(fixture, checkout, false, ['first', 'active'], signal()))
      .rejects.toMatchObject({ code: 'worktree/removal-incomplete', details: { archivedSessionIds: ['first'] } })
    expect(live.archived).toEqual(['first'])
    expect(await registered(fixture)).toContain(checkout)
  })

  it('refuses removal when an associated session is not accessible to the caller', async () => {
    fixture = await repository()
    const checkout = await worktreeAt(fixture, 'private-session')
    live = await harness(fixture, [fixture], undefined, { entries: [{ id: 'private', directory: checkout }] })
    live.access.allows = resource => resource.kind !== 'session'
    await expect(live.ctx.worktreeConsole.removeWorktree(fixture, checkout, true, ['private'], signal()))
      .rejects.toMatchObject({ code: 'worktree/session-access-denied' })
    expect(await registered(fixture)).toContain(checkout)
    expect(live.archived).toEqual([])
  })

  it('reads a cold Session’s persisted directory without requiring a live Session and releases the observation', async () => {
    fixture = await repository()
    const checkout = await worktreeAt(fixture, 'cold-checkout')
    live = await harness(fixture, [fixture], undefined, { known: [] })
    const dispose = vi.fn()
    const observation: SessionObservation = {
      source: 'prepared',
      header: { ...Session.create(SessionId('cold')).header, cwd: fixture },
      inheritedEventCount: SessionLogOffset(0),
      events: [], cursor: -1,
      projections: { asOfSeq: -1, values: { workingDirectory: checkout } },
      retain: () => observation,
      [Symbol.dispose]: dispose,
    }
    const query: Pick<SessionQueryEngine, 'observeSession'> = { observeSession: async () => observation }
    live.query.observeSession = query.observeSession

    const choices = await live.ctx.worktreeConsole.branches('cold', signal())
    expect(choices.repositoryRoot).toBe(checkout)
    expect(choices.branches.find(branch => branch.current)).toEqual({ name: 'cold-checkout', kind: 'local', current: true })
    expect(dispose).toHaveBeenCalledOnce()
    expect(live.ctx.sessions.get(SessionId('cold'))).toBeUndefined()
  })

  it('preserves an unknown-session error when a cold observation cannot find it', async () => {
    fixture = await repository()
    live = await harness(fixture, [fixture], undefined, { known: [] })
    const query: Pick<SessionQueryEngine, 'observeSession'> = {
      observeSession: () => Promise.reject(new SessionQueryError('missing', 'SESSION_QUERY_SESSION_NOT_FOUND')),
    }
    live.query.observeSession = query.observeSession
    await expect(live.ctx.worktreeConsole.branches('missing', signal())).rejects.toMatchObject({ code: 'worktree/unknown-session' })
  })

  // The repository's own checkout is a row: the page is the whole inventory, so
  // a user sees which worktree they are already in beside the extra ones.
  it('lists the repository’s own checkout first, then the worktrees it registered', async () => {
    fixture = await repository()
    const one = await worktreeAt(fixture, 'brave-otter')
    live = await harness(fixture, [fixture])

    const snapshot = await live.ctx.worktreeConsole.list(signal())

    expect(snapshot.repositories).toHaveLength(1)
    expect(snapshot.repositories[0]?.path).toBe(fixture)
    const rows = snapshot.repositories[0]?.worktrees ?? []
    expect(rows.map(row => row.path)).toEqual([fixture, one])
    expect(rows[0]).toMatchObject({ primary: true, branch: 'main', stale: false, outsideRepository: false, origin: 'manual' })
    expect(rows[1]).toEqual({
      path: one, branch: 'brave-otter', head: expect.stringMatching(/^[0-9a-f]{40}$/) as string,
      primary: false, stale: false, dirtyFiles: [], ignoredFiles: [], outsideRepository: false, locked: false,
      origin: 'official', sessionIds: [],
    })
  })

  it('still reports the repository itself when it registered no worktrees', async () => {
    fixture = await repository()
    live = await harness(fixture, [fixture])

    const rows = (await live.ctx.worktreeConsole.list(signal())).repositories[0]?.worktrees ?? []
    expect(rows.map(row => row.path)).toEqual([fixture])
    expect(rows[0]?.primary).toBe(true)
  })

  it('identifies the main checkout when the registered workspace is a linked checkout', async () => {
    fixture = await repository()
    const linked = await worktreeAt(fixture, 'linked')
    live = await harness(fixture, [linked])
    const rows = (await live.ctx.worktreeConsole.list(signal())).repositories[0]?.worktrees ?? []
    expect(rows.find(row => row.path === fixture)?.primary).toBe(true)
    expect(rows.find(row => row.path === linked)?.primary).toBe(false)
    const failure = await live.ctx.worktreeConsole.removeWorktree(linked, fixture, true, [], signal())
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'worktree/primary' })
  })

  it('rejects the inventory read when a checkout cannot be inspected', async () => {
    fixture = await repository()
    const linked = await worktreeAt(fixture, 'broken')
    await writeFile(join(linked, '.git'), 'gitdir: missing-administration\n')
    live = await harness(fixture, [fixture])
    await expect(live.ctx.worktreeConsole.list(signal())).rejects.toThrow()
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
    const row = rows.find(candidate => candidate.path === one)
    expect([...(row?.dirtyFiles ?? [])].sort()).toEqual(['fresh.txt', 'tracked.txt'])
  })

  it('refuses a dirty removal without confirmation and leaves the repository unchanged', async () => {
    fixture = await repository()
    const one = await worktreeAt(fixture, 'brave-otter')
    await writeFile(join(one, 'fresh.txt'), 'draft\n')
    live = await harness(fixture, [fixture])

    const failure = await live.ctx.worktreeConsole.removeWorktree(fixture, one, false, [], signal()).catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({ code: 'worktree/dirty', details: { path: one, files: ['fresh.txt'] } })
    expect(await registered(fixture)).toContain(one)
  })

  it('removes a confirmed dirty worktree and its registration', async () => {
    fixture = await repository()
    const one = await worktreeAt(fixture, 'brave-otter')
    await writeFile(join(one, 'fresh.txt'), 'draft\n')
    live = await harness(fixture, [fixture])

    expect(await live.ctx.worktreeConsole.removeWorktree(fixture, one, true, [], signal())).toEqual({ removed: one })
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
    const row = rows.find(candidate => candidate.path === one)
    expect(row?.dirtyFiles).toEqual([])
    expect(row?.ignoredFiles).toEqual(['.env'])

    const failure = await live.ctx.worktreeConsole.removeWorktree(fixture, one, false, [], signal()).catch((error: unknown) => error)
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
      expect(rows.find(candidate => candidate.path === outside)?.outsideRepository).toBe(true)

      const outcome = await live.ctx.worktreeConsole.removeWorktree(fixture, outside, true, [], signal())
      expect(outcome).toEqual({ removed: outside })
      expect(await registered(fixture)).not.toContain(outside)

      // The page is the caller, so nothing here is fenced: the sandbox seam is
      // never consulted at all, which is what an unconfined policy records as.
      expect(live.sandbox.policies).toEqual([])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  // A registration whose directory is gone is bookkeeping, not a directory: the
  // repair is pruning it, and no file can be lost because none is there. The
  // page reads this row as `stale` and offers the same Remove it offers the
  // living rows.
  it('clears the registration of a stale row without deleting anything', async () => {
    fixture = await repository()
    const one = await worktreeAt(fixture, 'brave-otter')
    await rm(one, { recursive: true, force: true })
    live = await harness(fixture, [fixture])

    expect(await live.ctx.worktreeConsole.removeWorktree(fixture, one, true, [], signal())).toEqual({ removed: one })
    expect(await registered(fixture)).not.toContain(one)
  })

  // The repository's own checkout is the one row a user cannot act on: Git
  // refuses it, and deleting the directory would delete the repository.
  it('refuses to remove the repository’s own checkout', async () => {
    fixture = await repository()
    live = await harness(fixture, [fixture])

    const failure = await live.ctx.worktreeConsole.removeWorktree(fixture, fixture, true, [], signal())
      .catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({ code: 'worktree/primary', details: { path: fixture } })
    expect(await registered(fixture)).toContain(fixture)
  })

  it('rejects a checkout the repository does not know', async () => {
    fixture = await repository()
    live = await harness(fixture, [fixture])

    const failure = await live.ctx.worktreeConsole.removeWorktree(fixture, join(fixture, 'nowhere'), true, [], signal())
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
