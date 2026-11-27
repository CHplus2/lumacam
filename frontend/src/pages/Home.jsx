import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CalendarDays, Plus, Search, Sparkles } from 'lucide-react'
import api, { parseError, track } from '../api'
import { useCategories } from '../hooks'
import { AnnouncementCard, EmptyState, ErrorBox, Spinner } from '../components/ui'
import ViewToggle, { PostList } from '../components/ViewToggle'
import Onboarding from '../components/Onboarding'
import { useFollows } from '../follows'
import { ICONS, fmtEventRange, quickRange } from '../utils'

// Home is built for "what's new": search, one row of categories, "For you" (posts from what
// you follow), then the latest posts. Upcoming events sit below as a compact list.
export default function Home() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const { categories, loading: catLoading, error: catError, reload } = useCategories()
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [upcoming, setUpcoming] = useState([])
  const [upcomingCount, setUpcomingCount] = useState(0)
  const { slugs } = useFollows()
  const followKey = slugs.join(',')
  const [forYou, setForYou] = useState(null) // null while loading
  const [picking, setPicking] = useState(false)

  // Refetch when follows change, so a fresh pick shows its posts straight away. Logged-in
  // devices hold a copy of the account's follows; with none here the server uses the account's.
  useEffect(() => {
    let alive = true
    api.get('/announcements/for-you/', { params: followKey ? { categories: followKey } : {} })
      .then(({ data }) => { if (alive) setForYou(data.results) })
      .catch(() => { if (alive) setForYou([]) })
    return () => { alive = false }
  }, [followKey])

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
          <div>
            <h2><Sparkles size={20} className="inline" /> For you</h2>
            <p className="muted section-hint">Based on what you follow</p>
          </div>
          {forYou?.length > 0 && (
            <button type="button" className="link-more btn-link" onClick={() => setPicking(true)}>Change interests</button>
          )}
        </div>
        {forYou === null ? <Spinner /> : forYou.length === 0 ? (
          <EmptyState mood="curious" title={followKey ? 'Nothing new in what you follow' : 'Pick your interests'}
            text={followKey ? 'Follow a few more categories to see more here.' : "Tell me what you're into and I'll pick posts for you"}
            action={<button type="button" className="btn btn-primary" onClick={() => setPicking(true)}>Choose interests</button>} />
        ) : (
          // Count opens from this row for the evidence table.
          <div onClickCapture={(e) => { if (e.target.closest('a')) track('for_you_opened') }}>
            <PostList>{forYou.map((a) => <AnnouncementCard key={a.id} a={a} />)}</PostList>
          </div>
        )}
        {picking && <Onboarding pickOnly onClose={() => setPicking(false)} />}
      </section>

      <section>
        <div className="section-head">
          <h2>Latest posts</h2>
          <div className="section-actions">
            <ViewToggle />
            <Link to="/explore" className="link-more">View all <ArrowRight size={16} /></Link>
          </div>
        </div>
        <ErrorBox message={error} />
        {loading ? <Spinner /> : recent.length === 0 ? (
          <EmptyState title="No announcements yet" text="Be the first to share something with your campus."
            action={<Link to="/create" className="btn btn-primary">Create announcement</Link>} />
        ) : (
          <PostList>{recent.map((a) => <AnnouncementCard key={a.id} a={a} />)}</PostList>
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
