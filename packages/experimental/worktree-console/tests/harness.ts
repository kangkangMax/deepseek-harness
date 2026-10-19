/**
 * Shared fixtures: a real repository on the real local providers, plus a
 * recording stand-in for the sandbox seam.
 *
 * The sandbox is recorded rather than enforced so the suite needs no platform
 * backend, while still asserting the exact policy the port asked for — the
 * decision under test is which root the fence uses, not that seatbelt works.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { WorktreeService } from '@deepseek-ai/dsh-experimental-worktree'
import WorktreeConsole from '../src/index.ts'

const execute = promisify(execFile)

/** Run Git directly, clearing the selectors a fixture must not inherit. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.quotePath=false', ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '',
      GIT_CONFIG_PARAMETERS: '',
      GIT_CONFIG_COUNT: '0',
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_INDEX_FILE: undefined,
    },
  })
  return result.stdout.trim()
}

/**
 * A repository carrying one commit on `main`.
 * @param parent - directory to create the fixture under.
 * @returns the fixture's canonical path.
 */
export async function repository(parent: string = tmpdir()): Promise<string> {
  const path = await realpath(await mkdtemp(join(parent, 'dsh-worktree-console-')))
  try {
    await git(path, 'init', '-b', 'main')
    await git(path, 'config', 'core.autocrlf', 'false')
    await git(path, 'config', 'user.name', 'Worktree console fixture')
    await git(path, 'config', 'user.email', 'worktree-console@example.invalid')
    await git(path, 'config', 'commit.gpgSign', 'false')
    await writeFile(join(path, 'tracked.txt'), 'initial\n')
    // Committed up front so a worktree already has an ignore rule: a case that
    // needs an ignored file must not have to add one and dirty the tree first.
    await writeFile(join(path, '.gitignore'), '.env\n')
    await git(path, 'add', 'tracked.txt', '.gitignore')
    await git(path, 'commit', '-m', 'initial')
    return path
  } catch (error: unknown) {
    await rm(path, { recursive: true, force: true })
    throw error
  }
}

/** One policy the port asked the sandbox for. */
export interface RecordedPolicy {
  readonly mode: string
  readonly workspaceRoot: string
}

/** The sandbox seam, recorded rather than enforced. */
export interface RecordingSandbox {
  /** Every policy passed to `confine`, in call order. */
  readonly policies: RecordedPolicy[]
  confine: (argv: readonly string[], policy: RecordedPolicy) => Promise<{ argv: string[] }>
}

/** One resource the console asked access control about. */
export interface CheckedResource {
  /** Resource kind the call named. */
  readonly kind: string
  /** Identity of the resource. */
  readonly id: string
}

/** The access seam, recorded rather than decided. */
export interface RecordingAccess {
  /** Every resource the console filtered on, in call order. */
  readonly checked: CheckedResource[]
  /**
   * Whether one resource is visible to the caller. The owner path answers true
   * for every resource, so a spec that exercises filtering replaces this.
   */
  allows: (resource: CheckedResource) => boolean
}

/** A context, its recording sandbox, and the fixture directory to clean up. */
export interface Harness {
  readonly ctx: Context
  readonly sandbox: RecordingSandbox
  readonly access: RecordingAccess
  readonly root: string
}

/**
 * What the Session-facing stand-ins answer.
 *
 * Both are list- or read-shaped seams over services this suite does not own: the
 * console only asks which Session an id names and which directory that Session
 * works in.
 */
export interface SessionFixture {
  /**
   * Ids the Session store holds. Omitted means every id resolves, which is what
   * the arm path relied on before a Session service was read at all.
   */
  readonly known?: readonly string[]
  /** Directory the directory service reports; defaults to the fixture root. */
  readonly directory?: string
}

/**
 * Build a context over the real local filesystem and subprocess providers.
 * @param root - fixture directory; also the fallback filesystem working directory.
 * @param repositories - workspace paths the registry reports, in order.
 * @param worktrees - the official worktree runtime to stand in for, when the
 * test needs entering a worktree to be possible at all.
 * @param sessions - which ids and which directory the Session stand-ins answer.
 * @returns the context and its recording sandbox.
 */
export async function harness(
  root: string,
  repositories: readonly string[] = [],
  worktrees?: Pick<WorktreeService, 'create'>,
  sessions: SessionFixture = {},
): Promise<Harness> {
  const ctx = new Context()
  const sandbox: RecordingSandbox = {
    policies: [],
    confine(argv, policy) {
      sandbox.policies.push(policy)
      return Promise.resolve({ argv: [...argv] })
    },
  }
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(LocalSubprocessRuntime)
  ctx.provide('sandbox', sandbox as never)
  ctx.provide('typert', {} as never)
  // Access control is the Gateway's per-call decision; this suite exercises the
  // owner path, where every check answers true, plus the list filter it feeds.
  // The record lives in the provider, not in `allows`: a spec replaces the
  // decision without also silencing the record.
  const access: RecordingAccess = {
    checked: [],
    allows: () => true,
  }
  ctx.provide('remoteAccess', {
    allows: (resource: CheckedResource) => {
      access.checked.push(resource)
      return access.allows(resource)
    },
  } as never)
  // The registry is a real service with durable storage; this suite only reads
  // `list()`, so a list-shaped stand-in is the honest seam.
  ctx.provide('workspaceRegistry', {
    list: () => repositories.map(path => ({
      id: path, path, title: basename(path), createdAt: '', updatedAt: '', sessionIds: [],
    })),
  } as never)
  ctx.provide('sessions', {
    get: (id: string) => sessions.known === undefined || sessions.known.includes(id) ? { id } : undefined,
  } as never)
  // The directory read is the one call the branch picker makes, so the seam is
  // the answer it returns rather than the projection machinery behind it.
  ctx.provide('workingDirectory', {
    get: () => sessions.directory ?? root,
  } as never)
  // Left absent when the test needs the "official plugin not loaded" path.
  if (worktrees !== undefined) ctx.provide('worktrees', worktrees as never)
  await ctx.plugin(WorktreeConsole, { gitCommand: 'git' })
  return { ctx, sandbox, access, root }
}
