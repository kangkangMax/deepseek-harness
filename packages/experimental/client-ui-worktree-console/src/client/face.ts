/**
 * The Remote-facing face the management section renders from.
 *
 * Kept apart from the component so the component can be tested against a
 * literal face: browser specs must not import the generated Remote artifact,
 * which only exists after a build.
 * @module @deepseek-ai/dsh-experimental-client-ui-worktree-console/src/client/console
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ConsoleSnapshot, PruneOutcome, RemoveOutcome, WorktreeArmRequest, WorktreeSessionState,
} from '@deepseek-ai/dsh-experimental-worktree-console/types'

/** What the section asks the Host to do. */
export interface ConsoleInjected {
  /** Read every registered repository and its worktrees. */
  readonly list: (signal: AbortSignal) => Promise<ConsoleSnapshot>
  /** Clear stale registrations of one repository. */
  readonly prune: (repositoryId: string, signal: AbortSignal) => Promise<PruneOutcome>
  /** Remove one worktree, discarding changes when `force`. */
  readonly remove: (
    repositoryId: string,
    path: string,
    force: boolean,
    signal: AbortSignal,
  ) => Promise<RemoveOutcome>
}

/**
 * Build the face over the mounted Remote.
 * @param ctx - client runtime owning `ctx.remote.worktrees`.
 * @returns face whose methods reject with the Host's `RemoteError`.
 */
export function createConsoleFace(ctx: Context): ConsoleInjected {
  return {
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
    async remove(repositoryId, path, force, signal) {
      const result = await ctx.remote.worktrees.remove(repositoryId, path, force, signal)
      if (!result.ok) throw result.error
      return result.value
    },
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
    return `${fallback} (${error.code})`
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
}

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
  }
}
