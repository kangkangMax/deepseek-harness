// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConsoleSnapshot } from '@deepseek-ai/dsh-experimental-worktree-console/types'
import { WorktreeConsolePage, type ConsoleProps } from '../src/client/Console.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const WORKTREE = '/repos/dsh/.agents/worktrees/brave-otter'

/** Interpolate the real English dictionary, so the spec asserts shipped copy. */
function literalT(): ConsoleProps['t'] {
  return (key: string, params?: Record<string, unknown>) => {
    const template = (en as Record<string, string>)[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
      const value = params[name]
      return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
    })
  }
}

function snapshot(worktrees: ConsoleSnapshot['repositories'][number]['worktrees']): ConsoleSnapshot {
  return { repositories: [{ id: 'wt', path: '/repos/dsh', title: 'dsh', worktrees }] }
}

function row(dirtyFiles: readonly string[], over: Partial<ConsoleSnapshot['repositories'][number]['worktrees'][number]> = {}) {
  return {
    path: WORKTREE,
    branch: 'brave-otter',
    head: 'abcdef0123456789abcdef0123456789abcdef01',
    present: true,
    stale: false,
    dirtyFiles,
    ignoredFiles: [],
    outsideRepository: false,
    locked: false,
    origin: 'official' as const,
    ...over,
  }
}

function renderSection(options: { worktrees?: readonly ReturnType<typeof row>[] } = {}) {
  const list = vi.fn(async () => snapshot(options.worktrees ?? [row([])]))
  const prune = vi.fn(async () => ({ pruned: [] }))
  const removeWorktree = vi.fn(async () => ({ removed: WORKTREE }))
  const props = {
    close: () => {},
    t: literalT(),
    list,
    prune,
    removeWorktree,
  } as ConsoleProps
  render(<WorktreeConsolePage {...props} />)
  return { list, prune, removeWorktree }
}

describe('worktree management page', () => {
  it('reads its repositories from the Host on mount', async () => {
    const { list } = renderSection()

    expect(await screen.findByText('brave-otter')).toBeTruthy()
    expect(list).toHaveBeenCalled()
  })

  it('lists the worktree with the convention that created it', async () => {
    renderSection()

    expect(await screen.findByText('brave-otter')).toBeTruthy()
    expect(screen.getByText(WORKTREE)).toBeTruthy()
    expect(screen.getByText(en.originOfficial)).toBeTruthy()
    expect(screen.getByText('abcdef01')).toBeTruthy()
  })

  it('reports a repository without worktrees as an empty list', async () => {
    renderSection({ worktrees: [] })

    expect(await screen.findByText(en.worktreesEmpty)).toBeTruthy()
  })

  it('names the files at risk and sends nothing when the user cancels', async () => {
    const { removeWorktree } = renderSection({ worktrees: [row(['fresh.txt', 'tracked.txt'])] })

    fireEvent.click(await screen.findByText(en.remove))

    expect(await screen.findByText('fresh.txt')).toBeTruthy()
    expect(screen.getByText('tracked.txt')).toBeTruthy()
    expect(removeWorktree).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText(en.removeCancel))
    await waitFor(() => { expect(screen.queryByText('fresh.txt')).toBeNull() })
    expect(removeWorktree).not.toHaveBeenCalled()
  })

  // A removal that would lose a change asks for its own acknowledgement, so a
  // dialog cannot be confirmed by muscle memory.
  it('holds the confirm action until the loss is acknowledged', async () => {
    const { removeWorktree } = renderSection({ worktrees: [row(['fresh.txt'])] })

    fireEvent.click(await screen.findByText(en.remove))
    const confirm = await screen.findByText(en.removeConfirmAction)
    expect((confirm.closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect(removeWorktree).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(removeWorktree).toHaveBeenCalledWith('wt', WORKTREE, true, expect.anything())
    })
  })

  // A third-party pool is a location, not a lock: the Host widens its fence for
  // that one command, so the row has to offer the action at all.
  it('offers removal for a checkout registered outside the repository', async () => {
    renderSection({ worktrees: [row([], { outsideRepository: true })] })

    fireEvent.click(await screen.findByText(en.remove))
    expect(await screen.findByText(en.removeConfirm)).toBeTruthy()
  })

  // R8: every row confirms before it runs. A clean checkout still gets the
  // step — it simply has no file list to show.
  it('confirms before removing a clean worktree', async () => {
    const { removeWorktree } = renderSection()

    fireEvent.click(await screen.findByText(en.remove))

    expect(await screen.findByText(en.removeConfirmAction)).toBeTruthy()
    expect(screen.queryByText(en.removeLostFiles)).toBeNull()
    expect(removeWorktree).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText(en.removeConfirmAction))
    await waitFor(() => {
      expect(removeWorktree).toHaveBeenCalledWith('wt', WORKTREE, false, expect.anything())
    })
  })

  // Git refuses a locked checkout without a second --force, so the row reports
  // the lock instead of offering an action that cannot succeed.
  it('reports a locked checkout instead of offering removal', async () => {
    renderSection({ worktrees: [row([], { locked: true })] })

    expect(await screen.findByText(en.locked)).toBeTruthy()
    expect(screen.queryByText(en.remove)).toBeNull()
  })

  it('clears stale registrations for the selected repository', async () => {
    const { prune } = renderSection()

    fireEvent.click(await screen.findByText(en.prune))

    await waitFor(() => { expect(prune).toHaveBeenCalledWith('wt', expect.anything()) })
    expect(await screen.findByText(en.pruneNone)).toBeTruthy()
  })

  // The Plugins page draws a section's own chrome (title, icon, crumb — see
  // ui-plugin-manager slot-contract), so the mark beside the title is the only
  // place this section can carry an icon at all.
  it('carries a branch glyph beside the section title', async () => {
    renderSection()

    const heading = await screen.findByRole('heading', { name: en.section })
    expect(heading.querySelector('svg')).toBeTruthy()
  })
})
