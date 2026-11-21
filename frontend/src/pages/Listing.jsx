import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Search, Trash2, X } from 'lucide-react'
import api, { parseError } from '../api'
import { useCategories, useDebounced } from '../hooks'
import { AnnouncementCard, EmptyState, ErrorBox, Spinner } from '../components/ui'
import { ICONS, categoryDeleteBlocker } from '../utils'

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'expiring', label: 'Expiring soon' },
]

export default function Listing() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const initialQ = params.get('q') || ''
  const [q, setQ] = useState(initialQ)
  const debouncedQ = useDebounced(q)
  const ordering = params.get('ordering') || 'newest'
  const { categories, reload: reloadCategories } = useCategories()
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const category = categories.find((c) => c.slug === slug)

  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Keep the URL's q in sync with the debounced input.
  const pushedQ = useRef(initialQ)
  const requestId = useRef(0)
  useEffect(() => {
    if ((params.get('q') || '') === debouncedQ) return
    pushedQ.current = debouncedQ
    const next = new URLSearchParams(params)
    if (debouncedQ) next.set('q', debouncedQ); else next.delete('q')
    setParams(next, { replace: true })
  }, [debouncedQ]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset the input if navigation changes q externally (e.g. from the home search).
  // Changes we pushed ourselves are ignored so typing is never overwritten.
  useEffect(() => {
    if (initialQ !== pushedQ.current) { pushedQ.current = initialQ; setQ(initialQ) }
  }, [initialQ])

  const urlQ = params.get('q') || ''
  const load = useCallback(async (pageNo, replace) => {
    const myId = ++requestId.current
    setLoading(true); setError('')
    try {
      const { data } = await api.get('/announcements/', {
        params: { category: slug || undefined, search: urlQ || undefined, ordering, page: pageNo },
      })
      if (myId !== requestId.current) return // a newer request superseded this one
      setItems((prev) => (replace ? data.results : [...prev, ...data.results]))
      setHasMore(Boolean(data.next))
      setPage(pageNo)
    } catch (e) {
      if (myId === requestId.current) setError(parseError(e).message)
    } finally {
      if (myId === requestId.current) setLoading(false)
    }
  }, [slug, urlQ, ordering])

  useEffect(() => { load(1, true) }, [load])

  const setSort = (value) => {
    const next = new URLSearchParams(params)
    if (value === 'newest') next.delete('ordering'); else next.set('ordering', value)
    setParams(next, { replace: true })
  }

  const deleteCategory = async () => {
    const blocker = categoryDeleteBlocker(category)
    if (blocker) { setDeleteError(blocker); return }
    if (!window.confirm(`Delete the category "${category.name}"?`)) return
    setDeleting(true); setDeleteError('')
    try {
      await api.delete(`/categories/${category.id}/`)
      reloadCategories()
      navigate('/categories', { replace: true })
    } catch (e) {
      setDeleteError(parseError(e).message)
    } finally { setDeleting(false) }
  }

  const Icon = category ? ICONS[category.icon] : null

  return (
    <>
      <div className={`page-head ${category ? `tone-${category.color}` : ''}`}>
        {Icon && <span className="cat-icon"><Icon size={26} /></span>}
        <div>
          <h1>{category ? category.name : 'Explore all announcements'}</h1>
          <p className="muted">{category ? category.description : 'Browse everything shared by your campus community.'}</p>
        </div>
      </div>

      <div className="chips" role="tablist" aria-label="Categories">
        <Link to="/explore" className={`chip ${!slug ? 'active' : ''}`}>All</Link>
        {categories.map((c) => (
          <Link key={c.id} to={`/category/${c.slug}`} className={`chip ${slug === c.slug ? 'active' : ''}`}>{c.name}</Link>
        ))}
      </div>

      <div className="toolbar">
        <div className="search-bar">
          <Search size={18} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={category ? `Search in ${category.name}...` : 'Search announcements...'} aria-label="Search" />
          {q && <button className="icon-btn" aria-label="Clear search" onClick={() => setQ('')}><X size={16} /></button>}
        </div>
        <select value={ordering} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <ErrorBox message={error} onRetry={() => load(1, true)} />
      {loading && items.length === 0 ? <Spinner /> : !error && items.length === 0 ? (
        <EmptyState
          title={urlQ ? `No results for "${urlQ}"` : 'No announcements here yet'}
          text={urlQ ? 'Try a different keyword or browse all categories.' : 'Check back soon, or post the first one.'}
          action={
            <div className="empty-actions">
              <Link to="/categories" className="btn">All categories</Link>
              <Link to={category ? `/create?category=${category.id}` : '/create'} className="btn btn-primary">Create post</Link>
            </div>
          }
        />
      ) : (
        <>
          <div className="ann-grid">{items.map((a) => <AnnouncementCard key={a.id} a={a} />)}</div>
          {hasMore && (
            <div className="center">
              <button className="btn" disabled={loading} onClick={() => load(page + 1, false)}>
                {loading ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}

      {category && (
        <div className="page-foot">
          <ErrorBox message={deleteError} />
          <button className="btn btn-quiet-danger btn-sm" onClick={deleteCategory} disabled={deleting}>
            <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete this category'}
          </button>
        </div>
      )}
    </>
  )
}
