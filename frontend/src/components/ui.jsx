import { Link } from 'react-router-dom'
import { Inbox, LoaderCircle } from 'lucide-react'
import { ICONS, fmtDate } from '../utils'

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

export function CategoryCard({ category }) {
  const Icon = ICONS[category.icon]
  return (
    <Link to={`/category/${category.slug}`} className={`cat-card tone-${category.color}`}>
      <span className="cat-icon">{Icon && <Icon size={26} strokeWidth={2} />}</span>
      <span className="cat-name">{category.name}</span>
      <span className="cat-desc">{category.description}</span>
      {category.announcement_count !== undefined && (
        <span className="cat-count">{category.announcement_count} active</span>
      )}
    </Link>
  )
}

export function AnnouncementCard({ a, to, footer }) {
  const Icon = ICONS[a.category_detail?.icon]
  return (
    <article className="card ann-card">
      <Link to={to || `/announcements/${a.id}`} className="ann-link">
        <div className={`ann-thumb tone-${a.category_detail?.color || 'blue'}`}>
          {a.image_url
            ? <img src={a.image_url} alt="" loading="lazy" />
            : Icon && <Icon size={40} strokeWidth={1.6} />}
        </div>
        <div className="ann-body">
          <CategoryBadge category={a.category_detail} />
          <h3 className="ann-title">{a.title}</h3>
          <p className="ann-desc">{a.description}</p>
          <p className="ann-meta">{a.publisher_name} · {fmtDate(a.created_at)}</p>
        </div>
      </Link>
      {footer}
    </article>
  )
}
