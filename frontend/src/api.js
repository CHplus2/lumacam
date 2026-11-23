import axios from 'axios'
import { authToken, clearAuth } from './auth'

// Logged-in requests carry "Authorization: Token <key>" (no cookies, so no CSRF).
const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = authToken()
  if (token) {
    if (config.headers && typeof config.headers.set === 'function') config.headers.set('Authorization', `Token ${token}`)
    else config.headers = { ...(config.headers || {}), Authorization: `Token ${token}` }
  }
  return config
})

// A rejected token (logged out on another device) means this device is logged out
// too. Retry once without it, so public pages still load.
api.interceptors.response.use(undefined, (error) => {
  const config = error.config
  if (error.response?.status === 401 && authToken() && config && !config._retriedWithoutToken) {
    clearAuth()
    config._retriedWithoutToken = true
    if (config.headers?.delete) config.headers.delete('Authorization')
    else if (config.headers) delete config.headers.Authorization
    return api.request(config)
  }
  return Promise.reject(error)
})

/** Turn a DRF error response into { message, fields }. */
export function parseError(err) {
  if (!err.response) {
    return { message: 'Cannot reach the server. Check your connection and try again.', fields: {} }
  }
  const { status, data } = err.response
  const fields = {}
  let message = ''
  if (data && typeof data === 'object') {
    if (typeof data.detail === 'string') message = data.detail
    for (const [k, v] of Object.entries(data)) {
      if (k === 'detail') continue
      fields[k] = Array.isArray(v) ? v.join(' ') : String(v)
    }
    if (!message && Object.keys(fields).length) message = 'Please fix the highlighted fields.'
  }
  if (status === 429) message = 'Too many attempts. Please wait a moment and try again.'
  if (!message) message = status >= 500 ? 'Something went wrong on our side.' : 'Request failed.'
  return { message, fields }
}

export default api
