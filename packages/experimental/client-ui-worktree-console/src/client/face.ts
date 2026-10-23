/**
 * The Remote-facing faces the two components render from — the management
 * section's and the composer switch's.
 *
 * Kept apart from the components so a component can be tested against a
 * literal face: browser specs must not import the generated Remote artifact,
 * which only exists after a build.
 * @module @deepseek-ai/dsh-experimental-client-ui-worktree-console/src/client/face
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {
  BranchChoices, ConsoleSnapshot, PruneOutcome, RemoveOutcome, WorktreeArmRequest, WorktreeSessionState,
} from '@deepseek-ai/dsh-experimental-worktree-console/types'

/** What the section asks the Host to do. */
export interface ConsoleInjected {
  /** Report a localized operation result through the shell overlay. */
  readonly notify: (text: string, failed?: boolean) => void
  /** Read every registered repository and its worktrees. */
  readonly list: (signal: AbortSignal) => Promise<ConsoleSnapshot>
  /** Clear stale registrations of one repository. */
  readonly prune: (repositoryId: string, signal: AbortSignal) => Promise<PruneOutcome>
  /**
   * Archive the confirmed Sessions and remove one worktree, discarding changes when `force`.
   *
   * `removeWorktree` rather than `remove`: a mounted namespace installs its
   * methods on a service that already owns `remove`, and `$mount` refuses the
   * shorter name before the entry ever activates.
   */
  readonly removeWorktree: (
    repositoryId: string,
    path: string,
    force: boolean,
    confirmedSessionIds: readonly string[],
    signal: AbortSignal,
  ) => Promise<RemoveOutcome>
  /**
   * Open one checkout directory in the Host desktop's file manager.
   *
   * Optional, and absent unless the Session Remote is mounted: the reveal is
   * that namespace's own capability, so a browser deployment without a desktop
   * Host answers `undefined` here and the page then offers only the copy.
   * @param path - absolute checkout directory.
   * @returns whether the Host handed the path to a file manager.
   */
  readonly reveal?: ((path: string) => Promise<boolean>) | undefined
}

/** The slice of the Session Remote a reveal goes through. */
interface RevealRemote {
  readonly openWorkspacePath?: (
    request: { readonly path: string },
  ) => Promise<{ readonly ok: boolean }>
}

/**
 * Build the reveal action over the Session Remote, when this deployment has one.
 *
 * Read through `ctx.get` rather than injected: the reveal belongs to another
 * plugin, and requiring it would turn "no desktop here" into "this page never
 * activates".
 * @param ctx - client runtime.
 * @returns the reveal action, or undefined when no Session Remote is mounted.
 */
function createReveal(ctx: Context): ((path: string) => Promise<boolean>) | undefined {
  const remote = ctx.get('remote.session') as RevealRemote | undefined
  if (remote?.openWorkspacePath === undefined) return undefined
  const reveal = remote.openWorkspacePath
  return async (path) => {
    try {
      return (await reveal.call(remote, { path })).ok
    } catch (error: unknown) {
      // A rejection and a refusal are the same outcome to the page: the
      // directory was not shown, and it says so rather than failing silently.
      console.warn('[worktree-console] reveal failed', error)
      return false
    }
  }
}

/**
 * Build the face over the mounted Remote.
 * @param ctx - client runtime owning `ctx.remote.worktrees`.
 * @param notify - localized operation feedback hosted outside Settings.
 * @returns face whose methods reject with the Host's `RemoteError`.
 */
export function createConsoleFace(ctx: Context, notify: ConsoleInjected['notify']): ConsoleInjected {
  return {
    notify,
    async list(signal) {
      const result = await ctx.remote.worktrees.list(signal)
      if (!result.ok) throw result.error
      return result.value
    },
    async prune(repositoryId, signal) {
      const result = await ctx.remote.worktrees.prune(repositoryId, signal)
      if (!result.ok) throw result.error
      return result.value
    },
    async removeWorktree(repositoryId, path, force, confirmedSessionIds, signal) {
      const result = await ctx.remote.worktrees.removeWorktree(repositoryId, path, force, confirmedSessionIds, signal)
      if (!result.ok) throw result.error
      return result.value
    },
    reveal: createReveal(ctx),
  }
}

/**
 * Render one failure as copy. A Remote failure carries a `code`; the code is
 * read rather than tested with `instanceof`, which does not survive the wire.
 * @param error - the rejection value.
 * @param fallback - copy to show when the value carries no code.
 * @returns a line the section can display.
 */
export function describeFailure(error: unknown, fallback: string): string {
  if (error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    // The code names the fault; the wire message names which value caused it.
    const message = 'message' in error && typeof error.message === 'string' && error.message.length > 0
      ? `: ${error.message}`
      : ''
    return `${fallback} (${error.code})${message}`
  }
  return fallback
}

/** What the composer switch asks the Host to do. */
export interface SwitchInjected {
  /** Arm one Session so its next step materializes a worktree first. */
  readonly arm: (
    sessionId: string,
    request: WorktreeArmRequest,
    signal: AbortSignal,
  ) => Promise<WorktreeSessionState>
  /** Drop the intent without materializing anything. */
  readonly disarm: (sessionId: string, signal: AbortSignal) => Promise<WorktreeSessionState>
  /** Read the intent and outcome for one Session. */
  readonly state: (sessionId: string, signal: AbortSignal) => Promise<WorktreeSessionState>
  /** Read the base branches a blank Session's worktree could start from. */
  readonly branches: (sessionId: string, signal: AbortSignal) => Promise<BranchChoices>
}

/** Session directory read and actions used by the header branch control. */
export type ContextInjected =
  & Pick<SwitchInjected, 'state' | 'branches'>
  & Pick<ConsoleInjected, 'reveal' | 'notify'>

/**
 * Build the switch's face over the mounted Remote.
 * @param ctx - client runtime owning `ctx.remote.worktrees`.
 * @returns face whose methods reject with the Host's `RemoteError`.
 */
export function createSwitchFace(ctx: Context): SwitchInjected {
  return {
    async arm(sessionId, request, signal) {
      const result = await ctx.remote.worktrees.arm(sessionId, request, signal)
      if (!result.ok) throw result.error
      return result.value
    },
    async disarm(sessionId, signal) {
      const result = await ctx.remote.worktrees.disarm(sessionId, signal)
      if (!result.ok) throw result.error
      return result.value
    },
    async state(sessionId, signal) {
      const result = await ctx.remote.worktrees.state(sessionId, signal)
      if (!result.ok) throw result.error
      return result.value
    },
    async branches(sessionId, signal) {
      const result = await ctx.remote.worktrees.branches(sessionId, signal)
      if (!result.ok) throw result.error
      return result.value
    },
  }
}
