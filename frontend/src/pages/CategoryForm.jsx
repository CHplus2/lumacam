import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import api, { parseError } from '../api'
import { CategoryCard, EmptyState, ErrorBox, Spinner } from '../components/ui'
import { CategoryFields } from '../components/fields'
import { emptyCategory } from '../utils'

const EDITABLE = ['name', 'description', 'icon', 'color', 'sells_items', 'subcategories']

export default function CategoryForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const [value, setValue] = useState(emptyCategory)
  const [original, setOriginal] = useState(null)
  const [loading, setLoading] = useState(editing)
  const [blocked, setBlocked] = useState('')
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!editing) return
    api.get(`/categories/${id}/`)
      .then(({ data }) => {
        if (!data.can_edit) { setBlocked('Only the person who created this category can edit it.'); return }
        setOriginal(data)
        setValue(Object.fromEntries(EDITABLE.map((k) => [k, data[k] ?? emptyCategory[k]])))
      })
      .catch((e) => setBlocked(e.response?.status === 404 ? 'This category no longer exists.' : parseError(e).message))
      .finally(() => setLoading(false))
  }, [id, editing])

  const submit = async (e) => {
    e.preventDefault()
    if (editing && original?.sells_items && !value.sells_items
      && !window.confirm('Turn off selling? Stock status and pickup places will be removed from every post in this category.')) return
    setBusy(true); setError(''); setErrors({})
    try {
      const { data } = editing
        ? await api.patch(`/categories/${id}/`, value)
        : await api.post('/categories/', value)
      navigate(`/category/${data.slug}`, { replace: true })
    } catch (err) {
      const parsed = parseError(err)
      setError(parsed.message); setErrors(parsed.fields)
    } finally { setBusy(false) }
  }

  if (loading) return <Spinner />
  if (blocked) {
    return <EmptyState title="You can't edit this category" text={blocked}
      action={<Link to="/categories" className="btn btn-primary">All categories</Link>} />
  }

  const preview = {
    ...value,
    slug: '',
    name: value.name.trim() || 'Category name',
    description: value.description.trim() || 'Short description',
  }

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h1>{editing ? 'Edit category' : 'Create category'}</h1>
      <p className="muted">
        {editing
          ? 'Changes show for everyone straight away. Its link and followers stay the same.'
          : 'Add a new kind of announcement. It appears on the home page straight away.'}
      </p>
      <ErrorBox message={error} />
      <CategoryFields value={value} onChange={setValue} errors={errors} />
      <div className="field">
        <span className="label">Preview</span>
        <div className="cat-preview" aria-hidden="true"><CategoryCard category={preview} preview /></div>
      </div>
      <div className="row form-actions">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? (editing ? 'Saving...' : 'Creating...') : (editing ? 'Save changes' : 'Create category')}
        </button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </form>
  )
}
