import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Aperture, Bell, Compass, House, LogIn, LogOut, Plus, ShieldCheck,
} from 'lucide-react'
import { useAuth } from '../auth'

function Logo() {
  return (
    <Link to="/" className="logo" aria-label="LumaCam home">
      <span className="logo-mark"><Aperture size={20} strokeWidth={2.4} /></span>
      <span>LumaCam</span>
    </Link>
  )
}

function Notifications() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  return (
    <div className="popover-wrap" ref={ref}>
      <button className="icon-btn" aria-label="Notifications" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Bell size={20} />
      </button>
      {open && (
        <div className="popover" role="status">
          <strong>Notifications</strong>
          <p className="muted">You&apos;re all caught up. Alerts are coming soon.</p>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { user, isAdmin, loading, logout } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  const link = ({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')

  return (
    <div className="app">
      <header className="header">
        <div className="container header-inner">
          <Logo />
          <nav className="nav-desktop" aria-label="Main">
            <NavLink to="/" end className={link}>Home</NavLink>
            <NavLink to="/explore" className={link}>Explore</NavLink>
            <NavLink to="/create" className={link}>Create Announcement</NavLink>
            {isAdmin && <NavLink to="/admin" className={link}>Admin</NavLink>}
          </nav>
          <div className="header-actions">
            <Notifications />
            {!loading && (isAdmin ? (
              <button className="btn btn-sm" onClick={async () => { await logout(); navigate('/') }}>
                <LogOut size={16} /> Log out
              </button>
            ) : (
              <Link to="/login" className="btn btn-sm"><LogIn size={16} /> Admin login</Link>
            ))}
          </div>
        </div>
      </header>

      <main className="container main"><Outlet /></main>

      <footer className="footer container">
        <span>LumaCam - campus announcements, organised.</span>
      </footer>

      <nav className="nav-mobile" aria-label="Mobile">
        <NavLink to="/" end className={link}><House size={22} /><span>Home</span></NavLink>
        <NavLink to="/explore" className={link}><Compass size={22} /><span>Explore</span></NavLink>
        <NavLink to="/create" className="nav-create" aria-label="Create announcement"><Plus size={28} strokeWidth={2.6} /></NavLink>
        <NavLink to={isAdmin ? '/admin' : '/login'} className={link}>
          <ShieldCheck size={22} /><span>Admin</span>
        </NavLink>
      </nav>
    </div>
  )
}
