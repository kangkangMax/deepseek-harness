// @vitest-environment jsdom
/**
 * The entry's activation, against the real Remote gateway.
 *
 * The boot audit reports an entry whose `apply` rejected as a bare `failed`
 * label and keeps no cause, so an activation fault is indistinguishable from a
 * hang in the product. This spec is what turns that label back into a stack:
 * it runs the real `apply` over the real `ClientRemoteService` and the real
 * generated contribution, so a contribution the gateway refuses fails here
 * with the gateway's own message.
 *
 * It needs the generated Remote artifact, which only exists after the
 * workspace build emits `packages/experimental/worktree-console/lib`.
 * @module @deepseek-ai/dsh-experimental-client-ui-worktree-console/tests/activation
 */
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { apply as applyRemoteService, inject as remoteInject } from '@deepseek-ai/dsh-api-gateway/client'
import { afterEach, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'
import { inject } from '../src/client/mount.ts'

/** One endpoint the fake Connection answered, in call order. */
const answered: string[] = []

afterEach(() => { answered.length = 0 })

/**
 * A context wired the way the browser wires one: real Typert registry, real
 * gateway Remote, real locale and slot runtimes, and a Connection that answers
 * every call with one canned success.
 * @returns a context whose `remote.worktrees` reaches the fake transport.
 */
async function runtime(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  ctx.provide('connection', {
    rpc: {
      call: async (_path: string, endpoint: string) => {
        answered.push(endpoint)
        return { ok: true, value: { removed: '/repos/dsh/.agents/worktrees/brave-otter' } }
      },
      open: () => { throw new Error('no streams in this fixture') },
    },
    registerGenerationSource: () => () => {},
    start: () => ({ stop: () => {} }),
  } as unknown as ConnectionHandle)
  await ctx.plugin({ inject: remoteInject, apply: applyRemoteService })
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  // Both seats are declared by the packages that own them; the entry injects
  // into them rather than declaring them itself.
  ctx.slots.register({ name: 'root', children: {
    'plugins.detail.section': { kind: 'list', scope: 'root' },
    'conversation.input.left': { kind: 'list', scope: 'session' },
  } } as never, () => null)
  return ctx
}

it('activates against the real Remote gateway', async () => {
  const ctx = await runtime()
  const fiber = ctx.plugin({ inject: [...inject], apply })

  // `await` on the fiber is the assertion: a rejected `apply` throws here with
  // the gateway's message instead of surfacing as a bare `failed` label.
  await fiber
  expect(ctx.get('remote.worktrees')).toBeDefined()

  await ctx.fiber.dispose()
})

it('serves the removal under the name the Host publishes', async () => {
  const ctx = await runtime()
  await ctx.plugin({ inject: [...inject], apply })

  // The wire name is `removeWorktree`, not `remove`: a namespace service owns a
  // `remove` of its own, and `$mount` refuses a method that lands on it.
  const outcome = await ctx.remote.worktrees.removeWorktree('repo', '/repos/dsh/.agents/worktrees/brave-otter', true, new AbortController().signal)

  expect(outcome).toEqual({ ok: true, value: { removed: '/repos/dsh/.agents/worktrees/brave-otter' } })
  expect(answered).toEqual(['worktrees/removeWorktree'])

  await ctx.fiber.dispose()
})
