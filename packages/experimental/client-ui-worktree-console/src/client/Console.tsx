/**
 * The worktree management page of the Settings panel: the repositories of the
 * profile on the left, the selected repository's worktrees on the right, and the
 * two repairs — clear stale registrations, and remove one worktree.
 *
 * It owns one Settings navigation row, so the page is where a user looks for it
 * rather than at the bottom of a plugin's own detail page.
 *
 * The table is four columns wide and one fact per column. The commit and the
 * full directory are not columns: they are what the branch cell's hover card
 * shows, because the branch name is the only thing that tells two rows apart,
 * and every pixel spent on a second identifier is a pixel taken from it.
 * @module @deepseek-ai/dsh-experimental-client-ui-worktree-console/src/client/Console
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button, HoverCard, IconBranchOutlineRegular, IconRefreshOutlineRegular, IconWarningTriangleOutlineRegular,
  Modal, Tag, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {
  RepositoryRows, WorktreeOrigin, WorktreeRow,
} from '@deepseek-ai/dsh-experimental-worktree-console/types'
import { describeFailure, type ConsoleInjected } from './face.ts'
import { NS } from './locales.ts'
import css from './Console.module.css'

/** Owner props, dictionaries, and the Host face this page renders from. */
export type ConsoleProps =
  & PropsRuntime<'settings.section'>
  & PropsLocale<typeof NS>
  & InjectFace<ConsoleInjected>

/** One removal the user has not confirmed yet. */
interface PendingRemoval {
  readonly repositoryId: string
  readonly path: string
  /** Tracked and untracked paths that would be lost, listed by name. */
  readonly files: readonly string[]
  /** Ignored paths that would also be deleted; shown as a count, not a list. */
  readonly ignoredCount: number
  /** The registration has no checkout left, so nothing on disk is at stake. */
  readonly stale: boolean
}

/** How long the copy action reports its own success. */
const COPIED_MS = 1_200

/** Shorten a commit for the hover card without hiding which commit it is. */
function shortCommit(commit: string): string {
  return commit.slice(0, 8)
}

/**
 * The distinguishing tail of a detached checkout's directory.
 *
 * Two detached checkouts of the same commit are told apart by where they sit,
 * and the pool names each directory after what created it. Only the tail is
 * shown in the row: the full path is one gesture away in the hover card.
 * @param path - absolute checkout directory.
 * @returns the shortest readable tail, prefixed to read as a truncated path.
 */
function pathTail(path: string): string {
  const segments = path.split('/')
  const name = (segments[segments.length - 1] ?? path).replace(/--worktree$/, '')
  return `…${name.length > 8 ? name.slice(-8) : name}`
}

/** The management page, as the Settings panel registers it. */
export function WorktreeConsolePage(props: ConsoleProps) {
  return <Console {...props} />
}

function originLabel(origin: WorktreeOrigin, t: ConsoleProps['t']): string {
  // Every member is listed and there is no fallback arm, so adding an origin
  // stops compiling here instead of silently rendering as `manual`.
  switch (origin) {
    case 'official': return t('originOfficial')
    case 'third-party': return t('originThirdParty')
    case 'manual': return t('originManual')
  }
}

/** The reason Git would refuse a removal, or undefined when it would run. */
function removalRefusal(row: WorktreeRow): 'primary' | 'locked' | undefined {
  if (row.primary) return 'primary'
  if (row.locked) return 'locked'
  return undefined
}

/** One worktree row, with the hover card its branch cell owns. */
function WorktreeTableRow({ row, busy, copied, t, reveal, onCopy, onReveal, onRemove }: {
  row: WorktreeRow
  busy: boolean
  copied: boolean
  t: ConsoleProps['t']
  reveal: ((path: string) => Promise<boolean>) | undefined
  onCopy: (path: string) => void
  onReveal: (path: string) => void
  onRemove: () => void
}) {
  // The row owns the anchor the card is sized from, so the card follows the
  // branch column rather than the width of the branch name inside it.
  const cell = useRef<HTMLElement | null>(null)
  const refusal = removalRefusal(row)
  return <tr>
    <td className={css.branchCell} ref={(node) => { cell.current = node }}>
      <HoverCard
        variant="preview"
        widthAnchorRef={cell}
        openDelayMs={200}
        anchor={<span className={css.branch}>
          <IconBranchOutlineRegular className={css.branchGlyph} size={13} />
          {row.branch === null
            ? <>
              <span className={css.detached}>{t('detached')}</span>
              <span className={css.tail}>{pathTail(row.path)}</span>
            </>
            : <span className={css.name}>{row.branch}</span>}
          {row.primary && <Tag tone="neutral">{t('primary')}</Tag>}
          {row.locked && <Tag tone="outline">{t('locked')}</Tag>}
          {row.outsideRepository && <Tag tone="outline">{t('outsideRepository')}</Tag>}
          {row.stale && <Tag tone="danger">{t('stale')}</Tag>}
        </span>}
        content={<div className={css.card}>
          <p className={css.cardPath}>{row.path}</p>
          {row.stale && <p className={css.cardWarn}>
            <IconWarningTriangleOutlineRegular size={11} />
            <span>{t('staleCardHint')}</span>
          </p>}
          <div className={css.cardFoot}>
            <span className={css.cardMeta}>{shortCommit(row.head)}</span>
            <span className={css.cardActions}>
              <button type="button" className={css.cardAction} onClick={() => { onCopy(row.path) }}>
                {copied ? t('copied') : t('copyPath')}
              </button>
              {reveal !== undefined && !row.stale && <button
                type="button"
                className={css.cardAction}
                onClick={() => { onReveal(row.path) }}
              >{t('reveal')}</button>}
            </span>
          </div>
        </div>}
      />
    </td>
    <td className={css.changesCell}>
      {row.stale
        ? <span className={css.dimmed}>—</span>
        : row.dirtyFiles.length === 0
          ? <span className={css.clean}>{t('clean')}</span>
          : <Tag tone="warning" className={css.changedTag}>
            <span className={css.dot} />
            {t('changedCount', { count: row.dirtyFiles.length })}
          </Tag>}
    </td>
    <td className={`${css.sourceCell} ${css.sourceText}`}>
      {row.primary ? '—' : originLabel(row.origin, t)}
    </td>
    <td className={css.actionsCell}>
      <button
        type="button"
        className={css.remove}
        disabled={busy || refusal !== undefined}
        title={refusal === undefined ? undefined : t(refusal)}
        onClick={onRemove}
      >{t('remove')}</button>
    </td>
  </tr>
}

function Console(props: ConsoleProps) {
  const { t } = props
  const [repositories, setRepositories] = useState<readonly RepositoryRows[] | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState<PendingRemoval | undefined>(undefined)
  // A destructive confirm is gated on its own acknowledgement, reset per target.
  const [acknowledged, setAcknowledged] = useState(false)
  const [failure, setFailure] = useState<unknown>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  /** Path whose copy action just succeeded, for the card's own feedback. */
  const [copied, setCopied] = useState<string | undefined>(undefined)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Latest-ref so the load effect depends on the refresh token alone: the face
  // is rebuilt on each render, and depending on it directly would refetch in a
  // loop.
  const face = useRef(props)
  face.current = props

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const snapshot = await face.current.list(controller.signal)
        if (controller.signal.aborted) return
        setRepositories(snapshot.repositories)
        setSelectedId(current => current ?? snapshot.repositories[0]?.id)
      } catch (error: unknown) {
        if (!controller.signal.aborted) setFailure(error)
      }
    })()
    return () => { controller.abort() }
  }, [refreshToken])

  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
  }, [])

  const refresh = useCallback(() => {
    setFailure(undefined)
    setNotice(undefined)
    setRefreshToken(token => token + 1)
  }, [])

  const copyPath = useCallback((path: string) => {
    void writeClipboard(path).then((accepted) => {
      if (!accepted) return
      setCopied(path)
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => { setCopied(undefined) }, COPIED_MS)
    })
  }, [])

  const reveal = props.reveal

  const showInFileManager = useCallback((path: string) => {
    if (reveal === undefined) return
    setFailure(undefined)
    void reveal(path).then((shown) => {
      if (!shown) setNotice(t('revealFailed'))
    })
  }, [reveal, t])

  async function runPrune(repositoryId: string): Promise<void> {
    setBusy(true)
    setFailure(undefined)
    try {
      const outcome = await props.prune(repositoryId, new AbortController().signal)
      setNotice(outcome.pruned.length === 0 ? t('pruneNone') : t('pruneDone', { count: outcome.pruned.length }))
      setRefreshToken(token => token + 1)
    } catch (error: unknown) {
      setFailure(error)
    } finally {
      setBusy(false)
    }
  }

  async function submitRemoval(target: PendingRemoval, force: boolean): Promise<void> {
    setBusy(true)
    setFailure(undefined)
    try {
      await props.removeWorktree(target.repositoryId, target.path, force, new AbortController().signal)
      setPending(undefined)
      setNotice(t('removeDone', { path: target.path }))
      setRefreshToken(token => token + 1)
    } catch (error: unknown) {
      setFailure(error)
      setPending(undefined)
    } finally {
      setBusy(false)
    }
  }

  function requestRemoval(repositoryId: string, row: WorktreeRow): void {
    // Every removal confirms before it runs (R8). A clean checkout still gets
    // the step: the confirmation is what the user is agreeing to, and the Host
    // re-reads the working tree before acting, so a row that went dirty since
    // this page was read is refused rather than deleted unseen.
    setNotice(undefined)
    setAcknowledged(false)
    setPending({
      repositoryId,
      path: row.path,
      files: row.dirtyFiles,
      ignoredCount: row.ignoredFiles.length,
      stale: row.stale,
    })
  }

  const selected = repositories?.find(row => row.id === selectedId)

  // Losing a change is not the same as deleting a directory: the dialog only
  // asks for an acknowledgement when something is actually at risk.
  const atRisk = pending !== undefined && (pending.files.length > 0 || pending.ignoredCount > 0)

  return <section className={css.section}>
    <header className={css.header}>
      <div>
        <h3 className={css.title}>
          <IconBranchOutlineRegular className={css.titleGlyph} size={14} />
          {t('section')}
        </h3>
        <p className={css.hint}>{t('sectionHint')}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        icon={<IconRefreshOutlineRegular size={14} />}
        disabled={busy}
        onClick={refresh}
      >{t('refresh')}</Button>
    </header>

    {failure !== undefined && <p role="status" className={css.notice}>{describeFailure(failure, t('failed'))}</p>}
    {notice !== undefined && <p role="status" className={css.notice}>{notice}</p>}

    {repositories === undefined && <p className={css.notice}>{t('loading')}</p>}

    {repositories !== undefined && repositories.length === 0 && <p className={css.notice}>{t('repositoriesEmpty')}</p>}

    {repositories !== undefined && repositories.length > 0 && <div className={css.panes}>
      <div>
        <p className={css.paneLabel}><span className={css.paneLabelText}>{t('repositories')}</span></p>
        <ul className={css.repositoryList}>
          {repositories.map(repository => <li key={repository.id}>
            <button
              type="button"
              className={css.repositoryButton}
              aria-current={repository.id === selectedId}
              onClick={() => { setSelectedId(repository.id); setPending(undefined) }}
            >
              <span className={css.repositoryName}>{repository.title}</span>
              <span className={css.repositoryCount}>{repository.worktrees.length}</span>
            </button>
          </li>)}
        </ul>
      </div>

      <div className={css.worktreePane}>
        {selected === undefined
          ? <p className={css.notice}>{t('selectRepository')}</p>
          : <>
            <div className={css.paneLabel}>
              <span className={css.paneLabelText}>{t('worktreesIn', { repository: selected.title })}</span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void runPrune(selected.id) }}>
                {t('prune')}
              </Button>
            </div>
            {selected.worktrees.length === 0
              ? <p className={css.notice}>{t('worktreesEmpty')}</p>
              : <table className={css.table}>
                <thead>
                  <tr>
                    <th>{t('branch')}</th>
                    <th className={css.changesCell}>{t('changes')}</th>
                    <th className={css.sourceCell}>{t('source')}</th>
                    <th className={css.actionsCell} />
                  </tr>
                </thead>
                <tbody>
                  {selected.worktrees.map(row => <WorktreeTableRow
                    key={row.path}
                    row={row}
                    busy={busy}
                    copied={copied === row.path}
                    t={t}
                    reveal={reveal}
                    onCopy={copyPath}
                    onReveal={showInFileManager}
                    onRemove={() => { requestRemoval(selected.id, row) }}
                  />)}
                </tbody>
              </table>}
          </>}
      </div>
    </div>}

    {pending !== undefined && <Modal
      open
      onClose={() => { setPending(undefined) }}
      title={t('removeConfirm')}
      closeLabel={t('removeCancel')}
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={() => { setPending(undefined) }}>
            {t('removeCancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || (atRisk && !acknowledged)}
            onClick={() => { void submitRemoval(pending, atRisk) }}
          >
            {t('removeConfirmAction')}
          </Button>
        </>
      )}
    >
      <p className={css.hint}>{pending.path} — {t('removeConfirmHint')}</p>
      {pending.stale && <p className={css.hint}>{t('staleCardHint')}</p>}
      {pending.files.length > 0 && <>
        <p className={css.hint}>{t('removeLostFiles')}</p>
        <ul className={css.files}>
          {pending.files.map(file => <li key={file}>{file}</li>)}
        </ul>
      </>}
      {pending.ignoredCount > 0 && <p className={css.hint}>
        {t('removeLostIgnored', { count: pending.ignoredCount })}
      </p>}
      {atRisk && <label className={css.acknowledge}>
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={busy}
          data-modal-autofocus
          onChange={(event) => { setAcknowledged(event.currentTarget.checked) }}
        />
        <span>{t('removeAcknowledge')}</span>
      </label>}
    </Modal>}
  </section>
}
