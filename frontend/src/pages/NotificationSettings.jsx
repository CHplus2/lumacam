import { useEffect, useState } from 'react'
import { BellOff, BellRing, Moon, Send, Share, Smartphone, SquarePlus } from 'lucide-react'
import { parseError } from '../api'
import { useCategories } from '../hooks'
import { FREQUENCIES, useFollows } from '../follows'
import {
  disablePush, enablePush, isIOS, isStandalone, permission, pushIsActive, pushSupported, sendTestPush,
} from '../push'
import { ErrorBox, Spinner } from '../components/ui'
import { ICONS } from '../utils'

function PhoneStatus({ follows }) {
  const { slugs, push, setPush } = follows
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [checking, setChecking] = useState(push.on)

  // Make sure "on" here still matches the phone and the server (permission can be revoked any time).
  useEffect(() => {
    if (!push.on) return
    let alive = true
    pushIsActive()
      .then((active) => { if (alive && !active) setPush({ on: false }) })
      .catch(() => {})
      .finally(() => { if (alive) setChecking(false) })
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn, done) => {
    setBusy(true); setError(''); setNote('')
    try { await fn(); if (done) setNote(done) } catch (e) { setError(e.response ? parseError(e).message : e.message) } finally { setBusy(false) }
  }
  const turnOn = () => run(async () => {
    await enablePush({ slugs, frequency: push.frequency, quietHours: push.quietHours })
    setPush({ on: true })
  }, 'Phone notifications are on. Send a test to check.')
  const turnOff = () => run(async () => { await disablePush(); setPush({ on: false }) }, 'Phone notifications are off.')
  const test = () => run(sendTestPush, 'Test sent. It should appear on this device in a few seconds.')

  if (!pushSupported() && isIOS() && !isStandalone()) {
    return (
      <div className="push-card">
        <p><strong>On iPhone, add LumaCam to your Home Screen first.</strong> Apple only allows notifications for sites installed this way (iOS 16.4 or later).</p>
        <ol className="steps">
          <li>Tap <Share size={15} className="inline" /> <strong>Share</strong> in Safari.</li>
          <li>Tap <SquarePlus size={15} className="inline" /> <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          <li>Open LumaCam from your Home Screen and come back to this page.</li>
        </ol>
      </div>
    )
  }
  if (!pushSupported()) {
    return <div className="push-card"><p className="muted">This browser doesn&apos;t support notifications. Try Chrome on Android, or Safari on iPhone after adding LumaCam to your Home Screen.</p></div>
  }
  if (checking) return <div className="push-card"><Spinner label="Checking this device..." /></div>

  const blocked = permission() === 'denied'
  return (
    <div className={`push-card ${push.on ? 'is-on' : ''}`}>
      <div className="row push-head">
        {push.on ? <BellRing size={20} /> : <Smartphone size={20} />}
        <strong>{push.on ? 'On for this device' : 'Off'}</strong>
      </div>
      {blocked && !push.on && (
        <p className="muted small">Notifications are blocked for this site. Allow them in your browser or phone settings (site settings, then Notifications), then come back.</p>
      )}
      {!push.on && slugs.length === 0 && <p className="muted small">Pick at least one category above first.</p>}
      <div className="row">
        {push.on ? (
          <>
            <button type="button" className="btn btn-sm" onClick={test} disabled={busy}><Send size={14} /> Send a test</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={turnOff} disabled={busy}><BellOff size={14} /> Turn off</button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={turnOn} disabled={busy || blocked || slugs.length === 0}>
            <BellRing size={16} /> {busy ? 'Turning on...' : 'Turn on phone notifications'}
          </button>
        )}
      </div>
      {note && <p className="stock-saved small" role="status">{note}</p>}
      <ErrorBox message={error} />
    </div>
  )
}

export default function NotificationSettings() {
  const follows = useFollows()
  const { slugs, isFollowing, toggle, push, setPush } = follows
  const { categories, loading } = useCategories()

  return (
    <div className="card form notif-settings">
      <h1>Notifications</h1>
      <p className="muted">
        LumaCam only notifies you about <strong>new posts in the categories you pick</strong>. Nothing else: no ads,
        no reminders, no messages from other people.
      </p>

      <section className="field">
        <span className="label">1. Which categories?</span>
        {loading ? <Spinner /> : (
          <div className="notif-cats">
            {categories.map((c) => {
              const Icon = ICONS[c.icon]
              return (
                <label key={c.id} className={`check check-card tone-${c.color} ${isFollowing(c.slug) ? 'on' : ''}`}>
                  <input type="checkbox" checked={isFollowing(c.slug)} onChange={() => toggle(c.slug)} />
                  {Icon && <Icon size={18} className="notif-cat-icon" />}
                  <span>{c.name}</span>
                </label>
              )
            })}
          </div>
        )}
        <small className="muted">{slugs.length === 0 ? 'None selected: you won\'t get any notifications.'
          : `Following ${slugs.length} ${slugs.length === 1 ? 'category' : 'categories'}. New posts in them also show in the bell.`}</small>
      </section>

      <section className="field" data-tour="freq">
        <span className="label">2. How often can we notify your phone?</span>
        <div className="radio-list" role="radiogroup" aria-label="Notification frequency">
          {FREQUENCIES.map((f) => (
            <label key={f.value} className={`check check-card ${push.frequency === f.value ? 'on' : ''}`}>
              <input type="radio" name="frequency" checked={push.frequency === f.value} onChange={() => setPush({ frequency: f.value })} />
              <span><strong>{f.label}</strong><small className="muted block">{f.hint}</small></span>
            </label>
          ))}
        </div>
        <label className={`check check-card ${push.quietHours ? 'on' : ''}`}>
          <input type="checkbox" checked={push.quietHours} onChange={(e) => setPush({ quietHours: e.target.checked })} />
          <Moon size={18} className="notif-cat-icon" />
          <span><strong>Quiet hours, 10pm to 7am</strong><small className="muted block">No notifications overnight.</small></span>
        </label>
        <small className="muted">Posts held back by these limits aren&apos;t sent later, but you&apos;ll still find them in the bell and on the site.</small>
      </section>

      <section className="field">
        <span className="label">3. Phone notifications</span>
        <PhoneStatus follows={follows} />
      </section>
    </div>
  )
}
