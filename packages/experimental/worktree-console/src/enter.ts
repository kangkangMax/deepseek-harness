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
import type { WorktreeService } from '@deepseek-ai/dsh-experimental-worktree'

/**
 * Read the official runtime when the deployment loaded it.
 * @param ctx - Host context.
 * @returns the runtime, or undefined when the worktree plugin is absent.
 */
export function worktreeRuntime(ctx: Context): WorktreeService | undefined {
  return ctx.get('worktrees') as WorktreeService | undefined
}
