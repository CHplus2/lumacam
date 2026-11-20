import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import api, { parseError } from '../api'
import { useCategories } from '../hooks'
import { CategoryCard, ErrorBox, Spinner } from '../components/ui'

export default function Categories() {
  const { categories, loading, error, reload } = useCategories()
  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState('')

  const remove = async (c) => {
    const note = c.announcement_count
      ? ` Its ${c.announcement_count} announcement(s) will move to "Other Announcements".`
      : ''
    if (!window.confirm(`Delete the category "${c.name}"?${note}`)) return
    setDeletingId(c.id); setDeleteError('')
    try {
      await api.delete(`/categories/${c.id}/`)
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
      <ErrorBox message={error || deleteError} onRetry={error ? reload : undefined} />
      {loading && categories.length === 0 ? <Spinner /> : (
        <div className="cat-grid">
          {categories.map((c) => (
            <div key={c.id} className="cat-wrap">
              <CategoryCard category={c} />
              {!c.is_builtin && (
                <button className="cat-delete" onClick={() => remove(c)} disabled={deletingId === c.id}
                  aria-label={`Delete category ${c.name}`} title="Delete category">
                  <Trash2 size={16} />
                </button>
              )}
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
