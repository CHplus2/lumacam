import { useEffect, useRef, useState } from 'react'

/**
 * Text clamped to a few lines (by CSS), with a More / Show less toggle that only
 * appears when the text is actually cut off. Remount it (key) when the text changes.
 */
export default function ExpandableText({ text, className = '' }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const [clamped, setClamped] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || open) return undefined
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    measure()
    const ro = new ResizeObserver(measure) // rotating the phone changes the width
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, text])

  return (
    <div className="expandable">
      <p ref={ref} className={`${className} ${open ? 'is-open' : ''}`}>{text}</p>
      {(clamped || open) && (
        <button type="button" className="link-btn expand-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'More'}
        </button>
      )}
    </div>
  )
}
