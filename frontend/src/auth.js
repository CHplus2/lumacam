import { useSyncExternalStore } from 'react'

// Logged-in account for this device: { token, user } in localStorage, so you
// log in once and stay logged in until you log out.
const KEY = 'lumacam.auth.v1'
const EVENT = 'lumacam-auth'
const EMPTY = { token: null, user: null }
let cache = null

function read() {
  if (cache) return cache
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    cache = raw && raw.token && raw.user ? raw : EMPTY
  } catch {
    cache = EMPTY
  }
  return cache
}

function write(next) {
  cache = next
  try {
    if (next.token) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch { /* private mode: keep in memory */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(cb) {
  const onStorage = (e) => { if (e.key === KEY) { cache = null; cb() } }
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', onStorage) // log in/out in other tabs too
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', onStorage) }
}

export const authToken = () => read().token
export const setAuth = (token, user) => write({ token, user })
export const clearAuth = () => write(EMPTY)

export function useAuth() {
  const state = useSyncExternalStore(subscribe, read, () => EMPTY)
  return { ...state, loggedIn: Boolean(state.token) }
}
