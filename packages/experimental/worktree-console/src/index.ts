/**
 * Host controller behind the worktree management page: it lists every Git
 * worktree of the registered workspaces, and offers the two repairs a stale or
 * unwanted checkout needs.
 *
 * The service owns no registry of its own. The truth is `git worktree list`
 * per repository, read on demand, so worktrees created by any plugin or by hand
 * stay visible without that plugin cooperating.
 * @module @deepseek-ai/dsh-experimental-worktree-console
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { enterWorktree, worktreeRuntime } from './enter.ts'
import { createGitPort, type GitConfig, type GitPort } from './git.ts'
import { classifyOrigin } from './sources.ts'
import type {
  ConsoleSnapshot, EnteredWorktree, PruneOutcome, RemoveOutcome, RepositoryRows,
  WorktreeArmRequest, WorktreeRow, WorktreeSessionState,
} from './types.ts'
import { listRepositories, type RepositoryRef } from './workspaces.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Worktree management controller. */
    worktreeConsole: WorktreeConsole
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No registered workspace is a repository with that id. */
    'worktree/repository-not-found': { readonly repositoryId: string }
    /** The repository has no registration for that checkout path. */
    'worktree/not-found': { readonly repositoryId: string; readonly path: string }
    /** The checkout has uncommitted changes and the caller did not confirm losing them. */
    'worktree/dirty': { readonly path: string; readonly files: readonly string[] }
    /** The registration has no checkout directory left; pruning is the repair. */
    'worktree/stale': { readonly path: string }
    /** Git refused the removal. */
    'worktree/remove-failed': { readonly path: string; readonly reason: string }
    /** The official worktree runtime is not loaded, so nothing can be entered. */
    'worktree/unavailable': { readonly reason: string }
  }
}

/** Resource limits and the Git executable. */
export interface Config {
  /** Deadline for one Git command, in milliseconds. */
  timeoutMs?: number
  /** Termination grace for one managed process, in milliseconds. */
  graceMs?: number
  /** Maximum captured bytes per output stream. */
  maxOutputBytes?: number
  /** Git executable: a bare PATH name or an absolute execution-world path. */
  gitCommand?: string
}

/** Strip the ref namespace so rows show the branch name a person typed. */
function shortBranch(branch: string | null): string | null {
  if (branch === null) return null
  const heads = 'refs/heads/'
  return branch.startsWith(heads) ? branch.slice(heads.length) : branch
}

/** Lists and repairs Git worktrees across the registered workspaces. */
export class WorktreeConsole extends TypertRemoteService {
  static inject = ['typert', 'subprocess', 'sandbox', 'fs', 'workspaceRegistry']

  static Config: z<Config> = z.object({
    timeoutMs: z.natural().min(1_000).default(30_000),
    graceMs: z.natural().default(2_000),
    maxOutputBytes: z.natural().min(1_024).default(4 * 1024 * 1024),
    gitCommand: z.string().default('git'),
  })

  private readonly git: GitPort
  /** Sessions whose next step materializes a worktree first. */
  private readonly armed = new Map<string, WorktreeArmRequest>()
  /** Worktrees this console materialized, by Session. */
  private readonly entered = new Map<string, EnteredWorktree>()
  /** Last materialization failure per Session; a refused step leaves no other trace. */
  private readonly failures = new Map<string, string>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'worktreeConsole', { namespace: 'worktrees' })
    this.git = createGitPort(ctx, this.limits(), repositoryRoot => this.policyFor(repositoryRoot))
    // "On send" from the Host side is the Session's next step: a send produces
    // one, and it lands before any tool runs in the directory being left.
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const sessionId: string = agent.session.id
      const pending = this.armed.get(sessionId)
      if (pending === undefined) return await next()
      // Spend the intent before attempting: a refused step must not be retried
      // into a second materialization.
      this.armed.delete(sessionId)
      this.failures.delete(sessionId)
      const runtime = worktreeRuntime(ctx)
      if (runtime === undefined) {
        this.failures.set(sessionId, 'the official worktree plugin is not loaded')
        return { kind: 'reject' as const }
      }
      try {
        const created = await enterWorktree(runtime, agent, pending, signal)
        this.entered.set(sessionId, {
          path: created.path,
          branch: created.branch,
          baseCommit: created.baseCommit,
          repositoryRoot: created.repositoryRoot,
        })
      } catch (error: unknown) {
        // Fail closed. Continuing would run the step in the directory the user
        // meant to leave, which is the one outcome worse than not running.
        this.failures.set(sessionId, error instanceof Error ? error.message : String(error))
        return { kind: 'reject' as const }
      }
      return await next()
    })
  }

  private stateOf(sessionId: string): WorktreeSessionState {
    return {
      armed: this.armed.has(sessionId),
      worktree: this.entered.get(sessionId) ?? null,
      failure: this.failures.get(sessionId) ?? null,
    }
  }

  /**
   * Arm one Session so its next step materializes a worktree first.
   * @param sessionId - Session the composer switch belongs to.
   * @param request - optional branch name and start revision.
   * @param signal - cancellation.
   * @returns this Session's intent and outcome.
   */
  @Remote
  async arm(sessionId: string, request: WorktreeArmRequest, signal: AbortSignal): Promise<WorktreeSessionState> {
    signal.throwIfAborted()
    if (worktreeRuntime(this.ctx) === undefined) {
      throw new RemoteError(
        'worktree/unavailable',
        'the official worktree plugin is not loaded',
        { reason: 'no-worktrees-service' },
      )
    }
    this.armed.set(sessionId, request)
    this.failures.delete(sessionId)
    return this.stateOf(sessionId)
  }

  /**
   * Drop an intent without materializing anything.
   * @param sessionId - Session the composer switch belongs to.
   * @param signal - cancellation.
   * @returns this Session's intent and outcome.
   */
  @Remote
  async disarm(sessionId: string, signal: AbortSignal): Promise<WorktreeSessionState> {
    signal.throwIfAborted()
    this.armed.delete(sessionId)
    return this.stateOf(sessionId)
  }

  /**
   * Read one Session's worktree intent and outcome.
   * @param sessionId - Session the composer switch belongs to.
   * @param signal - cancellation.
   * @returns the armed flag, the checkout once one exists, and any failure.
   */
  @Remote
  async state(sessionId: string, signal: AbortSignal): Promise<WorktreeSessionState> {
    signal.throwIfAborted()
    return this.stateOf(sessionId)
  }

  private limits(): GitConfig {
    return {
      timeoutMs: this.config.timeoutMs ?? 30_000,
      graceMs: this.config.graceMs ?? 2_000,
      maxOutputBytes: this.config.maxOutputBytes ?? 4 * 1024 * 1024,
      gitCommand: this.config.gitCommand ?? 'git',
    }
  }

  /**
   * The fence root is the repository being operated on. Every path these
   * commands write — `.git/worktrees/<name>`, and the checkout itself, which the
   * official plugin places under `<root>/.agents/worktrees` — sits inside it.
   *
   * The session plane is deliberately not consulted: this page owns no session,
   * and the fail-safe deployment default (`read-only`) would make prune and
   * remove impossible while adding no protection the root itself does not give.
   */
  private policyFor(repositoryRoot: string): SandboxExecutionPolicy {
    return { mode: 'workspace-write', workspaceRoot: repositoryRoot }
  }

  private async exists(path: string, signal: AbortSignal): Promise<boolean> {
    return await this.ctx.fs.lstat(path, undefined, signal) !== undefined
  }

  private async requireRepository(repositoryId: string, signal: AbortSignal): Promise<RepositoryRef> {
    const repositories = await listRepositories(this.ctx, this.git, signal)
    const found = repositories.find(candidate => candidate.id === repositoryId)
    if (found === undefined) {
      throw new RemoteError('worktree/repository-not-found', `no registered repository "${repositoryId}"`, { repositoryId })
    }
    return found
  }

  private async readWorktrees(repository: RepositoryRef, signal: AbortSignal): Promise<readonly WorktreeRow[]> {
    const rows: WorktreeRow[] = []
    for (const entry of await this.git.list(repository.path, signal)) {
      signal.throwIfAborted()
      // The repository's own checkout is the repository: Git refuses to remove
      // it and `prune` never touches it, so it is not a row.
      if (entry.bare || entry.path === repository.path) continue
      const present = await this.exists(entry.path, signal)
      rows.push({
        path: entry.path,
        branch: shortBranch(entry.branch),
        head: entry.head,
        present,
        stale: !present,
        dirtyFiles: present ? await this.git.status(repository.path, entry.path, signal) : [],
        origin: classifyOrigin(entry.path, repository.path),
      })
    }
    return rows
  }

  /**
   * Read every worktree of every registered repository.
   * @param signal - cancellation of the registry read and the per-repository probes.
   * @returns one row set per repository, in registry order.
   */
  @Remote
  async list(signal: AbortSignal): Promise<ConsoleSnapshot> {
    signal.throwIfAborted()
    const repositories: RepositoryRows[] = []
    for (const repository of await listRepositories(this.ctx, this.git, signal)) {
      repositories.push({ ...repository, worktrees: await this.readWorktrees(repository, signal) })
    }
    return { repositories }
  }

  /**
   * Clear registrations whose checkout directory is gone. Idempotent: with
   * nothing stale the command is a no-op and reports an empty list.
   * @param repositoryId - registered repository to prune.
   * @param signal - cancellation.
   * @returns the checkout paths whose registrations disappeared.
   */
  @Remote
  async prune(repositoryId: string, signal: AbortSignal): Promise<PruneOutcome> {
    signal.throwIfAborted()
    const repository = await this.requireRepository(repositoryId, signal)
    const before = new Set((await this.git.list(repository.path, signal)).map(entry => entry.path))
    await this.git.prune(repository.path, signal)
    const after = new Set((await this.git.list(repository.path, signal)).map(entry => entry.path))
    // Report the difference rather than predicting it: what Git actually
    // cleared is the only claim the page can safely make.
    return { pruned: [...before].filter(path => !after.has(path)) }
  }

  /**
   * Remove one worktree and its registration.
   * @param repositoryId - registered repository owning the checkout.
   * @param path - absolute checkout path.
   * @param force - discard uncommitted changes instead of refusing.
   * @param signal - cancellation.
   * @returns the removed checkout path.
   */
  @Remote
  async remove(repositoryId: string, path: string, force: boolean, signal: AbortSignal): Promise<RemoveOutcome> {
    signal.throwIfAborted()
    const repository = await this.requireRepository(repositoryId, signal)
    const entry = (await this.git.list(repository.path, signal)).find(candidate => candidate.path === path)
    if (entry === undefined) {
      throw new RemoteError('worktree/not-found', `no worktree at "${path}"`, { repositoryId, path })
    }
    if (!await this.exists(path, signal)) {
      throw new RemoteError('worktree/stale', `the checkout at "${path}" no longer exists`, { path })
    }
    // Re-read the working tree here rather than trusting the page's snapshot:
    // the confirmation the user saw may be older than the current changes.
    const dirtyFiles = await this.git.status(repository.path, path, signal)
    if (dirtyFiles.length > 0 && !force) {
      throw new RemoteError('worktree/dirty', `"${path}" has uncommitted changes`, { path, files: dirtyFiles })
    }
    try {
      await this.git.remove(repository.path, path, force, signal)
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('worktree/remove-failed', reason, { path, reason }, { cause: error })
    }
    return { removed: path }
  }
}

export default WorktreeConsole
