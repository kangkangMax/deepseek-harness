/** Source-safe lifecycle for the worktree console Remote and its browser UI. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-experimental-worktree-console/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { createConsoleFace } from './console.ts'
import { WorktreeConsoleSection } from './Console.tsx'
import { en, NS, zh } from './locales.ts'

export const inject = ['remote', 'slots', 'locale']

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  const face = createConsoleFace(ctx)
  // The section draws its own heading and decides from the subject whether it
  // belongs on the page it was handed.
  ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
    name: 'plugins.detail.section', locale: NS, inject: () => face,
  }, WorktreeConsoleSection))
}

/**
 * Mount this experimental namespace without adding it to stable API Remotes.
 * @param ctx - Client runtime owning the Remote, dictionaries and slots.
 * @param contribution - generated worktree Remote definitions.
 * @returns disposer joining UI and Remote withdrawal.
 */
export async function mountWorktreeConsole(
  ctx: Context,
  contribution: TypertRemoteContribution,
): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.worktrees', 'slots', 'locale'], registerUi)
  try {
    await ui
  } catch (error: unknown) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => { await ui.dispose(); await disposeRemote() }
}
