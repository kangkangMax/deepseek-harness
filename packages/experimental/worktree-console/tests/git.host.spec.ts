import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGitPort, parseBranchList, parseStatusPorcelain, parseWorktreeList, type GitConfig } from '../src/git.ts'
import { git, harness, repository, type Harness } from './harness.ts'

const config: GitConfig = { timeoutMs: 30_000, graceMs: 2_000, maxOutputBytes: 4 * 1024 * 1024, gitCommand: 'git' }

let fixture: string | undefined
let live: Harness | undefined

afterEach(async () => {
  await live?.ctx.fiber.dispose()
  live = undefined
  if (fixture !== undefined) await rm(fixture, { recursive: true, force: true })
  fixture = undefined
})

describe('porcelain grammars', () => {
  it('separates registrations and reads every qualifier', () => {
    const entries = parseWorktreeList([
      'worktree /repos/dsh',
      'HEAD aaa111',
      'branch refs/heads/main',
      '',
      'worktree /repos/dsh/.agents/worktrees/one',
      'HEAD bbb222',
      'branch refs/heads/feature/one',
      '',
      'worktree /repos/dsh/.agents/worktrees/gone',
      'HEAD ccc333',
      'branch refs/heads/lost',
      'prunable gitdir file points to non-existent location',
      '',
      'worktree /repos/dsh/.agents/worktrees/detached',
      'HEAD ddd444',
      'detached',
      'locked',
      '',
    ].join('\0'))

    expect(entries).toEqual([
      { path: '/repos/dsh', head: 'aaa111', branch: 'refs/heads/main', bare: false, locked: false, prunable: false },
      { path: '/repos/dsh/.agents/worktrees/one', head: 'bbb222', branch: 'refs/heads/feature/one', bare: false, locked: false, prunable: false },
      { path: '/repos/dsh/.agents/worktrees/gone', head: 'ccc333', branch: 'refs/heads/lost', bare: false, locked: false, prunable: true },
      { path: '/repos/dsh/.agents/worktrees/detached', head: 'ddd444', branch: null, bare: false, locked: true, prunable: false },
    ])
  })

  it('preserves newlines and quotation marks in a worktree directory', () => {
    const path = '/repos/a\n"quoted"'
    expect(parseWorktreeList(`worktree ${path}\0HEAD abc\0detached\0\0`)[0]?.path).toBe(path)
  })

  it('reads local branches and remote-tracking refs, and skips a remote’s HEAD pointer', () => {
    expect(parseBranchList([
      'refs/heads/feature/one\0 \0',
      'refs/heads/main\0*\0',
      'refs/remotes/origin/HEAD\0 \0refs/remotes/origin/main',
      'refs/remotes/origin/main\0 \0',
      'refs/remotes/origin/release/1.0\0 \0',
      '',
    ].join('\n'))).toEqual([
      { name: 'feature/one', kind: 'local', current: false },
      { name: 'main', kind: 'local', current: true },
      // `origin/main` keeps its remote prefix: the runtime resolves the ref, and
      // a bare `main` would name the local branch instead.
      { name: 'origin/main', kind: 'remote', current: false },
      { name: 'origin/release/1.0', kind: 'remote', current: false },
    ])
  })

  // A repository with no commit yet has no branch to offer, and the picker has
  // to read that as "nothing to list" rather than as a malformed record.
  it('reads nothing from output with no records', () => {
    expect(parseBranchList('')).toEqual([])
  })

  it('separates changed paths from ignored ones and reads a rename destination', () => {
    expect(parseStatusPorcelain([
      ' M tracked.txt',
      '?? fresh.txt',
      '!! .env',
      'R  new.txt\0old.txt\0',
      ' R renamed.txt\0source.txt\0',
      '',
    ].join('\0'))).toEqual({
      // The NUL-separated rename record carries its source as the next token,
      // which the parser consumes rather than reporting.
      changed: ['tracked.txt', 'fresh.txt', 'new.txt', 'renamed.txt'],
      ignored: ['.env'],
    })
  })
})

describe('Git port over the real providers', () => {
  it('lists the repository and its worktree, reports changes, and fences on the repository', async () => {
    fixture = await repository()
    const worktree = join(fixture, '.agents', 'worktrees', 'one')
    await git(fixture, 'worktree', 'add', '-b', 'feature/one', worktree)
    live = await harness(fixture)
    const port = createGitPort(live.ctx, config, root => ({ mode: 'workspace-write', workspaceRoot: root }))
    const signal = new AbortController().signal

    const entries = await port.list(fixture, signal)
    expect(entries.map(entry => entry.path)).toEqual([fixture, worktree])
    expect(entries[1]?.branch).toBe('refs/heads/feature/one')
    expect(entries[1]?.head).toMatch(/^[0-9a-f]{40}$/)

    expect(await port.status(fixture, worktree, signal)).toEqual({ changed: [], ignored: [] })
    await writeFile(join(worktree, 'fresh.txt'), 'draft\n')
    expect((await port.status(fixture, worktree, signal)).changed).toEqual(['fresh.txt'])

    // Every command that writes Git metadata is fenced on the repository the
    // caller named — including `status` run inside a checkout, whose index
    // write lands in the parent repository rather than in the checkout.
    expect(live.sandbox.policies.length).toBeGreaterThan(0)
    expect(new Set(live.sandbox.policies.map(policy => policy.workspaceRoot))).toEqual(new Set([fixture]))
    for (const policy of live.sandbox.policies) expect(policy.mode).toBe('workspace-write')
  })

  it('marks a registration whose checkout directory was deleted by hand', async () => {
    fixture = await repository()
    const worktree = join(fixture, '.agents', 'worktrees', 'one')
    await git(fixture, 'worktree', 'add', '-b', 'feature/one', worktree)
    live = await harness(fixture)
    const port = createGitPort(live.ctx, config, root => ({ mode: 'workspace-write', workspaceRoot: root }))

    await rm(worktree, { recursive: true, force: true })
    const entries = await port.list(fixture, new AbortController().signal)

    expect(entries).toHaveLength(2)
    expect(entries[1]?.prunable).toBe(true)
  })

  it('lists the local branches and marks the one the repository has out', async () => {
    fixture = await repository()
    await git(fixture, 'branch', 'feature/one')
    live = await harness(fixture)
    const port = createGitPort(live.ctx, config, root => ({ mode: 'workspace-write', workspaceRoot: root }))

    expect(await port.branches(fixture, new AbortController().signal)).toEqual([
      { name: 'feature/one', kind: 'local', current: false },
      { name: 'main', kind: 'local', current: true },
    ])
  })

  // A branch checked out in a worktree is still a base a new branch may start
  // from, so the list must not drop it just because another checkout holds it.
  it('keeps a branch that a worktree has checked out', async () => {
    fixture = await repository()
    await git(fixture, 'worktree', 'add', '-b', 'feature/one', join(fixture, '.agents', 'worktrees', 'one'))
    live = await harness(fixture)
    const port = createGitPort(live.ctx, config, root => ({ mode: 'workspace-write', workspaceRoot: root }))

    expect((await port.branches(fixture, new AbortController().signal)).map(option => option.name))
      .toEqual(['feature/one', 'main'])
  })
})
