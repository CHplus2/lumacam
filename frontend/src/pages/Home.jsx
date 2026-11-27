import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CalendarDays, Plus, Search, Sparkles } from 'lucide-react'
import api, { parseError, track } from '../api'
import { useCategories } from '../hooks'
import { AnnouncementCard, EmptyState, ErrorBox, Spinner } from '../components/ui'
import ViewToggle, { PostList } from '../components/ViewToggle'
import Onboarding from '../components/Onboarding'
import { useFollows } from '../follows'
import { ICONS, fmtEventRange, quickRange } from '../utils'

const TAB_KEY = 'lumacam.homeTab.v1'
const readTab = () => { try { return localStorage.getItem(TAB_KEY) } catch { return null } }
const saveTab = (t) => { try { localStorage.setItem(TAB_KEY, t) } catch { /* private mode */ } }

/** Horizontal swipe on the feed switches tabs. Ignores mostly-vertical drags (scrolling) and
 * drags that start near the screen edge (iPhone's swipe-to-go-back). */
function useSwipe(onLeft, onRight) {
  const start = useRef(null)
  return {
    onTouchStart: (e) => {
      const t = e.touches[0]
      const edge = 24
      start.current = (t.clientX < edge || t.clientX > window.innerWidth - edge) ? null : { x: t.clientX, y: t.clientY }
    },
    onTouchEnd: (e) => {
      const s0 = start.current
      start.current = null
      if (!s0) return
      const t = e.changedTouches[0]
      const dx = t.clientX - s0.x
      const dy = t.clientY - s0.y
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
      if (dx < 0) onLeft(); else onRight()
    },
  }
}

// Home is built for "what's new": search, one row of categories, then one feed with two tabs,
// "For you" (posts from what you follow) and "Latest". Upcoming events sit below as a compact list.
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
  // Last tab used on this device; first visit: For you if interests are picked, else Latest.
  const [tab, setTabState] = useState(() => readTab() || (followKey ? 'foryou' : 'latest'))
  const setTab = (t) => { setTabState(t); saveTab(t) }
  const swipe = useSwipe(() => setTab('latest'), () => setTab('foryou'))

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

      <section className="feed" data-tour="feed">
        <div className="section-head feed-head">
          <div className="feed-tabs" role="tablist" aria-label="Posts">
            <button type="button" role="tab" id="tab-foryou" aria-controls="panel-feed" aria-selected={tab === 'foryou'}
              className={tab === 'foryou' ? 'on' : ''} onClick={() => setTab('foryou')}>
              <Sparkles size={16} /> For you
            </button>
            <button type="button" role="tab" id="tab-latest" aria-controls="panel-feed" aria-selected={tab === 'latest'}
              className={tab === 'latest' ? 'on' : ''} onClick={() => setTab('latest')}>
              Latest
            </button>
          </div>
          <div className="section-actions">
            <ViewToggle />
            {tab === 'latest'
              ? <Link to="/explore" className="link-more">View all <ArrowRight size={16} /></Link>
              : forYou?.length > 0 && <button type="button" className="link-more btn-link" onClick={() => setPicking(true)}>Interests</button>}
          </div>
        </div>
        <p className="muted section-hint feed-hint">
          {tab === 'foryou' ? 'Based on what you follow. Swipe or tap Latest for everything new.' : 'Everything new on campus, newest first.'}
        </p>

        <div id="panel-feed" role="tabpanel" aria-labelledby={tab === 'foryou' ? 'tab-foryou' : 'tab-latest'}
          className="feed-panel" {...swipe}>
          {tab === 'foryou' ? (
            forYou === null ? <Spinner /> : forYou.length === 0 ? (
              <EmptyState mood="curious" title={followKey ? 'Nothing new in what you follow' : 'Pick your interests'}
                text={followKey ? 'Follow a few more categories, or see everything new.' : "Tell me what you're into and I'll pick posts for you"}
                action={(
                  <div className="empty-actions">
                    <button type="button" className="btn btn-primary" onClick={() => setPicking(true)}>Choose interests</button>
                    <button type="button" className="btn" onClick={() => setTab('latest')}>See latest</button>
                  </div>
                )} />
            ) : (
              // Count opens from this tab for the evidence table.
              <div onClickCapture={(e) => { if (e.target.closest('a')) track('for_you_opened') }}>
                <PostList>{forYou.map((a) => <AnnouncementCard key={a.id} a={a} />)}</PostList>
              </div>
            )
          ) : (
            <>
              <ErrorBox message={error} />
              {loading ? <Spinner /> : recent.length === 0 ? (
                <EmptyState title="No announcements yet" text="Be the first to share something with your campus."
                  action={<Link to="/create" className="btn btn-primary">Create announcement</Link>} />
              ) : (
                <PostList>{recent.map((a) => <AnnouncementCard key={a.id} a={a} />)}</PostList>
              )}
            </>
          )}
        </div>
        {picking && <Onboarding pickOnly onClose={() => setPicking(false)} />}
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
