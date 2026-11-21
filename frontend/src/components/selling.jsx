import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleCheck, CircleDashed, CircleX, MapPin, Plus, X } from 'lucide-react'
import { MAX_PICKUPS, STOCK, stockLabel } from '../utils'

const STOCK_ICONS = { available: CircleCheck, limited: CircleDashed, out: CircleX }

export function StockBadge({ value, className = '' }) {
  if (!value) return null
  const Icon = STOCK_ICONS[value]
  return (
    <span className={`stock-badge stock-${value} ${className}`}>
      {Icon && <Icon size={13} />}{stockLabel(value)}
    </span>
  )
}

/** One-tap stock switch: three buttons, the current one highlighted. */
export function StockPicker({ value, onChange, disabled = false, label = 'Stock' }) {
  return (
    <div className="stock-picker" role="radiogroup" aria-label={label}>
      {STOCK.map((s) => {
        const Icon = STOCK_ICONS[s.value]
        const on = value === s.value
        return (
          <button key={s.value} type="button" role="radio" aria-checked={on} disabled={disabled}
            className={`stock-option stock-${s.value} ${on ? 'selected' : ''}`}
            onClick={() => !on && onChange(s.value)}>
            <Icon size={16} /> {s.label}
          </button>
        )
      })}
    </div>
  )
}

/** Pickup place chips. With categorySlug, each links to that category filtered by the place. */
export function PickupTags({ places, categorySlug }) {
  if (!places?.length) return null
  return (
    <ul className="pickup-tags" aria-label="Pickup places">
      {places.map((p) => (
        <li key={p}>
          {categorySlug ? (
            <Link className="pickup-tag" to={`/category/${categorySlug}?pickup=${encodeURIComponent(p)}`}>
              <MapPin size={13} />{p}
            </Link>
          ) : (
            <span className="pickup-tag"><MapPin size={13} />{p}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

const tidy = (s) => s.replace(/\s+/g, ' ').trim()

/** Tag input for pickup places, with one-tap suggestions from places other posts use. */
export function PickupInput({ value, onChange, suggestions = [], id = 'pickup_input' }) {
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const has = (name) => value.some((v) => v.toLowerCase() === name.toLowerCase())
  const full = value.length >= MAX_PICKUPS

  const add = (raw) => {
    const name = tidy(raw)
    setText('')
    if (!name) return
    if (name.length < 2 || name.length > 40) { setNote('Pickup places must be 2-40 characters.'); return }
    if (has(name)) { setNote(''); return }
    if (full) { setNote(`You can add up to ${MAX_PICKUPS} places.`); return }
    // Reuse an existing place's spelling so posts share the same tag.
    const known = suggestions.find((s) => s.toLowerCase() === name.toLowerCase())
    setNote('')
    onChange([...value, known || name])
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text) }
    else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
  }

  const quick = suggestions.filter((s) => !has(s)).slice(0, 6)
  return (
    <div className="pickup-input">
      {value.length > 0 && (
        <ul className="pickup-tags">
          {value.map((p) => (
            <li key={p}>
              <span className="pickup-tag removable">
                <MapPin size={13} />{p}
                <button type="button" aria-label={`Remove ${p}`} onClick={() => onChange(value.filter((v) => v !== p))}>
                  <X size={13} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="row pickup-entry">
          <input id={id} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown}
            maxLength={40} placeholder="e.g. Block C lobby" list={`${id}_list`}
            enterKeyHint="done" />
          <button type="button" className="btn btn-sm" onClick={() => add(text)} disabled={!tidy(text)}>
            <Plus size={14} /> Add
          </button>
          <datalist id={`${id}_list`}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
      )}
      {quick.length > 0 && !full && (
        <div className="pickup-suggest">
          <span className="muted small">Popular:</span>
          {quick.map((s) => (
            <button key={s} type="button" className="chip chip-tiny" onClick={() => add(s)}>+ {s}</button>
          ))}
        </div>
      )}
      {note && <small className="field-error">{note}</small>}
    </div>
  )
}
