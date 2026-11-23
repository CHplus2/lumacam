import { useState } from 'react'
import { Check, Link2 } from 'lucide-react'
import { editLink } from '../ownership'

/** Copy the private link that lets the poster manage this post on another device. */
export default function EditLink({ id, compact = false }) {
  const [copied, setCopied] = useState(false)
  const link = editLink(id)
  if (!link) return null
  const copy = async () => {
    try { await navigator.clipboard.writeText(link) } catch { window.prompt('Copy your private edit link:', link) }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }
  return (
    <div className={compact ? 'edit-link compact' : 'edit-link'}>
      <button type="button" className="btn btn-sm" onClick={copy}>
        {copied ? <><Check size={14} /> Copied</> : <><Link2 size={14} /> Copy my private edit link</>}
      </button>
      <small className="muted">
        Only this browser can edit this post. Open the link on another phone to edit it there. Don&apos;t share it.
      </small>
    </div>
  )
}
