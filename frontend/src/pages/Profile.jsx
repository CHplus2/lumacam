import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import api, { parseError } from '../api'
import { useAuth } from '../auth'
import { fmtDate } from '../utils'

export default function Profile() {
  const { user, setUser, logout } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ first_name: user.first_name, last_name: user.last_name, email: user.email })
  const [msg, setMsg] = useState(null)
  const [fields, setFields] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null); setFields({})
    try {
      const { data } = await api.patch('/auth/me/', form)
      setUser(data)
      setMsg({ ok: true, text: 'Profile updated.' })
    } catch (err) {
      const p = parseError(err)
      setFields(p.fields); setMsg({ ok: false, text: p.message })
    } finally { setBusy(false) }
  }

  const signOut = async () => { await logout(); navigate('/') }

  return (
    <div className="card form narrow">
      <h1>Profile</h1>
      <p className="muted">@{user.username} · {user.role === 'admin' ? 'Administrator' : 'Student'} · Joined {fmtDate(user.date_joined)}</p>
      {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`} role="status">{msg.text}</div>}
      <form onSubmit={save} className="stack">
        <div className="grid-2">
          <div className="field"><label htmlFor="fn">First name</label>
            <input id="fn" value={form.first_name} onChange={set('first_name')} maxLength={150} /></div>
          <div className="field"><label htmlFor="ln">Last name</label>
            <input id="ln" value={form.last_name} onChange={set('last_name')} maxLength={150} /></div>
        </div>
        <div className={`field ${fields.email ? 'has-error' : ''}`}><label htmlFor="em">Email</label>
          <input id="em" type="email" value={form.email} onChange={set('email')} required />
          {fields.email && <small className="field-error">{fields.email}</small>}</div>
        <p className="muted small">Your name is shown as the publisher on your announcements.</p>
        <div className="row">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button>
          <button type="button" className="btn" onClick={signOut}><LogOut size={16} /> Log out</button>
        </div>
      </form>
    </div>
  )
}
