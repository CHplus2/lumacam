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
export const emptyCategory = { name: '', description: '', icon: 'tag', color: 'blue' }

export const CONTACT_METHODS = [
  { value: 'none', label: 'No contact', placeholder: '', hint: '' },
  { value: 'whatsapp', label: 'WhatsApp', placeholder: 'e.g. 60123456789', hint: 'Phone number with country code' },
  { value: 'email', label: 'Email', placeholder: 'you@example.com', hint: '' },
  { value: 'link', label: 'External link', placeholder: 'https://...', hint: 'e.g. an Instagram page or Google Form' },
]

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
