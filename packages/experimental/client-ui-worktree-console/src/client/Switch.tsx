/**
 * The composer's worktree switch, in the tool row beside the plan and
 * permission controls.
 *
 * Two states share one seat: an empty Session gets a toggle that arms it so its
 * first step materializes a worktree, and a Session already in one gets a
 * read-only badge naming the branch. A Session that is neither renders nothing
 * — the tool row is not the place to explain what the user cannot do here.
 * @module @deepseek-ai/dsh-experimental-client-ui-worktree-console/src/client/Switch
 */

import { useEffect, useRef, useState } from 'react'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { WorktreeSessionState } from '@deepseek-ai/dsh-experimental-worktree-console/types'
import { describeFailure, type SwitchInjected } from './console.ts'
import { NS } from './locales.ts'
import css from './Switch.module.css'

/** Runtime share (session kit), the Remote face, and the locale seat. */
export type WorktreeSwitchProps =
  & PropsRuntime<'conversation.input.left'>
  & InjectFace<SwitchInjected>
  & PropsLocale<typeof NS>

export function WorktreeSwitch(props: WorktreeSwitchProps) {
  const { sessionId, t } = props
  const blank = props.useSession(value => value.blank)
  const [state, setState] = useState<WorktreeSessionState | undefined>(undefined)
  const [failure, setFailure] = useState<unknown>(undefined)
  const [busy, setBusy] = useState(false)

  const alive = useRef(true)
  const face = useRef(props)
  face.current = props
  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const next = await face.current.state(sessionId, controller.signal)
        if (alive.current && !controller.signal.aborted) setState(next)
      } catch (error: unknown) {
        if (alive.current && !controller.signal.aborted) setFailure(error)
      }
    })()
    return () => { controller.abort() }
  }, [sessionId])

  // Nothing is known yet, so nothing is claimed: a toggle that guesses would
  // flicker between armed and not on every mount.
  if (state === undefined) return null

  if (state.worktree !== null) {
    return <span className={css.wrap}>
      <Tag tone="neutral">{t('switchWorking', { branch: state.worktree.branch })}</Tag>
    </span>
  }

  if (!blank) return null

  const armed = state.armed
  const toggle = (): void => {
    setBusy(true)
    setFailure(undefined)
    const signal = new AbortController().signal
    const next = armed
      ? face.current.disarm(sessionId, signal)
      : face.current.arm(sessionId, {}, signal)
    void next.then(
      (value) => { if (alive.current) setState(value) },
      (error: unknown) => { if (alive.current) setFailure(error) },
    ).finally(() => { if (alive.current) setBusy(false) })
  }

  return <span className={css.wrap}>
    <button
      type="button"
      className={css.chip}
      aria-pressed={armed}
      aria-label={t('switchHint')}
      title={t('switchHint')}
      disabled={busy}
      onClick={toggle}
    >{t('switchLabel')}</button>
    {state.failure !== null && <span className={css.failure} role="status">
      {t('switchArmFailed', { reason: state.failure })}
    </span>}
    {failure !== undefined && <span className={css.failure} role="status">
      {describeFailure(failure, t('failed'))}
    </span>}
  </span>
}
