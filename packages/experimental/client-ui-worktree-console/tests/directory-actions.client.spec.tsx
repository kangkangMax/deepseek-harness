// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as clipboard from '@deepseek-ai/dsh-client-ui-primitives'
import { DirectoryActions } from '../src/client/DirectoryActions.tsx'
import type { ConsoleProps } from '../src/client/Console.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const t: ConsoleProps['t'] = key => key in en ? en[key as keyof typeof en] : key
const path = '/repos/project'

it.each([true, false])('reports clipboard acceptance %s without claiming a failed copy succeeded', async (accepted) => {
  const write = vi.spyOn(clipboard, 'writeClipboard').mockResolvedValue(accepted)
  const notify = vi.fn()
  render(<DirectoryActions path={path} t={t} notify={notify} />)
  fireEvent.click(screen.getByRole('button', { name: en.copyPath }))
  await waitFor(() => { expect(write).toHaveBeenCalledWith(path) })
  await waitFor(() => { expect(notify).toHaveBeenCalledWith(accepted ? en.copied : en.copyFailed, !accepted) })
  expect(screen.getByRole('button', { name: accepted ? en.copied : en.copyPath })).toBeTruthy()
  expect(screen.queryByRole('button', { name: en.reveal })).toBeNull()
})

it.each([true, false])('reports the directory-open outcome %s', async (shown) => {
  const reveal = vi.fn(async () => shown)
  const notify = vi.fn()
  render(<DirectoryActions path={path} t={t} notify={notify} reveal={reveal} />)
  fireEvent.click(screen.getByRole('button', { name: en.reveal }))
  await waitFor(() => { expect(reveal).toHaveBeenCalledWith(path) })
  await waitFor(() => { expect(notify).toHaveBeenCalledWith(shown ? en.revealDone : en.revealFailed, !shown) })
})

it('reports a rejected directory-open request', async () => {
  const notify = vi.fn()
  render(<DirectoryActions path={path} t={t} notify={notify} reveal={() => Promise.reject(new Error('unavailable'))} />)
  fireEvent.click(screen.getByRole('button', { name: en.reveal }))
  await waitFor(() => { expect(notify).toHaveBeenCalledWith(en.revealFailed, true) })
})
