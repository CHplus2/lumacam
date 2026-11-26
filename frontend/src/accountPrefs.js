import { applyAccountPrefs, clearFollows, readFollows } from './follows'
import { disablePush, updatePush } from './push'

// Notification settings for logged-in users live on the account (GET/PUT /api/auth/prefs/),
// so they are the same on every device. This device keeps a copy for the bell and the
// settings page, plus whether phone notifications are on here.

const toBody = ({ slugs, push }) => ({ categories: slugs, frequency: push.frequency, quiet_hours: push.quietHours })

/** After logging in: add this device's follows to the account, then use the account's settings. */
export async function mergeOnLogin(api) {
  const device = readFollows()
  const { data: account } = await api.get('/auth/prefs/')
  const merged = account.saved
    ? { categories: [...new Set([...account.categories, ...device.slugs])],
        frequency: account.frequency, quiet_hours: account.quiet_hours }
    : toBody(device)
  const { data } = await api.put('/auth/prefs/', merged)
  applyAccountPrefs(data)
  if (device.push.on) {
    // Link this phone's notifications to the account.
    await updatePush({ slugs: data.categories, frequency: data.frequency, quietHours: data.quiet_hours })
  }
}

/** On app start while logged in: pick up changes made on other devices. */
export async function loadAccountPrefs(api) {
  const { data } = await api.get('/auth/prefs/')
  if (data.saved) applyAccountPrefs(data)
  return data
}

/** Save a change made on this device to the account (and to this phone's subscription). */
export async function saveAccountPrefs(api) {
  const state = readFollows()
  if (state.push.on) {
    const ok = await updatePush({ slugs: state.slugs, frequency: state.push.frequency, quietHours: state.push.quietHours })
    if (ok) return true // subscribing also saves the account settings
  }
  await api.put('/auth/prefs/', toBody(state))
  return true
}

/** Before logging out: stop this phone's notifications for the account and forget the follows. */
export async function forgetOnLogout() {
  if (readFollows().push.on) {
    try { await disablePush() } catch { /* offline: the server unlinks it on the next subscribe */ }
  }
  clearFollows()
}
