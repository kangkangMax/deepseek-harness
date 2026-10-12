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
import type {} from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-workspace'
import { worktreeRuntime } from './enter.ts'
import { createGitPort, type GitPort } from './git.ts'
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
    /** The checkout is registered from a pool outside the repository, so this fence cannot cover its removal. */
    'worktree/outside-repository': { readonly path: string; readonly repositoryRoot: string }
    /** Git refused the removal. */
    'worktree/remove-failed': { readonly path: string; readonly reason: string }
    /**
     * Git dropped the registration but did not finish deleting the checkout.
     * The directory may remain on disk while the repository has no record.
     */
    'worktree/remove-partial': { readonly path: string; readonly reason: string }
    /** No live Session carries that id. */
    'worktree/unknown-session': { readonly sessionId: string }
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

  constructor(ctx: Context, config: Required<Config>) {
    super(ctx, 'worktreeConsole', { namespace: 'worktrees' })
    this.git = createGitPort(ctx, config, repositoryRoot => this.policyFor(repositoryRoot))
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
        const created = await runtime.create(agent, pending, signal)
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
    // The client offers the switch only for an empty Session, but the Host does
    // not take that on trust from the wire: a stale tab or a replay must not be
    // able to move a Session that is already under way.
    const sessions = this.ctx.get('sessions') as { get(id: string): unknown } | undefined
    if (sessions !== undefined && sessions.get(sessionId) === undefined) {
      throw new RemoteError('worktree/unknown-session', `no Session "${sessionId}"`, { sessionId })
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

  /**
   * The fence root is the repository being operated on: the shared
   * `.git/worktrees/<name>` state and the official `.agents/worktrees` pool both
   * sit inside it, so `workspace-write` covers every command this service
   * issues for that repository.
   *
   * A checkout registered from a pool *outside* the repository is therefore
   * visible here but not repairable here — `removeWorktree` refuses it by name
   * rather than letting Git fail inside the sandbox. Widening this to cover such
   * a checkout would need a policy that carries more than one root.
   *
   * The session plane is deliberately not consulted: this page owns no session,
   * and the fail-safe deployment default (`read-only`) would make prune and
   * `removeWorktree` impossible while adding no protection the root itself does
   * not give.
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
      // One uninspectable checkout degrades its own row instead of blanking the
      // whole page with a rejection.
      const risk = present
        ? await this.git.status(repository.path, entry.path, signal).catch(() => ({ changed: [], ignored: [] }))
        : { changed: [], ignored: [] }
      rows.push({
        path: entry.path,
        branch: shortBranch(entry.branch),
        head: entry.head,
        stale: !present,
        dirtyFiles: risk.changed,
        ignoredFiles: risk.ignored,
        outsideRepository: !entry.path.startsWith(`${repository.path}/`),
        locked: entry.locked,
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
   *
   * The wire name is `removeWorktree` rather than `remove`: every mounted
   * namespace installs its methods on a service whose own surface already owns
   * `remove`, so `$mount` refuses the shorter name outright. See the reserved
   * surface asserted in `tests/worktree-console.host.spec.ts`.
   * @param repositoryId - registered repository owning the checkout.
   * @param path - absolute checkout path.
   * @param force - discard uncommitted changes instead of refusing.
   * @param signal - cancellation.
   * @returns the removed checkout path.
   */
  @Remote
  async removeWorktree(repositoryId: string, path: string, force: boolean, signal: AbortSignal): Promise<RemoveOutcome> {
    signal.throwIfAborted()
    const repository = await this.requireRepository(repositoryId, signal)
    // The fence root is this repository, so a checkout registered from a pool
    // outside it cannot be removed here. Refuse by name instead of letting Git
    // fail inside the sandbox with a message about paths.
    if (!path.startsWith(`${repository.path}/`)) {
      throw new RemoteError(
        'worktree/outside-repository',
        `"${path}" is outside "${repository.path}"`,
        { path, repositoryRoot: repository.path },
      )
    }
    const entry = (await this.git.list(repository.path, signal)).find(candidate => candidate.path === path)
    if (entry === undefined) {
      throw new RemoteError('worktree/not-found', `no worktree at "${path}"`, { repositoryId, path })
    }
    if (!await this.exists(path, signal)) {
      throw new RemoteError('worktree/stale', `the checkout at "${path}" no longer exists`, { path })
    }
    // Re-read the working tree here rather than trusting the page's snapshot:
    // the confirmation the user saw may be older than what is now at risk.
    // Ignored files count — a removal deletes them too.
    const risk = await this.git.status(repository.path, path, signal)
    const atRisk = [...risk.changed, ...risk.ignored]
    if (atRisk.length > 0 && !force) {
      throw new RemoteError('worktree/dirty', `"${path}" has changes or ignored files`, { path, files: atRisk })
    }
    try {
      await this.git.remove(repository.path, path, force, signal)
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      // Git can drop the registration while failing to delete the checkout, so
      // report what the repository now holds rather than assuming nothing moved.
      const registered = (await this.git.list(repository.path, signal)).some(candidate => candidate.path === path)
      throw new RemoteError(
        registered ? 'worktree/remove-failed' : 'worktree/remove-partial',
        registered ? reason : `"${path}" is no longer registered, but its directory may remain. ${reason}`,
        { path, reason },
        { cause: error },
      )
    }
    // A Session must stop claiming a checkout that is gone.
    for (const [sessionId, entered] of this.entered) {
      if (entered.path === path) this.entered.delete(sessionId)
    }
    return { removed: path }
  }
}

export default WorktreeConsole
