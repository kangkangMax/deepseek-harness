import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
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
      { path: one, branch: 'brave-otter', head: expect.stringMatching(/^[0-9a-f]{40}$/) as unknown as string,
        present: true, stale: false, dirtyFiles: [], origin: 'official' },
    ])
  })

  it('reports a repository with no worktrees as an empty list, not a missing one', async () => {
    fixture = await repository()
    live = await harness(fixture, [fixture])

    expect((await live.ctx.worktreeConsole.list(signal())).repositories[0]?.worktrees).toEqual([])
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

    const failure = await live.ctx.worktreeConsole.remove(fixture, one, false, signal()).catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({ code: 'worktree/dirty', details: { path: one, files: ['fresh.txt'] } })
    expect(await registered(fixture)).toContain(one)
  })

  it('removes a confirmed dirty worktree and its registration', async () => {
    fixture = await repository()
    const one = await worktreeAt(fixture, 'brave-otter')
    await writeFile(join(one, 'fresh.txt'), 'draft\n')
    live = await harness(fixture, [fixture])

    expect(await live.ctx.worktreeConsole.remove(fixture, one, true, signal())).toEqual({ removed: one })
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

  it('refuses a stale registration, because pruning is the repair', async () => {
    fixture = await repository()
    const one = await worktreeAt(fixture, 'brave-otter')
    await rm(one, { recursive: true, force: true })
    live = await harness(fixture, [fixture])

    const failure = await live.ctx.worktreeConsole.remove(fixture, one, true, signal()).catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({ code: 'worktree/stale', details: { path: one } })
  })

  it('rejects a checkout the repository does not know', async () => {
    fixture = await repository()
    live = await harness(fixture, [fixture])

    const failure = await live.ctx.worktreeConsole.remove(fixture, join(fixture, 'nowhere'), true, signal())
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
