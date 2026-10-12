/**
 * Entering a worktree: create the checkout, and make it the Session's current
 * working directory.
 *
 * The official runtime already publishes the new working directory as the last
 * step of a successful creation (`ctx.workingDirectory.set`). This service adds
 * no second write on top: a directory published by anything other than Git's
 * own success path would be a checkout the page claims but Git never made.
 *
 * Read back through {@link worktreeRuntime} rather than injected, so the
 * management page keeps working on a deployment that never loads the official
 * worktree plugin.
 * @module @deepseek-ai/dsh-experimental-worktree-console/src/enter
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CreateWorktreeRequest, CreatedWorktree } from '@deepseek-ai/dsh-experimental-worktree'

/** The official runtime, structurally — the shape this service consumes. */
export interface WorktreeRuntime {
  /**
   * @param agent - Session whose working directory changes on success.
   * @param request - new name and start revision.
   * @param signal - cancellation of lookup, creation, and publication.
   * @returns the created checkout and the Session's new working directory.
   */
  create(agent: Agent, request: CreateWorktreeRequest, signal?: AbortSignal): Promise<CreatedWorktree>
}

/**
 * Read the official runtime when the deployment loaded it.
 * @param ctx - Host context.
 * @returns the runtime, or undefined when the worktree plugin is absent.
 */
export function worktreeRuntime(ctx: Context): WorktreeRuntime | undefined {
  return ctx.get('worktrees') as WorktreeRuntime | undefined
}

/**
 * Materialize a worktree and move the Session into it.
 * @param runtime - the official runtime.
 * @param agent - Session whose current directory changes.
 * @param request - new name and start revision.
 * @param signal - cancellation of creation and publication.
 * @returns the created checkout.
 */
export async function enterWorktree(
  runtime: WorktreeRuntime,
  agent: Agent,
  request: CreateWorktreeRequest,
  signal: AbortSignal,
): Promise<CreatedWorktree> {
  return await runtime.create(agent, request, signal)
}
