import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CalendarDays, FolderPlus, Search } from 'lucide-react'
import api, { parseError } from '../api'
import { useCategories } from '../hooks'
import { AnnouncementCard, CategoryCard, EmptyState, ErrorBox, Spinner } from '../components/ui'
import { quickRange } from '../utils'

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
    // Dated posts in the next 7 days; the section only shows when there are some.
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
      <section className="hero" data-tour="home">
        <h1>Discover what&apos;s happening around campus.</h1>
        <p>Find food, student businesses, events, research surveys, and opportunities shared by your university community.</p>
        <form className="search-bar search-hero" data-tour="search" onSubmit={submit} role="search">
          <Search size={20} />
          <input
            type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search announcements..." aria-label="Search announcements"
          />
          <button className="btn btn-primary" type="submit">Search</button>
        </form>
      </section>

      <section data-tour="categories">
        <div className="section-head">
          <h2>Explore categories</h2>
          <Link to="/categories/new" className="link-more"><FolderPlus size={16} /> Create a category</Link>
        </div>
        <ErrorBox message={catError} onRetry={reload} />
        {catLoading ? <Spinner /> : (
          <div className="cat-grid">
            {categories.map((c) => <CategoryCard key={c.id} category={c} />)}
          </div>
        )}
      </section>

      {upcoming.length > 0 && (
        <section>
          <div className="section-head">
            <h2><CalendarDays size={20} className="inline" /> Coming up this week</h2>
            <Link to="/explore?when=week" className="link-more">
              {upcomingCount > upcoming.length ? `All ${upcomingCount}` : 'View all'} <ArrowRight size={16} />
            </Link>
          </div>
          <div className="ann-grid">{upcoming.map((a) => <AnnouncementCard key={a.id} a={a} />)}</div>
        </section>
      )}

      <section>
        <div className="section-head">
          <h2>Recent announcements</h2>
          <Link to="/explore" className="link-more">View All <ArrowRight size={16} /></Link>
        </div>
        <ErrorBox message={error} />
        {loading ? <Spinner /> : recent.length === 0 ? (
          <EmptyState title="No announcements yet" text="Be the first to share something with your campus."
            action={<Link to="/create" className="btn btn-primary">Create announcement</Link>} />
        ) : (
          <div className="ann-grid">{recent.map((a) => <AnnouncementCard key={a.id} a={a} />)}</div>
        )}
      </section>
    </>
  )
}
