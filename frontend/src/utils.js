import {
  Utensils, ShoppingBag, CalendarDays, ClipboardList, BriefcaseBusiness, Megaphone,
} from 'lucide-react'

export const ICONS = {
  utensils: Utensils,
  'shopping-bag': ShoppingBag,
  'calendar-days': CalendarDays,
  'clipboard-list': ClipboardList,
  'briefcase-business': BriefcaseBusiness,
  megaphone: Megaphone,
}

export const CONTACT_METHODS = [
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

/** Build the primary contact link for an announcement. */
export function contactLink(a) {
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
