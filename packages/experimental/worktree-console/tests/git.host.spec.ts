import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGitPort, parseStatusPorcelain, parseWorktreeList, type GitConfig } from '../src/git.ts'
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
    ].join('\n'))

    expect(entries).toEqual([
      { path: '/repos/dsh', head: 'aaa111', branch: 'refs/heads/main', bare: false, locked: false, prunable: false },
      { path: '/repos/dsh/.agents/worktrees/one', head: 'bbb222', branch: 'refs/heads/feature/one', bare: false, locked: false, prunable: false },
      { path: '/repos/dsh/.agents/worktrees/gone', head: 'ccc333', branch: 'refs/heads/lost', bare: false, locked: false, prunable: true },
      { path: '/repos/dsh/.agents/worktrees/detached', head: 'ddd444', branch: null, bare: false, locked: true, prunable: false },
    ])
  })

  it('reads changed paths and reports a rename destination', () => {
    expect(parseStatusPorcelain([
      ' M tracked.txt',
      '?? fresh.txt',
      'R  old.txt -> new.txt',
      '',
    ].join('\n'))).toEqual(['tracked.txt', 'fresh.txt', 'new.txt'])
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

    expect(await port.status(fixture, worktree, signal)).toEqual([])
    await writeFile(join(worktree, 'fresh.txt'), 'draft\n')
    expect(await port.status(fixture, worktree, signal)).toEqual(['fresh.txt'])

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
})
