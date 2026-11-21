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
  { value: 'none', label: 'No contact', placeholder: '' },
  { value: 'whatsapp', label: 'WhatsApp', placeholder: 'Phone number with country code, e.g. 60123456789' },
  { value: 'email', label: 'Email', placeholder: 'you@example.com' },
  { value: 'link', label: 'External link', placeholder: 'https://forms.gle/...' },
]

export const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''

// Date-only strings (YYYY-MM-DD) should not shift by timezone.
export const fmtDay = (day) => (day ? fmtDate(`${day}T00:00:00`) : '')

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
