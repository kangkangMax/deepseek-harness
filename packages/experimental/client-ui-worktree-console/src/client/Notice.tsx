/** Operation feedback owned by the shell overlay, independent of Settings. */
import { IconWarningTriangleOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

/** One localized operation result. */
export interface WorktreeNotice {
  readonly text: string
  readonly failed: boolean
  readonly sequence: number
}

/** Observable feedback and its dismissal. */
export interface NoticeInjected {
  readonly hooks: { readonly notice: HostObservable<WorktreeNotice | null> }
  readonly dismissNotice: () => void
}

/** Render the latest result after the reporting panel closes. */
export function WorktreeNoticeOverlay(props: PropsRuntime<'shell.overlay'> & InjectFace<NoticeInjected>) {
  const notice = props.useNotice(value => value)
  if (notice === null) return null
  return notice.failed
    ? <Toast key={notice.sequence} text={notice.text} icon={<IconWarningTriangleOutlineRegular />} onDone={props.dismissNotice} />
    : <Toast key={notice.sequence} text={notice.text} tone="success" onDone={props.dismissNotice} />
}
