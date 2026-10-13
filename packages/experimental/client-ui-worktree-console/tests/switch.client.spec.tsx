// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeSessionState } from '@deepseek-ai/dsh-experimental-worktree-console/types'
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
  } = {},
) {
  const arm = vi.fn(async () => options.after ?? idle({ armed: true }))
  const disarm = vi.fn(async () => idle())
  const state = vi.fn(async () => {
    if (options.rejects !== undefined) throw options.rejects
    return options.state ?? idle()
  })
  const props = {
    sessionId: 'session-1',
    useSession: (selector: (snapshot: { blank: boolean }) => unknown) => selector({ blank: options.blank ?? true }),
    t: literalT(),
    arm,
    disarm,
    state,
  } as unknown as WorktreeSwitchProps
  render(<WorktreeSwitch {...props} />)
  return { arm, disarm, state }
}

describe('composer worktree switch', () => {
  it('renders nothing for a session that is neither empty nor in a worktree', async () => {
    const { state } = renderSwitch({ blank: false })

    await waitFor(() => { expect(state).toHaveBeenCalled() })
    expect(screen.queryByText(en.switchLabel)).toBeNull()
  })

  it('offers the switch to an empty session and arms it', async () => {
    const { arm } = renderSwitch()

    fireEvent.click(await screen.findByText(en.switchLabel))

    await waitFor(() => { expect(arm).toHaveBeenCalledWith('session-1', {}, expect.anything()) })
    await waitFor(() => { expect(screen.getByText(en.switchLabel).getAttribute('aria-pressed')).toBe('true') })
  })

  it('releases an armed session', async () => {
    const { disarm } = renderSwitch({ state: idle({ armed: true }), after: idle() })

    fireEvent.click(await screen.findByText(en.switchLabel))

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

  // The chip shares the tool row with the plan and permission controls, which
  // both carry glyphs: a text-only button reads as a stray label.
  it('carries a branch glyph beside the switch label', async () => {
    renderSwitch()

    const button = await screen.findByText(en.switchLabel)
    expect(button.querySelector('svg')).toBeTruthy()
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
