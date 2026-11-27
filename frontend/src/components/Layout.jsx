import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Aperture, Bell, BellRing, Compass, FileText, House, LayoutGrid, LogIn, LogOut, Plus, Settings, Shield, Trash2,
} from 'lucide-react'
import api from '../api'
import { useFollows } from '../follows'
import { updatePush } from '../push'
import { clearAuth, useAuth } from '../auth'
import { forgetOnLogout, loadAccountPrefs, saveAccountPrefs } from '../accountPrefs'
import { fmtDate } from '../utils'
import Onboarding, { PageTour } from './Onboarding'
import { replayGuide, welcomeDone } from '../guide'

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
  const { slugs, lastSeen, markSeen, push } = useFollows()
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
      <button className="icon-btn bell" data-tour="bell" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Bell size={20} />
        {news.count > 0 && <span className="bell-count" aria-hidden="true">{news.count > 9 ? '9+' : news.count}</span>}
      </button>
      {open && (
        <div className="popover notif" role="dialog" aria-label="Notifications">
          <strong>Notifications</strong>
          {slugs.length === 0 ? (
            <p className="muted small">Pick categories in notification settings to hear about new posts in them.</p>
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
            <span className="muted small">
              Following {slugs.length} {slugs.length === 1 ? 'category' : 'categories'}
              {' · '}{push.on ? <><BellRing size={12} className="inline" /> Phone notifications on</> : 'Phone notifications off'}
            </span>
            <Link to="/notifications" className="btn btn-sm" onClick={() => setOpen(false)}>
              <Settings size={14} /> Notification settings
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function useOutsideClose(ref, setOpen) {
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [ref, setOpen])
}

/** Log in button, or the account menu once logged in. */
function AccountMenu() {
  const { user, loggedIn } = useAuth()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useOutsideClose(ref, setOpen)

  if (!loggedIn) {
    const next = pathname === '/login' || pathname === '/register' ? '' : `?next=${encodeURIComponent(pathname + search)}`
    return <Link to={`/login${next}`} className="btn btn-sm header-login"><LogIn size={16} /> Log in</Link>
  }
  const go = (to) => { setOpen(false); navigate(to) }
  const logOut = async (everywhere) => {
    setOpen(false)
    await forgetOnLogout()
    if (everywhere) { try { await api.post('/auth/logout/') } catch { /* already invalid */ } }
    clearAuth()
    navigate('/')
  }
  const initial = (user.display_name || user.username).slice(0, 1).toUpperCase()
  return (
    <div className="popover-wrap" ref={ref}>
      <button type="button" className="avatar" aria-label={`Account: ${user.display_name}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        {initial}
      </button>
      {open && (
        <div className="popover account-menu" role="menu">
          <div className="account-who">
            <strong>{user.display_name}</strong>
            <span className="muted small">@{user.username}</span>
          </div>
          <button type="button" role="menuitem" className="menu-item" onClick={() => go('/my-posts')}><FileText size={16} /> My posts</button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => go('/trash')}><Trash2 size={16} /> Trash</button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => go('/notifications')}><Settings size={16} /> Notification settings</button>
          <button type="button" role="menuitem" className="menu-item" onClick={replayGuide}><Compass size={16} /> Replay the guide</button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => go('/privacy')}><Shield size={16} /> Privacy and account</button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => logOut(false)}><LogOut size={16} /> Log out</button>
          <button type="button" role="menuitem" className="menu-item small muted" onClick={() => logOut(true)}>Log out on all devices</button>
        </div>
      )}
    </div>
  )
}

/** Keeps the server's copy of this device's notification settings in step with the app. */
function PushSync() {
  const { slugs, push, setPush } = useFollows()
  const { loggedIn, user } = useAuth()
  const key = slugs.join(',')
  // Logged in: load the account's settings first, so a stale device copy never overwrites them.
  const [readyFor, setReadyFor] = useState(null)
  const accountId = loggedIn ? user.id : null
  useEffect(() => {
    if (!accountId) return undefined
    let alive = true
    loadAccountPrefs(api).catch(() => {}).finally(() => { if (alive) setReadyFor(accountId) })
    return () => { alive = false }
  }, [accountId])

  useEffect(() => {
    if (accountId && readyFor !== accountId) return undefined
    if (!accountId && !push.on) return undefined
    const t = setTimeout(() => {
      const save = accountId
        ? saveAccountPrefs(api)
        : updatePush({ slugs: key ? key.split(',') : [], frequency: push.frequency, quietHours: push.quietHours })
          .then((ok) => { if (!ok) setPush({ on: false }) })
      save.catch(() => { /* offline or rate limited: try again on the next change */ })
    }, 600)
    return () => clearTimeout(t)
  }, [key, push.on, push.frequency, push.quietHours, accountId, readyFor]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export default function Layout() {
  const { pathname, state } = useLocation()
  const navigate = useNavigate()
  const { loggedIn } = useAuth()
  // Each main screen has its own short Lumi tour (see Onboarding.jsx).
  const tourId = pathname.startsWith('/category/') || pathname === '/explore' ? 'listing'
    : pathname === '/my-posts' ? 'myposts'
      : /^\/announcements\/\d+$/.test(pathname) ? 'detail'
        : pathname === '/create' ? 'create'
          : pathname === '/notifications' ? 'notify' : null

  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  const link = ({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')

  return (
    <div className="app">
      <PushSync />
      <header className="header">
        <div className="container header-inner">
          <Logo />
          <nav className="nav-desktop" aria-label="Main">
            <NavLink to="/" end className={link}>Home</NavLink>
            <NavLink to="/categories" className={link}>Categories</NavLink>
            <NavLink to="/explore" className={link} data-tour="explore">Explore</NavLink>
          </nav>
          <div className="header-actions">
            <Notifications />
            <Link to="/create" className="btn btn-primary btn-sm header-create" data-tour="post"><Plus size={16} /> Create Announcement</Link>
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="container main"><Outlet /></main>
      {pathname === '/' && <Onboarding />}
      {/* Right after sign-up (see AuthPage), unless the Home welcome is about to ask the same. */}
      {state?.pickInterests && (pathname !== '/' || welcomeDone()) && (
        <Onboarding pickOnly onClose={() => navigate(pathname, { replace: true, state: null })} />
      )}
      {tourId && <PageTour key={pathname} id={tourId} />}

      <footer className="footer container">
        <span>LumaCam - campus announcements, organised.</span> <Link to="/privacy">Privacy and rules</Link>
      </footer>

      <nav className="nav-mobile" aria-label="Mobile">
        <NavLink to="/" end className={link}><House size={22} /><span>Home</span></NavLink>
        <NavLink to="/categories" className={link}><LayoutGrid size={22} /><span>Categories</span></NavLink>
        <NavLink to="/create" className="nav-create" data-tour="post" aria-label="Create announcement"><Plus size={28} strokeWidth={2.6} /></NavLink>
        <NavLink to="/explore" className={link} data-tour="explore"><Compass size={22} /><span>Explore</span></NavLink>
        {loggedIn
          ? <NavLink to="/my-posts" className={link}><FileText size={22} /><span>My posts</span></NavLink>
          : <NavLink to="/login" className={link}><LogIn size={22} /><span>Log in</span></NavLink>}
      </nav>
    </div>
  )
}
