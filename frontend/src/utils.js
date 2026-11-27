import {
  Utensils, ShoppingBag, CalendarDays, ClipboardList, BriefcaseBusiness, Megaphone, Tag, BookOpen,
  Music, Dumbbell, HeartHandshake, Laptop, Gamepad2, House, Bus, Shirt, Palette, Trophy, Sparkles,
} from 'lucide-react'

// Keep in sync with CATEGORY_ICONS / CATEGORY_COLORS in backend/announcements/serializers.py.
export const ICONS = {
  utensils: Utensils,
  'shopping-bag': ShoppingBag,
  'calendar-days': CalendarDays,
  'clipboard-list': ClipboardList,
  'briefcase-business': BriefcaseBusiness,
  megaphone: Megaphone,
  tag: Tag,
  'book-open': BookOpen,
  music: Music,
  dumbbell: Dumbbell,
  'heart-handshake': HeartHandshake,
  laptop: Laptop,
  'gamepad-2': Gamepad2,
  house: House,
  bus: Bus,
  shirt: Shirt,
  palette: Palette,
  trophy: Trophy,
  sparkles: Sparkles,
}

export const CATEGORY_COLORS = ['orange', 'blue', 'violet', 'teal', 'emerald', 'rose']
export const emptyCategory = { name: '', description: '', icon: 'tag', color: 'blue', sells_items: false, subcategories: [] }
export const MAX_SUBCATEGORIES = 12

export const CONTACT_METHODS = [
  { value: 'none', label: 'No contact', placeholder: '', hint: '' },
  { value: 'whatsapp', label: 'WhatsApp', placeholder: 'e.g. 60123456789', hint: 'Phone number with country code' },
  { value: 'email', label: 'Email', placeholder: 'you@example.com', hint: '' },
  { value: 'link', label: 'External link', placeholder: 'https://...', hint: 'e.g. an Instagram page or Google Form' },
]

// Stock status for posts in categories that sell food or items.
export const STOCK = [
  { value: 'available', label: 'Available' },
  { value: 'limited', label: 'Limited stock' },
  { value: 'out', label: 'Out of stock' },
]
export const stockLabel = (value) => STOCK.find((s) => s.value === value)?.label || ''
export const MAX_PICKUPS = 5

// Only allow going back to a page on this site (after logging in or onboarding).
export const safeNext = (next) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/')

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago". */
export function fmtAgo(iso) {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

// Keep in sync with TRASH_DAYS in backend settings.
export const TRASH_DAYS = 30

const DAY = 24 * 60 * 60 * 1000

/** "today", "yesterday", "3 days ago". */
export function fmtRelative(iso) {
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(new Date()) - startOf(new Date(iso))) / DAY)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** "in 28 days", "tomorrow", "within a day". */
export function timeLeft(iso) {
  if (!iso) return ''
  const days = Math.floor((new Date(iso).getTime() - Date.now()) / DAY)
  if (days < 1) return 'within a day'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

export const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''

// Date-only strings (YYYY-MM-DD) should not shift by timezone.
export const fmtDay = (day) => (day ? fmtDate(`${day}T00:00:00`) : '')

// ---- Local calendar dates (YYYY-MM-DD in the user's timezone, not UTC) ----
const pad = (n) => String(n).padStart(2, '0')
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseISODate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const todayISO = () => toISODate(new Date())

/** Date range for a quick filter, as { from, to } (inclusive), counted from today. */
export function quickRange(key, now = new Date()) {
  const days = { today: 0, week: 6, month: 29 }[key]
  if (days === undefined) return null
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start); end.setDate(start.getDate() + days)
  return { from: toISODate(start), to: toISODate(end) }
}

/**
 * Event date label in the reader's locale, e.g. "Sat, 28 Nov" or "25–28 Nov"
 * ("Nov 25 – 28" in US English). The year is shown when it isn't this year.
 */
export function fmtEventRange(start, end) {
  if (!start) return ''
  const s = parseISODate(start)
  const e = end ? parseISODate(end) : null
  const thisYear = new Date().getFullYear()
  const withYear = s.getFullYear() !== thisYear || (e && e.getFullYear() !== thisYear)
  const base = { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }
  if (!e) return s.toLocaleDateString(undefined, { ...base, weekday: 'short' })
  const fmt = new Intl.DateTimeFormat(undefined, base)
  return typeof fmt.formatRange === 'function'
    ? fmt.formatRange(s, e)
    : `${fmt.format(s)} – ${fmt.format(e)}`
}

const isHttp = (u) => /^https?:\/\//i.test(u || '')
export const safeUrl = (u) => (isHttp(u) ? u : null)

// The server refuses to delete a category that still has posts; mirror that here.
export function categoryDeleteBlocker(c) {
  const n = c.announcement_count || 0
  return n ? `"${c.name}" still has ${n} announcement${n === 1 ? '' : 's'}. Delete them or move them to another category first.` : ''
}

/** Build the primary contact link for an announcement. */
export function contactLink(a) {
  if (!a.contact_method || a.contact_method === 'none' || !a.contact_info) return null
  if (a.contact_method === 'whatsapp') {
    const digits = (a.contact_info || '').replace(/\D/g, '')
    return digits ? { href: `https://wa.me/${digits}`, label: 'Chat on WhatsApp', external: true } : null
  }
  if (a.contact_method === 'email') {
    return { href: `mailto:${a.contact_info}?subject=${encodeURIComponent(`Re: ${a.title}`)}`, label: 'Send an email', external: false }
  }
  const href = safeUrl(a.contact_info)
  return href ? { href, label: 'Open link', external: true } : null
}
