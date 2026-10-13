/** Source-safe lifecycle for the worktree console Remote and its browser UI. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-experimental-worktree-console/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { createConsoleFace, createSwitchFace } from './face.ts'
import { WorktreeConsoleSection } from './Console.tsx'
import { WorktreeSwitch } from './Switch.tsx'
import { en, NS, zh } from './locales.ts'

export const inject = ['remote', 'slots', 'locale']

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  // The section draws its own heading and decides from the subject whether it
  // belongs on the page it was handed.
  const section = createConsoleFace(ctx)
  ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
    name: 'plugins.detail.section', id: 'worktree-console', locale: NS, inject: () => section,
  }, WorktreeConsoleSection))
  // `conversation.input.left` is the composer tool row's own list seat, drawn
  // beside the plan and permission controls. Using it keeps this feature out of
  // the conversation package entirely: no new slot, no edited skeleton.
  const face = createSwitchFace(ctx)
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'worktree', order: 100, locale: NS, inject: () => face,
  }, WorktreeSwitch))
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
  // `remote.worktrees` is declared HERE, not in the entry's `inject`: Cordis
  // refuses to hand a plugin a property it never asked for ("Cannot get
  // property \"remote.worktrees\" without inject"), and the property only
  // exists because the line above mounted it — an entry-level declaration
  // would wait for the namespace the entry itself has yet to create. Read
  // back through this scope, which mounts first and then asks for it, and
  // both halves stay honest: the namespace is requested rather than
  // assumed, and a failed mount still surfaces as a failed call.
  const ui = ctx.inject(['remote', 'remote.worktrees', 'slots', 'locale'], registerUi)
  try {
    await ui
  } catch (error: unknown) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => { await ui.dispose(); await disposeRemote() }
}
