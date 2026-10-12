/**
 * The worktree management section of the Plugins page: the repositories of the
 * profile on the left, the selected repository's worktrees on the right, and
 * the two repairs — clear stale registrations, and remove one worktree.
 *
 * The section renders on one bundle's page and returns nothing for every other
 * subject, so it never competes with a plugin's own configuration.
 * @module @deepseek-ai/dsh-experimental-client-ui-worktree-console/src/client/Console
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {
  RepositoryRows, WorktreeOrigin, WorktreeRow,
} from '@deepseek-ai/dsh-experimental-worktree-console/types'
import { describeFailure, type ConsoleInjected } from './face.ts'
import { NS } from './locales.ts'
import css from './Console.module.css'

/** The bundle whose detail page carries this section. */
export const BUNDLE_NAME = '@deepseek-ai/dsh-experimental-worktree-console-bundle'

/** Owner props, dictionaries, and the Host face this section renders from. */
export type ConsoleProps =
  & PropsRuntime<'plugins.detail.section'>
  & PropsLocale<typeof NS>
  & InjectFace<ConsoleInjected>

/** One removal the user has not confirmed yet. */
interface PendingRemoval {
  readonly repositoryId: string
  readonly path: string
  readonly files: readonly string[]
}

/** Shorten a commit for the table without hiding which commit it is. */
function shortCommit(commit: string): string {
  return commit.slice(0, 8)
}

/** The section as the Plugins page registers it: silent for other subjects. */
export function WorktreeConsoleSection(props: ConsoleProps) {
  const { subject } = props
  if (subject.kind !== 'bundle' || subject.pkg.name !== BUNDLE_NAME) return null
  return <Console {...props} />
}

function originLabel(origin: WorktreeOrigin, t: ConsoleProps['t']): string {
  switch (origin) {
    case 'official': return t('originOfficial')
    case 'third-party': return t('originThirdParty')
    default: return t('originManual')
  }
}

function Console(props: ConsoleProps) {
  const { t } = props
  const [repositories, setRepositories] = useState<readonly RepositoryRows[] | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState<PendingRemoval | undefined>(undefined)
  const [failure, setFailure] = useState<unknown>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
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
        setSelectedId(current => current ?? snapshot.repositories[0]?.id)
      } catch (error: unknown) {
        if (!controller.signal.aborted) setFailure(error)
      }
    })()
    return () => { controller.abort() }
  }, [refreshToken])

  const refresh = useCallback(() => {
    setFailure(undefined)
    setNotice(undefined)
    setRefreshToken(token => token + 1)
  }, [])

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
      await props.remove(target.repositoryId, target.path, force, new AbortController().signal)
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
    setPending({ repositoryId, path: row.path, files: row.dirtyFiles })
  }

  const selected = repositories?.find(row => row.id === selectedId)

  return <section className={css.section}>
    <header className={css.header}>
      <div>
        <h3 className={css.title}>{t('section')}</h3>
        <p className={css.hint}>{t('sectionHint')}</p>
      </div>
      <Button size="sm" disabled={busy} onClick={refresh}>{t('refresh')}</Button>
    </header>

    {failure !== undefined && <p role="status" className={css.notice}>{describeFailure(failure, t('failed'))}</p>}
    {notice !== undefined && <p role="status" className={css.notice}>{notice}</p>}

    {repositories === undefined && <p className={css.notice}>{t('loading')}</p>}

    {repositories !== undefined && repositories.length === 0 && <p className={css.notice}>{t('repositoriesEmpty')}</p>}

    {repositories !== undefined && repositories.length > 0 && <div className={css.columns}>
      <div>
        <p className={css.hint}>{t('repositories')}</p>
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

      <div>
        {selected === undefined
          ? <p className={css.notice}>{t('selectRepository')}</p>
          : <>
            <div className={css.toolbar}>
              <span className={css.hint}>{t('worktrees')}</span>
              <Button size="sm" disabled={busy} onClick={() => { void runPrune(selected.id) }}>{t('prune')}</Button>
            </div>
            {selected.worktrees.length === 0
              ? <p className={css.notice}>{t('worktreesEmpty')}</p>
              : <table className={css.table}>
                <thead>
                  <tr>
                    <th>{t('branch')}</th>
                    <th>{t('head')}</th>
                    <th>{t('changes')}</th>
                    <th>{t('source')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {selected.worktrees.map(row => <tr key={row.path}>
                    <td>
                      <div>{row.branch ?? t('detached')}</div>
                      <div className={css.path}>{row.path}</div>
                      {row.stale && <p className={css.notice}>{t('stale')} — {t('staleHint')}</p>}
                    </td>
                    <td className={css.commit}>{shortCommit(row.head)}</td>
                    <td>
                      {row.dirtyFiles.length === 0
                        ? <span className={css.badges}><Tag tone="neutral">{t('changedCount', { count: 0 })}</Tag></span>
                        : t('changedCount', { count: row.dirtyFiles.length })}
                    </td>
                    <td>{originLabel(row.origin, t)}</td>
                    <td>
                      {row.locked && <Tag tone="neutral">{t('locked')}</Tag>}
                      {!row.stale && !row.locked && <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => { requestRemoval(selected.id, row) }}
                      >{t('remove')}</Button>}
                    </td>
                  </tr>)}
                </tbody>
              </table>}
          </>}
      </div>
    </div>}

    {pending !== undefined && <div className={css.confirm} role="alertdialog" aria-label={t('removeConfirm')}>
      <strong>{t('removeConfirm')}</strong>
      <p className={css.hint}>{pending.path} — {t('removeConfirmHint')}</p>
      {pending.files.length > 0 && <>
        <p className={css.hint}>{t('removeLostFiles')}</p>
        <ul className={css.files}>
          {pending.files.map(file => <li key={file}>{file}</li>)}
        </ul>
      </>}
      <div className={css.confirmActions}>
        <Button size="sm" disabled={busy} onClick={() => { void submitRemoval(pending, pending.files.length > 0) }}>
          {t('removeConfirmAction')}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => { setPending(undefined) }}>{t('removeCancel')}</Button>
      </div>
    </div>}
  </section>
}
