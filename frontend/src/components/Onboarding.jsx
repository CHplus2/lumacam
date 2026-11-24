import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useCategories } from '../hooks'
import { useFollows } from '../follows'
import { Lumi } from './ui'

const KEY = 'lumacam.onboarded.v1'
const isDone = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
const markDone = () => { try { localStorage.setItem(KEY, '1') } catch { /* private mode: shows again next visit */ } }

/**
 * Full-screen first-visit welcome with Lumi (Duolingo-style): 4 short steps, skippable at any time.
 * Shown once per device, and only on Home, so a shared post link opens straight to the post.
 */
export default function Onboarding() {
  const [open, setOpen] = useState(() => !isDone())
  const [step, setStep] = useState(0)
  const { categories } = useCategories()
  const follows = useFollows()
  const nextBtn = useRef(null)
  const picked = categories.filter((c) => follows.isFollowing(c.slug)).length

  const close = () => { markDone(); setOpen(false) }

  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [open])

  useEffect(() => { if (open) nextBtn.current?.focus() }, [open, step])

  if (!open) return null

  const steps = [
    { mood: 'curious', title: "Hi, I'm Lumi!", text: "I'll show you what's happening around campus." },
    { mood: 'found', title: 'Food, preloved finds, events and notices.', text: 'All in one place, posted by students. Look around, no account needed.' },
    { mood: 'love', title: 'What do you want to hear about?', text: 'Pick a few. I can tell you when something new is posted.', pick: true },
    picked
      ? { mood: 'wink', title: "You're all set!", text: `New posts in your ${picked === 1 ? 'pick' : `${picked} picks`} will show under the bell.` }
      : { mood: 'wink', title: "You're all set!", text: 'You can follow any category later from its page.' },
  ]
  const s = steps[step]
  const last = step === steps.length - 1

  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
      <div className="onboard-top">
        <button type="button" className="onboard-close" aria-label="Skip the welcome" onClick={close}><X size={24} /></button>
        <div className="onboard-progress" aria-hidden="true"><span style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
      </div>

      <div className="onboard-body" key={step}>
        <div className="onboard-speech">
          <Lumi mood={s.mood} size={s.pick ? 110 : 150} />
          <div className="onboard-bubble">
            <h2 id="onboard-title">{s.title}</h2>
            <p>{s.text}</p>
          </div>
        </div>
        {s.pick && (
          <div className="onboard-chips">
            {categories.map((c) => {
              const on = follows.isFollowing(c.slug)
              return (
                <button key={c.id} type="button" className={`onboard-chip ${on ? 'on' : ''}`} aria-pressed={on}
                  onClick={() => follows.toggle(c.slug)}>{c.name}</button>
              )
            })}
          </div>
        )}
      </div>

      <div className="onboard-actions">
        <button ref={nextBtn} type="button" className="btn btn-primary onboard-next" onClick={last ? close : () => setStep(step + 1)}>
          {last ? 'Start exploring' : s.pick && !picked ? 'Skip for now' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
