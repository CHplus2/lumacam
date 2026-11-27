import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ExternalLink, Link2, LoaderCircle, Mail, MapPin, MessageCircle } from 'lucide-react'
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

/** Lumi the mascot (public/mascot/). Animated, or still when the device asks for reduced motion. */
export function Lumi({ mood, size = 120 }) {
  return (
    <picture>
      <source srcSet={`/mascot/lumi-${mood}.svg`} media="(prefers-reduced-motion: reduce)" />
      <img className="lumi" src={`/mascot/lumi-${mood}-animated.svg`} alt="" width={size} />
    </picture>
  )
}

/** Share a post where students already are (WhatsApp), with copy-link as the fallback. */
export function ShareBar({ a, big = false }) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/announcements/${a.id}`
  const text = `${a.title}\n${url}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link:', url) // clipboard blocked (e.g. http or old browser)
    }
  }
  return (
    <div className={`share-bar ${big ? 'big' : ''}`}>
      <a className="btn btn-whatsapp" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
        <MessageCircle size={18} /> Share to WhatsApp
      </a>
      <button type="button" className="btn" onClick={copy} aria-live="polite">
        <Link2 size={18} /> {copied ? 'Link copied' : 'Copy link'}
      </button>
    </div>
  )
}

export function EmptyState({ title, text, action, mood = 'sleepy' }) {
  return (
    <div className="empty">
      <Lumi mood={mood} size={160} />
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

export function CategoryBadge({ category, sub }) {
  if (!category) return null
  const Icon = ICONS[category.icon]
  return (
    <span className={`badge tone-${category.color}`}>
      {Icon && <Icon size={13} />}{category.name}{sub && <span className="badge-sub">{' '}· {sub}</span>}
    </span>
  )
}

export function CategoryCard({ category, preview = false }) {
  const Icon = ICONS[category.icon]
  const Tag = preview ? 'div' : Link
  return (
    <Tag {...(preview ? {} : { to: `/category/${category.slug}` })} className={`cat-card tone-${category.color}`}>
      {/* Symbol, name and count are separate rows sharing one left edge. */}
      <span className="cat-symbol" aria-hidden="true">{Icon && <Icon size={30} strokeWidth={2} />}</span>
      <span className="cat-name">{category.name}</span>
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
        <Icon size={15} /> <span className="btn-label">{SHORT_LABELS[a.contact_method] || contact.label}</span>
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
            ? <img src={a.image_url} alt={a.image_alt || ''} loading="lazy" />
            : Icon && <Icon size={40} strokeWidth={1.6} />}
          {a.event_start && <DateTile start={a.event_start} end={a.event_end} />}
          {a.availability && <StockBadge value={a.availability} className="on-image" />}
        </div>
        <div className="ann-body">
          <div className="ann-badges">
            <CategoryBadge category={a.category_detail} sub={a.subcategory_name} />
            {a.event_start && <EventBadge start={a.event_start} end={a.event_end} />}
            {a.availability && <StockBadge value={a.availability} className="list-only" />}
          </div>
          <h3 className="ann-title">{a.title}</h3>
          <p className="ann-desc">{a.description}</p>
          {a.pickup_locations?.length > 0 && (
            <p className="ann-place">
              <MapPin size={14} />
              <span>{a.pickup_locations[0]}{a.pickup_locations.length > 1 && ` +${a.pickup_locations.length - 1} more`}</span>
            </p>
          )}
          <p className="ann-meta">Posted by {a.publisher_name} · {fmtDate(a.created_at)}{a.can_edit && <span className="mine-chip">Yours</span>}</p>
        </div>
      </Link>
      {footer === undefined ? <QuickContact a={a} /> : footer}
    </article>
  )
}
