import { CATEGORY_COLORS, ICONS } from '../utils'

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
    </>
  )
}
