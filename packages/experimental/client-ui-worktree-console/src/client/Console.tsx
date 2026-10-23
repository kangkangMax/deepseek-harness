/** Collapsible repository worktree inventories with details and confirmed removal. */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconBranchOutlineRegular, IconChevronRightOutlineRegular, IconCloseOutlineRegular,
  IconFolderOpenOutlineRegular, IconRefreshOutlineRegular, IconWarningTriangleOutlineRegular,
  Modal, StateDot, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {
  RepositoryRows, WorktreeOrigin, WorktreeRow,
} from '@deepseek-ai/dsh-experimental-worktree-console/types'
import { describeFailure, type ConsoleInjected } from './face.ts'
import { DirectoryActions } from './DirectoryActions.tsx'
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
  readonly sessionIds: readonly string[]
}

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

/**
 * Characters kept on each side of an over-long branch name.
 *
 * A row is identified by its branch, and CSS ellipsis cuts from the right —
 * which is exactly where the pool's random suffix lives. Five rows reading
 * `worktree-1e…`, `worktree-5…`, `worktree-5…` are five rows the user cannot
 * tell apart, which defeats the column's only job. Keeping the head says which
 * namespace the branch belongs to and the tail says which one it is; the middle
 * is the part nobody reads.
 *
 * Thirty-eight is above an ordinary branch name (`fix/darkfactory-upgrade-check`
 * is 29), so only machine-generated ones pay the ellipsis: those are the ones
 * whose head and tail both carry meaning and whose middle never does.
 */
const NAME_HEAD = 18
const NAME_TAIL = 19

/**
 * Shorten a branch name from the middle, so both ends stay readable.
 * @param branch - the branch name Git reported.
 * @returns the name unchanged when it fits, otherwise head + ellipsis + tail.
 */
function middleTruncate(branch: string): string {
  if (branch.length <= NAME_HEAD + NAME_TAIL + 1) return branch
  return `${branch.slice(0, NAME_HEAD)}…${branch.slice(-NAME_TAIL)}`
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

/** The row opens details; operation buttons retain their independent actions. */
function WorktreeTableRow({ row, busy, t, reveal, notify, onRemove }: {
  row: WorktreeRow
  busy: boolean
  t: ConsoleProps['t']
  reveal: ((path: string) => Promise<boolean>) | undefined
  notify: ConsoleInjected['notify']
  onRemove: () => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const refusal = removalRefusal(row)
  return <tr
    tabIndex={0}
    onClick={(event) => {
      if (event.target instanceof Node && !event.currentTarget.contains(event.target)) return
      if (event.target instanceof Element && event.target.closest('button') !== null) return
      setDetailsOpen(true)
    }}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
      event.preventDefault()
      setDetailsOpen(true)
    }}
  >
    <td className={css.branchCell}>
      <button type="button" className={css.branch} onClick={() => { setDetailsOpen(true) }}>
        <IconBranchOutlineRegular className={css.branchGlyph} size={13} />
        {row.branch === null
          ? <>
            <span className={css.detached}>{t('detached')}</span>
            <span className={css.tail}>{pathTail(row.path)}</span>
          </>
          : <span className={css.name} title={row.branch}>{middleTruncate(row.branch)}</span>}
        {row.primary && <Tag tone="neutral">{t('primary')}</Tag>}
        {row.locked && <Tag tone="outline">{t('locked')}</Tag>}
        {row.outsideRepository && <span className={css.mark} title={t('outsideRepositoryHint')}>
          <Tag tone="outline">{t('outsideRepository')}</Tag>
        </span>}
        {row.stale && <span className={css.mark} title={t('staleHint')}>
          <Tag tone="danger">{t('stale')}</Tag>
        </span>}
      </button>
      <p className={css.rowPath}>{row.path}</p>
      {detailsOpen && <Modal open headless className={clsx(css.detailsDialog)} onClose={() => { setDetailsOpen(false) }} title={row.branch ?? t('detached')}>
        <header className={css.detailsHeader}>
          <h2 className={css.detailsTitle}>{row.branch ?? t('detached')}</h2>
          <Button size="sm" variant="ghost" aria-label={t('close')} onClick={() => { setDetailsOpen(false) }}>
            <IconCloseOutlineRegular size={14} />
          </Button>
        </header>
        <div className={css.detailsBody}>
          <p className={css.cardPath}>{row.path}</p>
          <div className={css.metadata}>
            <span>{t('source')}: {originLabel(row.origin, t)}</span>
            <span>{t('head')}: <span>{shortCommit(row.head)}</span></span>
            {row.ignoredFiles.length > 0 && <span>{t('ignoredCount', { count: row.ignoredFiles.length })}</span>}
          </div>
          {row.stale && <p className={css.cardWarn}>
            <IconWarningTriangleOutlineRegular size={13} />
            <span>{t('staleCardHint')}</span>
          </p>}
        </div>
        <footer className={css.detailsFooter}>
          <DirectoryActions path={row.path} t={t} reveal={row.stale ? undefined : reveal} notify={notify} />
        </footer>
      </Modal>}
    </td>
    <td className={css.changesCell}>
      {row.stale
        ? <span className={css.dimmed}>—</span>
        : row.dirtyFiles.length === 0
          ? <Tag tone={row.ignoredFiles.length > 0 ? 'neutral' : 'success'}>{row.ignoredFiles.length > 0 ? t('ignoredCount', { count: row.ignoredFiles.length }) : t('clean')}</Tag>
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
      {refusal !== undefined && <span className={css.removalHint}>{t(refusal === 'primary' ? 'primaryProtected' : 'lockedProtected')}</span>}
    </td>
  </tr>
}

function RepositoryGroup({ repository, busy, t, reveal, notify, onPrune, onRemove }: {
  repository: RepositoryRows
  busy: boolean
  t: ConsoleProps['t']
  onPrune: (repositoryId: string) => void
  onRemove: (repositoryId: string, row: WorktreeRow) => void
} & Pick<ConsoleInjected, 'reveal' | 'notify'>) {
  const [expanded, setExpanded] = useState(true)
  const listId = useId()
  return <section className={css.repository}>
    <header className={css.repositoryHeader}>
      <button type="button" className={css.repositoryButton} aria-expanded={expanded} aria-controls={listId} onClick={() => { setExpanded(value => !value) }}>
        <IconChevronRightOutlineRegular size={13} className={css.expandGlyph} />
        <IconFolderOpenOutlineRegular size={15} />
        <span className={css.repositoryName}>{repository.title}</span>
        <span className={css.repositoryCount}>{t('worktreeCount', { count: repository.worktrees.length })}</span>
      </button>
      <Button size="sm" variant="outline" disabled={busy} title={t('pruneHint')} onClick={() => { onPrune(repository.id) }}>{t('prune')}</Button>
    </header>
    <div id={listId} className={css.worktreePane}>
      {expanded && (repository.worktrees.length === 0
        ? <p className={css.empty}>{t('worktreesEmpty')}</p>
        : <table className={css.table}>
          <thead><tr>
            <th>{t('branchDirectory')}</th>
            <th className={css.changesCell}>{t('changes')}</th>
            <th className={css.sourceCell}>{t('source')}</th>
            <th className={css.actionsCell}>{t('actions')}</th>
          </tr></thead>
          <tbody>{repository.worktrees.map(row => <WorktreeTableRow
            key={row.path} row={row} busy={busy} t={t} reveal={reveal} notify={notify}
            onRemove={() => { onRemove(repository.id, row) }}
          />)}</tbody>
        </table>)}
    </div>
  </section>
}

function Console(props: ConsoleProps) {
  const { t } = props
  const [repositories, setRepositories] = useState<readonly RepositoryRows[] | undefined>(undefined)
  const [pending, setPending] = useState<PendingRemoval | undefined>(undefined)
  // A destructive confirm is gated on its own acknowledgement, reset per target.
  const [acknowledged, setAcknowledged] = useState(false)
  const [sessionsAcknowledged, setSessionsAcknowledged] = useState(false)
  const [failure, setFailure] = useState<unknown>(undefined)
  const [busy, setBusy] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

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
      } catch (error: unknown) {
        if (!controller.signal.aborted) setFailure(error)
      }
    })()
    return () => { controller.abort() }
  }, [refreshToken])

  const refresh = useCallback(() => {
    setFailure(undefined)
    setRefreshToken(token => token + 1)
  }, [])

  async function runPrune(repositoryId: string): Promise<void> {
    setBusy(true)
    setFailure(undefined)
    try {
      const outcome = await props.prune(repositoryId, new AbortController().signal)
      props.notify(outcome.pruned.length === 0 ? t('pruneNone') : t('pruneDone', { count: outcome.pruned.length }))
      setRefreshToken(token => token + 1)
    } catch (error: unknown) {
      props.notify(describeFailure(error, t('failed')), true)
    } finally {
      setBusy(false)
    }
  }

  async function submitRemoval(target: PendingRemoval, force: boolean): Promise<void> {
    setBusy(true)
    setFailure(undefined)
    try {
      await props.removeWorktree(target.repositoryId, target.path, force, target.sessionIds, new AbortController().signal)
      setPending(undefined)
      props.notify(t('removeDone', { path: target.path }))
      setRefreshToken(token => token + 1)
    } catch (error: unknown) {
      const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined
      props.notify(
        code === 'worktree/sessions-unconfirmed' ? t('removeSessionsChanged')
          : code === 'worktree/session-access-denied' ? t('removeSessionsDenied')
            : code === 'worktree/session-archive-failed' ? t('removeSessionsFailed')
              : code === 'worktree/removal-incomplete' ? t('removeIncomplete')
                : describeFailure(error, t('failed')),
        true,
      )
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
    setAcknowledged(false)
    setSessionsAcknowledged(false)
    setPending({
      repositoryId,
      path: row.path,
      files: row.dirtyFiles,
      ignoredCount: row.ignoredFiles.length,
      stale: row.stale,
      sessionIds: row.sessionIds,
    })
  }


  // Losing a change is not the same as deleting a directory: the dialog only
  // asks for an acknowledgement when something is actually at risk.
  const atRisk = pending !== undefined && (pending.files.length > 0 || pending.ignoredCount > 0)

  return <section className={css.section} data-worktree-console>
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
    {repositories === undefined && failure === undefined && <div role="status" aria-label={t('loading')} className={css.loading}>
      <StateDot state="ongoing" />
    </div>}

    {repositories !== undefined && repositories.length === 0 && <p className={css.notice}>{t('repositoriesEmpty')}</p>}

    {repositories !== undefined && repositories.length > 0 && <div className={css.repositories}>
      {repositories.map(repository => <RepositoryGroup
        key={repository.id} repository={repository} busy={busy} t={t}
        reveal={props.reveal} notify={props.notify}
        onPrune={(id) => { void runPrune(id) }} onRemove={requestRemoval}
      />)}
    </div>}

    {pending !== undefined && <Modal
      open
      headless
      className={clsx(css.detailsDialog)}
      onClose={() => { if (!busy) setPending(undefined) }}
      title={t('removeConfirm')}
    >
      <header className={css.detailsHeader}>
        <h2 className={css.detailsTitle}>{t('removeConfirm')}</h2>
        <Button size="sm" variant="ghost" disabled={busy} aria-label={t('removeCancel')} onClick={() => { setPending(undefined) }}>
          <IconCloseOutlineRegular size={14} />
        </Button>
      </header>
      <div className={css.removalBody}>
        <section className={css.removalSection} aria-label={t('directory')}>
          <h3 className={css.removalLabel}>{t('directory')}</h3>
          <p className={css.cardPath}>{pending.path}</p>
          <p className={css.hint}>{t(pending.stale ? 'staleCardHint' : 'removeConfirmHint')}</p>
        </section>
        {pending.sessionIds.length > 0 && <section className={css.removalSection}>
          <p className={css.hint}>{t('removeSessionsHint', { count: pending.sessionIds.length })}</p>
          <label className={css.acknowledge}>
            <input
              type="checkbox"
              checked={sessionsAcknowledged}
              disabled={busy}
              onChange={(event) => { setSessionsAcknowledged(event.currentTarget.checked) }}
            />
            <span>{t('removeSessionsAcknowledge')}</span>
          </label>
        </section>}
        {atRisk && <section className={css.removalRisk}>
          {pending.files.length > 0 && <>
            <p className={css.hint}>{t('removeLostFiles')}</p>
            <ul className={css.files}>
              {pending.files.map(file => <li key={file}>{file}</li>)}
            </ul>
          </>}
          {pending.ignoredCount > 0 && <p className={css.hint}>
            {t('removeLostIgnored', { count: pending.ignoredCount })}
          </p>}
          <label className={css.acknowledge}>
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy}
              data-modal-autofocus
              onChange={(event) => { setAcknowledged(event.currentTarget.checked) }}
            />
            <span>{t('removeAcknowledge')}</span>
          </label>
        </section>}
      </div>
      <footer className={css.removalFooter}>
        <Button variant="outline" disabled={busy} onClick={() => { setPending(undefined) }}>
          {t('removeCancel')}
        </Button>
        <Button
          variant="primary"
          disabled={busy || (atRisk && !acknowledged) || (pending.sessionIds.length > 0 && !sessionsAcknowledged)}
          onClick={() => { void submitRemoval(pending, atRisk) }}
        >
          {t('removeConfirmAction')}
        </Button>
      </footer>
    </Modal>}
  </section>
}
