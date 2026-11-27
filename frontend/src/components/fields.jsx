import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { CATEGORY_COLORS, ICONS, MAX_SUBCATEGORIES } from '../utils'

export function Field({ label, error, hint, children, htmlFor }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <small className="muted">{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </div>
  )
}

export function CategoryFields({ value, onChange, errors }) {
  const set = (k, v) => onChange({ ...value, [k]: v })
  return (
    <>
      <Field label="Category name" htmlFor="cat_name" error={errors.name}>
        <input id="cat_name" value={value.name} maxLength={40} onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. Sports & Fitness" />
      </Field>
      <Field label="Short description (optional)" htmlFor="cat_desc" error={errors.description}>
        <input id="cat_desc" value={value.description} maxLength={200} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <label className="check check-card">
        <input type="checkbox" checked={Boolean(value.sells_items)} onChange={(e) => set('sells_items', e.target.checked)} />
        <span>
          <strong>People sell food or items here</strong>
          <small className="muted block">Posts get a stock status (Available, Limited stock, Out of stock) and pickup places.</small>
        </span>
      </label>
      <div className="field">
        <span className="label">Icon</span>
        <div className="icon-picker" role="radiogroup" aria-label="Category icon">
          {Object.entries(ICONS).map(([key, Icon]) => (
            <button type="button" key={key} role="radio" aria-checked={value.icon === key} aria-label={key}
              className={`icon-choice tone-${value.color} ${value.icon === key ? 'selected' : ''}`} onClick={() => set('icon', key)}>
              <Icon size={18} />
            </button>
          ))}
        </div>
        {errors.icon && <small className="field-error">{errors.icon}</small>}
      </div>
      <div className="field">
        <span className="label">Colour</span>
        <div className="row" role="radiogroup" aria-label="Category colour">
          {CATEGORY_COLORS.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={value.color === c} aria-label={c}
              className={`swatch tone-${c} ${value.color === c ? 'selected' : ''}`} onClick={() => set('color', c)} />
          ))}
        </div>
      </div>
      <SubcategoryEditor value={value.subcategories || []} onChange={(v) => set('subcategories', v)} error={errors.subcategories} />
    </>
  )
}

const tidy = (t) => t.replace(/\s+/g, ' ').trim()

/** Add, rename and remove a category's subcategories. Existing ones keep their id when renamed. */
function SubcategoryEditor({ value, onChange, error }) {
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const full = value.length >= MAX_SUBCATEGORIES
  const has = (name, except = -1) => value.some((s, i) => i !== except && s.name.toLowerCase() === name.toLowerCase())

  const add = () => {
    const name = tidy(text)
    if (!name) return
    if (name.length < 2 || name.length > 30) { setNote('Subcategory names must be 2-30 characters.'); return }
    if (has(name)) { setNote(`"${name}" is already in the list.`); return }
    if (full) { setNote(`You can add up to ${MAX_SUBCATEGORIES}.`); return }
    onChange([...value, { name }]); setText(''); setNote('')
  }
  const rename = (i, name) => onChange(value.map((s, j) => (j === i ? { ...s, name } : s)))
  const remove = (i) => onChange(value.filter((_, j) => j !== i))

  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <span className="label">Subcategories (optional)</span>
      {value.length > 0 && (
        <ul className="subcat-list">
          {value.map((s, i) => (
            <li key={s.id ?? `new-${i}`}>
              <input value={s.name} maxLength={30} aria-label={`Subcategory ${i + 1}`}
                onChange={(e) => rename(i, e.target.value)} onBlur={(e) => rename(i, tidy(e.target.value))} />
              <button type="button" className="icon-btn" aria-label={`Remove ${s.name}`} onClick={() => remove(i)}><X size={16} /></button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="row pickup-entry">
          <input id="subcat_new" value={text} maxLength={30} placeholder="e.g. Desserts"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} enterKeyHint="done" />
          <button type="button" className="btn btn-sm" onClick={add} disabled={!tidy(text)}><Plus size={14} /> Add</button>
        </div>
      )}
      {note || error
        ? <small className="field-error">{note || error}</small>
        : <small className="muted">Posters pick one, and people can filter by it. Removing one keeps its posts, just without that label.</small>}
    </div>
  )
}
