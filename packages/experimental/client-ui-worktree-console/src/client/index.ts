/** Browser entry for the optional worktree management Remote contribution and its section. */
import type { Context } from '@deepseek-ai/cordis'
import worktreeConsoleRemote from '@deepseek-ai/dsh-experimental-worktree-console/remote'
import { mountWorktreeConsole } from './mount.ts'

export { inject } from './mount.ts'

/**
 * Activate the experimental worktree management contribution.
 * @param ctx - Client runtime.
 * @returns complete UI and Remote disposer.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountWorktreeConsole(ctx, worktreeConsoleRemote)
}
