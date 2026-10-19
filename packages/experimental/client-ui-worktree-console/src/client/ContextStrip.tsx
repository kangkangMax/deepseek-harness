/**
 * The composer's context strip: the branch this Session will run in, printed
 * below the input.
 *
 * It answers one question — "where am I about to work?" — so it carries no
 * controls. The worktree switch above it decides *whether* to isolate; this
 * line only reports the outcome of that decision, plus the ordinary case of a
 * Session that was never isolated at all.
 *
 * One value is printed. The branch is the shortest answer and the only one that
 * changes between Sessions on the same repository. The checkout directory is
 * long enough to push the rest of the row off, so it rides a tooltip on the
 * branch: no width until asked for, and its last segment names the repository
 * anyway. Nothing about the repository is stated anywhere else — the line says
 * the branch and stops, rather than repeating a name the path already carries.
 * It reads again when a run ends, because a run is the only thing that can move
 * this Session onto another branch.
 * @module @deepseek-ai/dsh-experimental-client-ui-worktree-console/src/client/ContextStrip
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {
  BranchChoices, WorktreeSessionState,
} from '@deepseek-ai/dsh-experimental-worktree-console/types'
import type { SwitchInjected } from './face.ts'
import { NS } from './locales.ts'
import css from './ContextStrip.module.css'

/** Runtime share (session kit), the Remote face, and the locale seat. */
export type WorktreeContextProps =
  & PropsRuntime<'conversation.composer.dock'>
  & InjectFace<SwitchInjected>
  & PropsLocale<typeof NS>

export function WorktreeContext(props: WorktreeContextProps) {
  const { sessionId, t } = props
  const running = props.useSession(value => value.running)
  const [state, setState] = useState<WorktreeSessionState | undefined>(undefined)
  const [choices, setChoices] = useState<BranchChoices | undefined>(undefined)

  const alive = useRef(true)
  const face = useRef(props)
  face.current = props
  useEffect(() => () => { alive.current = false }, [])

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
      } catch {
        // This strip is a reading, not an affordance: it offers nothing to
        // retry, so a failed read leaves the line out rather than printing a
        // fault the user cannot act on. The switch above reports its own.
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

  if (state === undefined || choices === undefined) return null
  // A Session outside every repository has no branch to report, and a row
  // saying so would be a permanent line for a case the user already knows.
  if (choices.repositoryRoot === null) return null

  // `current` is the branch checked out in the directory Git resolved, which is
  // why it is trusted over recomputing one here. A detached checkout marks no
  // branch at all, and says so instead of showing a wrong name.
  const branch = choices.branches.find(option => option.current)?.name
    ?? state.worktree?.branch
    ?? null
  const label = branch ?? t('detached')

  // The hover names the checkout itself, which is the same answer as "which
  // repository" plus where it is: an isolated Session's directory is a worktree
  // folder, and that is the directory the Session actually runs in.
  return <Tooltip label={choices.repositoryRoot} side="top" maxWidth={440} portal>
    <span className={css.root}>
      <svg className={css.icon} viewBox="0 0 16 16" width="12" height="12" aria-hidden>
        <circle cx="4.5" cy="3.6" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="4.5" cy="12.4" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="11.5" cy="6.6" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4.5 5.2v5.6M11.5 8.2c0 2-1.6 2.6-3.2 2.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className={css.branch}>{label}</span>
    </span>
  </Tooltip>
}
