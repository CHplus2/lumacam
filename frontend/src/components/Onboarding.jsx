import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { useCategories } from '../hooks'
import { useFollows } from '../follows'
import { Lumi } from './ui'
import { ICONS } from '../utils'
import { finishWelcome, markPicker, markTour, tourSeen, welcomeDone } from '../guide'
import { track } from '../api'

// One short tour per screen. `sel` is a CSS selector; the first VISIBLE match is used, so the
// same tour works with the phone bottom bar and the desktop header. Missing targets are skipped.
const TOURS = {
  home: [
    { sel: '[data-tour="home"]', mood: 'curious', title: 'This is Home', text: 'New posts from around campus land here first.' },
    { sel: '[data-tour="search"]', mood: 'found', title: 'Looking for something?', text: 'Search food, books or events, like "nasi lemak".' },
    { sel: '[data-tour="categories"]', mood: 'happy', title: 'Browse by category', text: 'Tap one to see its posts. You can Follow it from there.' },
    { sel: '[data-tour="bell"]', mood: 'surprised', title: 'New posts show up here', text: "When something's posted in what you follow, I'll put it under the bell." },
    { sel: '[data-tour="post"]', mood: 'love', title: 'Selling or announcing something?', text: 'Tap here to post. You need a free account, and it goes live straight away.' },
    { sel: '[data-tour="explore"]', mood: 'wink', title: 'See everything', text: "Filter by today or the next 7 days, or sort by what's ending soon." },
  ],
  listing: [
    { sel: '[data-tour="follow"]', mood: 'love', title: 'Follow this category', text: "I'll show new posts from here under the bell. Tap again to stop." },
    { sel: '[data-tour="filters"]', mood: 'found', title: 'Narrow it down', text: 'Search inside this list. Sort and filter by date, stock or pickup place in the row below.' },
    { sel: '.ann-card', mood: 'curious', title: 'Open a post', text: 'Tap any post to see the details, pickup place and how to contact the seller.' },
  ],
  detail: [
    { sel: '[data-tour="stock"]', mood: 'surprised', title: 'Still available?', text: 'Stock shows here. Only the seller can change it.' },
    { sel: '[data-tour="pickup"]', mood: 'found', title: 'Where to meet', text: 'These are the pickup places the seller offers.' },
    { sel: '.contact-box', mood: 'happy', title: 'Get in touch', text: 'Contact the seller or open the sign-up form from here.' },
  ],
  create: [
    { sel: '.ai-paste', mood: 'found', title: 'Already posted it on WhatsApp?', text: "Paste the message here and I'll fill in the form. You check it before posting." },
    { sel: '#title', mood: 'curious', title: 'Start with a clear title', text: 'Say what it is, like "Preloved denim jacket, size M".' },
    { sel: '#category', mood: 'found', title: 'Pick a category', text: 'This decides who sees it and who gets notified.' },
    { sel: '#contact_method', mood: 'love', title: 'How should people reach you?', text: 'WhatsApp is quickest for most students.' },
    { sel: '.form-actions .btn-primary', mood: 'happy', title: 'Post it', text: "It's live straight away, and only you can edit or delete it." },
  ],
  myposts: [
    { sel: '.ann-card', mood: 'happy', title: 'Your posts live here', text: 'Open one to edit it or change its stock.' },
    { sel: '[data-tour="trash"]', mood: 'sad', title: 'Deleted something by mistake?', text: 'It waits in Trash for 30 days, so you can bring it back.' },
  ],
  notify: [
    { sel: '.notif-cats', mood: 'love', title: 'Pick your categories', text: 'Only new posts in these will reach your phone.' },
    { sel: '[data-tour="freq"]', mood: 'sleepy', title: 'Not too often', text: 'Choose how often I can ping you. Quiet hours keep nights silent.' },
    { sel: '.push-card', mood: 'surprised', title: 'Switch it on', text: 'Turn on phone notifications here, and send yourself a test.' },
  ],
}

const visible = (sel) => [...document.querySelectorAll(sel)]
  .find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })

function useLockScroll(active, onEscape) {
  useEffect(() => {
    if (!active) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onEscape() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [active, onEscape])
}

/** Lumi points at real parts of the screen, one at a time. */
function Tour({ steps: all, onDone }) {
  const [steps] = useState(() => all.filter((t) => visible(t.sel)))
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const nextBtn = useRef(null)
  const step = steps[i]
  const last = i === steps.length - 1
  useLockScroll(true, onDone)

  useLayoutEffect(() => {
    const el = step && visible(step.sel)
    if (!el) { onDone(); return undefined }
    el.scrollIntoView({ block: 'center' })
    let frame = 0
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setRect(el.getBoundingClientRect())) }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    nextBtn.current?.focus()
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [step, onDone])

  if (!step) return null
  const pad = 6
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(380, vw - 32)
  const room = 250 // card height plus breathing space
  const card = { width, left: rect ? Math.min(Math.max(16, rect.left + rect.width / 2 - width / 2), vw - width - 16) : 16 }
  // Put the card on whichever side of the target has room, with its tail pointing at the target.
  let place = 'floating'
  if (rect && vh - rect.bottom > room) { card.top = rect.bottom + pad + 16; place = 'below' }
  else if (rect && rect.top > room) { card.bottom = vh - rect.top + pad + 16; place = 'above' }
  else card.bottom = 16
  const tailX = rect ? Math.min(Math.max(28, rect.left + rect.width / 2 - card.left), width - 28) : 0

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="tour-block" />
      {rect && (
        <div className="tour-spot" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      )}
      <div className={`tour-card ${place}`} style={{ ...card, '--tail-x': `${tailX}px` }} key={i}>
        <div className="tour-say">
          <Lumi mood={step.mood} size={104} />
          <div className="tour-text">
            <h2 id="tour-title">{step.title}</h2>
            <p>{step.text}</p>
          </div>
        </div>
        <div className="tour-actions">
          <span className="tour-dots" aria-label={`Step ${i + 1} of ${steps.length}`}>
            {steps.map((t, k) => <span key={t.sel} className={k === i ? 'on' : ''} />)}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>Skip</button>
          <button ref={nextBtn} type="button" className="btn btn-primary btn-sm" onClick={last ? onDone : () => setI(i + 1)}>
            {last ? 'Got it' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * A screen's own tour, the first time it is opened. Waits for the screen's content to load,
 * and only runs after the Home welcome, so someone opening a shared post link is never covered.
 */
export function PageTour({ id }) {
  const [ready, setReady] = useState(false)
  const done = useCallback(() => { markTour(id); setReady(false) }, [id])

  useEffect(() => {
    if (!TOURS[id] || !welcomeDone() || tourSeen(id)) return undefined
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      const found = TOURS[id].filter((t) => visible(t.sel)).length
      if (found >= Math.min(2, TOURS[id].length) || tries > 16) {
        clearInterval(timer)
        if (found) setReady(true)
      }
    }, 250)
    return () => clearInterval(timer)
  }, [id])

  return ready ? <Tour steps={TOURS[id]} onDone={done} /> : null
}

/**
 * First visit to Home: a full-screen Lumi welcome (Duolingo-style), then an optional spotlight
 * tour of the real buttons. Shown once per device; never over a shared post link.
 * `pickOnly` shows just the "What are you into?" screen (after sign-up, or from Home's For you).
 */
export default function Onboarding({ pickOnly = false, onClose }) {
  const [phase, setPhase] = useState(() => (pickOnly || !welcomeDone() ? 'welcome' : 'done'))
  const [step, setStep] = useState(0)
  const { categories } = useCategories()
  const follows = useFollows()
  const nextBtn = useRef(null)
  const picked = categories.filter((c) => follows.isFollowing(c.slug)).length

  // Counted once per device, as "completed" (picked something) or "skipped".
  const leavePick = () => { markPicker(); track(picked ? 'picker_completed' : 'picker_skipped') }
  const close = useCallback(() => {
    if (pickOnly) { onClose?.() } else { finishWelcome(); markTour('home') }
    setPhase('done')
  }, [pickOnly, onClose])
  const startTour = () => { finishWelcome(); setPhase('tour') }
  useLockScroll(phase === 'welcome', close)
  useEffect(() => { if (phase === 'welcome') nextBtn.current?.focus() }, [phase, step])

  if (phase === 'done') return null
  if (phase === 'tour') return <Tour steps={TOURS.home} onDone={close} />

  const pickStep = { mood: 'love', title: 'What are you into?', text: "Pick 3 or more. I'll put matching posts at the top of Home.", pick: true }
  const steps = pickOnly ? [pickStep] : [
    { mood: 'curious', title: "Hi, I'm Lumi!", text: "I'll show you what's happening around campus." },
    { mood: 'found', title: 'Food, preloved finds, events and notices.', text: 'All in one place, posted by students. Look around, no account needed.' },
    pickStep,
    picked
      ? { mood: 'wink', title: "You're all set!", text: `Posts from your ${picked === 1 ? 'pick' : `${picked} picks`} show in "For you" on Home, and new ones under the bell. Want a quick look around?` }
      : { mood: 'wink', title: "You're all set!", text: 'You can follow any category later from its page. Want a quick look around?' },
  ]
  const s = steps[step]
  const last = step === steps.length - 1

  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
      <div className="onboard-top">
        <button type="button" className="onboard-close" aria-label={pickOnly ? 'Close' : 'Skip the welcome'}
          onClick={pickOnly ? () => { leavePick(); close() } : close}><X size={24} /></button>
        <div className="onboard-progress" aria-hidden="true"><span style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
      </div>

      {/* Duolingo-style layouts: statements = big centred Lumi with the bubble above him;
          questions = Lumi top-left, bubble to his right, full-width answer rows below. */}
      <div className={`onboard-body ${s.pick ? 'is-ask' : 'is-say'}`} key={step}>
        <div className="onboard-speech">
          <Lumi mood={s.mood} size={s.pick ? 104 : 240} />
          <div className="onboard-bubble">
            <h2 id="onboard-title">{s.title}</h2>
            <p>{s.text}</p>
          </div>
        </div>
        {s.pick && (
          <div className="onboard-options">
            {categories.map((c) => {
              const on = follows.isFollowing(c.slug)
              const Icon = ICONS[c.icon]
              return (
                <button key={c.id} type="button" className={`onboard-option ${on ? 'on' : ''}`} aria-pressed={on}
                  onClick={() => follows.toggle(c.slug)}>
                  <span className={`onboard-option-icon tone-${c.color}`}>{Icon && <Icon size={20} />}</span>
                  <span className="onboard-option-name">{c.name}</span>
                  <span className="onboard-check" aria-hidden="true">{on && <Check size={16} strokeWidth={3} />}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="onboard-actions">
        {pickOnly ? (
          <button ref={nextBtn} type="button" className="btn btn-primary onboard-next" onClick={() => { leavePick(); close() }}>
            {picked ? 'Show my posts' : 'Skip for now'}
          </button>
        ) : last ? (
          <>
            <button ref={nextBtn} type="button" className="btn btn-primary onboard-next" onClick={startTour}>Show me around</button>
            <button type="button" className="btn onboard-next" onClick={close}>Start exploring</button>
          </>
        ) : (
          <button ref={nextBtn} type="button" className="btn btn-primary onboard-next" onClick={() => { if (s.pick) leavePick(); setStep(step + 1) }}>
            {s.pick && !picked ? 'Skip for now' : 'Continue'}
          </button>
        )}
      </div>
    </div>
  )
}
