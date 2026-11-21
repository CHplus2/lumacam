import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ImagePlus, X } from 'lucide-react'
import api, { parseError } from '../api'
import { useCategories } from '../hooks'
import { EmptyState, ErrorBox, Spinner } from '../components/ui'
import { CONTACT_METHODS, emptyCategory, todayISO } from '../utils'
import { CategoryFields, Field } from '../components/fields'
import { MAX_UPLOAD_BYTES, shrinkImage } from '../image'

const NEW_CATEGORY = '__new__'
const MAX_PICK_MB = 20 // larger photos are downsized before upload
const empty = {
  publisher_name: '', title: '', category: '', description: '', contact_method: 'none',
  contact_info: '', external_url: '', expires_at: '', event_start: '', event_end: '',
}

export default function AnnouncementForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { categories, loading: catLoading } = useCategories()
  // ?category=<id> preselects a category (e.g. from an empty category page).
  const [form, setForm] = useState(() => ({ ...empty, category: params.get('category') || '' }))
  const [newCat, setNewCat] = useState(emptyCategory)
  const [catErrors, setCatErrors] = useState({})
  // Remember a category created on an earlier (failed) submit so we don't create it twice.
  const [createdCat, setCreatedCat] = useState(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [existingImage, setExistingImage] = useState(null)
  const [removeImage, setRemoveImage] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [loading, setLoading] = useState(editing)
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fields, setFields] = useState({})
  const [success, setSuccess] = useState(null)

  // Load the post being edited.
  useEffect(() => {
    if (!editing) return
    api.get(`/announcements/${id}/`)
      .then(({ data }) => {
        setForm({
          publisher_name: data.publisher_name, title: data.title, category: String(data.category),
          description: data.description, contact_method: data.contact_method, contact_info: data.contact_info,
          external_url: data.external_url || '', expires_at: data.expires_at || '',
          event_start: data.event_start || '', event_end: data.event_end || '',
        })
        setExistingImage(data.image_url)
      })
      .catch((e) => (e.response?.status === 404 ? setNotFound(true) : setError(parseError(e).message)))
      .finally(() => setLoading(false))
  }, [id, editing])

  useEffect(() => {
    if (!file) { setPreview(null); return undefined }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const method = CONTACT_METHODS.find((m) => m.value === form.contact_method)

  const pickFile = async (e) => {
    const input = e.target
    const f = input.files?.[0]
    setFields((x) => ({ ...x, image: undefined }))
    if (!f) return
    const fail = (msg) => { setFields((x) => ({ ...x, image: msg })); input.value = '' }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) return fail('Only JPEG, PNG or WebP images are allowed.')
    if (f.size > MAX_PICK_MB * 1024 * 1024) return fail(`Image must be ${MAX_PICK_MB}MB or smaller.`)
    setPreparing(true)
    try {
      const small = await shrinkImage(f)
      if (small.size > MAX_UPLOAD_BYTES) return fail('This image is too large even after resizing. Try a smaller one.')
      setFile(small); setRemoveImage(false)
    } catch {
      fail('Could not read this image. Try a different file.')
    } finally { setPreparing(false) }
  }

  const clearImage = () => {
    setFile(null)
    if (existingImage) setRemoveImage(true)
    const input = document.getElementById('image')
    if (input) input.value = ''
  }

  const ensureCategory = async () => {
    if (form.category !== NEW_CATEGORY) return form.category
    if (createdCat && createdCat.name === newCat.name.trim()) return createdCat.id
    setCatErrors({})
    try {
      const { data } = await api.post('/categories/', newCat)
      setCreatedCat({ id: data.id, name: newCat.name.trim() })
      return data.id
    } catch (err) {
      const parsed = parseError(err)
      setCatErrors(parsed.fields)
      throw Object.assign(new Error(parsed.message), { parsed })
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(''); setFields({})
    try {
      const categoryId = await ensureCategory()
      const body = new FormData()
      Object.entries({ ...form, category: categoryId }).forEach(([k, v]) => {
        // On create, skip empty optional fields; on edit, send them so they can be cleared.
        if (!editing && ['expires_at', 'external_url', 'event_start', 'event_end'].includes(k) && !v) return
        body.append(k, v)
      })
      if (file) body.append('image', file)
      else if (removeImage) body.append('remove_image', 'true')
      const { data } = editing
        ? await api.patch(`/announcements/${id}/`, body)
        : await api.post('/announcements/', body)
      if (editing) navigate(`/announcements/${data.id}`, { replace: true })
      else setSuccess(data)
    } catch (err) {
      const parsed = err.parsed || parseError(err)
      setError(err.parsed ? `New category: ${parsed.message}` : parsed.message)
      if (!err.parsed) setFields(parsed.fields)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally { setBusy(false) }
  }

  if (loading || catLoading) return <Spinner />
  if (notFound) return <EmptyState title="Announcement not found" text="It may have been deleted."
    action={<Link to="/explore" className="btn btn-primary">Browse announcements</Link>} />

  if (success) {
    return (
      <div className="card center-card">
        <h1>Your announcement is live</h1>
        <p className="muted">Everyone can see it now. You can edit or delete it from its page at any time.</p>
        <div className="row">
          <Link to={`/announcements/${success.id}`} className="btn btn-primary">View announcement</Link>
          <button className="btn" onClick={() => {
            setSuccess(null); setForm(empty); setFile(null); setNewCat(emptyCategory); setCreatedCat(null)
          }}>Post another</button>
        </div>
      </div>
    )
  }

  const shownImage = preview || (removeImage ? null : existingImage)
  const today = todayISO()

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h1>{editing ? 'Edit announcement' : 'Create announcement'}</h1>
      {!editing && <p className="muted">No account needed. Your post appears as soon as you submit it.</p>}
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
          <option value={NEW_CATEGORY}>+ Create a new category</option>
        </select>
      </Field>
      {form.category === NEW_CATEGORY && <div className="new-cat"><CategoryFields value={newCat} onChange={setNewCat} errors={catErrors} /></div>}

      <div className="field">
        <span className="label">When (optional)</span>
        <div className="grid-2">
          <Field label="Start date" htmlFor="event_start" error={fields.event_start}>
            <input id="event_start" type="date" value={form.event_start}
              onChange={(e) => setForm((f) => ({
                ...f, event_start: e.target.value,
                // Keep the range valid if the start moves past the end.
                event_end: f.event_end && e.target.value && f.event_end < e.target.value ? '' : f.event_end,
              }))} />
          </Field>
          <Field label="End date (if more than one day)" htmlFor="event_end" error={fields.event_end}>
            <input id="event_end" type="date" min={form.event_start || today} value={form.event_end}
              disabled={!form.event_start} onChange={set('event_end')} />
          </Field>
        </div>
        <small className="muted">For events, deadlines or preorders, so people can find it by date. Leave empty if it doesn&apos;t apply.</small>
      </div>

      <Field label="Description" htmlFor="description" error={fields.description} hint={`${form.description.length}/3000`}>
        <textarea id="description" rows={6} value={form.description} onChange={set('description')} maxLength={3000} required
          placeholder="Share the details: what, when, where, price, how to join..." />
      </Field>

      <Field label="Image (optional)" error={fields.image} hint={preparing ? 'Preparing image...' : 'JPEG, PNG or WebP. Large photos are resized automatically.'} htmlFor="image">
        {shownImage ? (
          <div className="img-preview">
            <img src={shownImage} alt="Selected" />
            <button type="button" className="icon-btn" aria-label="Remove image" onClick={clearImage}><X size={16} /></button>
          </div>
        ) : (
          <label className="upload" htmlFor="image"><ImagePlus size={22} /> Choose an image</label>
        )}
        <input id="image" type="file" accept="image/jpeg,image/png,image/webp" onChange={pickFile} className={shownImage ? '' : 'sr-only'} />
      </Field>

      <div className={form.contact_method === 'none' ? '' : 'grid-2'}>
        <Field label="Contact (optional)" htmlFor="contact_method" error={fields.contact_method}>
          <select id="contact_method" value={form.contact_method} onChange={set('contact_method')}>
            {CONTACT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
        {form.contact_method !== 'none' && (
          <Field label="Contact details" htmlFor="contact_info" error={fields.contact_info} hint={method.hint}>
            <input id="contact_info" value={form.contact_info} onChange={set('contact_info')} required placeholder={method.placeholder}
              inputMode={form.contact_method === 'whatsapp' ? 'tel' : undefined} />
          </Field>
        )}
      </div>

      <div className="grid-2">
        <Field label="Registration / form link (optional)" htmlFor="external_url" error={fields.external_url}>
          <input id="external_url" type="url" value={form.external_url} onChange={set('external_url')} placeholder="https://" />
        </Field>
        <Field label="Hide after (optional)" htmlFor="expires_at" error={fields.expires_at}
          hint={form.event_start ? 'If empty, the post is hidden after the event ends.' : 'If empty, the post stays up.'}>
          <input id="expires_at" type="date" min={today} value={form.expires_at} onChange={set('expires_at')} />
        </Field>
      </div>

      <div className="row form-actions">
        <button className="btn btn-primary" disabled={busy || preparing}>
          {busy ? (editing ? 'Saving...' : 'Posting...') : (editing ? 'Save changes' : 'Post announcement')}
        </button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </form>
  )
}
