import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import api, { parseError } from '../api'
import { setAuth, useAuth } from '../auth'
import { claimBrowserPosts } from '../ownership'
import { Field } from '../components/fields'
import { ErrorBox } from '../components/ui'
import { safeNext } from '../utils'

export default function AuthPage({ mode }) {
  const signup = mode === 'register'
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const { loggedIn } = useAuth()
  const [form, setForm] = useState({ username: '', display_name: '', password: '' })
  const [error, setError] = useState('')
  const [fields, setFields] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  if (loggedIn) return <Navigate to={next} replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(''); setFields({})
    try {
      const body = signup ? form : { username: form.username, password: form.password }
      const { data } = await api.post(signup ? '/auth/register/' : '/auth/login/', body)
      setAuth(data.token, data.user)
      try { await claimBrowserPosts(api) } catch { /* not critical */ }
      navigate(next, { replace: true })
    } catch (err) {
      const p = parseError(err); setError(p.message); setFields(p.fields)
    } finally { setBusy(false) }
  }

  const other = `${signup ? '/login' : '/register'}${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`
  return (
    <form className="card form narrow" onSubmit={submit} noValidate>
      <h1>{signup ? 'Create your account' : 'Log in'}</h1>
      <p className="muted">
        {signup
          ? 'Takes a few seconds. You stay logged in on this device, and only you can edit your posts.'
          : 'You only need to do this once on each device.'}
      </p>
      <ErrorBox message={error} />
      <Field label="Username" htmlFor="username" error={fields.username} hint={signup ? '3-30 letters, numbers, dots or underscores' : undefined}>
        <input id="username" value={form.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" required />
      </Field>
      {signup && (
        <Field label="Your name" htmlFor="display_name" error={fields.display_name} hint="Shown as the publisher on your posts">
          <input id="display_name" value={form.display_name} onChange={set('display_name')} autoComplete="name" maxLength={60} required />
        </Field>
      )}
      <Field label="Password" htmlFor="password" error={fields.password} hint={signup ? 'At least 8 characters, not too common' : undefined}>
        <input id="password" type="password" value={form.password} onChange={set('password')}
          autoComplete={signup ? 'new-password' : 'current-password'} required />
      </Field>
      {signup && <p className="muted small">By creating an account you agree to our <Link to="/privacy">privacy notice and rules</Link>.</p>}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? (signup ? 'Creating account...' : 'Logging in...') : (signup ? 'Create account' : 'Log in')}
      </button>
      <p className="muted center-text">
        {signup ? 'Already have an account? ' : 'New to LumaCam? '}
        <Link to={other}>{signup ? 'Log in' : 'Create an account'}</Link>
      </p>
    </form>
  )
}
