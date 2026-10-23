/** Session header branch with directory details and actions; rereads after each run. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { HoverCard, IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {
  BranchChoices, WorktreeSessionState,
} from '@deepseek-ai/dsh-experimental-worktree-console/types'
import { describeFailure, type ContextInjected } from './face.ts'
import { DirectoryActions } from './DirectoryActions.tsx'
import { NS } from './locales.ts'
import css from './ContextStrip.module.css'

/** Runtime share (session kit), the Remote face, and the locale seat. */
export type WorktreeContextProps =
  & PropsRuntime<'conversation.session.header.actions'>
  & InjectFace<ContextInjected>
  & PropsLocale<typeof NS>

export function WorktreeContext(props: WorktreeContextProps) {
  return <SessionContext key={props.sessionId} {...props} />
}

function SessionContext(props: WorktreeContextProps) {
  const { sessionId, t } = props
  const running = props.useSession(value => value.running)
  const [state, setState] = useState<WorktreeSessionState | undefined>(undefined)
  const [choices, setChoices] = useState<BranchChoices | undefined>(undefined)
  const [failure, setFailure] = useState<unknown>(undefined)

  const alive = useRef(true)
  const face = useRef(props)
  face.current = props
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  /** Read both answers, and report neither unless both land. */
  const read = useCallback((signal: AbortSignal): void => {
    void (async () => {
      try {
        const [nextState, nextChoices] = await Promise.all([
          face.current.state(sessionId, signal),
          face.current.branches(sessionId, signal),
        ])
        if (!alive.current || signal.aborted) return
        setState(nextState)
        setChoices(nextChoices)
        setFailure(undefined)
      } catch (error: unknown) {
        if (alive.current && !signal.aborted) setFailure(error)
      }
    })()
  }, [sessionId])

  useEffect(() => {
    // Drop the previous Session's answer first: switching conversations must
    // not leave the strip naming a branch the new one is not on.
    setState(undefined)
    setChoices(undefined)
    const controller = new AbortController()
    read(controller.signal)
    return () => { controller.abort() }
  }, [read])

  // A run that materialized a worktree moved this Session to a new branch, and
  // nothing but the run's end says so. Without the re-read the line keeps
  // naming the repository's own checkout for the rest of the Session, which is
  // the one thing it exists not to do.
  const ranFor = useRef(false)
  useEffect(() => {
    if (running) {
      ranFor.current = true
      return
    }
    const spent = ranFor.current
    ranFor.current = false
    if (!spent) return
    const controller = new AbortController()
    read(controller.signal)
    return () => { controller.abort() }
  }, [read, running])

  if (failure !== undefined) return <span className={css.root} role="status">
    {describeFailure(failure, t('failed'))}
  </span>
  if (state === undefined || choices === undefined) return null
  // A Session outside every repository has no branch to report, and a row
  // saying so would be a permanent line for a case the user already knows.
  if (choices.repositoryRoot === null) return null

  // `current` is the branch checked out in the directory Git resolved, which is
  // why it is trusted over recomputing one here. A detached checkout marks no
  // branch at all, and says so instead of showing a wrong name.
  const branch = choices.branches.find(option => option.current)?.name
    ?? null
  const label = branch ?? t('detached')

  const details = <div className={css.details} role="region" aria-label={t('directory')}>
    <p className={css.branchName}>{label}</p>
    <p className={css.detailLabel}>{t('directory')}</p>
    <p className={css.path}>{choices.repositoryRoot}</p>
    <DirectoryActions key={choices.repositoryRoot} path={choices.repositoryRoot} t={t} reveal={props.reveal} notify={props.notify} />
  </div>
  return <HoverCard inline openDelayMs={200} anchor={
    <span className={css.root} tabIndex={0} data-worktree-context="">
      <IconBranchOutlineRegular className={css.icon} size={13} />
      <span className={css.branch}>{label}</span>
    </span>
  } content={details} />
}
