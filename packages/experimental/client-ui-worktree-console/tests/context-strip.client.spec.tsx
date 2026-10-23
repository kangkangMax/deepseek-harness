// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BranchChoices, WorktreeSessionState } from '@deepseek-ai/dsh-experimental-worktree-console/types'
import { en } from '../src/client/locales.ts'
import { WorktreeContext, type WorktreeContextProps } from '../src/client/ContextStrip.tsx'

afterEach(cleanup)

/** Interpolate the real English dictionary, so the spec asserts shipped copy. */
function literalT(): WorktreeContextProps['t'] {
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

const main = (over: Partial<BranchChoices> = {}): BranchChoices => ({
  repositoryRoot: '/repos/deepseek-harness',
  branches: [
    { name: 'main', kind: 'local', current: true },
    { name: 'feature/one', kind: 'local', current: false },
  ],
  ...over,
})

function renderStrip(
  options: {
    state?: WorktreeSessionState
    choices?: BranchChoices
    /** Answers for reads after the first, which is what a re-read asks for. */
    thenState?: WorktreeSessionState
    thenChoices?: BranchChoices
    rejects?: unknown
  } = {},
) {
  let stateReads = 0
  let branchReads = 0
  const state = vi.fn(async () => {
    if (options.rejects !== undefined) throw options.rejects
    stateReads += 1
    return stateReads > 1 && options.thenState !== undefined ? options.thenState : options.state ?? idle()
  })
  const branches = vi.fn(async () => {
    branchReads += 1
    return branchReads > 1 && options.thenChoices !== undefined ? options.thenChoices : options.choices ?? main()
  })
  const reveal = vi.fn(async () => true)
  const notify = vi.fn()
  const props = (over: { running?: boolean } = {}) => ({
    sessionId: 'session-1',
    useSession: (selector: (snapshot: { running: boolean }) => unknown) => selector({
      running: over.running ?? false,
    }),
    t: literalT(),
    state,
    branches,
    reveal,
    notify,
  } as WorktreeContextProps)
  const view = render(<WorktreeContext {...props()} />)
  return {
    state,
    branches,
    reveal,
    notify,
    container: view.container,
    rerenderWith: (over: { running?: boolean }) => {
      view.rerender(<WorktreeContext {...props(over)} />)
    },
  }
}

/** Hover the whole strip: the branch is all it holds, so its anchor is the header. */
function hover(container: HTMLElement) {
  const anchor = container.firstElementChild
  if (anchor === null) throw new Error('the strip rendered no anchor')
  fireEvent.pointerEnter(anchor)
  return anchor
}

describe('composer context strip', () => {
  // The branch is the shortest answer to "where am I about to work?", so it is
  // the only value printed. The checkout path is longer than the rest of the row
  // and its last segment is the repository name, so both are withheld from the
  // printed line rather than spending the width twice.
  it('prints the branch its own checkout has out, and only that', async () => {
    const { container } = renderStrip()

    expect(await screen.findByText('main')).toBeTruthy()
    expect(screen.queryByText('deepseek-harness')).toBeNull()
    expect(container.textContent).toBe('main')
  })

  // Hovering the branch is the one affordance this line has: it names the
  // directory, which is the same answer as "which repository" plus where it is.
  it('names the checkout directory when the branch is hovered', async () => {
    const { container, reveal } = renderStrip()
    await screen.findByText('main')

    hover(container)

    expect(await screen.findByText('/repos/deepseek-harness')).toBeTruthy()
    expect(screen.getByRole('button', { name: en.copyPath })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.reveal }))
    await waitFor(() => { expect(reveal).toHaveBeenCalledWith('/repos/deepseek-harness') })
  })

  it('shows one hover card and never opens a dialog on click', async () => {
    renderStrip()
    const branch = await screen.findByText('main')
    fireEvent.click(branch)
    expect(screen.queryByRole('region', { name: en.directory })).toBeNull()
    fireEvent.pointerEnter(branch.closest('[data-worktree-context]')!.parentElement!)
    await screen.findByRole('region', { name: en.directory })
    expect(screen.getAllByRole('region', { name: en.directory })).toHaveLength(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: en.copyPath })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('region', { name: en.directory })).toBeNull() })
  })

  it('does not open directory details on touch hover or click', async () => {
    renderStrip()
    const branch = await screen.findByText('main')
    const touch = new Event('pointerover', { bubbles: true })
    Object.defineProperty(touch, 'pointerType', { value: 'touch' })
    fireEvent(branch, touch)
    fireEvent.click(branch)
    expect(screen.queryByRole('region', { name: en.directory })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // The stripped root is what the Host resolves from the Session's directory,
  // so a checkout detached from every branch has no `current` row at all. It
  // says `detached` rather than naming a branch it cannot know.
  it('says the checkout is detached when no branch carries HEAD', async () => {
    renderStrip({
      choices: { repositoryRoot: '/repos/dsh', branches: [{ name: 'main', kind: 'local', current: false }] },
    })

    expect(await screen.findByText(en.detached)).toBeTruthy()
  })

  // An isolated Session's own directory is a worktree folder (`9c5993a4--worktree`),
  // so neither the folder name nor the repository name is printed; the hover
  // has to name the folder, because that is the directory the Session runs in.
  it('prints the worktree branch and hovers the worktree directory', async () => {
    const { container } = renderStrip({
      state: idle({
        worktree: {
          path: '/repos/dsh/.agents/worktrees/9c5993a4--worktree',
          branch: 'fix-darkfactory',
          baseCommit: 'a',
          repositoryRoot: '/repos/deepseek-harness',
        },
      }),
      choices: {
        repositoryRoot: '/repos/dsh/.agents/worktrees/9c5993a4--worktree',
        branches: [{ name: 'fix-darkfactory', kind: 'local', current: true }],
      },
    })

    expect(await screen.findByText('fix-darkfactory')).toBeTruthy()
    expect(container.textContent).toBe('fix-darkfactory')

    hover(container)

    expect(await screen.findByText('/repos/dsh/.agents/worktrees/9c5993a4--worktree')).toBeTruthy()
  })

  // README-level honesty: a directory outside every repository has neither a
  // repository nor a branch, and a permanent line saying so is noise.
  it('renders nothing outside a repository', async () => {
    const { branches, container } = renderStrip({ choices: { repositoryRoot: null, branches: [] } })

    await waitFor(() => { expect(branches).toHaveBeenCalled() })
    await waitFor(() => { expect(container.textContent).toBe('') })
    expect(container.firstElementChild).toBeNull()
  })

  // A run that materialized a worktree moved this Session onto a branch the
  // first reading could not have known, and only the run's end says so.
  it('names the new branch once the run that created a worktree ends', async () => {
    const { rerenderWith } = renderStrip({
      thenState: idle({
        worktree: {
          path: '/repos/dsh/.agents/worktrees/9c5993a4--worktree',
          branch: 'worktree-9c5993a4',
          baseCommit: 'a',
          repositoryRoot: '/repos/deepseek-harness',
        },
      }),
      thenChoices: {
        repositoryRoot: '/repos/dsh/.agents/worktrees/9c5993a4--worktree',
        branches: [{ name: 'worktree-9c5993a4', kind: 'local', current: true }],
      },
    })
    expect(await screen.findByText('main')).toBeTruthy()

    rerenderWith({ running: true })
    rerenderWith({ running: false })

    expect(await screen.findByText('worktree-9c5993a4')).toBeTruthy()
    expect(screen.queryByText('main')).toBeNull()
  })

  // Like the switch, a strip that guessed would flicker between two answers on
  // every mount, so nothing is claimed until both reads land.
  it('claims nothing until both reads answer', async () => {
    const never = new Promise<never>(() => {})
    const props = {
      sessionId: 'session-1',
      useSession: (selector: (snapshot: { running: boolean }) => unknown) => selector({ running: false }),
      t: literalT(),
      state: () => never,
      branches: () => never,
    } as WorktreeContextProps
    const { container } = render(<WorktreeContext {...props} />)

    expect(container.textContent).toBe('')
  })

  it('reports when the current checkout cannot be read', async () => {
    renderStrip({ rejects: new Error('unreachable') })
    expect((await screen.findByRole('status')).textContent).toBe(en.failed)
  })

  it('reports detached HEAD instead of an earlier worktree branch', async () => {
    renderStrip({
      state: idle({ worktree: { path: '/repos/dsh', branch: 'old-branch', baseCommit: 'a', repositoryRoot: '/repos/dsh' } }),
      choices: main({ branches: [{ name: 'old-branch', kind: 'local', current: false }] }),
    })
    expect(await screen.findByText(en.detached)).toBeTruthy()
    expect(screen.queryByText('old-branch')).toBeNull()
  })
})
