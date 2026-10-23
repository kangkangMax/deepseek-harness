/** Source-safe lifecycle for the worktree console Remote and its browser UI. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-experimental-worktree-console/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { createConsoleFace, createSwitchFace } from './face.ts'
import { WorktreeConsolePage } from './Console.tsx'
import { WorktreeContext } from './ContextStrip.tsx'
import { WorktreeSwitch } from './Switch.tsx'
import { WorktreeNoticeOverlay, type NoticeInjected, type WorktreeNotice } from './Notice.tsx'
import { en, NS, zh } from './locales.ts'

export const inject = ['remote', 'slots', 'locale']

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  const t = ctx.locale.bind(NS)
  // The management page owns one Settings navigation row, which puts it where
  // a user opens this panel to configure things — a section at the bottom of a
  // bundle's own Plugins page was reachable but not findable.
  const notice = createSnapshotStore<WorktreeNotice | null>(null)
  let sequence = 0
  const console = createConsoleFace(ctx, (text, failed = false) => {
    notice.set({ text, failed, sequence: ++sequence })
  })
  const feedback: NoticeInjected = { hooks: { notice }, dismissNotice: () => { notice.set(null) } }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'worktree-console.notice', inject: () => feedback,
  }, WorktreeNoticeOverlay))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'worktree-console',
    order: 20,
    label: () => t('settingsNav'),
    locale: NS,
    inject: () => console,
  }, WorktreeConsolePage))
  // `conversation.input.left` is the composer tool row's own list seat, drawn
  // beside the plan and permission controls. Using it keeps this feature out of
  // the conversation package entirely: no new slot, no edited skeleton.
  const face = createSwitchFace(ctx)
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'worktree', order: 100, locale: NS, inject: () => face,
  }, WorktreeSwitch))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'worktree-context', order: -9, locale: NS,
    inject: () => ({ state: face.state, branches: face.branches, reveal: console.reveal, notify: console.notify }),
  }, WorktreeContext))
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
