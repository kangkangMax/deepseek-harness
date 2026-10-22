/** Keyless UI expectations over real Git repositories and the shipped Web composition. */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, openSettings, saveFailureShot } from './support.ts'

const execute = promisify(execFile)
const expected = fileURLToPath(new URL('./expected/worktree-console/page.expected.md', import.meta.url))
const headerExpected = fileURLToPath(new URL('./expected/worktree-console/header.expected.md', import.meta.url))
const removalExpected = fileURLToPath(new URL('./expected/worktree-console/removal.expected.md', import.meta.url))
const REMOVAL_SESSION = SessionId('worktree-removal-fixture')
const HEADER_BRANCH = 'worktree-57d650f1-f76a-4502-982d-a0367b55df3e'

/** A closed user turn exposes the Session header without a model call. */
function headerFixture(): string {
  const session = Session.create(SessionId('worktree-header-fixture'))
  session.append('turn/start', { turn: 1 })
  const message = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Inspect the worktree header.' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', { title: 'Worktree header fixture', messageSeqs: [message.seq], source: { kind: 'fallback' } })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return [
    JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', cwd: '{{cwd}}', createdAt: 0, isSeeded: false, delegationDepth: 0 }),
    ...session.snapshotEvents().map(event => JSON.stringify(event)),
    '',
  ].join('\n')
}

it('restores the accepted base and exposes worktree details and deletion at narrow widths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-console-browser-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const overlay = join(root, 'console.json')
  await writeFile(overlay, JSON.stringify([{ insert: [
    { id: 'review-worktree', name: fileURLToPath(new URL('../../../packages/experimental/worktree/lib/index.js', import.meta.url)) },
    { id: 'review-console', name: fileURLToPath(new URL('../../../packages/experimental/worktree-console/lib/index.js', import.meta.url)) },
    { id: 'review-console-ui', name: fileURLToPath(new URL('../../../packages/experimental/client-ui-worktree-console/lib/index.js', import.meta.url)) },
  ] }]))
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)), overlay],
    extraInstallAnchors: [fileURLToPath(new URL('../../../packages/experimental/worktree-console-bundle/package.json', import.meta.url))],
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  onTestFailed(() => saveFailureShot(page, 'worktree-console'))
  const tripwire = watchConsole(page)
  const repository = join(scaffold.workspaceCwd, 'workspace')
  await mkdir(repository, { recursive: true })
  const git = (...args: string[]) => execute('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repository,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '', GIT_CONFIG_PARAMETERS: '', GIT_CONFIG_COUNT: '0',
      GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_COMMON_DIR: undefined, GIT_INDEX_FILE: undefined,
      GIT_OBJECT_DIRECTORY: undefined, GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
    },
  })
  await git('init', '-b', 'main')
  await git('config', 'core.autocrlf', 'false')
  await writeFile(join(repository, 'tracked.txt'), 'retained\n')
  await writeFile(join(repository, '.gitignore'), '.agents/\n.env\n')
  await git('add', '.')
  await git('-c', 'user.name=Worktree fixture', '-c', 'user.email=worktree@example.invalid',
    '-c', 'commit.gpgSign=false', 'commit', '-m', 'initial')
  for (const name of ['topic', 'one', 'two', 'three', 'four', 'five']) await git('branch', name)
  const checkout = join(repository, '.agents', 'worktrees', 'retained-checkout')
  await git('worktree', 'add', '-b', 'retained-checkout', checkout)
  await writeFile(join(checkout, '.env'), 'LOCAL_ONLY=1\n')
  await seedSession({ ...scaffold, workspaceCwd: repository }, headerFixture(), 'worktree-header-fixture', 'standard')
  await seedSession({ ...scaffold, workspaceCwd: checkout }, headerFixture(), REMOVAL_SESSION, 'standard')

  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  await page.getByRole('checkbox', { name: 'Worktree', exact: true }).click()
  await expect.poll(() => page.getByRole('checkbox', { name: 'Worktree', exact: true }).isChecked()).toBe(true)
  await page.getByTitle('Branch the new worktree starts from').click()
  const search = page.getByRole('searchbox', { name: 'Search branches' })
  await search.fill('topic')
  await search.press('ArrowDown')
  expect(await search.evaluate(element => element === document.activeElement)).toBe(true)
  await search.press('Enter')
  await expect.poll(() => page.getByTitle('Branch the new worktree starts from').textContent()).toContain('topic')
  await page.reload({ waitUntil: 'load' })
  await expect.poll(() => page.getByTitle('Branch the new worktree starts from').textContent()).toContain('topic')

  await openSettings(page, 'en')
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('button', { name: 'Worktrees', exact: true }).click()
  const inventory = page.locator('[data-worktree-console]')
  await inventory.getByRole('button', { name: 'retained-checkout', exact: true }).waitFor()
  const titleBlock = await inventory.getByRole('heading', { name: 'Worktrees', exact: true }).locator('..').boundingBox()
  const refreshButton = await inventory.getByRole('button', { name: 'Refresh', exact: true }).boundingBox()
  if (titleBlock === null || refreshButton === null) throw new Error('Worktree page header is not measurable')
  expect(Math.abs(titleBlock.y + titleBlock.height / 2 - refreshButton.y - refreshButton.height / 2)).toBeLessThan(1)
  const workspaceGroup = inventory.getByRole('button', { name: /workspace.*worktrees/ })
  await workspaceGroup.click()
  expect(await workspaceGroup.getAttribute('aria-expanded')).toBe('false')
  expect(await inventory.getByRole('button', { name: 'retained-checkout', exact: true }).count()).toBe(0)
  await workspaceGroup.press('Enter')
  await inventory.getByRole('button', { name: 'retained-checkout', exact: true }).waitFor()
  await compareOrRefreshGolden(expected, await captureStableAria(page, '[data-worktree-console]', scaffold.workspaceCwd), webSnapshotMode())

  for (const width of [1000, 390]) {
    await page.emulateMedia({ colorScheme: width === 390 ? 'dark' : 'light' })
    await page.setViewportSize({ width, height: 844 })
    const overflow = await inventory.evaluate(element => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
      children: Array.from(element.querySelectorAll('*'))
        .filter(child => child.getBoundingClientRect().right > element.getBoundingClientRect().right + 1)
        .slice(0, 8).map(child => ({ tag: child.tagName, class: child.className, text: child.textContent?.slice(0, 50) })),
    }))
    expect(overflow.scroll, JSON.stringify({ width, ...overflow })).toBeLessThanOrEqual(overflow.client)
    const checkoutRow = inventory.locator('tbody tr').filter({ has: page.getByRole('button', { name: 'retained-checkout', exact: true }) })
    await checkoutRow.locator('td').nth(1).click()
    const details = page.getByRole('dialog', { name: 'retained-checkout', exact: true })
    await details.getByRole('button', { name: 'Copy path', exact: true }).waitFor()
    expect(await details.getByText(checkout, { exact: true }).count()).toBe(1)
    await details.getByRole('button', { name: 'Close', exact: true }).click()
  }
  await inventory.getByRole('button', { name: 'Remove', exact: true }).last().click()
  const confirmation = page.getByRole('dialog', { name: 'Remove this worktree?', exact: true })
  await confirmation.getByText('Associated sessions (1) will be archived and hidden from the session list. Chat history will be retained.', { exact: true }).waitFor()
  await compareOrRefreshGolden(removalExpected, await captureStableAria(page, '[role="dialog"][aria-label="Remove this worktree?"]', scaffold.workspaceCwd), webSnapshotMode())
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await confirmation.waitFor({ state: 'hidden' })
  expect((await git('worktree', 'list', '--porcelain')).stdout).toContain(checkout)
  expect(scaffold.ctx.workspaceRegistry.archivedSessionIds).not.toContain(REMOVAL_SESSION)
  await inventory.getByRole('button', { name: 'Remove', exact: true }).last().click()
  expect(await confirmation.getByRole('button', { name: 'Remove and discard changes' }).isDisabled()).toBe(true)
  await confirmation.getByRole('checkbox', { name: 'I know this worktree has changes that will be lost', exact: true }).check()
  expect(await confirmation.getByRole('button', { name: 'Remove and discard changes' }).isDisabled()).toBe(true)
  await confirmation.getByRole('checkbox', { name: 'Also archive the associated sessions', exact: true }).check()
  await confirmation.getByRole('button', { name: 'Remove and discard changes' }).click()
  await confirmation.waitFor({ state: 'hidden' })
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Removed' }).waitFor()
  expect((await git('worktree', 'list', '--porcelain')).stdout).not.toContain(checkout)
  expect(scaffold.ctx.workspaceRegistry.archivedSessionIds).toContain(REMOVAL_SESSION)
  expect((await scaffold.ctx.sessionPersistence.list()).map(snapshot => snapshot.header.id)).toContain(REMOVAL_SESSION)
  await git('checkout', '-b', HEADER_BRANCH)
  await page.setViewportSize({ width: 1000, height: 844 })
  await page.reload({ waitUntil: 'load' })
  const openSidebar = page.getByRole('button', { name: 'Open sidebar', exact: true }).first()
  if (await openSidebar.isVisible()) await openSidebar.click()
  const fixtureGroup = page.getByRole('treeitem').filter({ hasText: 'Ungrouped' })
  await fixtureGroup.waitFor()
  if (await fixtureGroup.getAttribute('aria-expanded') !== 'true') await fixtureGroup.click()
  await page.locator('[data-row-key="session:worktree-header-fixture"]').click()
  await page.getByText('Inspect the worktree header.', { exact: true }).waitFor()
  expect(await page.locator('[data-row-key="session:worktree-removal-fixture"]').count()).toBe(0)
  expect(scaffold.ctx.workspaceRegistry.archivedSessionIds).not.toContain(SessionId('worktree-header-fixture'))
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  const header = page.locator('[data-conversation-header-corner]').locator('..')
  const branch = header.locator('[data-worktree-context]')
  await branch.waitFor()
  await header.getByText('Standard mode', { exact: true }).waitFor()
  await compareOrRefreshGolden(headerExpected, await captureStableAria(page, '[data-conversation-header-corner] >> ..', scaffold.workspaceCwd), webSnapshotMode())
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await branch.hover()
  const copy = page.getByRole('button', { name: 'Copy path', exact: true })
  await copy.waitFor()
  await copy.hover()
  await copy.click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(repository)
  await page.mouse.move(950, 800)
  await page.getByText(repository, { exact: true }).waitFor({ state: 'hidden' })
  for (const width of [1000, 390]) {
    await page.emulateMedia({ colorScheme: width === 390 ? 'dark' : 'light' })
    await page.setViewportSize({ width, height: 844 })
    await branch.hover()
    const directory = page.getByRole('region', { name: 'Working directory', exact: true })
    await directory.getByRole('button', { name: 'Copy path', exact: true }).waitFor()
    expect(await directory.getByText(repository, { exact: true }).count()).toBe(1)
    expect(await directory.getByText(HEADER_BRANCH, { exact: true }).count()).toBe(1)
    expect(await page.getByRole('dialog').count()).toBe(0)
    await page.keyboard.press('Escape')
    await directory.waitFor({ state: 'hidden' })
    const branchBox = await branch.boundingBox()
    const cornerBox = await page.locator('[data-conversation-header-corner]').boundingBox()
    if (branchBox === null || cornerBox === null) throw new Error('Session header controls are not measurable')
    expect(branchBox.x).toBeGreaterThanOrEqual(0)
    expect(branchBox.x + branchBox.width).toBeLessThanOrEqual(cornerBox.x)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).first().click()
  await branch.hover()
  const narrowDetails = page.getByRole('region', { name: 'Working directory', exact: true })
  await narrowDetails.getByRole('button', { name: 'Copy path', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await narrowDetails.waitFor({ state: 'hidden' })
  const narrowBranch = await branch.boundingBox()
  const utilities = await header.getByRole('button', { name: 'More actions', exact: true }).boundingBox()
  if (narrowBranch === null || utilities === null) throw new Error('Narrow header controls are not measurable')
  expect(narrowBranch.y + narrowBranch.height).toBeLessThanOrEqual(utilities.y)
  expect(tripwire.pageErrors).toEqual([])
})
