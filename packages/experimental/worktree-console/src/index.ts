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
import { isAbsolute, relative } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import type {} from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'
import { worktreeRuntime } from './enter.ts'
import { createGitPort, type GitPort } from './git.ts'
import { classifyOrigin } from './sources.ts'
import type {
  BranchChoices, ConsoleSnapshot, EnteredWorktree, PruneOutcome, RemoveOutcome, RepositoryRows,
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
    /** The registration names the repository's own checkout, which Git refuses to remove. */
    'worktree/primary': { readonly path: string }
    /** Git refused the removal. */
    'worktree/remove-failed': { readonly path: string; readonly reason: string }
    /**
     * Git dropped the registration but did not finish deleting the checkout.
     * The directory may remain on disk while the repository has no record.
     */
    'worktree/remove-partial': { readonly path: string; readonly reason: string }
    /** The caller has not confirmed every currently associated Session. */
    'worktree/sessions-unconfirmed': { readonly path: string }
    /** The caller cannot archive every associated Session. */
    'worktree/session-access-denied': { readonly path: string }
    /** Archiving failed before the checkout was removed. */
    'worktree/session-archive-failed': { readonly path: string; readonly reason: string }
    /** Removal failed after some Sessions were durably archived; those archives remain. */
    'worktree/removal-incomplete': { readonly path: string; readonly archivedSessionIds: readonly string[]; readonly reason: string }
    /** No live Session carries that id. */
    'worktree/unknown-session': { readonly sessionId: string }
    /** A turn has already started, so this Session cannot be armed. */
    'worktree/session-started': { readonly sessionId: string }
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

/**
 * Name the Session one call speaks for.
 *
 * Declared as a `@Remote` resource reader so the Gateway resolves the call's
 * resource before it dispatches: every Remote method is under access control,
 * and a method that names no resource is judged against `global` alone, which
 * refuses a non-owner even when a Session-scoped binding is what granted it.
 *
 * The brand is a compile-time type, so this asserts it over the wire string
 * rather than calling `SessionId()`: that helper lives in the Session service's
 * entry, and importing it for a no-op would pull the whole service into this
 * bundle.
 * @param sessionId - Session identity the wire carried.
 * @returns the same identity, typed for the `session` resource kind.
 */
function sessionResource(sessionId: string): SessionId {
  return sessionId as SessionId
}

/**
 * Name the registered workspace one call speaks for.
 *
 * A repository row is a workspace record, so the `workspace` kind is the
 * resource a prune or a removal touches; the path and the `force` flag are
 * arguments, not identities, and are never part of the resource.
 * @param repositoryId - workspace registry identity the wire carried.
 * @returns the same identity, typed for the `workspace` resource kind.
 */
function workspaceResource(repositoryId: string): WorkspaceId {
  return repositoryId as WorkspaceId
}

/** Lists and repairs Git worktrees across the registered workspaces. */
export class WorktreeConsole extends TypertRemoteService {
  static inject = ['typert', 'subprocess', 'sandbox', 'fs', 'workspaceRegistry', 'remoteAccess']

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
    const request = this.armed.get(sessionId)
    return {
      armed: request !== undefined,
      ...(request === undefined ? {} : { request }),
      worktree: this.entered.get(sessionId) ?? null,
      failure: this.failures.get(sessionId) ?? null,
    }
  }

  /**
   * Read the Session a wire id names.
   * @param sessionId - id from the wire.
   * @returns the Session, or undefined when the deployment carries no Session
   * service — the id is then taken on trust, which is what keeps this plugin
   * loadable in a composition that does not include one.
   * @throws when a Session service is present and does not hold the id.
   */
  private sessionOf(sessionId: string): Session | undefined {
    const sessions = this.ctx.get('sessions') as { get(id: string): Session | undefined } | undefined
    if (sessions === undefined) return undefined
    const session = sessions.get(sessionId)
    if (session === undefined) {
      throw new RemoteError('worktree/unknown-session', `no Session "${sessionId}"`, { sessionId })
    }
    return session
  }

  /**
   * Read the branches a blank Session's worktree could start from: the
   * repository's local branches and its remote-tracking refs, with the local
   * branch its own checkout has out marked.
   *
   * The Session's own directory decides the repository, because that is where
   * the armed step creates the checkout: offering another repository's branches
   * would let the user pin a revision the official runtime then fails to
   * resolve, and the step would be refused for a reason the page caused.
   * @param sessionId - Session the composer switch belongs to.
   * @param signal - cancellation.
   * @returns the repository root and its branches; a null root means the
   * Session's directory is outside every repository, so there is no base.
   */
  @Remote({ name: 'branches', resources: { session: sessionResource } })
  async branches(sessionId: string, signal: AbortSignal): Promise<BranchChoices> {
    signal.throwIfAborted()
    // Read rather than inject: this is a picker's read, and a composition
    // without the directory service gets an empty choice instead of a plugin
    // that refuses to activate.
    const working = this.ctx.get('workingDirectory') as Pick<WorkingDirectoryService, 'get' | 'defaultDirectory'> | undefined
    const query = this.ctx.get('sessionQuery')
    let directory: string
    if (query === undefined) {
      const session = this.sessionOf(sessionId)
      if (session === undefined || working === undefined) return { repositoryRoot: null, branches: [] }
      directory = working.get(session)
    } else {
      try {
        using observation = await query.observeSession(SessionId(sessionId), { signal })
        if (working === undefined) return { repositoryRoot: null, branches: [] }
        if (observation.projections === undefined) {
          throw new RemoteError('worktree/unavailable', 'Session projections are unavailable', { reason: 'no-session-projections' })
        }
        directory = observation.projections.values.workingDirectory ?? observation.header.cwd ?? working.defaultDirectory
      } catch (error: unknown) {
        if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
          throw new RemoteError('worktree/unknown-session', `no Session "${sessionId}"`, { sessionId })
        }
        throw error
      }
    }
    const repositoryRoot = await this.git.topLevel(directory, signal)
    if (repositoryRoot === null) return { repositoryRoot: null, branches: [] }
    return { repositoryRoot, branches: await this.git.branches(repositoryRoot, signal) }
  }

  /**
   * Arm one Session so its next step materializes a worktree first.
   * @param sessionId - Session the composer switch belongs to.
   * @param request - optional branch name and start revision.
   * @param signal - cancellation.
   * @returns this Session's intent and outcome.
   */
  @Remote({ name: 'arm', resources: { session: sessionResource } })
  // oxlint-disable-next-line typescript/require-await -- the wire shape is a Promise and this handler settles without awaiting anything.
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
    const session = this.sessionOf(sessionId)
    const projections = this.ctx.get('sessionProjections')
    if (session === undefined || projections === undefined) {
      throw new RemoteError('worktree/unavailable', 'Session state is unavailable', { reason: 'no-session-state' })
    }
    const boundary = projections.stateOf(session, 'turnBoundary')
    if (boundary === undefined) {
      throw new RemoteError('worktree/unavailable', 'Session turn state is unavailable', { reason: 'no-turn-state' })
    }
    if (boundary.openTurnStartSeq !== null || boundary.lastTurn !== 0) {
      throw new RemoteError('worktree/session-started', 'Start a new Session to create a worktree', { sessionId })
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
  @Remote({ name: 'disarm', resources: { session: sessionResource } })
  // oxlint-disable-next-line typescript/require-await -- the wire shape is a Promise and this handler settles without awaiting anything.
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
  @Remote({ name: 'state', resources: { session: sessionResource } })
  // oxlint-disable-next-line typescript/require-await -- the wire shape is a Promise and this handler settles without awaiting anything.
  async state(sessionId: string, signal: AbortSignal): Promise<WorktreeSessionState> {
    signal.throwIfAborted()
    return this.stateOf(sessionId)
  }

  /**
   * Unconfined, because every command behind it is a management-page action a
   * person asked for. The fence exists to keep an *agent* inside the workspace
   * it was given; here the caller is the user, the arguments are built in this
   * package, and the paths come from Git's own `worktree list` rather than from
   * the page. A checkout may legitimately sit in a pool outside the repository
   * — a task space, an agent's own `.agents/worktree/…` — and fencing that only
   * made the page refuse work the user explicitly confirmed.
   *
   * What an agent may do to a worktree is a different path entirely: it goes
   * through the official runtime's own policy when the armed step creates one.
   * @param repositoryRoot - canonical repository root; kept for the policy shape.
   * @returns the unconfined execution policy this service runs its commands under.
   */
  private policyFor(repositoryRoot: string): SandboxExecutionPolicy {
    return { mode: 'danger-full-access', workspaceRoot: repositoryRoot }
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

  private async sessionDirectories(signal: AbortSignal): Promise<ReadonlyMap<SessionId, string>> {
    const query = this.ctx.get('sessionQuery')
    if (query === undefined) {
      throw new RemoteError('worktree/unavailable', 'Session history is required to find associated Sessions', { reason: 'no-session-query' })
    }
    const directories = new Map<SessionId, string>()
    const archived = new Set(this.ctx.workspaceRegistry.archivedSessionIds)
    for (const { header } of await query.listSessions(signal)) {
      if (archived.has(header.id)) continue
      using observation = await query.observeSession(header.id, { signal })
      if (observation.projections === undefined) {
        throw new RemoteError('worktree/unavailable', 'Session projections are required to find associated Sessions', { reason: 'no-session-projections' })
      }
      const directory = observation.projections.values.workingDirectory ?? observation.header.cwd
        ?? this.ctx.get('workingDirectory')?.defaultDirectory
      if (directory === undefined) {
        throw new RemoteError('worktree/unavailable', 'Session working directory is unavailable', { reason: 'no-working-directory' })
      }
      directories.set(header.id, directory)
    }
    return directories
  }

  private associatedSessions(path: string, directories: ReadonlyMap<SessionId, string>): SessionId[] {
    return [...directories].filter(([, directory]) => {
      const tail = relative(path, directory)
      return tail === '' || (tail !== '..' && !tail.startsWith('../') && !tail.startsWith('..\\') && !isAbsolute(tail))
    }).map(([id]) => id)
  }

  private async readWorktrees(
    repository: RepositoryRef, directories: ReadonlyMap<SessionId, string>, signal: AbortSignal,
  ): Promise<readonly WorktreeRow[]> {
    const rows: WorktreeRow[] = []
    const entries = await this.git.list(repository.path, signal)
    for (const entry of entries) {
      signal.throwIfAborted()
      if (entry.bare) continue
      // The repository's own checkout is a row like any other. Leaving it out
      // made the page a list of *extra* checkouts, which reads as "you have no
      // worktrees here" beside a directory the user is working in; including
      // it is what makes the page an inventory. Removal is refused below, so
      // the extra row costs the user nothing.
      const primary = entry === entries[0]
      const present = await this.exists(entry.path, signal)
      const risk = present
        ? await this.git.status(repository.path, entry.path, signal)
        : { changed: [], ignored: [] }
      rows.push({
        sessionIds: this.associatedSessions(entry.path, directories)
          .filter(id => this.ctx.remoteAccess.allows({ kind: 'session', id })),
        path: entry.path,
        branch: shortBranch(entry.branch),
        head: entry.head,
        primary,
        stale: !present,
        dirtyFiles: risk.changed,
        ignoredFiles: risk.ignored,
        outsideRepository: !primary && !entry.path.startsWith(`${repository.path}/`),
        locked: entry.locked,
        origin: classifyOrigin(entry.path, repository.path),
      })
    }
    return rows
  }

  /**
   * Read every worktree of every registered repository this caller may see.
   * @param signal - cancellation of the registry read and the per-repository probes.
   * @returns one row set per visible repository, in registry order.
   */
  @Remote
  async list(signal: AbortSignal): Promise<ConsoleSnapshot> {
    signal.throwIfAborted()
    const repositories: RepositoryRows[] = []
    const directories = await this.sessionDirectories(signal)
    for (const repository of await listRepositories(this.ctx, this.git, signal)) {
      // A read that spans resources names none, so the Gateway decided it on
      // `global`; each row is then filtered on its own repository. A caller
      // bound to one workspace keeps that one and loses the rest, and the
      // Host still refuses a direct `prune` or removal outside its bindings.
      if (!this.ctx.remoteAccess.allows({ kind: 'workspace', id: workspaceResource(repository.id) })) continue
      repositories.push({ ...repository, worktrees: await this.readWorktrees(repository, directories, signal) })
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
  @Remote({ name: 'prune', resources: { workspace: workspaceResource } })
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
   * Archive associated inactive Sessions, then remove the checkout and registration.
   * Archives remain if a later operation fails; `worktree/removal-incomplete`
   * identifies them. Session records and chat history are retained.
   *
   * The wire name is `removeWorktree` rather than `remove`: every mounted
   * namespace installs its methods on a service whose own surface already owns
   * `remove`, so `$mount` refuses the shorter name outright. See the reserved
   * surface asserted in `tests/worktree-console.host.spec.ts`.
   * @param repositoryId - registered repository owning the checkout.
   * @param path - absolute checkout path.
   * @param force - discard uncommitted changes instead of refusing.
   * @param confirmedSessionIds - associated Sessions the user explicitly agreed to archive.
   * @param signal - cancellation.
   * @returns the removed checkout path.
   */
  @Remote({ name: 'removeWorktree', resources: { workspace: workspaceResource } })
  async removeWorktree(
    repositoryId: string, path: string, force: boolean, confirmedSessionIds: readonly string[], signal: AbortSignal,
  ): Promise<RemoveOutcome> {
    signal.throwIfAborted()
    const repository = await this.requireRepository(repositoryId, signal)
    const entries = await this.git.list(repository.path, signal)
    const entry = entries.find(candidate => candidate.path === path)
    if (entry === undefined) {
      throw new RemoteError('worktree/not-found', `no worktree at "${path}"`, { repositoryId, path })
    }
    // The repository's own checkout is the last row a user may act on: Git
    // refuses to remove it, and there is no directory to delete either, so the
    // page reports the refusal instead of offering an action that cannot run.
    if (entry === entries[0]) {
      throw new RemoteError('worktree/primary', `"${path}" is the repository's own checkout`, { path })
    }
    const present = await this.exists(path, signal)
    if (present) {
      const risk = await this.git.status(repository.path, path, signal)
      const atRisk = [...risk.changed, ...risk.ignored]
      if (atRisk.length > 0 && !force) {
        throw new RemoteError('worktree/dirty', `"${path}" has changes or ignored files`, { path, files: atRisk })
      }
    }
    const sessionIds = this.associatedSessions(path, await this.sessionDirectories(signal))
    for (const id of sessionIds) {
      if (!this.ctx.remoteAccess.allows({ kind: 'session', id })) {
        throw new RemoteError('worktree/session-access-denied', 'Access to an associated Session is required', { path })
      }
      if (!confirmedSessionIds.includes(id)) {
        throw new RemoteError('worktree/sessions-unconfirmed', 'Refresh and confirm the associated Sessions before removing this worktree', { path })
      }
    }
    const archivedSessionIds: SessionId[] = []
    try {
      for (const id of sessionIds) {
        signal.throwIfAborted()
        try {
          await this.ctx.workspaceRegistry.archiveSession(id)
        } catch (error: unknown) {
          throw new RemoteError('worktree/session-archive-failed', 'Stop active Session work and retry the removal', {
            path, reason: error instanceof Error ? error.message : String(error),
          }, { cause: error })
        }
        archivedSessionIds.push(id)
      }
      return await this.removeCheckout(repository, path, present, force, signal)
    } catch (error: unknown) {
      if (archivedSessionIds.length === 0) throw error
      throw new RemoteError('worktree/removal-incomplete', 'Some Sessions were archived. Refresh worktrees before retrying; archived chats remain recoverable.', {
        path, archivedSessionIds, reason: error instanceof Error ? error.message : String(error),
      }, { cause: error })
    }
  }

  private async removeCheckout(
    repository: RepositoryRef, path: string, present: boolean, force: boolean, signal: AbortSignal,
  ): Promise<RemoveOutcome> {
    if (!present) {
      // A registration without a checkout is a bookkeeping row, not a
      // directory: the repair is pruning, and it deletes no files because none
      // are there. `git worktree prune` visits every stale registration in one
      // pass, so this also clears rows the page showed as stale beside it.
      await this.git.prune(repository.path, signal)
      if ((await this.git.list(repository.path, signal)).some(candidate => candidate.path === path)) {
        throw new RemoteError('worktree/remove-failed', `Git kept the registration for "${path}"`, { path, reason: 'prune-kept-registration' })
      }
      this.forget(path)
      return { removed: path }
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
    this.forget(path)
    return { removed: path }
  }

  /** Drop every Session's claim on a checkout that is gone. */
  private forget(path: string): void {
    for (const [sessionId, entered] of this.entered) {
      if (entered.path === path) this.entered.delete(sessionId)
    }
  }
}

export default WorktreeConsole
