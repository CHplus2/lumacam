import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowUpDown, Bell, BellOff, CalendarDays, MapPin, PackageCheck, Pencil, Search, Shapes, Trash2, X } from 'lucide-react'
import api, { parseError } from '../api'
import { useCategories, useDebounced } from '../hooks'
import { AnnouncementCard, EmptyState, ErrorBox, Spinner } from '../components/ui'
import TrashNotice from '../components/TrashNotice'
import ExpandableText from '../components/ExpandableText'
import ViewToggle, { PostList } from '../components/ViewToggle'
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

export default function Listing({ mine = false }) {
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
  const subcats = category?.subcategories || []
  const sub = subcats.some((sc) => String(sc.id) === params.get('sub')) ? params.get('sub') : ''
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
          category: slug || undefined, search: urlQ || undefined, ordering, page: pageNo, mine: mine ? 1 : undefined,
          date_from: dates.from || undefined, date_to: dates.to || undefined,
          stock: stockIn ? 'in' : undefined, pickup: pickup || undefined, sub: sub || undefined,
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
  }, [slug, urlQ, ordering, dates.from, dates.to, stockIn, pickup, mine, sub])

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

  const setParam = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    setParams(next, { replace: true })
  }
  const sellFiltersActive = stockIn || Boolean(pickup) || Boolean(sub)
  const clearAllFilters = () => {
    const next = new URLSearchParams(params)
    ;['stock', 'pickup', 'sub', ...DATE_PARAMS].forEach((k) => next.delete(k))
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
      <div className={`page-head page-head-compact ${category ? `tone-${category.color}` : ''} ${category && !category.description ? 'no-desc' : ''}`}>
        {Icon && <span className="cat-icon"><Icon size={22} /></span>}
        <div className="grow page-head-text">
          {/* On a category page, wait for the category instead of flashing the Explore title. */}
          <h1>{category ? category.name : slug ? '\u00a0' : mine ? 'My posts' : 'Explore all announcements'}</h1>
          {category?.description ? (
            <ExpandableText key={category.slug} text={category.description} className="muted page-head-desc" />
          ) : !category && (
            <p className="muted page-head-desc">
              {slug ? '\u00a0' : mine
                ? <>Everything you&apos;ve posted. Only you can edit these. Deleted posts are in your <Link to="/trash" data-tour="trash">Trash</Link>.</>
                : 'Browse everything shared by your campus community.'}
            </p>
          )}
        </div>
        {category && (
          <button type="button" data-tour="follow" className={`btn btn-sm ${following ? '' : 'btn-primary'}`} aria-pressed={following}
            onClick={() => follows.toggle(category.slug)}
            title={following ? 'Stop notifications for this category' : 'Get notified about new posts here. Phone notifications: bell, then Notification settings.'}>
            {following ? <><BellOff size={15} /> Following</> : <><Bell size={15} /> Follow</>}
          </button>
        )}
      </div>

      {!mine && <div className="chips" role="tablist" aria-label="Categories">
        <Link to={`/explore${keepDates}`} className={`chip ${!slug ? 'active' : ''}`}>All</Link>
        {categories.map((c) => (
          <Link key={c.id} to={`/category/${c.slug}${keepDates}`} className={`chip ${slug === c.slug ? 'active' : ''}`}>{c.name}</Link>
        ))}
      </div>}

      <div className="filter-block" data-tour="filters">
      <div className="toolbar">
        <div className="search-bar">
          <Search size={18} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={category ? `Search in ${category.name}...` : 'Search announcements...'} aria-label="Search" />
          {q && <button className="icon-btn" aria-label="Clear search" onClick={() => setQ('')}><X size={16} /></button>}
        </div>
        <ViewToggle />
      </div>

      <div className="filter-row" aria-label="Filters">
        {subcats.length > 0 && (
          <label className={`filter-pill ${sub ? 'on' : ''}`}>
            <Shapes size={15} aria-hidden="true" />
            <span className="sr-only">Subcategory</span>
            <select value={sub} onChange={(e) => setParam('sub', e.target.value)}>
              <option value="">All {category.name}</option>
              {subcats.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
            </select>
          </label>
        )}
        <label className="filter-pill">
          <ArrowUpDown size={15} aria-hidden="true" />
          <span className="sr-only">Sort by</span>
          <select value={ordering} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className={`filter-pill ${dates.when ? 'on' : ''}`}>
          <CalendarDays size={15} aria-hidden="true" />
          <span className="sr-only">Date</span>
          <select value={dates.when} onChange={(e) => pickWhen(e.target.value)}>
            {WHEN.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
        </label>
        {selling && (
          <label className={`filter-pill ${stockIn ? 'on' : ''}`}>
            <PackageCheck size={15} aria-hidden="true" />
            <span className="sr-only">Stock</span>
            <select value={stockIn ? 'in' : ''} onChange={(e) => setParam('stock', e.target.value)}>
              <option value="">Any stock</option>
              <option value="in">In stock only</option>
            </select>
          </label>
        )}
        {selling && placeChips.length > 0 && (
          <label className={`filter-pill ${pickup ? 'on' : ''}`}>
            <MapPin size={15} aria-hidden="true" />
            <span className="sr-only">Pickup place</span>
            <select value={placeChips.find((pl) => pl.name.toLowerCase() === pickup.toLowerCase())?.name || ''}
              onChange={(e) => setParam('pickup', e.target.value)}>
              <option value="">Pickup anywhere</option>
              {placeChips.slice(0, 30).map((pl) => <option key={pl.name} value={pl.name}>{pl.name}</option>)}
            </select>
          </label>
        )}
        {(dateActive || sellFiltersActive) && (
          <button type="button" className="link-btn filter-clear" onClick={clearAllFilters}>Clear</button>
        )}
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
          {' '}Posts without a date are hidden.
        </p>
      )}

      <ErrorBox message={error} onRetry={() => load(1, true)} />
      {loading && items.length === 0 ? <Spinner /> : !error && items.length === 0 ? (
        <EmptyState
          title={urlQ ? `No results for "${urlQ}"` : mine && !dateActive ? 'You haven\'t posted anything yet' : dateActive ? 'Nothing scheduled for these dates'
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
          <PostList>{items.map((a) => <AnnouncementCard key={a.id} a={a} />)}</PostList>
          {hasMore && (
            <div className="center">
              <button className="btn" disabled={loading} onClick={() => load(page + 1, false)}>
                {loading ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}

      {category?.can_edit && (
        <div className="page-foot">
          <ErrorBox message={deleteError} />
          <div className="row">
            <Link to={`/categories/${category.id}/edit`} className="btn btn-quiet btn-sm"><Pencil size={14} /> Edit this category</Link>
            <button className="btn btn-quiet-danger btn-sm" onClick={deleteCategory} disabled={deleting}>
              <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete this category'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
