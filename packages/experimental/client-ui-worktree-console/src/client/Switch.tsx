/**
 * The composer's worktree switch, in the tool row beside the plan and
 * permission controls.
 *
 * It renders for two states. An empty Session gets a toggle that arms it so
 * its first step materializes a worktree. A Session whose armed step the Host
 * refused gets the reason: the arm is spent and the turn ends before the model
 * is called, so that reason is the only trace the attempt left, and it is
 * re-read when the run ends. A Session already in a worktree says nothing here
 * — naming the branch is the context strip's job, one row below the composer,
 * and printing it twice made the tool row claim a fact the strip then repeated.
 * A Session that is neither renders nothing: the tool row is not the place to
 * explain what the user cannot do here.
 *
 * Arming also asks *what to start from*. The choice appears only once the
 * intent exists: an unchecked box has nothing to qualify yet, and a base picker
 * waiting beside it would read as a setting the user has to get right before
 * the checkbox means anything.
 * @module @deepseek-ai/dsh-experimental-client-ui-worktree-console/src/client/Switch
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { BranchChoices, WorktreeSessionState } from '@deepseek-ai/dsh-experimental-worktree-console/types'
import { BasePicker } from './BasePicker.tsx'
import { describeFailure, type SwitchInjected } from './face.ts'
import { NS } from './locales.ts'
import css from './Switch.module.css'

/** Runtime share (session kit), the Remote face, and the locale seat. */
export type WorktreeSwitchProps =
  & PropsRuntime<'conversation.input.left'>
  & InjectFace<SwitchInjected>
  & PropsLocale<typeof NS>

export function WorktreeSwitch(props: WorktreeSwitchProps) {
  return <SessionSwitch key={props.sessionId} {...props} />
}

function SessionSwitch(props: WorktreeSwitchProps) {
  const { sessionId, t } = props
  const blank = props.useSession(value => value.blank)
  const running = props.useSession(value => value.running)
  const [state, setState] = useState<WorktreeSessionState | undefined>(undefined)
  const [failure, setFailure] = useState<unknown>(undefined)
  const [busy, setBusy] = useState(false)
  const [choices, setChoices] = useState<BranchChoices | undefined>(undefined)
  const base = state?.request?.from

  const alive = useRef(true)
  const face = useRef(props)
  face.current = props
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  /** One read of the Session's arming state, cancellable with the caller. */
  const readState = useCallback((signal: AbortSignal): void => {
    void face.current.state(sessionId, signal).then(
      (next) => { if (alive.current && !signal.aborted) setState(next) },
      (error: unknown) => { if (alive.current && !signal.aborted) setFailure(error) },
    )
  }, [sessionId])

  useEffect(() => {
    const controller = new AbortController()
    readState(controller.signal)
    return () => { controller.abort() }
  }, [readState])

  // The Host spends the arm before attempting the step, and a refused step ends
  // the turn before the model is ever called. So the reason for a refusal lives
  // only in this reading, and only the end of the run says to read it again:
  // without that, a refused arming is a turn that completes with nothing in it.
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
    readState(controller.signal)
    return () => { controller.abort() }
  }, [readState, running])

  // The list is read only while the picker can be on screen. A bare session
  // that was never armed has no base to show, and reading for it would spend a
  // Git call on every mount of every conversation's tool row.
  const armed = state?.armed === true
  useEffect(() => {
    if (!armed) return
    const controller = new AbortController()
    void (async () => {
      try {
        const next = await face.current.branches(sessionId, controller.signal)
        if (alive.current && !controller.signal.aborted) setChoices(next)
      } catch (error: unknown) {
        if (alive.current && !controller.signal.aborted) setFailure(error)
      }
    })()
    return () => { controller.abort() }
  }, [sessionId, armed])

  // Nothing is known yet, so nothing is claimed: a toggle that guesses would
  // flicker between armed and not on every mount. A read that FAILED is not
  // "nothing known" though — reporting it only past this return is what let an
  // unreachable Host look exactly like a plugin that never loaded.
  if (state === undefined) {
    return failure === undefined ? null : <span className={css.wrap}>
      <span className={css.failure} role="status">{describeFailure(failure, t('failed'))}</span>
    </span>
  }

  // A refused arming is spent: the Host already deleted the intent, and the
  // Session is no longer empty, so there is nothing a toggle could arm. The row
  // says why instead — including once the Session has left the blank state,
  // which is the only place this reason ever appears.
  if (state.failure !== null) {
    const reason = t('switchArmFailed', { reason: state.failure })
    return <span className={css.wrap} data-worktree-switch>
      <span className={css.failure} role="status" title={reason}>{reason}</span>
    </span>
  }

  if (!blank) return null

  /** Send one arm call and fold its outcome into the switch's own state. */
  const rearm = (from: string | undefined): void => {
    setBusy(true)
    setFailure(undefined)
    const signal = new AbortController().signal
    void face.current
      .arm(sessionId, from === undefined ? {} : { from }, signal)
      .then(
        (value) => { if (alive.current) setState(value) },
        (error: unknown) => { if (alive.current) setFailure(error) },
      )
      .finally(() => { if (alive.current) setBusy(false) })
  }

  // Arming is an intent the user sets and sees set: a checkbox says "this is
  // on" the moment it is checked, where a button that only tints its border
  // reads as a label that happens to be clickable.
  const toggle = (checked: boolean): void => {
    if (!checked) {
      setBusy(true)
      setFailure(undefined)
      const signal = new AbortController().signal
      void face.current.disarm(sessionId, signal).then(
        (value) => { if (alive.current) setState(value) },
        (error: unknown) => { if (alive.current) setFailure(error) },
      ).finally(() => { if (alive.current) setBusy(false) })
      return
    }
    rearm(base)
  }

  const select = (revision: string | undefined): void => {
    rearm(revision)
  }

  return <span className={css.wrap}>
    <Checkbox
      className={css.switch}
      checked={state.armed}
      disabled={busy}
      label={t('switchLabel')}
      title={t('switchHint')}
      onChange={toggle}
    />
    {state.armed && <BasePicker
      base={base}
      choices={choices}
      busy={busy}
      hint={t('switchBaseHint')}
      label={t('switchBase')}
      headLabel={t('switchBaseHead')}
      localLabel={t('switchBaseLocal')}
      remoteLabel={t('switchBaseRemote')}
      currentLabel={branch => t('switchBaseCurrent', { branch })}
      searchLabel={t('switchBaseSearch')}
      clearLabel={t('switchBaseSearchClear')}
      noMatch={t('switchBaseNoMatch')}
      noChoices={t('switchBaseNoChoices')}
      noRepository={t('switchBaseNone')}
      onSelect={select}
    />}
    {failure !== undefined && <span className={css.failure} role="status">
      {describeFailure(failure, t('failed'))}
    </span>}
  </span>
}
