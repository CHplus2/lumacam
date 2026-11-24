import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ImagePlus, X } from 'lucide-react'
import api, { parseError } from '../api'
import { useCategories } from '../hooks'
import { EmptyState, ErrorBox, Lumi, ShareBar, Spinner } from '../components/ui'
import { CONTACT_METHODS, emptyCategory, todayISO } from '../utils'
import { CategoryFields, Field } from '../components/fields'
import { PickupInput, StockPicker } from '../components/selling'
import AiPaste from '../components/AiPaste'
import { useAuth } from '../auth'
import { MAX_UPLOAD_BYTES, shrinkImage } from '../image'

const NEW_CATEGORY = '__new__'
const MAX_PICK_MB = 20 // larger photos are downsized before upload
const empty = {
  title: '', category: '', description: '', contact_method: 'none',
  contact_info: '', external_url: '', expires_at: '', event_start: '', event_end: '',
  availability: 'available', pickup_locations: [],
}

export default function AnnouncementForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { categories, loading: catLoading } = useCategories()
  const { user } = useAuth()
  const [canEdit, setCanEdit] = useState(false)
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
  const [aiKeys, setAiKeys] = useState(() => new Set()) // fields Lumi filled, highlighted until posted

  // Load the post being edited.
  useEffect(() => {
    if (!editing) return
    api.get(`/announcements/${id}/`)
      .then(({ data }) => {
        setForm({
          title: data.title, category: String(data.category),
          description: data.description, contact_method: data.contact_method, contact_info: data.contact_info,
          external_url: data.external_url || '', expires_at: data.expires_at || '',
          event_start: data.event_start || '', event_end: data.event_end || '',
          availability: data.availability || 'available', pickup_locations: data.pickup_locations || [],
        })
        setExistingImage(data.image_url)
        setCanEdit(Boolean(data.can_edit))
      })
      .catch((e) => (e.response?.status === 404 ? setNotFound(true) : setError(parseError(e).message)))
      .finally(() => setLoading(false))
  }, [id, editing])

  // Pickup places other posts already use, for one-tap suggestions.
  const [placeSuggestions, setPlaceSuggestions] = useState([])
  useEffect(() => {
    api.get('/pickup-locations/').then(({ data }) => setPlaceSuggestions(data.map((p) => p.name))).catch(() => {})
  }, [])

  useEffect(() => {
    if (!file) { setPreview(null); return undefined }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const ai = (k) => (aiKeys.has(k) ? 'ai-filled' : undefined)

  // Apply AI-suggested fields (already validated by the server); returns what was filled, for the note.
  const applyAi = (f) => {
    const patch = {}
    if (f.title) patch.title = f.title
    if (f.description) patch.description = f.description
    const cat = f.category && categories.find((c) => c.slug === f.category)
    if (cat) patch.category = String(cat.id)
    if (f.event_start) patch.event_start = f.event_start
    if (f.event_end) patch.event_end = f.event_end
    if (f.pickup_locations) patch.pickup_locations = f.pickup_locations
    if (f.contact_method) { patch.contact_method = f.contact_method; patch.contact_info = f.contact_info }
    setForm((prev) => ({ ...prev, ...patch }))
    setAiKeys(new Set(Object.keys(patch)))
    const names = { title: 'title', description: 'description', category: 'category', event_start: 'date', event_end: 'date',
      pickup_locations: 'pickup places', contact_method: 'contact', contact_info: 'contact' }
    return [...new Set(Object.keys(patch).map((k) => names[k]))]
  }
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

  const selling = form.category === NEW_CATEGORY
    ? Boolean(newCat.sells_items)
    : Boolean(categories.find((c) => String(c.id) === String(form.category))?.sells_items)

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
      const { pickup_locations: places, availability, ...rest } = form
      if (selling) {
        body.append('availability', availability)
        body.append('pickup_locations', JSON.stringify(places))
      }
      Object.entries({ ...rest, category: categoryId }).forEach(([k, v]) => {
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
  if (notFound) return <EmptyState mood="sad" title="Announcement not found" text="It may have been deleted."
    action={<Link to="/explore" className="btn btn-primary">Browse announcements</Link>} />
  if (editing && !canEdit) {
    return <EmptyState mood="sad" title="You can't edit this post" text="Only the account that posted it can edit it."
      action={<Link to={`/announcements/${id}`} className="btn btn-primary">Back to the post</Link>} />
  }

  if (success) {
    return (
      <div className="card center-card">
        <Lumi mood="happy" size={190} />
        <h1>Your announcement is live</h1>
        <p className="muted">Everyone can see it now. Share it to your groups so people see it today.</p>
        <ShareBar a={success} big />
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
  const selectedCategory = categories.find((c) => String(c.id) === String(form.category))
  const isEventCategory = selectedCategory?.slug === 'events'

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h1>{editing ? 'Edit announcement' : 'Create announcement'}</h1>
      {!editing && <p className="muted">Your post appears as soon as you submit it. Only you can edit or delete it.</p>}
      <ErrorBox message={error} />

      {!editing && <p className="muted small posting-as">Posting as <strong>{user?.display_name}</strong></p>}
      {!editing && <AiPaste onFill={applyAi} />}

      <Field label="Title" htmlFor="title" error={fields.title}>
        <input id="title" className={ai('title')} value={form.title} onChange={set('title')} maxLength={120} required placeholder="e.g. Homemade nasi lemak, daily pre-order" />
      </Field>

      <Field label="Category" htmlFor="category" error={fields.category}>
        <select id="category" className={ai('category')} value={form.category} onChange={set('category')} required>
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
        {isEventCategory && !form.event_start ? (
          <small className="date-nudge">Add a date so people can find this event by date, and it hides itself after it ends.</small>
        ) : (
          <small className="muted">For events, deadlines or preorders, so people can find it by date. Leave empty if it doesn&apos;t apply.</small>
        )}
      </div>

      {selling && (
        <div className="selling-fields">
          <div className="field">
            <span className="label">Stock</span>
            <StockPicker value={form.availability} onChange={(v) => setForm((f) => ({ ...f, availability: v }))} />
            <small className="muted">You (or anyone) can change this later in one tap on the post.</small>
          </div>
          <Field label="Pickup places (optional)" htmlFor="pickup_input" error={fields.pickup_locations}
            hint="Hostel blocks or campus spots where buyers can collect. Press Enter after each one.">
            <PickupInput value={form.pickup_locations} suggestions={placeSuggestions}
              onChange={(v) => setForm((f) => ({ ...f, pickup_locations: v }))} />
          </Field>
        </div>
      )}

      <Field label="Description" htmlFor="description" error={fields.description} hint={`${form.description.length}/3000`}>
        <textarea id="description" className={ai('description')} rows={6} value={form.description} onChange={set('description')} maxLength={3000} required
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
