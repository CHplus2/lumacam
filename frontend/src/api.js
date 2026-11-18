import axios from 'axios'

// Session cookie auth; Django's CSRF cookie is echoed back in a header.
const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  xsrfCookieName: 'csrftoken',
  xsrfHeaderName: 'X-CSRFToken',
})

export const ensureCsrf = () => api.get('/auth/csrf/')

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
