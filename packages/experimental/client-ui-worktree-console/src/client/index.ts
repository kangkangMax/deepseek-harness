/** Browser entry for the optional worktree management Remote contribution and its section. */
import type { Context } from '@deepseek-ai/cordis'
import worktreeConsoleRemote from '@deepseek-ai/dsh-experimental-worktree-console/remote'
import { mountWorktreeConsole } from './mount.ts'

export { inject } from './mount.ts'

/**
 * Activate the experimental worktree management contribution.
 *
 * The boot audit reports a plugin whose `apply` rejected as a bare `failed`
 * label and keeps no cause, which makes an activation fault indistinguishable
 * from a hang. Logging here is what turns that into a stack that names the
 * step that broke.
 * @param ctx - Client runtime.
 * @returns complete UI and Remote disposer.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  try {
    return await mountWorktreeConsole(ctx, worktreeConsoleRemote)
  } catch (error: unknown) {
    console.error('[worktree-console] client activation failed', error)
    throw error
  }
}
