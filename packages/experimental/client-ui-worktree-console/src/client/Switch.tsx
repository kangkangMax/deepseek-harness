/**
 * The composer's worktree switch, in the tool row beside the plan and
 * permission controls.
 *
 * Two states share one seat: an empty Session gets a toggle that arms it so its
 * first step materializes a worktree, and a Session already in one gets a
 * read-only badge naming the branch. A Session that is neither renders nothing
 * — the tool row is not the place to explain what the user cannot do here.
 *
 * Arming also asks *what to start from*. The choice appears only once the
 * intent exists: an unchecked box has nothing to qualify yet, and a base picker
 * waiting beside it would read as a setting the user has to get right before
 * the checkbox means anything.
 * @module @deepseek-ai/dsh-experimental-client-ui-worktree-console/src/client/Switch
 */

import { useEffect, useRef, useState } from 'react'
import { Checkbox, Menu, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { BranchChoices, BranchKind, WorktreeSessionState } from '@deepseek-ai/dsh-experimental-worktree-console/types'
import { describeFailure, type SwitchInjected } from './face.ts'
import { NS } from './locales.ts'
import css from './Switch.module.css'

/**
 * Menu id of the row that names no revision, so the armed step resolves HEAD
 * for itself. Resolving it later is the point: a base pinned to today's HEAD
 * would quietly ignore a commit the user makes before sending.
 */
const HEAD_ID = 'head'

/**
 * Prefix on every branch row. Branch names are free-form, so a branch literally
 * called `head` must land on its own id rather than on {@link HEAD_ID}.
 */
const BRANCH_PREFIX = 'branch:'

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
  const [choices, setChoices] = useState<BranchChoices | undefined>(undefined)
  /** Explicit base revision, or undefined while the step is left to resolve HEAD. */
  const [base, setBase] = useState<string | undefined>(undefined)
  const [open, setOpen] = useState(false)

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

  if (state.worktree !== null) {
    return <span className={css.wrap}>
      <Tag tone="neutral">{t('switchWorking', { branch: state.worktree.branch })}</Tag>
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
      setBase(undefined)
      setOpen(false)
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

  const entries: MenuEntry[] = [{ id: HEAD_ID, label: t('switchBaseHead') }]
  if (choices !== undefined) {
    if (choices.repositoryRoot === null) {
      entries.push({ type: 'separator', id: 'branches' }, { type: 'label', id: 'none', text: t('switchBaseNone') })
    } else {
      /**
       * One heading per namespace, and only when that namespace has rows: a
       * local branch and its remote-tracking namesake are different revisions,
       * so the heading is what says which one a row names — while a repository
       * with no remote has nothing to head, and the HEAD row above still gives
       * the picker something to say.
       */
      const group = (id: string, kind: BranchKind, text: string): MenuEntry[] => {
        const matching = choices.branches.filter(branch => branch.kind === kind)
        if (matching.length === 0) return []
        return [
          { type: 'separator', id },
          { type: 'label', id: `${id}-label`, text },
          ...matching.map(branch => ({
            id: `${BRANCH_PREFIX}${branch.name}`,
            label: branch.current ? t('switchBaseCurrent', { branch: branch.name }) : branch.name,
          })),
        ]
      }
      entries.push(...group('branches', 'local', t('switchBaseLocal')), ...group('remotes', 'remote', t('switchBaseRemote')))
    }
  }

  const select = (id: string): void => {
    setOpen(false)
    const next = id.startsWith(BRANCH_PREFIX) ? id.slice(BRANCH_PREFIX.length) : undefined
    setBase(next)
    rearm(next)
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
    {state.armed && <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      // Portalled and opened upward for the same reason the permission chip
      // beside it is: the tool row sits at the bottom of a card that clips.
      side="top"
      portal
      anchor={<button
        type="button"
        className={css.base}
        title={t('switchBaseHint')}
        disabled={busy}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className={css.baseLabel}>{t('switchBase')}</span>
        <span className={css.baseValue}>{base ?? t('switchBaseHead')}</span>
      </button>}
      items={entries}
      selectedId={base === undefined ? HEAD_ID : `${BRANCH_PREFIX}${base}`}
      onSelect={select}
    />}
    {state.failure !== null && <span className={css.failure} role="status">
      {t('switchArmFailed', { reason: state.failure })}
    </span>}
    {failure !== undefined && <span className={css.failure} role="status">
      {describeFailure(failure, t('failed'))}
    </span>}
  </span>
}
