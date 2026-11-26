import { useSyncExternalStore } from 'react'

// Notification choices without accounts, kept in this browser only:
// - slugs: categories you follow (used by the in-app bell and phone notifications)
// - lastSeen: when you last marked the bell's list as seen
// - push: whether phone notifications are on, and their limits
const KEY = 'lumacam.follows.v1'
const EVENT = 'lumacam-follows'

export const FREQUENCIES = [
  { value: 'every', label: 'Every new post', hint: 'You may get several in a row when a category is busy.' },
  { value: 'hourly', label: 'At most one an hour', hint: 'Recommended. Busy categories won\'t flood your phone.' },
  { value: 'daily', label: 'At most one a day', hint: 'The quietest option.' },
]
const DEFAULT_PUSH = { on: false, frequency: 'hourly', quietHours: true }
const EMPTY = { slugs: [], lastSeen: null, push: DEFAULT_PUSH }
let cache = null

function read() {
  if (cache) return cache
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    cache = raw && Array.isArray(raw.slugs)
      ? { slugs: raw.slugs, lastSeen: raw.lastSeen || null, push: { ...DEFAULT_PUSH, ...(raw.push || {}) } }
      : EMPTY
  } catch {
    cache = EMPTY
  }
  return cache
}

function write(next) {
  cache = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode: keep in memory */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(cb) {
  const onStorage = (e) => { if (e.key === KEY) { cache = null; cb() } }
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', onStorage) // other tabs
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', onStorage) }
}

/** Current settings, outside React. */
export const readFollows = () => read()

/** Replace this device's copy with the account's settings (keeps push on/off, which is per device). */
export function applyAccountPrefs(prefs) {
  const cur = read()
  write({
    ...cur,
    slugs: prefs.categories,
    lastSeen: cur.lastSeen || new Date().toISOString(),
    push: { ...cur.push, frequency: prefs.frequency, quietHours: prefs.quiet_hours },
  })
}

/** Forget everything on log out, so the next person on this device starts fresh. */
export const clearFollows = () => write(EMPTY)

export function useFollows() {
  const state = useSyncExternalStore(subscribe, read, () => EMPTY)
  return {
    ...state,
    isFollowing: (slug) => state.slugs.includes(slug),
    toggle: (slug) => {
      const cur = read()
      const slugs = cur.slugs.includes(slug) ? cur.slugs.filter((s) => s !== slug) : [...cur.slugs, slug]
      // Start counting from the moment you first follow something, so you aren't
      // greeted with every old post as "new".
      write({ ...cur, slugs, lastSeen: cur.lastSeen || new Date().toISOString() })
    },
    markSeen: () => write({ ...read(), lastSeen: new Date().toISOString() }),
    setPush: (patch) => { const cur = read(); write({ ...cur, push: { ...cur.push, ...patch } }) },
  }
}
