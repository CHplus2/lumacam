import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CalendarDays, Plus, Search } from 'lucide-react'
import api, { parseError } from '../api'
import { useCategories } from '../hooks'
import { AnnouncementCard, EmptyState, ErrorBox, Spinner } from '../components/ui'
import { ICONS, fmtEventRange, quickRange } from '../utils'

// Home is built for "what's new": search, one row of categories, then the latest
// posts, so new posts are on screen without scrolling. Upcoming events sit below
// as a compact list.
export default function Home() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const { categories, loading: catLoading, error: catError, reload } = useCategories()
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [upcoming, setUpcoming] = useState([])
  const [upcomingCount, setUpcomingCount] = useState(0)

  useEffect(() => {
    api.get('/announcements/', { params: { ordering: 'newest' } })
      .then(({ data }) => setRecent(data.results.slice(0, 6)))
      .catch((e) => setError(parseError(e).message))
      .finally(() => setLoading(false))
    const week = quickRange('week')
    api.get('/announcements/', { params: { date_from: week.from, date_to: week.to } })
      .then(({ data }) => { setUpcoming(data.results.slice(0, 3)); setUpcomingCount(data.count) })
      .catch(() => {})
  }, [])

  const submit = (e) => {
    e.preventDefault()
    navigate(q.trim() ? `/explore?q=${encodeURIComponent(q.trim())}` : '/explore')
  }

  return (
    <>
      <section className="hero hero-compact" data-tour="home">
        <h1>Discover what&apos;s happening around campus.</h1>
        <p>Food, student businesses, events, surveys and opportunities from your university community.</p>
        <form className="search-bar search-hero" data-tour="search" onSubmit={submit} role="search">
          <Search size={20} />
          <input
            type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search announcements..." aria-label="Search announcements"
          />
          <button className="btn btn-primary" type="submit">Search</button>
        </form>
      </section>

      <nav className="cat-strip-wrap" data-tour="categories" aria-label="Categories">
        <ErrorBox message={catError} onRetry={reload} />
        {catLoading ? null : (
          <div className="cat-strip">
            {categories.map((c) => {
              const Icon = ICONS[c.icon]
              return (
                <Link key={c.id} to={`/category/${c.slug}`} className={`cat-chip tone-${c.color}`}>
                  {Icon && <Icon size={16} />}<span>{c.name}</span>
                </Link>
              )
            })}
            <Link to="/categories" className="cat-chip cat-chip-plain">All categories</Link>
            <Link to="/categories/new" className="cat-chip cat-chip-plain"><Plus size={16} /><span>New</span></Link>
          </div>
        )}
      </nav>

      <section>
        <div className="section-head">
          <h2>Latest posts</h2>
          <Link to="/explore" className="link-more">View all <ArrowRight size={16} /></Link>
        </div>
        <ErrorBox message={error} />
        {loading ? <Spinner /> : recent.length === 0 ? (
          <EmptyState title="No announcements yet" text="Be the first to share something with your campus."
            action={<Link to="/create" className="btn btn-primary">Create announcement</Link>} />
        ) : (
          <div className="ann-grid">{recent.map((a) => <AnnouncementCard key={a.id} a={a} />)}</div>
        )}
      </section>

      {upcoming.length > 0 && (
        <section>
          <div className="section-head">
            <h2><CalendarDays size={20} className="inline" /> Coming up this week</h2>
            <Link to="/explore?when=week" className="link-more">
              {upcomingCount > upcoming.length ? `See all ${upcomingCount}` : 'See all'} <ArrowRight size={16} />
            </Link>
          </div>
          <ul className="upcoming-list card">
            {upcoming.map((a) => (
              <li key={a.id}>
                <Link to={`/announcements/${a.id}`}>
                  <span className="upcoming-date">{fmtEventRange(a.event_start, a.event_end)}</span>
                  <span className="upcoming-title">{a.title}</span>
                  <ArrowRight size={16} className="upcoming-arrow" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
