import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { parseError } from '../api'
import { useAuth } from '../auth'
import { ErrorBox } from '../components/ui'

function useRedirect() {
  const { state } = useLocation()
  return state?.from || '/'
}

export function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const redirect = useRedirect()
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={redirect} replace />

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
      <h1>Welcome back</h1>
      <p className="muted">Log in to post and manage announcements.</p>
      <ErrorBox message={error} />
      <div className="field"><label htmlFor="u">Username or email</label>
        <input id="u" autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></div>
      <div className="field"><label htmlFor="p">Password</label>
        <input id="p" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Logging in...' : 'Log in'}</button>
      <p className="muted">New here? <Link to="/register" state={{ from: redirect }}>Create an account</Link></p>
    </form>
  )
}

export function Register() {
  const { user, register } = useAuth()
  const navigate = useNavigate()
  const redirect = useRedirect()
  const [form, setForm] = useState({ username: '', email: '', first_name: '', password: '' })
  const [error, setError] = useState('')
  const [fields, setFields] = useState({})
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={redirect} replace />
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(''); setFields({})
    try {
      await register({ ...form, username: form.username.trim(), email: form.email.trim() })
      navigate(redirect, { replace: true })
    } catch (err) {
      const p = parseError(err); setError(p.message); setFields(p.fields)
    } finally { setBusy(false) }
  }

  const F = ({ id, label, type = 'text', auto, hint, required = true }) => (
    <div className={`field ${fields[id] ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} autoComplete={auto} value={form[id]} onChange={set(id)} required={required} />
      {hint && !fields[id] && <small className="muted">{hint}</small>}
      {fields[id] && <small className="field-error">{fields[id]}</small>}
    </div>
  )

  return (
    <form className="card form narrow" onSubmit={submit} noValidate>
      <h1>Create your account</h1>
      <p className="muted">Join LumaCam to share announcements with your campus.</p>
      <ErrorBox message={error} />
      {F({ id: 'username', label: 'Username', auto: 'username' })}
      {F({ id: 'email', label: 'Email', type: 'email', auto: 'email' })}
      {F({ id: 'first_name', label: 'Display name (optional)', auto: 'given-name', required: false, hint: 'Shown as the publisher on your posts' })}
      {F({ id: 'password', label: 'Password', type: 'password', auto: 'new-password', hint: 'At least 8 characters, not too common' })}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating account...' : 'Sign up'}</button>
      <p className="muted">Already registered? <Link to="/login" state={{ from: redirect }}>Log in</Link></p>
    </form>
  )
}
