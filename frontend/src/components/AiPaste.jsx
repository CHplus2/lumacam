import { useEffect, useState } from 'react'
import api, { parseError } from '../api'
import { MAX_UPLOAD_BYTES, shrinkImage } from '../image'
import { Lumi } from './ui'

/**
 * Paste-to-post: the seller pastes the message they already sent on WhatsApp and Lumi fills in
 * the form (DeepSeek, called by our server). Nothing is posted until they tap Post.
 * Or they upload the event poster: Lumi reads it, and the poster becomes the post's image.
 * Hidden when the server has auto-fill switched off; the poster option has its own switch.
 */
export default function AiPaste({ onFill }) {
  const [enabled, setEnabled] = useState(false)
  const [poster, setPoster] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  useEffect(() => {
    api.get('/ai/autofill/').then(({ data }) => { setEnabled(Boolean(data.enabled)); setPoster(Boolean(data.poster)) }).catch(() => {})
  }, [])
  if (!enabled) return null

  // `send` posts either the pasted text or the shrunk poster; the reply is handled the same way.
  const fill = async (send = () => api.post('/ai/autofill/', { text }, { timeout: 25000 }), image = null) => {
    setBusy(true); setNote(null)
    try {
      const { data } = await send()
      if (data.ok) {
        const filled = onFill(data.fields, image)
        setNote({ ok: true, text: `Filled in: ${filled.join(', ')}. Check it before you post.` })
      } else {
        setNote({ ok: false, text: data.detail })
      }
    } catch (err) {
      setNote({ ok: false, text: err.code === 'ECONNABORTED' ? 'That took too long. Please fill in the form below.' : parseError(err).message })
    } finally {
      setBusy(false)
    }
  }

  const readPoster = async (e) => {
    const input = e.target
    const picked = input.files?.[0]
    input.value = ''
    if (!picked) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(picked.type)) {
      setNote({ ok: false, text: 'Only JPEG, PNG or WebP images are allowed.' }); return
    }
    let small
    try { small = await shrinkImage(picked) } catch { setNote({ ok: false, text: 'Could not read this image. Try a different file.' }); return }
    if (small.size > MAX_UPLOAD_BYTES) { setNote({ ok: false, text: 'This image is too large even after resizing.' }); return }
    const body = new FormData()
    body.append('image', small)
    fill(() => api.post('/ai/autofill-image/', body, { timeout: 25000 }), small)
  }

  return (
    <section className="ai-paste" aria-label="Fill in from a WhatsApp message">
      <div className="ai-paste-head">
        <Lumi mood={note?.ok ? 'happy' : 'found'} size={64} />
        <div>
          <strong>Already posted it on WhatsApp?</strong>
          <p className="muted small">Paste the message and I&apos;ll fill in the form for you. You check it before posting.</p>
        </div>
      </div>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={3000}
        aria-label="Your WhatsApp message"
        placeholder="e.g. Selling my calculus textbook, RM45, can meet at the library. WhatsApp 012-345 6789" />
      <div className="ai-paste-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => fill()} disabled={busy || !text.trim()}>
          {busy ? 'Reading...' : 'Fill in for me'}
        </button>
        {poster && (
          <label className={`btn btn-sm ${busy ? 'disabled' : ''}`}>
            Or upload the poster
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={readPoster} disabled={busy} />
          </label>
        )}
        <span className="muted small">Your text{poster ? ' or poster' : ''} is sent to DeepSeek (AI) only to fill this form.</span>
      </div>
      {note && <p className={`small ai-note ${note.ok ? 'ok' : 'err'}`} role="status">{note.text}</p>}
    </section>
  )
}
