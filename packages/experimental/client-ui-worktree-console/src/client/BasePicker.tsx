/**
 * The composer's base picker: which revision a new worktree starts from.
 *
 * A repository with twenty branches cannot be scanned from a flat list, so the
 * card carries a search field above the rows. It is the combobox arrangement
 * the model picker uses (ui-model-selection ModelSelect): focus stays in the
 * field while ↑/↓ move the highlight and Enter settles it, so typing a
 * character never costs the user their place.
 *
 * The search is a filter, not a second source of truth. `rankByName` is the
 * shared ranking every menu query in the app uses, so a branch matches the way
 * a slash command does — an ordered subsequence, prefix hits first.
 *
 * Two facts the picker has to keep straight: HEAD is not a branch and resolves
 * at send time rather than now, and a local branch and its remote-tracking
 * namesake are different revisions. So HEAD stays pinned above the search
 * field — a query cannot hide the row that means "no base at all" — and the two
 * namespaces keep their own headings.
 *
 * One subtree is rendered on every path, including the ones with nothing to
 * list. A bare trigger while the branch read is in flight would be replaced
 * when the answer lands, taking any open card with it.
 * @module @deepseek-ai/dsh-experimental-client-ui-worktree-console/src/client/BasePicker
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconBranchOutlineRegular, IconCheckOutlineRegular, IconCloseFillRegular, IconSearchOutlineRegular,
  Input, MenuGroup, MenuSurface, observeStickyMenuGroups, rankByName,
  useAnchoredPosition,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { BranchChoices, BranchKind } from '@deepseek-ai/dsh-experimental-worktree-console/types'
import css from './BasePicker.module.css'

/**
 * Menu id of the row that names no revision, so the armed step resolves HEAD
 * for itself. Resolving it later is the point: a base pinned to today's HEAD
 * would quietly ignore a commit the user makes before sending.
 */
const HEAD_ID = 'head'

/** Prefix on every branch row, so a branch literally called `head` lands on its own id. */
const BRANCH_PREFIX = 'branch:'

/** How long the Host's list has to be before a search field earns its row. */
const SEARCH_THRESHOLD = 6

/**
 * The highlight's value while the HEAD row is the active one. HEAD is not a
 * branch, so it cannot take a branch index; `null` names it instead of -1,
 * which is already a branch position.
 */
const HEAD_SLOT = null

/** One row's identity and the text a query is matched against. */
interface Row {
  readonly id: string
  readonly name: string
  readonly revision: string
  readonly current: boolean
}

/** One namespace's rows under one heading. */
interface Group {
  readonly id: string
  readonly label: string
  readonly rows: readonly Row[]
}

/** Unplaced portal card: laid out but invisible, so the first painted frame is already placed. */
const MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 } as const

/** Props for the picker card and its trigger. */
export interface BasePickerProps {
  /** Revision the armed step will branch from; undefined means resolve HEAD at send. */
  readonly base: string | undefined
  /** Branches read for this Session, or undefined while the read is in flight. */
  readonly choices: BranchChoices | undefined
  /** The trigger is disabled while an arming call is in flight. */
  readonly busy: boolean
  /** Hover title for the trigger. */
  readonly hint: string
  /** Trigger's leading label. */
  readonly label: string
  /** Text shown when the Session's directory is in no repository. */
  readonly noRepository: string
  /** The default row's label. */
  readonly headLabel: string
  /** Namespace headings. */
  readonly localLabel: string
  readonly remoteLabel: string
  /** Row suffix marking the branch checked out in the Session's own directory. */
  readonly currentLabel: (branch: string) => string
  /** Search field placeholder. */
  readonly searchLabel: string
  /** Clears the query. */
  readonly clearLabel: string
  /** Copy shown when a query matches nothing. */
  readonly noMatch: string
  /** Copy shown when the repository has fewer branches than the search threshold. */
  readonly noChoices: string
  /** Settle one row. */
  readonly onSelect: (revision: string | undefined) => void
}

/**
 * Render the base trigger and, while open, the searchable card above it.
 * @param props - current base, the Session's branch choices, localized copy, and the settle callback.
 * @returns the trigger plus the conditional portaled card.
 */
export function BasePicker(props: BasePickerProps) {
  const { base, choices, busy } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  /**
 * The active row: `undefined` before the keyboard or the pointer has moved one,
 * `HEAD_SLOT` for the pinned HEAD row, otherwise an index into the flattened
 * branch rows.
 */
  const [highlight, setHighlight] = useState<number | null | undefined>(undefined)

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const headRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])
  const position = useAnchoredPosition({
    open: open && choices !== undefined,
    anchorRef: triggerRef,
    panelRef: cardRef,
    side: 'top',
    gap: 4,
    margin: 12,
  })
  /**
   * The pointerdown that opened the card. The dismissal listener is registered
   * from an effect, so it mounts while that press is still propagating and
   * would otherwise receive the press itself — closing the card the user just
   * opened and eating the first click of every opening.
   */
  const openingPress = useRef<Event | null>(null)
  const id = useId()

  const groups = useMemo((): readonly Group[] => {
    if (choices === undefined || choices.repositoryRoot === null) return []
    const build = (groupId: string, kind: BranchKind, label: string): Group | null => {
      const rows = choices.branches
        .filter(branch => branch.kind === kind)
        .map<Row>(branch => ({
          id: `${BRANCH_PREFIX}refs/${kind === 'local' ? 'heads' : 'remotes'}/${branch.name}`,
          name: branch.name,
          revision: `refs/${kind === 'local' ? 'heads' : 'remotes'}/${branch.name}`,
          current: branch.current,
        }))
      return rows.length === 0 ? null : { id: groupId, label, rows }
    }
    return [
      build('local', 'local', props.localLabel),
      build('remote', 'remote', props.remoteLabel),
    ].filter((group): group is Group => group !== null)
  }, [choices, props.localLabel, props.remoteLabel])

  // Every branch the query left out disappears from every group, so a group
  // whose rows are all filtered out takes its heading with it rather than
  // leaving an empty label over nothing.
  const visible = useMemo((): readonly Group[] => groups
    .map(group => ({ ...group, rows: rankByName(group.rows, query.trim()) }))
    .filter(group => group.rows.length > 0), [groups, query])

  const flat = useMemo((): readonly Row[] => visible.flatMap(group => group.rows), [visible])

  // A repository with few branches is scanned faster than it is searched, and
  // a search field over three rows is a field that never earns its space.
  const searchable = (choices?.branches.length ?? 0) > SEARCH_THRESHOLD
  const selectedId = base === undefined ? HEAD_ID : `${BRANCH_PREFIX}${base}`
  // Without a search field the walk has no text box to leave, so the card opens
  // on the pinned HEAD row — where focus lands and where ↑/↓ starts. With one,
  // the highlight stays unmoved and the first branch is the first ↓ stop.
  const activeIndex = flat.length === 0 || highlight === HEAD_SLOT || (highlight === undefined && query.trim() === '')
    ? -1
    : Math.min(highlight ?? 0, flat.length - 1)

  const close = useCallback((restoreFocus = false): void => {
    setOpen(false)
    setQuery('')
    setHighlight(undefined)
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }, [])

  const settleRow = useCallback((revision: string | undefined): void => {
    close(true)
    // Read through a ref rather than closing over `props`: the owner builds a
    // fresh props object every render, and a `settleRow` that changed with it
    // would re-register the dismissal listener on each of them.
    selectRef.current(revision)
  }, [close])

  const selectRef = useRef(props.onSelect)
  selectRef.current = props.onSelect

  // Opening puts the caret in the field when there is one: the first thing a
  // user does with twenty branches is type, and a focus that starts on the
  // trigger makes them click twice. Without a field, focus lands on the pinned
  // HEAD row, which is where the walk starts.
  useEffect(() => {
    if (!open) return
    if (searchable) {
      searchRef.current?.focus()
    } else {
      setHighlight(HEAD_SLOT)
      headRef.current?.focus()
    }
  }, [open, searchable, choices !== undefined])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (openingPress.current === event) {
        openingPress.current = null
        return
      }
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) === true) return
      if (cardRef.current?.contains(target) === true) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [open, close])

  // Sticky headings observe the scrolling element, which only exists once the
  // card is mounted; the effect re-runs per query so a filter that empties a
  // group releases the heading it was tracking.
  useEffect(() => {
    if (!open) return
    const list = listRef.current
    if (list === null) return
    return observeStickyMenuGroups(list)
  }, [open, query, visible])

  useLayoutEffect(() => {
    if (!open || activeIndex < 0) return
    const row = rowRefs.current[activeIndex]
    /* v8 ignore next 3 -- jsdom implements no layout, so the method is absent
       there; the optional call is what keeps the card mountable under test. */
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const onKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      if (event.repeat) return
      close(true)
      return
    }
    // Enter settles the highlighted row. Focus is in the search field, so
    // without this the key would submit nothing while a row sat highlighted
    // right below — the one gesture a search-first picker is built around.
    // With no field, focus is on a row and Enter is the browser's own click.
    if (event.key === 'Enter' && searchable) {
      event.preventDefault()
      if (flat.length === 0 && query.trim() !== '' && highlight !== HEAD_SLOT) return
      settleRow(activeIndex < 0 ? undefined : flat[activeIndex]?.revision)
      return
    }
    // Tab settles like Enter and Shift+Tab leaves like Escape, so the card's keys
    // mean what they mean in the composer.
    if (event.key === 'Tab') {
      event.preventDefault()
      if (event.shiftKey) {
        close(true)
        return
      }
      if (flat.length === 0 && query.trim() !== '' && highlight !== HEAD_SLOT) { close(true); return }
      settleRow(activeIndex < 0 ? undefined : flat[activeIndex]?.revision)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    const total = flat.length + 1
    event.preventDefault()
    const from = highlight === HEAD_SLOT || highlight === undefined ? 0 : highlight + 1
    const slot = event.key === 'Home' ? 0 : event.key === 'End' ? total - 1
      : (from + (event.key === 'ArrowDown' ? 1 : -1) + total) % total
    if (slot === 0) {
      setHighlight(HEAD_SLOT)
      if (searchable) searchRef.current?.focus()
      else headRef.current?.focus()
      return
    }
    const next = slot - 1
    if (next < 0 || next >= flat.length) return
    setHighlight(next)
    if (searchable) searchRef.current?.focus()
    else rowRefs.current[next]?.focus()
  }

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={css.trigger}
      title={props.hint}
      disabled={busy}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? `${id}-base` : undefined}
      onPointerDown={(event) => { openingPress.current = event.nativeEvent }}
      onClick={() => {
        setQuery('')
        setHighlight(undefined)
        setOpen(value => !value)
      }}
    >
      <span className={css.triggerLabel}>{props.label}</span>
      <span className={css.triggerValue}>{base?.replace(/^refs\/(?:heads|remotes)\//, '') ?? props.headLabel}</span>
    </button>
  )

  const outsideRepository = choices !== undefined && choices.repositoryRoot === null
  const card = outsideRepository
    ? <MenuSurface
      ref={cardRef}
      id={`${id}-base`}
      className={css.card}
      style={position ?? MEASURE_STYLE}
      role="menu"
      aria-label={props.noRepository}
    >
      <p className={css.note} role="presentation">{props.noRepository}</p>
    </MenuSurface>
    : <MenuSurface
      ref={cardRef}
      id={`${id}-base`}
      className={css.card}
      style={position ?? MEASURE_STYLE}
      role="menu"
      aria-label={props.headLabel}
    >
      <button
        ref={headRef}
        id={`${id}-head`}
        type="button"
        role="menuitemradio"
        aria-checked={selectedId === HEAD_ID}
        tabIndex={searchable ? -1 : 0}
        data-active={highlight === HEAD_SLOT ? '' : undefined}
        className={css.row}
        onFocus={() => { setHighlight(HEAD_SLOT) }}
        onMouseMove={() => { setHighlight(HEAD_SLOT) }}
        onClick={() => { settleRow(undefined) }}
      >
        <span className={css.rowName}>{props.headLabel}</span>
        {selectedId === HEAD_ID && <IconCheckOutlineRegular className={css.check} size={14} />}
      </button>

      {searchable && <div className={css.searchRow}>
        <Input
          ref={searchRef}
          // `Input`'s own props type is `className?: string`, so under
          // exactOptionalPropertyTypes a CSS-module lookup
          // (`string | undefined`) has to be narrowed here rather than forwarded.
          className={css.search ?? ''}
          icon={<IconSearchOutlineRegular size={12} />}
          type="text"
          role="searchbox"
          aria-label={props.searchLabel}
          aria-controls={`${id}-base`}
          aria-activedescendant={highlight === HEAD_SLOT
            ? `${id}-head`
            : activeIndex < 0 ? undefined : `${id}-row-${activeIndex}`}
          placeholder={props.searchLabel}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlight(undefined)
          }}
        />
        {query !== '' && <button
          type="button"
          className={css.clear}
          aria-label={props.clearLabel}
          onClick={() => {
            setQuery('')
            setHighlight(undefined)
            searchRef.current?.focus()
          }}
        >
          <IconCloseFillRegular size={12} />
        </button>}
      </div>}

      {flat.length === 0
        ? <p className={css.note} role="status">{groups.length === 0 ? props.noChoices : props.noMatch}</p>
        : <div ref={listRef} className={css.list} role="group" aria-label={props.localLabel}>
          {visible.map(group => <MenuGroup key={group.id} label={group.label}>
            {group.rows.map((row) => {
              // Flat index across groups, so the arrow walk and the row refs
              // agree on which row `activeIndex` names.
              const at = flat.indexOf(row)
              const active = at === activeIndex
              return <button
                key={row.id}
                id={`${id}-row-${at}`}
                ref={(node) => { rowRefs.current[at] = node }}
                type="button"
                role="menuitemradio"
                aria-checked={selectedId === row.id}
                tabIndex={-1}
                data-active={active ? '' : undefined}
                className={css.row}
                title={row.name}
                onFocus={() => { setHighlight(at) }}
                onMouseMove={() => { if (!active) setHighlight(at) }}
                onClick={() => { settleRow(row.revision) }}
              >
                <IconBranchOutlineRegular className={css.glyph} size={12} />
                <span className={css.rowName}>{row.name}</span>
                {row.current && <span className={css.current}>{props.currentLabel(row.name)}</span>}
                {selectedId === row.id && <IconCheckOutlineRegular className={css.check} size={14} />}
              </button>
            })}
          </MenuGroup>)}
        </div>}
    </MenuSurface>

  return <span className={css.root} onKeyDown={onKeyDown}>
    {trigger}
    {open && choices !== undefined && createPortal(card, document.body)}
  </span>
}
