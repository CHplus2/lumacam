// Device-local onboarding progress: the Home welcome, then each screen's tour, each shown once.
const WELCOME_KEY = 'lumacam.onboarded.v1'
const TOURS_KEY = 'lumacam.tours.v1'
const get = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback } catch { return fallback } }
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }

export const welcomeDone = () => get(WELCOME_KEY, 0) === 1
export const finishWelcome = () => set(WELCOME_KEY, 1)
export const tourSeen = (id) => get(TOURS_KEY, []).includes(id)
export const markTour = (id) => { if (!tourSeen(id)) set(TOURS_KEY, [...get(TOURS_KEY, []), id]) }

/** Start the whole guide again from Home (account menu: "Replay the guide"). */
export function replayGuide() {
  try { localStorage.removeItem(WELCOME_KEY); localStorage.removeItem(TOURS_KEY) } catch { /* ignore */ }
  window.location.assign('/')
}
