import { useSyncExternalStore } from 'react'

// Grid (cards) or list (rows) for post lists, remembered on this device.
const KEY = 'lumacam.view.v1'
const EVENT = 'lumacam-view'
const read = () => { try { return localStorage.getItem(KEY) === 'list' ? 'list' : 'grid' } catch { return 'grid' } }

function subscribe(cb) {
  const onStorage = (e) => { if (e.key === KEY) cb() }
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', onStorage) }
}

export function useViewMode() {
  const mode = useSyncExternalStore(subscribe, read, () => 'grid')
  const setMode = (m) => {
    try { localStorage.setItem(KEY, m) } catch { /* private mode */ }
    window.dispatchEvent(new Event(EVENT))
  }
  return [mode, setMode]
}
