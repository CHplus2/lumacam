import { Link } from 'react-router-dom'
import { CalendarDays, ExternalLink, Inbox, LoaderCircle, Mail, MapPin, MessageCircle } from 'lucide-react'
import { StockBadge } from './selling'
import { ICONS, contactLink, fmtDate, fmtEventRange, parseISODate } from '../utils'

export function Spinner({ label = 'Loading...' }) {
  return (
    <div className="spinner" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={28} />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ title, text, action, icon: Icon = Inbox }) {
  return (
    <div className="empty">
      <Icon size={36} />
      <h3>{title}</h3>
      {text && <p className="muted">{text}</p>}
      {action}
    </div>
  )
}

export function ErrorBox({ message, onRetry }) {
  if (!message) return null
  return (
    <div className="alert alert-error" role="alert">
      <span>{message}</span>
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  )
}

export function CategoryBadge({ category }) {
  if (!category) return null
  const Icon = ICONS[category.icon]
  return (
    <span className={`badge tone-${category.color}`}>
      {Icon && <Icon size={13} />}{category.name}
    </span>
  )
}

export function CategoryCard({ category, preview = false }) {
  const Icon = ICONS[category.icon]
  const Tag = preview ? 'div' : Link
  return (
    <Tag {...(preview ? {} : { to: `/category/${category.slug}` })} className={`cat-card tone-${category.color}`}>
      <span className="cat-head">
        <span className="cat-icon">{Icon && <Icon size={26} strokeWidth={2} />}</span>
        <span className="cat-name">{category.name}</span>
      </span>
      <span className="cat-desc">{category.description}</span>
      {category.announcement_count !== undefined && (
        <span className="cat-count">{category.announcement_count} active</span>
      )}
    </Tag>
  )
}

export function EventBadge({ start, end }) {
  return <span className="event-badge"><CalendarDays size={13} />{fmtEventRange(start, end)}</span>
}

/** Calendar-style tile ("28 NOV") so the event date stands out on a card. */
function DateTile({ start, end }) {
  const d = parseISODate(start)
  return (
    <span className="date-tile" aria-hidden="true">
      <span className="date-tile-day">{d.getDate()}</span>
      <span className="date-tile-month">{d.toLocaleDateString(undefined, { month: 'short' })}</span>
      {end && <span className="date-tile-more">+{Math.round((parseISODate(end) - d) / 86400000)}d</span>}
    </span>
  )
}

const CONTACT_ICONS = { whatsapp: MessageCircle, email: Mail, link: ExternalLink }
const SHORT_LABELS = { whatsapp: 'WhatsApp', email: 'Email', link: 'Open link' }

function QuickContact({ a }) {
  const contact = contactLink(a)
  if (!contact) return null
  const Icon = CONTACT_ICONS[a.contact_method] || ExternalLink
  return (
    <div className="ann-actions">
      <a className={`btn btn-sm contact-${a.contact_method}`} href={contact.href}
        {...(contact.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        aria-label={`${contact.label}: ${a.title}`}>
        <Icon size={15} /> {SHORT_LABELS[a.contact_method] || contact.label}
      </a>
    </div>
  )
}

export function AnnouncementCard({ a, to, footer }) {
  const Icon = ICONS[a.category_detail?.icon]
  return (
    <article className={`card ann-card ${a.availability === 'out' ? 'is-out' : ''}`}>
      <Link to={to || `/announcements/${a.id}`} className="ann-link">
        <div className={`ann-thumb tone-${a.category_detail?.color || 'blue'}`}>
          {a.image_url
            ? <img src={a.image_url} alt="" loading="lazy" />
            : Icon && <Icon size={40} strokeWidth={1.6} />}
          {a.event_start && <DateTile start={a.event_start} end={a.event_end} />}
          {a.availability && <StockBadge value={a.availability} className="on-image" />}
        </div>
        <div className="ann-body">
          <div className="ann-badges">
            <CategoryBadge category={a.category_detail} />
            {a.event_start && <EventBadge start={a.event_start} end={a.event_end} />}
          </div>
          <h3 className="ann-title">{a.title}</h3>
          <p className="ann-desc">{a.description}</p>
          {a.pickup_locations?.length > 0 && (
            <p className="ann-place">
              <MapPin size={14} />
              <span>{a.pickup_locations[0]}{a.pickup_locations.length > 1 && ` +${a.pickup_locations.length - 1} more`}</span>
            </p>
          )}
          <p className="ann-meta">Posted by {a.publisher_name} · {fmtDate(a.created_at)}</p>
        </div>
      </Link>
      {footer === undefined ? <QuickContact a={a} /> : footer}
    </article>
  )
}
