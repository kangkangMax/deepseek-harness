// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConsoleSnapshot } from '@deepseek-ai/dsh-experimental-worktree-console/types'
import { WorktreeConsoleSection, type ConsoleProps } from '../src/client/Console.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const BUNDLE = '@deepseek-ai/dsh-experimental-worktree-console-bundle'
const WORKTREE = '/repos/dsh/.agents/worktrees/brave-otter'

/** Interpolate the real English dictionary, so the spec asserts shipped copy. */
function literalT(): ConsoleProps['t'] {
  return ((key: string, params?: Record<string, unknown>) => {
    const template = (en as unknown as Record<string, string>)[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''))
  }) as ConsoleProps['t']
}

function snapshot(worktrees: ConsoleSnapshot['repositories'][number]['worktrees']): ConsoleSnapshot {
  return { repositories: [{ id: 'wt', path: '/repos/dsh', title: 'dsh', worktrees }] }
}

function row(dirtyFiles: readonly string[]): ConsoleSnapshot['repositories'][number]['worktrees'][number] {
  return {
    path: WORKTREE,
    branch: 'brave-otter',
    head: 'abcdef0123456789abcdef0123456789abcdef01',
    present: true,
    stale: false,
    dirtyFiles,
    origin: 'official',
  }
}

function renderSection(options: { subject?: unknown; worktrees?: readonly ReturnType<typeof row>[] } = {}) {
  const list = vi.fn(async () => snapshot(options.worktrees ?? [row([])]))
  const prune = vi.fn(async () => ({ pruned: [] }))
  const remove = vi.fn(async () => ({ removed: WORKTREE }))
  const props = {
    subject: options.subject ?? { kind: 'bundle', pkg: { name: BUNDLE, installed: true, enabled: true, rows: [] } },
    t: literalT(),
    list,
    prune,
    remove,
  } as unknown as ConsoleProps
  render(<WorktreeConsoleSection {...props} />)
  return { list, prune, remove }
}

describe('worktree management section', () => {
  it('renders nothing for a bundle it does not own', () => {
    const { list } = renderSection({
      subject: { kind: 'bundle', pkg: { name: '@deepseek-ai/dsh-experimental-voice-input-bundle', installed: true, enabled: true, rows: [] } },
    })

    expect(screen.queryByText(en.section)).toBeNull()
    expect(list).not.toHaveBeenCalled()
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
    const { remove } = renderSection({ worktrees: [row(['fresh.txt', 'tracked.txt'])] })

    fireEvent.click(await screen.findByText(en.remove))

    expect(await screen.findByText('fresh.txt')).toBeTruthy()
    expect(screen.getByText('tracked.txt')).toBeTruthy()
    expect(remove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText(en.removeCancel))
    await waitFor(() => { expect(screen.queryByText('fresh.txt')).toBeNull() })
    expect(remove).not.toHaveBeenCalled()
  })

  it('removes with confirmation once the user accepts losing the changes', async () => {
    const { remove } = renderSection({ worktrees: [row(['fresh.txt'])] })

    fireEvent.click(await screen.findByText(en.remove))
    fireEvent.click(await screen.findByText(en.removeConfirmAction))

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith('wt', WORKTREE, true, expect.anything())
    })
  })

  // A clean checkout has nothing to warn about, so the click is the confirmation.
  it('removes a clean worktree without a confirmation step', async () => {
    const { remove } = renderSection()

    fireEvent.click(await screen.findByText(en.remove))

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith('wt', WORKTREE, false, expect.anything())
    })
    expect(screen.queryByText(en.removeConfirmAction)).toBeNull()
  })

  it('clears stale registrations for the selected repository', async () => {
    const { prune } = renderSection()

    fireEvent.click(await screen.findByText(en.prune))

    await waitFor(() => { expect(prune).toHaveBeenCalledWith('wt', expect.anything()) })
    expect(await screen.findByText(en.pruneNone)).toBeTruthy()
  })
})
