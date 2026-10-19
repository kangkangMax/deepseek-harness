// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BranchChoices } from '@deepseek-ai/dsh-experimental-worktree-console/types'
import { en } from '../src/client/locales.ts'
import { BasePicker, type BasePickerProps } from '../src/client/BasePicker.tsx'

afterEach(cleanup)

/** A repository with enough branches that the card owes the user a search field. */
const MANY: BranchChoices = {
  repositoryRoot: '/repos/dsh',
  branches: [
    { name: 'main', kind: 'local', current: true },
    { name: 'feat/search-field', kind: 'local', current: false },
    { name: 'feat/other-thing', kind: 'local', current: false },
    { name: 'fix/crash-on-load', kind: 'local', current: false },
    { name: 'chore/bump-deps', kind: 'local', current: false },
    { name: 'docs/readme', kind: 'local', current: false },
    { name: 'origin/main', kind: 'remote', current: false },
  ],
}

function renderPicker(over: Partial<BasePickerProps> = {}) {
  const onSelect = vi.fn()
  const props: BasePickerProps = {
    base: undefined,
    choices: MANY,
    busy: false,
    hint: en.switchBaseHint,
    label: en.switchBase,
    headLabel: en.switchBaseHead,
    localLabel: en.switchBaseLocal,
    remoteLabel: en.switchBaseRemote,
    currentLabel: branch => en.switchBaseCurrent.replace('{branch}', branch),
    searchLabel: en.switchBaseSearch,
    clearLabel: en.switchBaseSearchClear,
    noMatch: en.switchBaseNoMatch,
    noChoices: en.switchBaseNoChoices,
    noRepository: en.switchBaseNone,
    onSelect,
    ...over,
  }
  const view = render(<BasePicker {...props} />)
  return { onSelect, view, rerenderWith: (next: Partial<BasePickerProps>) => {
    view.rerender(<BasePicker {...props} {...next} />)
  } }
}

async function openCard(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByTitle(en.switchBaseHint))
  return screen.findByRole('menu')
}

describe('base picker search', () => {
  // Seven branches cannot be scanned from a flat list, and a search field over
  // three rows would be a field that never earns its space.
  it('offers a search field only once the list is long enough to need one', async () => {
    renderPicker()
    await openCard()

    expect(await screen.findByRole('searchbox')).toBeTruthy()

    cleanup()
    renderPicker({
      choices: {
        repositoryRoot: '/repos/dsh',
        branches: [
          { name: 'main', kind: 'local', current: true },
          { name: 'fix/one', kind: 'local', current: false },
        ],
      },
    })
    await openCard()

    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('narrows the rows to what the query matches', async () => {
    renderPicker()
    await openCard()

    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'crash' } })

    await waitFor(() => {
      expect(screen.queryByText('feat/search-field')).toBeNull()
    })
    expect(screen.getByText('fix/crash-on-load')).toBeTruthy()
  })

  // HEAD means "resolve whatever is checked out when the user sends", so it is
  // not a branch and no query may hide it. Read inside the card, because the
  // trigger names the same words as its value.
  it('keeps the HEAD row reachable under any query', async () => {
    renderPicker()
    const card = await openCard()

    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'crash' } })

    expect(within(card).getByText(en.switchBaseHead)).toBeTruthy()
  })

  it('says so when a query matches nothing, and the query can be cleared', async () => {
    renderPicker()
    await openCard()

    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'nothing-matches-this' } })

    expect(await screen.findByText(en.switchBaseNoMatch)).toBeTruthy()
    fireEvent.click(screen.getByLabelText(en.switchBaseSearchClear))

    await waitFor(() => {
      expect(screen.queryByText(en.switchBaseNoMatch)).toBeNull()
    })
    expect(await screen.findByText('feat/search-field')).toBeTruthy()
  })

  it('arms the branch the user settles from the highlighted row', async () => {
    const { onSelect } = renderPicker()
    await openCard()

    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'docs' } })
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' })

    await waitFor(() => { expect(onSelect).toHaveBeenCalledWith('docs/readme') })
  })

  // The remote namespace is a different revision from its local namesake, so a
  // query that matches one must not quietly settle the other.
  it('keeps the remote namespace under its own heading', async () => {
    renderPicker()
    await openCard()

    expect(await screen.findByText(en.switchBaseLocal)).toBeTruthy()
    expect(await screen.findByText(en.switchBaseRemote)).toBeTruthy()
    expect(screen.getByText('origin/main')).toBeTruthy()
  })
})
