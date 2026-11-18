import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { parseError } from '../api'
import { useAuth } from '../auth'
import { ErrorBox } from '../components/ui'

// Optional hint for demos/judging. Set VITE_DEMO_ADMIN_HINT="admin / Admin12345!" at build time.
const DEMO_HINT = import.meta.env.VITE_DEMO_ADMIN_HINT

export default function Login() {
  const { user, isAdmin, login } = useAuth()
  const navigate = useNavigate()
  const { state } = useLocation()
  const redirect = state?.from || '/admin'
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (isAdmin) return <Navigate to={redirect} replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await login(form.username.trim(), form.password)
      navigate(redirect, { replace: true })
    } catch (err) { setError(parseError(err).message) } finally { setBusy(false) }
  }

  return (
    <form className="card form narrow" onSubmit={submit}>
      <h1>Administrator login</h1>
      <p className="muted">Only moderators need to log in. Everyone else can browse and post without an account.</p>
      {DEMO_HINT && <div className="alert alert-ok">Demo admin: <strong>{DEMO_HINT}</strong></div>}
      {user && !isAdmin && <div className="alert alert-warn">This account is not an administrator.</div>}
      <ErrorBox message={error} />
      <div className="field"><label htmlFor="u">Username</label>
        <input id="u" autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></div>
      <div className="field"><label htmlFor="p">Password</label>
        <input id="p" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Logging in...' : 'Log in'}</button>
    </form>
  )
}
