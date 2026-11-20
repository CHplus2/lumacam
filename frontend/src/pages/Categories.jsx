import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useCategories } from '../hooks'
import { CategoryCard, ErrorBox, Spinner } from '../components/ui'

export default function Categories() {
  const { categories, loading, error, reload } = useCategories()
  return (
    <>
      <div className="section-head">
        <div>
          <h1>Categories</h1>
          <p className="muted">Pick a category to see its announcements.</p>
        </div>
      </div>
      <ErrorBox message={error} onRetry={reload} />
      {loading ? <Spinner /> : (
        <div className="cat-grid">
          {categories.map((c) => <CategoryCard key={c.id} category={c} />)}
          <Link to="/categories/new" className="cat-card cat-card-new">
            <span className="cat-icon"><Plus size={26} /></span>
            <span className="cat-name">New category</span>
            <span className="cat-desc">Add a new kind of announcement</span>
          </Link>
        </div>
      )}
    </>
  )
}
