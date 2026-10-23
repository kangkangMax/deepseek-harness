/** Directory copy and desktop-open controls shared by worktree details. */
import { useEffect, useRef, useState } from 'react'
import {
  Button, IconCopyOutlineRegular, IconFolderOpenOutlineRegular, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { describeFailure, type ConsoleInjected } from './face.ts'
import type { NS } from './locales.ts'
import css from './DirectoryActions.module.css'

/**
 * Copy or open a directory with shell-owned operation feedback.
 * @param props - Directory, localized copy, optional desktop opener and notification callback.
 * @returns copy action and, when available, a directory-open action.
 */
export function DirectoryActions({ path, reveal, notify, t }: {
  path: string
  t: PropsLocale<typeof NS>['t']
} & Pick<ConsoleInjected, 'reveal' | 'notify'>) {
  const [copied, setCopied] = useState(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => { setCopied(false) }, 1_200)
    return () => { clearTimeout(timer) }
  }, [copied])

  async function copy(): Promise<void> {
    const accepted = await writeClipboard(path)
    notify(t(accepted ? 'copied' : 'copyFailed'), !accepted)
    if (accepted && mounted.current) setCopied(true)
  }

  async function open(): Promise<void> {
    if (reveal === undefined) return
    try {
      const shown = await reveal(path)
      notify(t(shown ? 'revealDone' : 'revealFailed'), !shown)
    } catch (error: unknown) {
      notify(describeFailure(error, t('revealFailed')), true)
    }
  }

  return <div className={css.actions}>
    <Button size="sm" variant="outline" icon={<IconCopyOutlineRegular size={13} />} onClick={() => { void copy() }}>
      {t(copied ? 'copied' : 'copyPath')}
    </Button>
    {reveal !== undefined && <Button
      size="sm"
      variant="outline"
      icon={<IconFolderOpenOutlineRegular size={13} />}
      onClick={() => { void open() }}
    >{t('reveal')}</Button>}
  </div>
}
