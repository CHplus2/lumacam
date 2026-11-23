import api from './api'

// Browser side of phone notifications (Web Push). The server stores the
// subscription with the chosen categories and limits; see backend push.py.

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

// iPhone/iPad only allow web push for sites added to the Home Screen.
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

export const permission = () => (('Notification' in window) ? Notification.permission : 'unsupported')

function keyToBytes(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export function registerWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  return navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

export async function currentSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration('/')
  return reg ? reg.pushManager.getSubscription() : null
}

function settingsBody(sub, { slugs, frequency, quietHours }) {
  return {
    subscription: sub.toJSON(),
    categories: slugs,
    frequency,
    quiet_hours: quietHours,
    // getTimezoneOffset is minutes *behind* UTC (Malaysia: -480); the server wants minutes ahead.
    utc_offset_minutes: -new Date().getTimezoneOffset(),
  }
}

/** Ask permission (must run from a tap), subscribe this device, and save its settings on the server. */
export async function enablePush(prefs) {
  if (!pushSupported()) throw new Error('This browser does not support notifications.')
  const result = await Notification.requestPermission()
  if (result !== 'granted') {
    throw new Error(result === 'denied'
      ? 'Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.'
      : 'Notifications were not allowed.')
  }
  const reg = await registerWorker()
  await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    const { data } = await api.get('/push/key/')
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(data.public_key) })
  }
  await api.post('/push/subscribe/', settingsBody(sub, prefs))
  return sub
}

/** Save new categories or limits for an already-subscribed device. Returns false if not subscribed. */
export async function updatePush(prefs) {
  const sub = await currentSubscription()
  if (!sub) return false
  await api.post('/push/subscribe/', settingsBody(sub, prefs))
  return true
}

export async function disablePush() {
  const sub = await currentSubscription()
  if (!sub) return
  try { await api.post('/push/unsubscribe/', { endpoint: sub.endpoint }) } finally { await sub.unsubscribe() }
}

export async function sendTestPush() {
  const sub = await currentSubscription()
  if (!sub) throw new Error('Phone notifications are not on for this device.')
  await api.post('/push/test/', { endpoint: sub.endpoint })
}

/** True only if this device has a live subscription and the server still has it. */
export async function pushIsActive() {
  if (permission() !== 'granted') return false
  const sub = await currentSubscription()
  if (!sub) return false
  const { data } = await api.post('/push/status/', { endpoint: sub.endpoint })
  return Boolean(data.subscribed)
}
