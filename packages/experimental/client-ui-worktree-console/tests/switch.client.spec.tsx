// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BranchChoices, WorktreeSessionState } from '@deepseek-ai/dsh-experimental-worktree-console/types'
import { en } from '../src/client/locales.ts'
import { WorktreeSwitch, type WorktreeSwitchProps } from '../src/client/Switch.tsx'

afterEach(cleanup)

/** Interpolate the real English dictionary, so the spec asserts shipped copy. */
function literalT(): WorktreeSwitchProps['t'] {
  return ((key: string, params?: Record<string, unknown>) => {
    const template = (en as unknown as Record<string, string>)[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''))
  }) as WorktreeSwitchProps['t']
}

function idle(over: Partial<WorktreeSessionState> = {}): WorktreeSessionState {
  return { armed: false, worktree: null, failure: null, ...over }
}

function renderSwitch(
  options: {
    blank?: boolean
    state?: WorktreeSessionState
    after?: WorktreeSessionState
    rejects?: unknown
    choices?: BranchChoices
  } = {},
) {
  const arm = vi.fn(async () => options.after ?? idle({ armed: true }))
  const disarm = vi.fn(async () => idle())
  const state = vi.fn(async () => {
    if (options.rejects !== undefined) throw options.rejects
    return options.state ?? idle()
  })
  const branches = vi.fn(async () => options.choices ?? {
    repositoryRoot: '/repos/dsh',
    branches: [
      { name: 'main', kind: 'local' as const, current: true },
      { name: 'feature/one', kind: 'local' as const, current: false },
    ],
  })
  const props = {
    sessionId: 'session-1',
    useSession: (selector: (snapshot: { blank: boolean }) => unknown) => selector({ blank: options.blank ?? true }),
    t: literalT(),
    arm,
    disarm,
    state,
    branches,
  } as unknown as WorktreeSwitchProps
  render(<WorktreeSwitch {...props} />)
  return { arm, disarm, state, branches }
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
    await waitFor(() => { expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true) })
  })

  it('releases an armed session', async () => {
    const { disarm } = renderSwitch({ state: idle({ armed: true }), after: idle() })

    fireEvent.click(await screen.findByRole('checkbox'))

    await waitFor(() => { expect(disarm).toHaveBeenCalledWith('session-1', expect.anything()) })
  })

  // The badge is the only way the isolation state survives a reload; without
  // it the switch would read as "not armed" in a session already in a worktree.
  it('shows a read-only badge once the session is in a worktree', async () => {
    renderSwitch({
      blank: false,
      state: idle({
        worktree: { path: '/r/.agents/worktrees/x', branch: 'brave-otter', baseCommit: 'a', repositoryRoot: '/r' },
      }),
    })

    expect(await screen.findByText('Working in brave-otter')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('surfaces the reason the host refused to prepare a worktree', async () => {
    renderSwitch({ state: idle({ failure: 'worktree branch already exists: brave-otter' }) })

    expect(await screen.findByText(/already exists/)).toBeTruthy()
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
      expect(arm).toHaveBeenCalledWith('session-1', { from: 'origin/main' }, expect.anything())
    })
    // The trigger names the ref that will be resolved, not a shortened label.
    expect(await screen.findByText('origin/main')).toBeTruthy()
  })

  it('re-arms with the branch the user picks, and names it on the trigger', async () => {
    const { arm } = renderSwitch({ state: idle({ armed: true }) })

    fireEvent.click(await screen.findByTitle(en.switchBaseHint))
    fireEvent.click(await screen.findByText('feature/one'))

    await waitFor(() => {
      expect(arm).toHaveBeenCalledWith('session-1', { from: 'feature/one' }, expect.anything())
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
