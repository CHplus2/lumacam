import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Calendar, ExternalLink, Flag, Mail, MessageCircle, Pencil, Trash2 } from 'lucide-react'
import api, { parseError } from '../api'
import { useAuth } from '../auth'
import { CategoryBadge, EmptyState, ErrorBox, Spinner, StatusBadge } from '../components/ui'
import { contactLink, fmtDate, fmtDay, safeUrl } from '../utils'

function ReportForm({ id }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      await api.post(`/announcements/${id}/report/`, { reason })
      setMsg({ ok: true, text: 'Thanks. An administrator will review this announcement.' })
      setOpen(false); setReason('')
    } catch (err) {
      const { message, fields } = parseError(err)
      setMsg({ ok: false, text: fields.reason || message })
    } finally { setBusy(false) }
  }

  return (
    <div className="report">
      {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`} role="status">{msg.text}</div>}
      {!open ? (
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}><Flag size={15} /> Report this announcement</button>
      ) : (
        <form onSubmit={submit} className="stack">
          <label htmlFor="reason">What is wrong with this announcement?</label>
          <textarea id="reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} required />
          <div className="row">
            <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Sending...' : 'Submit report'}</button>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}

export default function Detail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()
  const [a, setA] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    setLoading(true); setNotFound(false); setError('')
    api.get(`/announcements/${id}/`)
      .then(({ data }) => setA(data))
      .catch((e) => (e.response?.status === 404 ? setNotFound(true) : setError(parseError(e).message)))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <Spinner />
  if (notFound) return <EmptyState title="Announcement not found" text="It may have been removed, expired or is awaiting approval."
    action={<Link to="/explore" className="btn btn-primary">Browse announcements</Link>} />
  if (error) return <ErrorBox message={error} />

  const contact = contactLink(a)
  const formUrl = safeUrl(a.external_url)
  const isOwner = user && a.publisher_name && user.username && (user.id === a.publisher)
  const canManage = isOwner || isAdmin
  const ContactIcon = a.contact_method === 'email' ? Mail : a.contact_method === 'whatsapp' ? MessageCircle : ExternalLink

  const remove = async () => {
    if (!window.confirm('Delete this announcement permanently?')) return
    try {
      await api.delete(isAdmin && !isOwner ? `/admin/announcements/${a.id}/` : `/announcements/${a.id}/`)
      navigate('/my-announcements')
    } catch (e) { setError(parseError(e).message) }
  }

  return (
    <article className="detail">
      <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}><ArrowLeft size={16} /> Back</button>

      {a.status !== 'approved' && (
        <div className="alert alert-warn">
          This announcement is <StatusBadge status={a.status} /> and is not visible to other students.
          {a.rejection_reason && <> Reason: {a.rejection_reason}</>}
        </div>
      )}

      {a.image_url && <img className="detail-img" src={a.image_url} alt={a.title} />}

      <div className="detail-main card">
        <CategoryBadge category={a.category_detail} />
        <h1>{a.title}</h1>
        <p className="ann-meta">
          Posted by <strong>{a.publisher_name}</strong> on {fmtDate(a.created_at)}
          {a.expires_at && <> · <Calendar size={14} className="inline" /> Expires {fmtDay(a.expires_at)}</>}
        </p>
        <p className="detail-desc">{a.description}</p>

        <div className="contact-box">
          <h3>Contact</h3>
          <p className="muted">
            {a.contact_method === 'whatsapp' && `WhatsApp: +${a.contact_info}`}
            {a.contact_method === 'email' && `Email: ${a.contact_info}`}
            {a.contact_method === 'link' && 'Use the link below to get in touch or sign up.'}
          </p>
          <div className="row">
            {contact && (
              <a className="btn btn-primary" href={contact.href}
                {...(contact.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                <ContactIcon size={18} /> {contact.label}
              </a>
            )}
            {formUrl && (
              <a className="btn" href={formUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={18} /> Register / Open form
              </a>
            )}
          </div>
        </div>

        {canManage && (
          <div className="row manage">
            {isOwner && <Link to={`/announcements/${a.id}/edit`} className="btn btn-sm"><Pencil size={15} /> Edit</Link>}
            <button className="btn btn-sm btn-danger" onClick={remove}><Trash2 size={15} /> Delete</button>
          </div>
        )}
        {user && !isOwner && a.status === 'approved' && <ReportForm id={a.id} />}
      </div>
    </article>
  )
}
