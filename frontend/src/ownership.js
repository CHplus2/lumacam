// Before accounts, posts were owned by a secret "edit key" stored in the browser
// that posted them ({ [postId]: key }). After you log in, those posts are moved
// into your account (POST /api/auth/claim/) and the keys are forgotten.
const KEY = 'lumacam.myposts.v1'

function readKeys() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    return {}
  }
}

/** Claim this browser's older posts into the logged-in account. Returns how many moved. */
export async function claimBrowserPosts(api) {
  const keys = readKeys()
  if (!Object.keys(keys).length) return 0
  const { data } = await api.post('/auth/claim/', { keys })
  // Forget every key we tried: claimed ones now belong to the account, and the
  // rest were wrong, deleted, or already claimed by someone.
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
  return data.claimed.length
}
