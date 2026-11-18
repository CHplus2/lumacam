import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import api, { parseError } from '../api'
import { AnnouncementCard, EmptyState, ErrorBox, Spinner, StatusBadge } from '../components/ui'

export default function MyAnnouncements() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true); setError('')
    api.get('/announcements/mine/')
      .then(({ data }) => setItems(data))
      .catch((e) => setError(parseError(e).message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const remove = async (a) => {
    if (!window.confirm(`Delete "${a.title}" permanently?`)) return
    try {
      await api.delete(`/announcements/${a.id}/`)
      setItems((list) => list.filter((x) => x.id !== a.id))
    } catch (e) { setError(parseError(e).message) }
  }

  return (
    <>
      <div className="section-head">
        <h1>My Announcements</h1>
        <Link to="/create" className="btn btn-primary btn-sm"><Plus size={16} /> New</Link>
      </div>
      <ErrorBox message={error} onRetry={load} />
      {loading ? <Spinner /> : items.length === 0 && !error ? (
        <EmptyState icon={FileText} title="You haven't posted anything yet" text="Share food, items, events or opportunities with your campus."
          action={<Link to="/create" className="btn btn-primary">Create announcement</Link>} />
      ) : (
        <div className="ann-grid">
          {items.map((a) => (
            <AnnouncementCard key={a.id} a={a} footer={
              <div className="ann-footer">
                <div>
                  <StatusBadge status={a.status} />
                  {a.status === 'rejected' && a.rejection_reason && <small className="muted block">{a.rejection_reason}</small>}
                </div>
                <div className="row">
                  <Link to={`/announcements/${a.id}/edit`} className="btn btn-sm"><Pencil size={14} /> Edit</Link>
                  <button className="btn btn-sm btn-danger" onClick={() => remove(a)}><Trash2 size={14} /> Delete</button>
                </div>
              </div>
            } />
          ))}
        </div>
      )}
    </>
  )
}
