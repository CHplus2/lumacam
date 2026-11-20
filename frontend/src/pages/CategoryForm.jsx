import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { parseError } from '../api'
import { CategoryCard, ErrorBox } from '../components/ui'
import { CategoryFields } from '../components/fields'
import { emptyCategory } from '../utils'

export default function CategoryForm() {
  const navigate = useNavigate()
  const [value, setValue] = useState(emptyCategory)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(''); setErrors({})
    try {
      const { data } = await api.post('/categories/', value)
      navigate(`/category/${data.slug}`, { replace: true })
    } catch (err) {
      const parsed = parseError(err)
      setError(parsed.message); setErrors(parsed.fields)
    } finally { setBusy(false) }
  }

  const preview = {
    ...value,
    slug: '',
    name: value.name.trim() || 'Category name',
    description: value.description.trim() || 'Short description',
  }

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h1>Create category</h1>
      <p className="muted">Add a new kind of announcement. It appears on the home page straight away.</p>
      <ErrorBox message={error} />
      <CategoryFields value={value} onChange={setValue} errors={errors} />
      <div className="field">
        <span className="label">Preview</span>
        <div className="cat-preview" aria-hidden="true"><CategoryCard category={preview} preview /></div>
      </div>
      <div className="row form-actions">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating...' : 'Create category'}</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </form>
  )
}
