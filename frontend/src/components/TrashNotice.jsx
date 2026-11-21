import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Undo2, X } from 'lucide-react'
import api, { parseError } from '../api'
import { TRASH_DAYS } from '../utils'

/**
 * "Moved to Trash" banner with Undo, shown right after a delete.
 * item: { kind: 'announcement' | 'category', id, label }
 */
export default function TrashNotice({ item, onUndone, onClose }) {
  const [state, setState] = useState('idle') // idle | busy | undone
  const [error, setError] = useState('')
  if (!item) return null

  const undo = async () => {
    setState('busy'); setError('')
    try {
      const path = item.kind === 'category' ? 'categories' : 'announcements'
      await api.post(`/trash/${path}/${item.id}/restore/`)
      setState('undone')
      onUndone?.(item)
    } catch (e) {
      setError(parseError(e).message); setState('idle')
    }
  }

  return (
    <div className={`alert ${state === 'undone' ? 'alert-ok' : 'alert-info'} trash-notice`} role="status">
      <span>
        {state === 'undone'
          ? <>Restored &ldquo;{item.label}&rdquo;.</>
          : <>&ldquo;{item.label}&rdquo; was moved to the Trash. You can restore it for {TRASH_DAYS} days.</>}
        {error && <> {error}</>}
      </span>
      <span className="row">
        {state !== 'undone' && (
          <>
            <button type="button" className="btn btn-sm" onClick={undo} disabled={state === 'busy'}>
              <Undo2 size={14} /> {state === 'busy' ? 'Restoring...' : 'Undo'}
            </button>
            <Link to={`/trash${item.kind === 'category' ? '?tab=categories' : ''}`} className="btn btn-sm btn-ghost">View Trash</Link>
          </>
        )}
        <button type="button" className="icon-btn" aria-label="Dismiss" onClick={onClose}><X size={16} /></button>
      </span>
    </div>
  )
}
