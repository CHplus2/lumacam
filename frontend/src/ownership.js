import { useSyncExternalStore } from 'react'

// Posts uploaded from this browser, and their secret edit keys ({ [postId]: key }).
// Only the browser holding a post's key can edit it, delete it, change its stock
// or restore it from the Trash; the server checks the key.
const KEY = 'lumacam.myposts.v1'
const EVENT = 'lumacam-myposts'
let cache = null

function read() {
  if (cache) return cache
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    cache = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    cache = {}
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
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', onStorage) }
}

export const tokenFor = (id) => read()[String(id)] || null
export const saveToken = (id, token) => { if (id && token) write({ ...read(), [String(id)]: token }) }
export const myPostIds = () => Object.keys(read())

export function useMyPosts() {
  const keys = useSyncExternalStore(subscribe, read, () => ({}))
  return { isMine: (id) => Boolean(keys[String(id)]), ids: Object.keys(keys) }
}

/** Private link that lets the poster manage the post from another device. */
export const editLink = (id) => {
  const token = tokenFor(id)
  return token ? `${window.location.origin}/announcements/${id}#key=${encodeURIComponent(token)}` : null
}

// Requests about one post: /announcements/12/ and /trash/announcements/12/restore/
const POST_URL = /^\/?(?:trash\/)?announcements\/(\d+)\//

/** Axios interceptor: attach this browser's key for the post the request is about. */
export function attachEditKey(config) {
  const m = POST_URL.exec(config.url || '')
  const token = m && tokenFor(m[1])
  if (!token) return config
  // Set it in place so axios keeps its other headers (e.g. multipart Content-Type).
  if (config.headers && typeof config.headers.set === 'function') config.headers.set('X-Edit-Token', token)
  else config.headers = { ...(config.headers || {}), 'X-Edit-Token': token }
  return config
}
