import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import api, { parseError } from '../api'
import { useCategories } from '../hooks'
import { CategoryCard, ErrorBox, Spinner } from '../components/ui'
import TrashNotice from '../components/TrashNotice'
import { TRASH_DAYS, categoryDeleteBlocker } from '../utils'

export default function Categories() {
  const { categories, loading, error, reload } = useCategories()
  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const [trashed, setTrashed] = useState(location.state?.trashed || null)
  const closeNotice = () => {
    setTrashed(null)
    if (location.state) navigate(location.pathname, { replace: true, state: null })
  }

  const remove = async (c) => {
    const blocker = categoryDeleteBlocker(c)
    if (blocker) {
      setDeleteError(blocker)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (!window.confirm(`Move the category "${c.name}" to the Trash? You can restore it for ${TRASH_DAYS} days.`)) return
    setDeletingId(c.id); setDeleteError('')
    try {
      await api.delete(`/categories/${c.id}/`)
      setTrashed({ kind: 'category', id: c.id, label: c.name })
      reload()
    } catch (e) {
      setDeleteError(parseError(e).message)
    } finally { setDeletingId(null) }
  }

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Categories</h1>
          <p className="muted">Pick a category to see its announcements.</p>
        </div>
      </div>
      <TrashNotice key={trashed?.id} item={trashed} onClose={closeNotice} onUndone={reload} />
      <ErrorBox message={error || deleteError} onRetry={error ? reload : undefined} />
      {loading && categories.length === 0 ? <Spinner /> : (
        <div className="cat-grid">
          {categories.map((c) => (
            <div key={c.id} className="cat-wrap">
              <CategoryCard category={c} />
              <button className="cat-delete" onClick={() => remove(c)} disabled={deletingId === c.id}
                aria-label={`Delete category ${c.name}`}
                title={c.announcement_count ? 'Only empty categories can be deleted' : 'Delete category'}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <Link to="/categories/new" className="cat-card cat-card-new">
            <span className="cat-icon"><Plus size={26} /></span>
            <span className="cat-name">New category</span>
            <span className="cat-desc">Add a new kind of announcement</span>
          </Link>
        </div>
      )}
    </>
  )
}
