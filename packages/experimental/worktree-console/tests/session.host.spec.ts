import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { EnteredWorktree } from '../src/types.ts'
import { harness, type Harness } from './harness.ts'

const ROOT = '/repos/dsh'
const SESSION = 'session-1'

let live: Harness | undefined

afterEach(async () => {
  await live?.ctx.fiber.dispose()
  live = undefined
})

/** The listener reads `agent.session.id` and hands the agent to the runtime, so a carrier stands in for the loop. */
function agent(): Agent {
  return { id: SESSION, session: { id: SESSION } } as Agent
}

function entered(): EnteredWorktree {
  return {
    path: `${ROOT}/.agents/worktrees/brave-otter`,
    branch: 'brave-otter',
    baseCommit: 'a'.repeat(40),
    repositoryRoot: ROOT,
  }
}

function signal(): AbortSignal {
  return new AbortController().signal
}

/** Dispatch the step admission a send produces. */
async function firePreStep(context: Harness, subject: Agent): Promise<{ kind: string }> {
  return await agentEvents(context.ctx, subject).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 1, signal: signal() },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
}

describe('entering a worktree on send', () => {
  it('refuses to arm a Session whose first turn has already started', async () => {
    const create = vi.fn(async () => entered())
    live = await harness(tmpdir(), [], { create }, { started: true })
    const failure = await live.ctx.worktreeConsole.arm(SESSION, {}, signal()).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'worktree/session-started' })
    expect((await live.ctx.worktreeConsole.state(SESSION, signal())).armed).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })

  it('reads back the accepted intent, including its base revision', async () => {
    live = await harness(tmpdir(), [], { create: async () => entered() })
    await live.ctx.worktreeConsole.arm(SESSION, { from: 'refs/heads/main' }, signal())
    expect(await live.ctx.worktreeConsole.state(SESSION, signal())).toMatchObject({
      armed: true, request: { from: 'refs/heads/main' },
    })
  })
  it('refuses to arm when the official worktree plugin is not loaded', async () => {
    live = await harness(tmpdir())

    const failure = await live.ctx.worktreeConsole.arm(SESSION, {}, signal()).catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({ code: 'worktree/unavailable' })
  })

  it('leaves an unarmed step untouched', async () => {
    const create = vi.fn(async () => entered())
    live = await harness(tmpdir(), [], { create })

    expect(await firePreStep(live, agent())).toMatchObject({ kind: 'enter' })
    expect(create).not.toHaveBeenCalled()
  })

  it('materializes before the armed step and reports the checkout', async () => {
    const create = vi.fn(async () => entered())
    live = await harness(tmpdir(), [], { create })
    const subject = agent()
    await live.ctx.worktreeConsole.arm(SESSION, { name: 'brave-otter' }, signal())

    expect(await firePreStep(live, subject)).toMatchObject({ kind: 'enter' })

    expect(create).toHaveBeenCalledWith(subject, { name: 'brave-otter' }, expect.anything())
    expect(await live.ctx.worktreeConsole.state(SESSION, signal())).toEqual({
      armed: false, worktree: entered(), failure: null,
    })
  })

  // Fail closed: running the step anyway would edit the checkout the user
  // meant to leave, which is worse than not running it.
  it('refuses the step when materialization fails, and keeps the reason', async () => {
    const create = vi.fn(async () => { throw new Error('worktree branch already exists: brave-otter') })
    live = await harness(tmpdir(), [], { create })
    await live.ctx.worktreeConsole.arm(SESSION, {}, signal())

    expect(await firePreStep(live, agent())).toEqual({ kind: 'reject' })

    const state = await live.ctx.worktreeConsole.state(SESSION, signal())
    expect(state).toMatchObject({ armed: false, worktree: null })
    expect(state.failure).toContain('already exists')
  })

  it('does not retry a refused step into a second materialization', async () => {
    const create = vi.fn(async () => { throw new Error('unavailable') })
    live = await harness(tmpdir(), [], { create })
    await live.ctx.worktreeConsole.arm(SESSION, {}, signal())

    await firePreStep(live, agent())
    await firePreStep(live, agent())

    expect(create).toHaveBeenCalledTimes(1)
  })

  it('drops the intent when the switch is released', async () => {
    const create = vi.fn(async () => entered())
    live = await harness(tmpdir(), [], { create })
    await live.ctx.worktreeConsole.arm(SESSION, {}, signal())

    expect((await live.ctx.worktreeConsole.disarm(SESSION, signal())).armed).toBe(false)
    await firePreStep(live, agent())

    expect(create).not.toHaveBeenCalled()
  })

  // The base the picker offers is only real if it reaches the runtime: the
  // switch stores the choice, and this is the call that spends it.
  it('carries the chosen base branch into the runtime', async () => {
    const create = vi.fn(async () => entered())
    live = await harness(tmpdir(), [], { create })
    const subject = agent()
    await live.ctx.worktreeConsole.arm(SESSION, { from: 'feature/one' }, signal())

    await firePreStep(live, subject)

    expect(create).toHaveBeenCalledWith(subject, { from: 'feature/one' }, expect.anything())
  })
})
