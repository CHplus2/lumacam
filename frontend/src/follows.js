import { useSyncExternalStore } from 'react'

// "Follow a category" without accounts: the list of followed category slugs and
// the time you last opened notifications are kept in this browser only.
const KEY = 'lumacam.follows.v1'
const EVENT = 'lumacam-follows'

const EMPTY = { slugs: [], lastSeen: null }
let cache = null

function read() {
  if (cache) return cache
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    cache = raw && Array.isArray(raw.slugs) ? { slugs: raw.slugs, lastSeen: raw.lastSeen || null } : EMPTY
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
      write({ slugs, lastSeen: cur.lastSeen || new Date().toISOString() })
    },
    markSeen: () => write({ ...read(), lastSeen: new Date().toISOString() }),
  }
}
