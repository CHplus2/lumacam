import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Bell, BellOff, CalendarDays, MapPin, PackageCheck, Search, Trash2, X } from 'lucide-react'
import api, { parseError } from '../api'
import { useCategories, useDebounced } from '../hooks'
import { AnnouncementCard, EmptyState, ErrorBox, Spinner } from '../components/ui'
import TrashNotice from '../components/TrashNotice'
import { useFollows } from '../follows'
import { ICONS, TRASH_DAYS, categoryDeleteBlocker, fmtEventRange, quickRange, todayISO } from '../utils'

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'upcoming', label: 'Upcoming first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'ending', label: 'Ending soon' },
]

const WHEN = [
  { value: '', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Next 7 days' },
  { value: 'month', label: 'Next 30 days' },
  { value: 'custom', label: 'Pick dates' },
]
const DATE_PARAMS = ['when', 'from', 'to']

/** Read the date filter from the URL as { when, from, to } (from/to may be empty). */
function readDateFilter(params) {
  const when = params.get('when') || ''
  if (when === 'custom') return { when, from: params.get('from') || '', to: params.get('to') || '' }
  const range = quickRange(when)
  return range ? { when, ...range } : { when: '', from: '', to: '' }
}

export default function Listing() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const trashed = location.state?.trashed
  const closeNotice = () => navigate(location.pathname + location.search, { replace: true, state: null })
  const initialQ = params.get('q') || ''
  const [q, setQ] = useState(initialQ)
  const debouncedQ = useDebounced(q)
  const dates = readDateFilter(params)
  const dateActive = Boolean(dates.from || dates.to)
  // "What's on soonest" is the natural order once you filter by date.
  const defaultOrdering = dateActive ? 'upcoming' : 'newest'
  const rawOrdering = params.get('ordering')
  const ordering = (rawOrdering === 'expiring' ? 'ending' : rawOrdering) || defaultOrdering
  const { categories, reload: reloadCategories } = useCategories()
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const category = categories.find((c) => c.slug === slug)
  const follows = useFollows()
  const following = category ? follows.isFollowing(category.slug) : false
  // Selling categories: "In stock only" and pickup place filters (kept in the URL).
  const selling = Boolean(category?.sells_items)
  const stockIn = selling && params.get('stock') === 'in'
  const pickup = selling ? params.get('pickup') || '' : ''
  const [places, setPlaces] = useState([])
  useEffect(() => {
    if (!selling) return
    api.get('/pickup-locations/', { params: { category: slug } })
      .then(({ data }) => setPlaces(data)).catch(() => setPlaces([]))
  }, [selling, slug])

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
        params: {
          category: slug || undefined, search: urlQ || undefined, ordering, page: pageNo,
          date_from: dates.from || undefined, date_to: dates.to || undefined,
          stock: stockIn ? 'in' : undefined, pickup: pickup || undefined,
        },
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
  }, [slug, urlQ, ordering, dates.from, dates.to, stockIn, pickup])

  useEffect(() => { load(1, true) }, [load])

  const setSort = (value) => {
    const next = new URLSearchParams(params)
    if (value === defaultOrdering) next.delete('ordering'); else next.set('ordering', value)
    setParams(next, { replace: true })
  }

  const setDateFilter = (patch) => {
    const next = new URLSearchParams(params)
    const merged = { ...dates, ...patch }
    DATE_PARAMS.forEach((k) => next.delete(k))
    if (merged.when) next.set('when', merged.when)
    if (merged.when === 'custom') {
      if (merged.from) next.set('from', merged.from)
      if (merged.to) next.set('to', merged.to)
    }
    // Let the sort fall back to the default for the new state.
    if (['newest', 'upcoming'].includes(next.get('ordering'))) next.delete('ordering')
    setParams(next, { replace: true })
  }
  const pickWhen = (when) => setDateFilter(when === 'custom'
    ? { when, from: dates.from || todayISO(), to: dates.to }
    : { when, from: '', to: '' })
  const clearDates = () => setDateFilter({ when: '', from: '', to: '' })

  const setParam = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    setParams(next, { replace: true })
  }
  const sellFiltersActive = stockIn || Boolean(pickup)
  const clearAllFilters = () => {
    const next = new URLSearchParams(params)
    ;['stock', 'pickup', ...DATE_PARAMS].forEach((k) => next.delete(k))
    if (['newest', 'upcoming'].includes(next.get('ordering'))) next.delete('ordering')
    setParams(next, { replace: true })
  }
  // Show the chosen place even if no live post uses it any more.
  const placeChips = pickup && !places.some((p) => p.name.toLowerCase() === pickup.toLowerCase())
    ? [{ name: pickup, count: 0 }, ...places] : places

  // Keep the date filter when switching between categories.
  const keepDates = (() => {
    const kept = new URLSearchParams()
    DATE_PARAMS.forEach((k) => params.get(k) && kept.set(k, params.get(k)))
    const qs = kept.toString()
    return qs ? `?${qs}` : ''
  })()

  const deleteCategory = async () => {
    const blocker = categoryDeleteBlocker(category)
    if (blocker) { setDeleteError(blocker); return }
    if (!window.confirm(`Move the category "${category.name}" to the Trash? You can restore it for ${TRASH_DAYS} days.`)) return
    setDeleting(true); setDeleteError('')
    try {
      await api.delete(`/categories/${category.id}/`)
      reloadCategories()
      navigate('/categories', { replace: true, state: { trashed: { kind: 'category', id: category.id, label: category.name } } })
    } catch (e) {
      setDeleteError(parseError(e).message)
    } finally { setDeleting(false) }
  }

  const Icon = category ? ICONS[category.icon] : null

  return (
    <>
      <TrashNotice key={trashed?.id} item={trashed} onClose={closeNotice}
        onUndone={() => { load(1, true); reloadCategories() }} />
      <div className={`page-head ${category ? `tone-${category.color}` : ''}`}>
        {Icon && <span className="cat-icon"><Icon size={26} /></span>}
        <div className="grow">
          <h1>{category ? category.name : 'Explore all announcements'}</h1>
          <p className="muted">{category ? category.description : 'Browse everything shared by your campus community.'}</p>
        </div>
        {category && (
          <button type="button" className={`btn btn-sm ${following ? '' : 'btn-primary'}`} aria-pressed={following}
            onClick={() => follows.toggle(category.slug)}
            title={following ? 'Stop notifications for this category' : 'Get notified about new posts here'}>
            {following ? <><BellOff size={15} /> Following</> : <><Bell size={15} /> Follow</>}
          </button>
        )}
      </div>

      <div className="chips" role="tablist" aria-label="Categories">
        <Link to={`/explore${keepDates}`} className={`chip ${!slug ? 'active' : ''}`}>All</Link>
        {categories.map((c) => (
          <Link key={c.id} to={`/category/${c.slug}${keepDates}`} className={`chip ${slug === c.slug ? 'active' : ''}`}>{c.name}</Link>
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

      {selling && (
        <div className="date-filter sell-filter">
          <span className="date-filter-label"><PackageCheck size={16} /> Stock</span>
          <div className="chips chips-small">
            <button type="button" aria-pressed={stockIn} className={`chip ${stockIn ? 'active' : ''}`}
              onClick={() => setParam('stock', stockIn ? '' : 'in')}>In stock only</button>
          </div>
          {placeChips.length > 0 && (
            <>
              <span className="date-filter-label"><MapPin size={16} /> Pickup</span>
              <div className="chips chips-small" role="radiogroup" aria-label="Pickup place">
                <button type="button" role="radio" aria-checked={!pickup} className={`chip ${!pickup ? 'active' : ''}`}
                  onClick={() => setParam('pickup', '')}>Anywhere</button>
                {placeChips.slice(0, 12).map((pl) => {
                  const on = pickup.toLowerCase() === pl.name.toLowerCase()
                  return (
                    <button key={pl.name} type="button" role="radio" aria-checked={on} className={`chip ${on ? 'active' : ''}`}
                      onClick={() => setParam('pickup', on ? '' : pl.name)}>{pl.name}</button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      <div className="date-filter">
        <span className="date-filter-label"><CalendarDays size={16} /> Date</span>
        <div className="chips chips-small" role="radiogroup" aria-label="Filter by date">
          {WHEN.map((w) => (
            <button key={w.value} type="button" role="radio" aria-checked={dates.when === w.value}
              className={`chip ${dates.when === w.value ? 'active' : ''}`} onClick={() => pickWhen(w.value)}>
              {w.label}
            </button>
          ))}
        </div>
        {dates.when === 'custom' && (
          <div className="date-range">
            <label className="sr-only" htmlFor="date_from">From</label>
            <input id="date_from" type="date" value={dates.from} max={dates.to || undefined}
              onChange={(e) => setDateFilter({ from: e.target.value })} />
            <span className="muted">to</span>
            <label className="sr-only" htmlFor="date_to">To</label>
            <input id="date_to" type="date" value={dates.to} min={dates.from || undefined}
              onChange={(e) => setDateFilter({ to: e.target.value })} />
          </div>
        )}
      </div>
      {dateActive && (
        <p className="muted small date-note">
          Showing posts happening {dates.from && dates.to
            ? (dates.from === dates.to ? `on ${fmtEventRange(dates.from)}` : `${fmtEventRange(dates.from, dates.to)}`)
            : dates.from ? `from ${fmtEventRange(dates.from)}` : `until ${fmtEventRange(dates.to)}`}.
          {' '}Posts without a date are hidden. <button type="button" className="link-btn" onClick={clearDates}>Clear date filter</button>
        </p>
      )}

      <ErrorBox message={error} onRetry={() => load(1, true)} />
      {loading && items.length === 0 ? <Spinner /> : !error && items.length === 0 ? (
        <EmptyState
          title={urlQ ? `No results for "${urlQ}"` : dateActive ? 'Nothing scheduled for these dates'
            : sellFiltersActive ? 'Nothing matches these filters' : 'No announcements here yet'}
          text={urlQ ? 'Try a different keyword or browse all categories.'
            : dateActive ? 'Try another date range, or clear the date filter to see everything.'
              : sellFiltersActive ? 'Try another pickup place, or show out-of-stock posts too.'
              : 'Check back soon, or post the first one.'}
          action={dateActive || sellFiltersActive ? (
            <div className="empty-actions">
              <button type="button" className="btn" onClick={clearAllFilters}>Clear filters</button>
              <Link to={category ? `/create?category=${category.id}` : '/create'} className="btn btn-primary">Create post</Link>
            </div>
          ) : (
            <div className="empty-actions">
              <Link to="/categories" className="btn">All categories</Link>
              <Link to={category ? `/create?category=${category.id}` : '/create'} className="btn btn-primary">Create post</Link>
            </div>
          )}
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
