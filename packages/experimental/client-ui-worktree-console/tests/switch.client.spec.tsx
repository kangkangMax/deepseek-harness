// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BranchChoices, WorktreeSessionState } from '@deepseek-ai/dsh-experimental-worktree-console/types'
import { en } from '../src/client/locales.ts'
import { WorktreeSwitch, type WorktreeSwitchProps } from '../src/client/Switch.tsx'

afterEach(cleanup)

/** Interpolate the real English dictionary, so the spec asserts shipped copy. */
function literalT(): WorktreeSwitchProps['t'] {
  return (key: string, params?: Record<string, unknown>) => {
    const template = (en as Record<string, string>)[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
      const value = params[name]
      return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
    })
  }
}

function idle(over: Partial<WorktreeSessionState> = {}): WorktreeSessionState {
  return { armed: false, worktree: null, failure: null, ...over }
}

function renderSwitch(
  options: {
    blank?: boolean
    running?: boolean
    state?: WorktreeSessionState
    /** Answers for reads after the first, which is what a re-read asks for. */
    then?: WorktreeSessionState
    after?: WorktreeSessionState
    rejects?: unknown
    armRejects?: unknown
    choices?: BranchChoices
  } = {},
) {
  const arm = vi.fn(async (_sessionId: string, request: { from?: string }) => {
    if (options.armRejects !== undefined) throw options.armRejects
    return options.after ?? idle({ armed: true, request })
  })
  const disarm = vi.fn(async () => idle())
  let reads = 0
  const state = vi.fn(async () => {
    if (options.rejects !== undefined) throw options.rejects
    reads += 1
    if (reads > 1 && options.then !== undefined) return options.then
    return options.state ?? idle()
  })
  const branches = vi.fn(async () => options.choices ?? {
    repositoryRoot: '/repos/dsh',
    branches: [
      { name: 'main', kind: 'local' as const, current: true },
      { name: 'feature/one', kind: 'local' as const, current: false },
    ],
  })
  const props = (over: { blank?: boolean; running?: boolean } = {}) => ({
    sessionId: 'session-1',
    useSession: (selector: (snapshot: { blank: boolean; running: boolean }) => unknown) => selector({
      blank: over.blank ?? options.blank ?? true,
      running: over.running ?? options.running ?? false,
    }),
    t: literalT(),
    arm,
    disarm,
    state,
    branches,
  } as WorktreeSwitchProps)
  const view = render(<WorktreeSwitch {...props()} />)
  return {
    arm,
    disarm,
    state,
    branches,
    container: view.container,
    rerenderWith: (over: { blank?: boolean; running?: boolean }) => {
      view.rerender(<WorktreeSwitch {...props(over)} />)
    },
  }
}

describe('composer worktree switch', () => {
  it('renders nothing for a session that is neither empty nor in a worktree', async () => {
    const { state } = renderSwitch({ blank: false })

    await waitFor(() => { expect(state).toHaveBeenCalled() })
    expect(screen.queryByText(en.switchLabel)).toBeNull()
  })

  it('offers the switch to an empty session and arms it', async () => {
    const { arm } = renderSwitch()

    fireEvent.click(await screen.findByRole('checkbox'))

    await waitFor(() => { expect(arm).toHaveBeenCalledWith('session-1', {}, expect.anything()) })
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- getByRole answers an HTMLElement.
    await waitFor(() => { expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true) })
  })

  it('releases an armed session', async () => {
    const { disarm } = renderSwitch({ state: idle({ armed: true }), after: idle() })

    fireEvent.click(await screen.findByRole('checkbox'))

    await waitFor(() => { expect(disarm).toHaveBeenCalledWith('session-1', expect.anything()) })
  })

  // A Session already in a worktree says nothing here: the context strip below
  // the composer names the branch, and a second badge in the tool row claimed
  // the same fact twice.
  it('stays silent once the session is in a worktree', async () => {
    const { state } = renderSwitch({
      blank: false,
      state: idle({
        worktree: { path: '/r/.agents/worktrees/x', branch: 'brave-otter', baseCommit: 'a', repositoryRoot: '/r' },
      }),
    })

    await waitFor(() => { expect(state).toHaveBeenCalled() })
    expect(screen.queryByText(en.switchLabel)).toBeNull()
    expect(screen.queryByText(/brave-otter/)).toBeNull()
  })

  it('surfaces the reason the host refused to prepare a worktree', async () => {
    renderSwitch({ state: idle({ failure: 'worktree branch already exists: brave-otter' }) })

    expect(await screen.findByText(/already exists/)).toBeTruthy()
  })

  // The Host spends the arm before attempting the step, and the refusal ends
  // the turn before the model is called, so nothing else reports it. The reason
  // arrives with the Session's next reading — and by then the Session is no
  // longer blank, which is exactly when this row used to render nothing at all.
  it('reports a refusal that lands after the session stopped being empty', async () => {
    const { state, rerenderWith } = renderSwitch({
      blank: true,
      state: idle({ armed: true }),
      then: idle({
        armed: false,
        failure: 'worktree command failed (71): sandbox-exec: sandbox_apply: Operation not permitted',
      }),
    })
    await waitFor(() => { expect(state).toHaveBeenCalledTimes(1) })

    rerenderWith({ blank: false, running: true })
    rerenderWith({ blank: false, running: false })

    expect(await screen.findByText(/sandbox_apply: Operation not permitted/)).toBeTruthy()
    // The arm is spent, so a toggle would arm nothing.
    expect(screen.queryByRole('checkbox')).toBeNull()
    // The row ellipsizes; the element still carries the whole reason.
    const [reported] = screen.getAllByRole('status')
    if (reported === undefined) throw new Error('missing worktree refusal')
    expect(reported.getAttribute('title')).toContain('sandbox_apply: Operation not permitted')
  })

  // Every run ends the same way; only the first ending after a refusal carries
  // news, so the row does not re-read on each idle tick.
  it('does not re-read a session that never ran', async () => {
    const { state } = renderSwitch({ running: false })
    await waitFor(() => { expect(state).toHaveBeenCalled() })
    await waitFor(() => { expect(state).toHaveBeenCalledTimes(1) })
  })

  // Arming is an intent the user sets and sees set, so the control is a real
  // checkbox: a checked box says "on" at a glance, where a button that only
  // tinted its border read as a label that happened to be clickable.
  it('renders the intent as a labeled checkbox', async () => {
    renderSwitch()

    const box = await screen.findByRole('checkbox')
    expect(box.getAttribute('type')).toBe('checkbox')
    expect((box as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText(en.switchLabel)).toBeTruthy()
  })

  // The empty state means "not read yet", not "nothing to say": returning null
  // for it swallowed every failed read, so an unreachable Host looked exactly
  // like a plugin that never loaded.
  it('reports a failed read instead of rendering nothing', async () => {
    const failure = Object.assign(new Error('worktrees/state is unknown'), { code: 'unknown-endpoint' })
    renderSwitch({ rejects: failure })

    expect(await screen.findByText(/unknown-endpoint/)).toBeTruthy()
  })
})

describe('composer worktree base branch', () => {
  it('keeps the accepted base visible when changing it fails', async () => {
    renderSwitch({
      state: idle({ armed: true, request: { from: 'refs/heads/main' } }),
      armRejects: { code: 'offline' },
    })
    fireEvent.click(await screen.findByTitle(en.switchBaseHint))
    fireEvent.click(await screen.findByText('feature/one'))
    expect(await screen.findByText(/offline/)).toBeTruthy()
    expect(screen.getByTitle(en.switchBaseHint).textContent).toContain('main')
    expect(screen.getByTitle(en.switchBaseHint).textContent).not.toContain('feature/one')
  })

  it('restores the accepted base from the Host when the control mounts', async () => {
    renderSwitch({ state: idle({ armed: true, request: { from: 'refs/heads/feature/one' } }) })
    expect((await screen.findByTitle(en.switchBaseHint)).textContent).toContain('feature/one')
  })
  // An unchecked box has nothing to qualify yet, and reading the branch list
  // for it would spend a Git call on every mount of every conversation.
  it('keeps the picker away, and unread, until the intent is set', async () => {
    const { branches } = renderSwitch()

    await screen.findByRole('checkbox')

    expect(screen.queryByTitle(en.switchBaseHint)).toBeNull()
    expect(branches).not.toHaveBeenCalled()
  })

  it('defaults the base to HEAD and lists the local branches', async () => {
    renderSwitch({ state: idle({ armed: true }) })

    // The trigger states the effective base, so the default is readable without
    // opening the list — and it is read through the trigger because the open
    // list renders the same words on its own HEAD row.
    const trigger = await screen.findByTitle(en.switchBaseHint)
    expect(trigger.textContent).toContain(en.switchBaseHead)

    fireEvent.click(trigger)

    expect(await screen.findByText(en.switchBaseLocal)).toBeTruthy()
    expect(await screen.findByText(en.switchBaseCurrent.replace('{branch}', 'main'))).toBeTruthy()
    expect(screen.getByText('feature/one')).toBeTruthy()
  })

  // A local branch and its remote-tracking namesake are different revisions, so
  // the picker groups them and arms with the ref the user actually sees — the
  // full `origin/main`, which is what the runtime resolves.
  it('groups remote-tracking refs under their own heading and arms with the full ref', async () => {
    const { arm } = renderSwitch({
      state: idle({ armed: true }),
      choices: {
        repositoryRoot: '/repos/dsh',
        branches: [
          { name: 'main', kind: 'local', current: true },
          { name: 'origin/main', kind: 'remote', current: false },
        ],
      },
    })

    fireEvent.click(await screen.findByTitle(en.switchBaseHint))

    expect(await screen.findByText(en.switchBaseLocal)).toBeTruthy()
    expect(screen.getByText(en.switchBaseRemote)).toBeTruthy()
    fireEvent.click(screen.getByText('origin/main'))

    await waitFor(() => {
      expect(arm).toHaveBeenCalledWith('session-1', { from: 'refs/remotes/origin/main' }, expect.anything())
    })
    // The trigger names the ref that will be resolved, not a shortened label.
    expect(await screen.findByText('origin/main')).toBeTruthy()
  })

  it('re-arms with the branch the user picks, and names it on the trigger', async () => {
    const { arm } = renderSwitch({ state: idle({ armed: true }) })

    fireEvent.click(await screen.findByTitle(en.switchBaseHint))
    fireEvent.click(await screen.findByText('feature/one'))

    await waitFor(() => {
      expect(arm).toHaveBeenCalledWith('session-1', { from: 'refs/heads/feature/one' }, expect.anything())
    })
    expect(await screen.findByText('feature/one')).toBeTruthy()
  })

  // A directory outside every repository has no base to offer, and an empty
  // list would read as a repository with no branches.
  it('says why there is nothing to pick when the session is not in a repository', async () => {
    renderSwitch({
      state: idle({ armed: true }),
      choices: { repositoryRoot: null, branches: [] },
    })

    fireEvent.click(await screen.findByTitle(en.switchBaseHint))

    expect(await screen.findByText(en.switchBaseNone)).toBeTruthy()
  })
})
