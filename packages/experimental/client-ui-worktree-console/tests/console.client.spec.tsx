// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConsoleSnapshot } from '@deepseek-ai/dsh-experimental-worktree-console/types'
import { SessionId } from '@deepseek-ai/dsh-session'
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
    primary: false,
    stale: false,
    dirtyFiles,
    ignoredFiles: [],
    outsideRepository: false,
    locked: false,
    origin: 'official' as const,
    sessionIds: [],
    ...over,
  }
}

function renderSection(options: {
  worktrees?: readonly ReturnType<typeof row>[]
  repositories?: ConsoleSnapshot['repositories']
} = {}) {
  const list = vi.fn(async () => options.repositories === undefined
    ? snapshot(options.worktrees ?? [row([])])
    : { repositories: options.repositories })
  const prune = vi.fn(async () => ({ pruned: [] }))
  const removeWorktree = vi.fn(async () => ({ removed: WORKTREE }))
  const reveal = vi.fn(async () => true)
  const notify = vi.fn()
  const props = {
    close: () => {},
    t: literalT(),
    list,
    prune,
    removeWorktree,
    reveal,
    notify,
  } as ConsoleProps
  render(<WorktreeConsolePage {...props} />)
  return { list, prune, removeWorktree, reveal, notify }
}

describe('worktree management page', () => {
  it('requires a separate acknowledgement to archive associated sessions', async () => {
    const sessionIds = [SessionId('associated')]
    const { removeWorktree } = renderSection({ worktrees: [row([], { sessionIds })] })
    fireEvent.click(await screen.findByText(en.remove))
    expect(await screen.findByText(en.removeSessionsHint.replace('{count}', '1'))).toBeTruthy()
    const dialog = screen.getByRole('dialog', { name: en.removeConfirm })
    const directory = within(dialog).getByRole('region', { name: en.directory })
    expect(within(directory).getByText(WORKTREE).textContent).toBe(WORKTREE)
    expect(within(directory).getByText(en.removeConfirmHint)).toBeTruthy()
    expect(within(directory).queryByRole('checkbox')).toBeNull()
    const confirm = screen.getByRole('button', { name: en.removeConfirmAction }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(removeWorktree).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: en.removeSessionsAcknowledge }))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => {
      expect(removeWorktree).toHaveBeenCalledWith('wt', WORKTREE, false, sessionIds, expect.anything())
    })
  })

  it('resets session acknowledgement after cancelling a removal', async () => {
    const { removeWorktree } = renderSection({ worktrees: [row([], { sessionIds: [SessionId('associated')] })] })
    fireEvent.click(await screen.findByText(en.remove))
    fireEvent.click(await screen.findByRole('checkbox', { name: en.removeSessionsAcknowledge }))
    fireEvent.click(screen.getByText(en.removeCancel))
    fireEvent.click(screen.getByText(en.remove))
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: en.removeConfirmAction })).disabled).toBe(true)
    expect(removeWorktree).not.toHaveBeenCalled()
  })

  it('requires both file-loss and session-archive acknowledgements', async () => {
    const { removeWorktree } = renderSection({ worktrees: [row(['fresh.txt'], { sessionIds: [SessionId('associated')] })] })
    fireEvent.click(await screen.findByText(en.remove))
    const confirm = await screen.findByRole('button', { name: en.removeConfirmAction }) as HTMLButtonElement
    fireEvent.click(screen.getByRole('checkbox', { name: en.removeSessionsAcknowledge }))
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: en.removeAcknowledge }))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => {
      expect(removeWorktree).toHaveBeenCalledWith('wt', WORKTREE, true, ['associated'], expect.anything())
    })
  })

  it.each([
    ['worktree/sessions-unconfirmed', en.removeSessionsChanged],
    ['worktree/session-access-denied', en.removeSessionsDenied],
    ['worktree/session-archive-failed', en.removeSessionsFailed],
    ['worktree/removal-incomplete', en.removeIncomplete],
  ])('reports %s with localized recovery guidance', async (code, message) => {
    const { removeWorktree, notify } = renderSection()
    removeWorktree.mockRejectedValueOnce({ code })
    fireEvent.click(await screen.findByText(en.remove))
    fireEvent.click(await screen.findByText(en.removeConfirmAction))
    await waitFor(() => { expect(notify).toHaveBeenCalledWith(message, true) })
    expect(screen.getByText('brave-otter')).toBeTruthy()
  })

  it('opens complete details and actions by activating the branch', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'brave-otter' }))
    const details = await screen.findByRole('dialog')
    expect(within(details).getByText(WORKTREE)).toBeTruthy()
    expect(screen.getByText(en.copyPath)).toBeTruthy()
  })

  it('shows ignored content instead of labelling it clean', async () => {
    renderSection({ worktrees: [row([], { ignoredFiles: ['.env'] })] })
    expect(await screen.findByText(en.ignoredCount.replace('{count}', '1'))).toBeTruthy()
    expect(screen.queryByText(en.clean)).toBeNull()
  })

  it('reads its repositories from the Host on mount', async () => {
    const { list } = renderSection()

    expect(await screen.findByText('brave-otter')).toBeTruthy()
    expect(list).toHaveBeenCalled()
  })

  it('opens compact details by clicking a non-action cell without repeating the branch', async () => {
    const { reveal } = renderSection()
    fireEvent.click(await screen.findByText(en.clean))
    const details = await screen.findByRole('dialog', { name: 'brave-otter' })
    expect(within(details).getAllByText('brave-otter')).toHaveLength(1)
    expect(within(details).getByText(WORKTREE)).toBeTruthy()
    expect(within(details).getByText('abcdef01')).toBeTruthy()
    expect(within(details).getByText(en.copyPath)).toBeTruthy()
    fireEvent.click(within(details).getByText(en.reveal))
    await waitFor(() => { expect(reveal).toHaveBeenCalledWith(WORKTREE) })
  })

  it('opens details from row keyboard activation but not from a removal button', async () => {
    renderSection()
    const branch = await screen.findByText('brave-otter')
    const tableRow = branch.closest('tr')
    if (tableRow === null) throw new Error('worktree row missing')
    fireEvent.keyDown(tableRow, { key: 'Enter' })
    expect(await screen.findByRole('dialog', { name: 'brave-otter' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    fireEvent.click(screen.getByText(en.remove))
    expect(await screen.findByRole('dialog', { name: en.removeConfirm })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'brave-otter' })).toBeNull()
  })

  it('dismisses row details from the mask without reopening them', async () => {
    renderSection()
    fireEvent.click(await screen.findByText(en.clean))
    const dialog = await screen.findByRole('dialog', { name: 'brave-otter' })
    const mask = dialog.previousElementSibling
    if (mask === null) throw new Error('dialog mask missing')
    fireEvent.click(mask)
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('opens row details inside the Settings dialog', async () => {
    render(<div role="dialog" aria-label="Settings">
      <WorktreeConsolePage {...{
        close: () => {}, t: literalT(), list: async () => snapshot([row([])]),
        prune: async () => ({ pruned: [] }), removeWorktree: async () => ({ removed: WORKTREE }),
        notify: () => {},
      } as ConsoleProps} />
    </div>)
    fireEvent.click(await screen.findByText(en.clean))
    expect(await screen.findByRole('dialog', { name: 'brave-otter' })).toBeTruthy()
  })

  it('folds workspace lists independently while cleanup leaves them folded', async () => {
    const { prune } = renderSection({ repositories: [
      ...snapshot([row([])]).repositories,
      { id: 'other', title: 'other', path: '/repos/other', worktrees: [row([], { path: '/repos/other', branch: 'other-branch' })] },
    ] })
    await screen.findByText('brave-otter')
    expect(screen.getByText('other-branch')).toBeTruthy()
    const workspace = screen.getByRole('button', { name: /dsh/ })
    expect(workspace.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(workspace)
    expect(workspace.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('brave-otter')).toBeNull()
    expect(screen.getByText('other-branch')).toBeTruthy()
    fireEvent.click(screen.getAllByText(en.prune)[0]!)
    await waitFor(() => { expect(prune).toHaveBeenCalledWith('wt', expect.anything()) })
    expect(workspace.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(workspace)
    expect(await screen.findByText('brave-otter')).toBeTruthy()
  })

  it('names the convention that created the checkout', async () => {
    renderSection()

    expect(await screen.findByText(en.originOfficial)).toBeTruthy()
  })

  it('reports a repository without worktrees as an empty list', async () => {
    renderSection({ worktrees: [] })

    expect(await screen.findByText(en.worktreesEmpty)).toBeTruthy()
  })

  // The row is the whole inventory, so the repository's own checkout appears
  // with the one action Git would refuse disabled rather than missing.
  it('shows the repository’s own checkout with no usable removal', async () => {
    renderSection({
      worktrees: [
        row([], { path: '/repos/dsh', branch: 'main', primary: true, origin: 'manual' }),
        row([]),
      ],
    })

    expect(await screen.findByText('main')).toBeTruthy()
    expect(screen.getByText(en.primary)).toBeTruthy()
    const [primaryRemove] = screen.getAllByText(en.remove)
    expect((primaryRemove?.closest('button') as HTMLButtonElement).disabled).toBe(true)
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
      expect(removeWorktree).toHaveBeenCalledWith('wt', WORKTREE, true, [], expect.anything())
    })
  })

  // A third-party pool is a location, not a lock: the Host widens its fence for
  // that one command, so the row has to offer the action at all.
  it('offers removal for a checkout registered outside the repository', async () => {
    renderSection({ worktrees: [row([], { outsideRepository: true })] })

    expect(await screen.findByText(en.outsideRepository)).toBeTruthy()
    fireEvent.click(screen.getByText(en.remove))
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
      expect(removeWorktree).toHaveBeenCalledWith('wt', WORKTREE, false, [], expect.anything())
    })
  })

  // Git refuses a locked checkout without a second --force, so the row keeps
  // its button in place and disables it rather than vanishing.
  it('reports a locked checkout with its removal disabled', async () => {
    renderSection({ worktrees: [row([], { locked: true })] })

    expect(await screen.findByText(en.locked)).toBeTruthy()
    const remove = screen.getByText(en.remove).closest('button') as HTMLButtonElement
    expect(remove.disabled).toBe(true)
  })

  // A stale registration is bookkeeping with no directory behind it, so the
  // row still offers the one repair that applies to it.
  it('offers removal for a stale registration and says nothing is on disk', async () => {
    const { removeWorktree } = renderSection({ worktrees: [row([], { stale: true })] })

    expect(await screen.findByText(en.stale)).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    fireEvent.click(screen.getByText(en.remove))
    fireEvent.click(await screen.findByText(en.removeConfirmAction))

    await waitFor(() => {
      expect(removeWorktree).toHaveBeenCalledWith('wt', WORKTREE, false, [], expect.anything())
    })
  })

  // Zero changes are stated quietly; only a row with something to lose earns a
  // coloured tag, which is what makes that tag readable at a glance.
  it('states a clean checkout quietly and a dirty one as a warning tag', async () => {
    renderSection({ worktrees: [row([]), row([], { path: '/repos/dsh/.agents/worktrees/calm-heron', branch: 'calm-heron', dirtyFiles: ['a', 'b', 'c'] })] })

    expect(await screen.findByText(en.clean)).toBeTruthy()
    expect(screen.getByText('3 changed')).toBeTruthy()
  })

  it('clears stale registrations for the selected repository', async () => {
    const { prune, notify } = renderSection()

    fireEvent.click(await screen.findByText(en.prune))

    await waitFor(() => { expect(prune).toHaveBeenCalledWith('wt', expect.anything()) })
    await waitFor(() => { expect(notify).toHaveBeenCalledWith(en.pruneNone) })
  })

  // The Settings page draws a section's own chrome (title, icon, crumb — see
  // ui-plugin-manager slot-contract), so the mark beside the title is the only
  // place this section can carry an icon at all.
  it('carries a branch glyph beside the section title', async () => {
    renderSection()

    const heading = await screen.findByRole('heading', { name: en.section })
    expect(heading.querySelector('svg')).toBeTruthy()
  })

  // CSS ellipsis cuts from the right, which is exactly where a generated
  // worktree's random suffix lives: five rows would read `worktree-1e…`,
  // `worktree-5…`, `worktree-5…` and the column would stop identifying
  // anything. Both ends stay; the middle is what goes.
  it('shortens an over-long branch name from the middle, keeping both ends', async () => {
    const long = 'worktree-1ec37b78-85bb-47b5-9724-096c943b8117'
    renderSection({ worktrees: [row([], { branch: long })] })

    const shown = await screen.findByTitle(long)
    expect(shown.textContent).toContain('worktree-1ec')
    expect(shown.textContent).toContain('c943b8117')
    expect(shown.textContent).toContain('…')
    // The full name is one hover away, because the row is the only place a
    // branch is written down.
    expect(shown.textContent).not.toContain('85bb-47b5-9724')
  })

  it('leaves a branch name that fits alone', async () => {
    renderSection({ worktrees: [row([], { branch: 'fix/darkfactory-upgrade-check' })] })

    expect(await screen.findByText('fix/darkfactory-upgrade-check')).toBeTruthy()
  })

  // The cleanup action shares its row with the repository name. A button long
  // enough to wrap takes the row, and the heading truncates to a name that
  // identifies nothing — so the label stays short and the sentence is the
  // title.
  it('keeps the repository name in the heading row beside a titled cleanup', async () => {
    renderSection()

    const heading = await screen.findByRole('button', { name: /dsh/ })
    const cleanup = screen.getByText(en.prune).closest('button') as HTMLButtonElement
    expect(heading).toBeTruthy()
    expect(cleanup.getAttribute('title')).toBe(en.pruneHint)
  })
})
