import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, FolderPlus, Search } from 'lucide-react'
import api, { parseError } from '../api'
import { useCategories } from '../hooks'
import { AnnouncementCard, CategoryCard, EmptyState, ErrorBox, Spinner } from '../components/ui'

export default function Home() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const { categories, loading: catLoading, error: catError, reload } = useCategories()
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/announcements/', { params: { ordering: 'newest' } })
      .then(({ data }) => setRecent(data.results.slice(0, 6)))
      .catch((e) => setError(parseError(e).message))
      .finally(() => setLoading(false))
  }, [])

  const submit = (e) => {
    e.preventDefault()
    navigate(q.trim() ? `/explore?q=${encodeURIComponent(q.trim())}` : '/explore')
  }

  return (
    <>
      <section className="hero">
        <h1>Discover what&apos;s happening around campus.</h1>
        <p>Find food, student businesses, events, research surveys, and opportunities shared by your university community.</p>
        <form className="search-bar search-hero" onSubmit={submit} role="search">
          <Search size={20} />
          <input
            type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search announcements..." aria-label="Search announcements"
          />
          <button className="btn btn-primary" type="submit">Search</button>
        </form>
      </section>

      <section>
        <div className="section-head">
          <h2>Explore categories</h2>
          <Link to="/create?new_category=1" className="link-more"><FolderPlus size={16} /> Create a category</Link>
        </div>
        <ErrorBox message={catError} onRetry={reload} />
        {catLoading ? <Spinner /> : (
          <div className="cat-grid">
            {categories.map((c) => <CategoryCard key={c.id} category={c} />)}
          </div>
        )}
      </section>

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
