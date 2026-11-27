import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Calendar, ExternalLink, Lock, Mail, MessageCircle, Pencil, Trash2, UserCheck } from 'lucide-react'
import api, { parseError } from '../api'
import { CategoryBadge, EmptyState, ErrorBox, EventBadge, Lumi, ShareBar, Spinner } from '../components/ui'
import { PickupTags, StockBadge, StockPicker } from '../components/selling'
import { useAuth } from '../auth'
import { contactLink, fmtAgo, fmtDate, fmtDay, safeUrl, stockLabel, TRASH_DAYS } from '../utils'

export default function Detail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { loggedIn } = useAuth()
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
    api.get(`/announcements/${id}/`)
      .then(({ data }) => setA(data))
      .catch((e) => (e.response?.status === 404 ? setNotFound(true) : setError(parseError(e).message)))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <Spinner />
  if (notFound) return <EmptyState mood="sad" title="Announcement not found" text="It may have been deleted."
    action={<Link to="/explore" className="btn btn-primary">Browse announcements</Link>} />
  if (error) return <ErrorBox message={error} />

  const contact = contactLink(a)
  // The server hides phone numbers and emails from guests; offer sign-in instead.
  const contactLocked = !loggedIn && ['whatsapp', 'email'].includes(a.contact_method)
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

      {a.image_url && <img className="detail-img" src={a.image_url} alt={a.image_alt || a.title} />}

      <div className="detail-main card">
        <div className="ann-badges">
          <CategoryBadge category={a.category_detail} sub={a.subcategory_name} />
          {a.event_start && <EventBadge start={a.event_start} end={a.event_end} />}
          {a.availability && <StockBadge value={a.availability} />}
        </div>
        <h1>{a.title}</h1>
        <p className="ann-meta">
          Posted by <strong>{a.publisher_name}</strong> on {fmtDate(a.created_at)}
          {a.expires_at && <> · <Calendar size={14} className="inline" /> Expires {fmtDay(a.expires_at)}</>}
        </p>
        <ShareBar a={a} />
        {a.lost_found && (
          <p className="ann-meta">
            <strong>{a.lost_found === 'lost' ? 'Lost' : 'Found'}</strong>
            {a.lost_found_place && <> at {a.lost_found_place}</>}
            {a.lost_found_date && <> on {fmtDay(a.lost_found_date)}</>}
          </p>
        )}
        <p className="detail-desc">{a.description}</p>
        {a.can_edit && a.lost_found && <LostFoundMatches postId={a.id} />}

        {a.pickup_locations?.length > 0 && (
          <div className="detail-section" data-tour="pickup">
            <h3>Pickup</h3>
            <PickupTags places={a.pickup_locations} categorySlug={a.category_detail?.slug} />
          </div>
        )}

        {a.category_detail?.sells_items && (
          <div className="detail-section stock-box" data-tour="stock">
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

        {(contact || formUrl || contactLocked) && (
        <div className="contact-box">
          <h3>{contact || contactLocked ? 'Contact' : 'Links'}</h3>
          {contactLocked && <p className="muted">Sign in to see their {a.contact_method === 'email' ? 'email' : 'WhatsApp number'}. It's free and takes a minute.</p>}
          {contact && (
            <p className="muted">
              {a.contact_method === 'whatsapp' && `WhatsApp: +${a.contact_info}`}
              {a.contact_method === 'email' && `Email: ${a.contact_info}`}
              {a.contact_method === 'link' && 'Use the link below to get in touch or sign up.'}
            </p>
          )}
          <div className="row">
            {contactLocked && (
              <Link className="btn btn-primary" to={`/login?next=/announcements/${a.id}`}>
                <Lock size={18} /> Sign in to contact
              </Link>
            )}
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
          </div>
        ) : (
          <p className="muted small manage owner-note">
            <Lock size={13} className="inline" /> Only the person who posted this can edit or delete it.
            {!loggedIn && <> <Link to={`/login?next=/announcements/${a.id}`}>Log in</Link> to manage your own posts.</>}
          </p>
        )}
      </div>
    </article>
  )
}

/** Owner only: posts Lumi thinks could be the other half of this lost or found item. */
function LostFoundMatches({ postId }) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    api.get(`/announcements/${postId}/matches/`).then(({ data }) => setRows(data)).catch(() => {})
  }, [postId])
  if (!rows.length) return null

  const dismiss = (matchId) => {
    setRows((r) => r.filter((m) => m.id !== matchId))
    api.post(`/lost-found-matches/${matchId}/dismiss/`).catch(() => {})
  }
  return (
    <section className="detail-section stock-box lf-matches" aria-label="Possible matches">
      <div className="row">
        <Lumi mood="found" size={56} />
        <div>
          <h3>Possible matches</h3>
          <p className="muted small">Only you can see these. Open one and contact them through the post.</p>
        </div>
      </div>
      <ul>
        {rows.map((m) => (
          <li key={m.id} className="lf-match">
            <Link to={`/announcements/${m.post.id}`}>
              <strong>{m.post.title}</strong>
              <span className="muted small">{m.reason}</span>
            </Link>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => dismiss(m.id)}>Not mine</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
