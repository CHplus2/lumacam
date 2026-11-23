import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Calendar, ExternalLink, Lock, Mail, MessageCircle, Pencil, Trash2, UserCheck } from 'lucide-react'
import api, { parseError } from '../api'
import { CategoryBadge, EmptyState, ErrorBox, EventBadge, Spinner } from '../components/ui'
import { PickupTags, StockBadge, StockPicker } from '../components/selling'
import EditLink from '../components/EditLink'
import { saveToken, tokenFor } from '../ownership'
import { contactLink, fmtAgo, fmtDate, fmtDay, safeUrl, stockLabel, TRASH_DAYS } from '../utils'

export default function Detail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [a, setA] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [stockBusy, setStockBusy] = useState(false)
  const [stockNote, setStockNote] = useState(null)

  useEffect(() => {
    setLoading(true); setNotFound(false); setError('')
    // A private edit link (#key=...) adds this post's key to this browser, if the key is right.
    const linkKey = new URLSearchParams(window.location.hash.slice(1)).get('key')
    const headers = linkKey && !tokenFor(id) ? { 'X-Edit-Token': linkKey } : undefined
    api.get(`/announcements/${id}/`, { headers })
      .then(({ data }) => {
        if (linkKey) {
          if (data.can_edit) saveToken(id, linkKey)
          window.history.replaceState(null, '', window.location.pathname + window.location.search)
        }
        setA(data)
      })
      .catch((e) => (e.response?.status === 404 ? setNotFound(true) : setError(parseError(e).message)))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <Spinner />
  if (notFound) return <EmptyState title="Announcement not found" text="It may have been deleted."
    action={<Link to="/explore" className="btn btn-primary">Browse announcements</Link>} />
  if (error) return <ErrorBox message={error} />

  const contact = contactLink(a)
  const formUrl = safeUrl(a.external_url)
  const ContactIcon = a.contact_method === 'email' ? Mail : a.contact_method === 'whatsapp' ? MessageCircle : ExternalLink

  // One tap: update right away and roll back if the server says no.
  const setStock = async (availability) => {
    const before = a
    setA({ ...a, availability, stock_updated_at: new Date().toISOString() })
    setStockBusy(true); setStockNote(null)
    try {
      const { data } = await api.patch(`/announcements/${a.id}/`, { availability })
      setA(data)
      setStockNote({ ok: true, text: `Marked as ${stockLabel(availability).toLowerCase()}.` })
    } catch (e) {
      setA(before)
      setStockNote({ ok: false, text: parseError(e).message })
    } finally { setStockBusy(false) }
  }

  const remove = async () => {
    if (!window.confirm(`Move "${a.title}" to the Trash? It disappears for everyone, and you can restore it from the Trash for ${TRASH_DAYS} days.`)) return
    setDeleting(true); setActionError('')
    try {
      await api.delete(`/announcements/${a.id}/`)
      navigate('/explore', { replace: true, state: { trashed: { kind: 'announcement', id: a.id, label: a.title } } })
    } catch (e) {
      setActionError(parseError(e).message)
      setDeleting(false)
    }
  }

  return (
    <article className="detail">
      <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}><ArrowLeft size={16} /> Back</button>

      {a.image_url && <img className="detail-img" src={a.image_url} alt={a.title} />}

      <div className="detail-main card">
        <div className="ann-badges">
          <CategoryBadge category={a.category_detail} />
          {a.event_start && <EventBadge start={a.event_start} end={a.event_end} />}
          {a.availability && <StockBadge value={a.availability} />}
        </div>
        <h1>{a.title}</h1>
        <p className="ann-meta">
          Posted by <strong>{a.publisher_name}</strong> on {fmtDate(a.created_at)}
          {a.expires_at && <> · <Calendar size={14} className="inline" /> Expires {fmtDay(a.expires_at)}</>}
        </p>
        <p className="detail-desc">{a.description}</p>

        {a.pickup_locations?.length > 0 && (
          <div className="detail-section">
            <h3>Pickup</h3>
            <PickupTags places={a.pickup_locations} categorySlug={a.category_detail?.slug} />
          </div>
        )}

        {a.category_detail?.sells_items && (
          <div className="detail-section stock-box">
            <div className="row stock-head">
              <h3>Stock</h3>
              {a.stock_updated_at && <span className="muted small">Updated {fmtAgo(a.stock_updated_at)}</span>}
            </div>
            {a.can_edit ? (
              <>
                <StockPicker value={a.availability} onChange={setStock} disabled={stockBusy} />
                {stockNote
                  ? <small className={stockNote.ok ? 'stock-saved' : 'field-error'} role="status">{stockNote.text}</small>
                  : <small className="muted">Tap to update it for everyone.</small>}
              </>
            ) : (
              <div><StockBadge value={a.availability} /></div>
            )}
          </div>
        )}

        {(contact || formUrl) && (
        <div className="contact-box">
          <h3>{contact ? 'Contact' : 'Links'}</h3>
          {contact && (
            <p className="muted">
              {a.contact_method === 'whatsapp' && `WhatsApp: +${a.contact_info}`}
              {a.contact_method === 'email' && `Email: ${a.contact_info}`}
              {a.contact_method === 'link' && 'Use the link below to get in touch or sign up.'}
            </p>
          )}
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
        )}

        <ErrorBox message={actionError} />
        {a.can_edit ? (
          <div className="manage owner-box">
            <span className="owner-chip"><UserCheck size={14} /> You posted this</span>
            <div className="row">
              <Link to={`/announcements/${a.id}/edit`} className="btn btn-sm"><Pencil size={15} /> Edit</Link>
              <button className="btn btn-sm btn-danger" onClick={remove} disabled={deleting}>
                <Trash2 size={15} /> {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
            <EditLink id={a.id} compact />
          </div>
        ) : (
          <p className="muted small manage owner-note">
            <Lock size={13} className="inline" /> Only the person who posted this can edit or delete it.
          </p>
        )}
      </div>
    </article>
  )
}
