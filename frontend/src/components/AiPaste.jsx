import { useEffect, useState } from 'react'
import api, { parseError } from '../api'
import { Lumi } from './ui'

/**
 * Paste-to-post: the seller pastes the message they already sent on WhatsApp and Lumi fills in
 * the form (DeepSeek, called by our server). Nothing is posted until they tap Post.
 * Hidden when the server has auto-fill switched off.
 */
export default function AiPaste({ onFill }) {
  const [enabled, setEnabled] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  useEffect(() => {
    api.get('/ai/autofill/').then(({ data }) => setEnabled(Boolean(data.enabled))).catch(() => {})
  }, [])
  if (!enabled) return null

  const fill = async () => {
    setBusy(true); setNote(null)
    try {
      const { data } = await api.post('/ai/autofill/', { text }, { timeout: 25000 })
      if (data.ok) {
        const filled = onFill(data.fields)
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
        <button type="button" className="btn btn-primary btn-sm" onClick={fill} disabled={busy || !text.trim()}>
          {busy ? 'Reading your message...' : 'Fill in for me'}
        </button>
        <span className="muted small">Your text is sent to DeepSeek (AI) only to fill this form.</span>
      </div>
      {note && <p className={`small ai-note ${note.ok ? 'ok' : 'err'}`} role="status">{note.text}</p>}
    </section>
  )
}
