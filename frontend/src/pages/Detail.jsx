import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Calendar, ExternalLink, Mail, MessageCircle, Pencil, Trash2 } from 'lucide-react'
import api, { parseError } from '../api'
import { CategoryBadge, EmptyState, ErrorBox, Spinner } from '../components/ui'
import { contactLink, fmtDate, fmtDay, safeUrl } from '../utils'

export default function Detail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState('')
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
  if (notFound) return <EmptyState title="Announcement not found" text="It may have been deleted."
    action={<Link to="/explore" className="btn btn-primary">Browse announcements</Link>} />
  if (error) return <ErrorBox message={error} />

  const contact = contactLink(a)
  const formUrl = safeUrl(a.external_url)
  const ContactIcon = a.contact_method === 'email' ? Mail : a.contact_method === 'whatsapp' ? MessageCircle : ExternalLink

  const remove = async () => {
    if (!window.confirm(`Delete "${a.title}"? It will disappear for everyone.`)) return
    setDeleting(true); setActionError('')
    try {
      await api.delete(`/announcements/${a.id}/`)
      navigate('/explore', { replace: true })
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

        <ErrorBox message={actionError} />
        <div className="row manage">
          <Link to={`/announcements/${a.id}/edit`} className="btn btn-sm"><Pencil size={15} /> Edit</Link>
          <button className="btn btn-sm btn-danger" onClick={remove} disabled={deleting}>
            <Trash2 size={15} /> {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </article>
  )
}
