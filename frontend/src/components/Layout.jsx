import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Aperture, Bell, Compass, House, LayoutGrid, Plus, Trash2 } from 'lucide-react'
import api from '../api'
import { useCategories } from '../hooks'
import { useFollows } from '../follows'
import { fmtDate } from '../utils'

function Logo() {
  return (
    <Link to="/" className="logo" aria-label="LumaCam home">
      <span className="logo-mark"><Aperture size={20} strokeWidth={2.4} /></span>
      <span>LumaCam</span>
    </Link>
  )
}

const POLL_MS = 60 * 1000

/** Bell: new posts in the categories you follow since you last marked them seen. */
function Notifications() {
  const { pathname } = useLocation()
  const { slugs, lastSeen, isFollowing, toggle, markSeen } = useFollows()
  const { categories } = useCategories()
  const [open, setOpen] = useState(false)
  const [result, setNews] = useState({ count: 0, items: [], key: '' })
  const ref = useRef(null)
  const key = slugs.join(',')
  // Ignore results fetched for an older follow list or before the last "mark as seen".
  const news = key && lastSeen && result.key === `${key}|${lastSeen}` ? result : { count: 0, items: [] }

  const check = useCallback(async () => {
    if (!key || !lastSeen) return
    try {
      const { data } = await api.get('/announcements/', { params: { categories: key, since: lastSeen, ordering: 'newest' } })
      setNews({ count: data.count, items: data.results.slice(0, 5), key: `${key}|${lastSeen}` })
    } catch { /* keep the last result; the bell is not critical */ }
  }, [key, lastSeen])

  useEffect(() => {
    check()
    const t = setInterval(check, POLL_MS)
    return () => clearInterval(t)
  }, [check, pathname])

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const label = news.count ? `Notifications, ${news.count} new` : 'Notifications'
  return (
    <div className="popover-wrap" ref={ref}>
      <button className="icon-btn bell" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Bell size={20} />
        {news.count > 0 && <span className="bell-count" aria-hidden="true">{news.count > 9 ? '9+' : news.count}</span>}
      </button>
      {open && (
        <div className="popover notif" role="dialog" aria-label="Notifications">
          <strong>Notifications</strong>
          {slugs.length === 0 ? (
            <p className="muted small">Follow categories below to hear about new posts in them.</p>
          ) : news.count === 0 ? (
            <p className="muted small">No new posts in the categories you follow.</p>
          ) : (
            <>
              <ul className="notif-list">
                {news.items.map((a) => (
                  <li key={a.id}>
                    <Link to={`/announcements/${a.id}`} onClick={() => setOpen(false)}>
                      <span className="notif-title">{a.title}</span>
                      <span className="muted small">{a.category_detail?.name} · {fmtDate(a.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {news.count > news.items.length && (
                <p className="muted small">and {news.count - news.items.length} more</p>
              )}
              <button type="button" className="btn btn-sm" onClick={markSeen}>
                Mark all as seen
              </button>
            </>
          )}
          <div className="notif-follow">
            <span className="label small">Categories you follow</span>
            {categories.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={isFollowing(c.slug)} onChange={() => toggle(c.slug)} />
                {c.name}
              </label>
            ))}
            <small className="muted">Saved in this browser.</small>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { pathname } = useLocation()

  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  const link = ({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')

  return (
    <div className="app">
      <header className="header">
        <div className="container header-inner">
          <Logo />
          <nav className="nav-desktop" aria-label="Main">
            <NavLink to="/" end className={link}>Home</NavLink>
            <NavLink to="/categories" className={link}>Categories</NavLink>
            <NavLink to="/explore" className={link}>Explore</NavLink>
          </nav>
          <div className="header-actions">
            <NavLink to="/trash" className={({ isActive }) => `nav-link header-trash${isActive ? ' active' : ''}`}
              title="Deleted posts and categories. Restore them within 30 days.">
              <Trash2 size={18} /> Trash
            </NavLink>
            <Notifications />
            <Link to="/create" className="btn btn-primary btn-sm header-create"><Plus size={16} /> Create Announcement</Link>
          </div>
        </div>
      </header>

      <main className="container main"><Outlet /></main>

      <footer className="footer container">
        <span>LumaCam - campus announcements, organised.</span>
      </footer>

      <nav className="nav-mobile" aria-label="Mobile">
        <NavLink to="/" end className={link}><House size={22} /><span>Home</span></NavLink>
        <NavLink to="/categories" className={link}><LayoutGrid size={22} /><span>Categories</span></NavLink>
        <NavLink to="/create" className="nav-create" aria-label="Create announcement"><Plus size={28} strokeWidth={2.6} /></NavLink>
        <NavLink to="/explore" className={link}><Compass size={22} /><span>Explore</span></NavLink>
        <NavLink to="/trash" className={link}><Trash2 size={22} /><span>Trash</span></NavLink>
      </nav>
    </div>
  )
}
