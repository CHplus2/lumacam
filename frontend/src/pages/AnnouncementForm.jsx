import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ImagePlus, X } from 'lucide-react'
import api, { parseError } from '../api'
import { useCategories } from '../hooks'
import { useAuth } from '../auth'
import { ErrorBox, Spinner } from '../components/ui'
import { CONTACT_METHODS } from '../utils'

const MAX_MB = 5
const empty = {
  publisher_name: '', title: '', category: '', description: '', contact_method: 'whatsapp',
  contact_info: '', external_url: '', expires_at: '',
}

function Field({ label, error, hint, children, htmlFor }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <small className="muted">{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </div>
  )
}

export default function AnnouncementForm() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const { categories, loading: catLoading } = useCategories()
  const [form, setForm] = useState(empty)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fields, setFields] = useState({})
  const [success, setSuccess] = useState(null)

  useEffect(() => {
    if (!file) { setPreview(null); return undefined }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const method = CONTACT_METHODS.find((m) => m.value === form.contact_method)

  const pickFile = (e) => {
    const f = e.target.files?.[0]
    setFields((x) => ({ ...x, image: undefined }))
    if (!f) return setFile(null)
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
      setFields((x) => ({ ...x, image: 'Only JPEG, PNG or WebP images are allowed.' })); e.target.value = ''; return
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setFields((x) => ({ ...x, image: `Image must be ${MAX_MB}MB or smaller.` })); e.target.value = ''; return
    }
    setFile(f)
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(''); setFields({})
    const body = new FormData()
    Object.entries(form).forEach(([k, v]) => {
      if ((k === 'expires_at' || k === 'external_url') && !v) return
      body.append(k, v)
    })
    if (file) body.append('image', file)
    try {
      const { data } = await api.post('/announcements/', body)
      setSuccess(data)
    } catch (err) {
      const parsed = parseError(err)
      setError(parsed.message); setFields(parsed.fields)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally { setBusy(false) }
  }

  if (catLoading) return <Spinner />

  if (success) {
    const live = success.status === 'approved'
    return (
      <div className="card center-card">
        <h1>Announcement submitted</h1>
        <p className="muted">
          {live
            ? 'Your announcement is live.'
            : 'Thanks! Your announcement is pending approval and will appear for everyone once a moderator approves it.'}
        </p>
        <div className="row">
          <Link to="/explore" className="btn btn-primary">Browse announcements</Link>
          <button className="btn" onClick={() => { setSuccess(null); setForm(empty); setFile(null) }}>Post another</button>
        </div>
      </div>
    )
  }

  const shownImage = preview
  const today = new Date().toISOString().slice(0, 10)

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h1>Create announcement</h1>
      {!isAdmin && <p className="muted">No account needed. A moderator reviews every post before it goes live.</p>}
      <ErrorBox message={error} />

      <Field label="Your name" htmlFor="publisher_name" error={fields.publisher_name} hint="Shown as the publisher">
        <input id="publisher_name" value={form.publisher_name} onChange={set('publisher_name')} maxLength={80} required autoComplete="name" />
      </Field>

      <Field label="Title" htmlFor="title" error={fields.title}>
        <input id="title" value={form.title} onChange={set('title')} maxLength={120} required placeholder="e.g. Homemade nasi lemak, daily pre-order" />
      </Field>

      <Field label="Category" htmlFor="category" error={fields.category}>
        <select id="category" value={form.category} onChange={set('category')} required>
          <option value="" disabled>Select a category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>

      <Field label="Description" htmlFor="description" error={fields.description} hint={`${form.description.length}/3000`}>
        <textarea id="description" rows={6} value={form.description} onChange={set('description')} maxLength={3000} required
          placeholder="Share the details: what, when, where, price, how to join..." />
      </Field>

      <Field label="Image (optional)" error={fields.image} hint={`JPEG, PNG or WebP, up to ${MAX_MB}MB`} htmlFor="image">
        {shownImage ? (
          <div className="img-preview">
            <img src={shownImage} alt="Selected" />
            <button type="button" className="icon-btn" aria-label="Remove image"
              onClick={() => setFile(null)}><X size={16} /></button>
          </div>
        ) : (
          <label className="upload" htmlFor="image"><ImagePlus size={22} /> Choose an image</label>
        )}
        <input id="image" type="file" accept="image/jpeg,image/png,image/webp" onChange={pickFile} className={shownImage ? '' : 'sr-only'} />
      </Field>

      <div className="grid-2">
        <Field label="Contact method" htmlFor="contact_method" error={fields.contact_method}>
          <select id="contact_method" value={form.contact_method} onChange={set('contact_method')}>
            {CONTACT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Contact details" htmlFor="contact_info" error={fields.contact_info}>
          <input id="contact_info" value={form.contact_info} onChange={set('contact_info')} required placeholder={method.placeholder}
            inputMode={form.contact_method === 'whatsapp' ? 'tel' : undefined} />
        </Field>
      </div>

      <div className="grid-2">
        <Field label="Registration / form link (optional)" htmlFor="external_url" error={fields.external_url}>
          <input id="external_url" type="url" value={form.external_url} onChange={set('external_url')} placeholder="https://" />
        </Field>
        <Field label="Expiry date (optional)" htmlFor="expires_at" error={fields.expires_at}>
          <input id="expires_at" type="date" min={today} value={form.expires_at} onChange={set('expires_at')} />
        </Field>
      </div>

      <div className="row form-actions">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting...' : 'Submit for approval'}</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </form>
  )
}
