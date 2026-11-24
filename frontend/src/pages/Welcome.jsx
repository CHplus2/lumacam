import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useCategories } from '../hooks'
import { useFollows } from '../follows'
import { safeNext } from '../utils'
import { ErrorBox, Lumi, Spinner } from '../components/ui'

/** One step right after sign-up: pick categories (= follow them), then carry on where you were going. */
export default function Welcome() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const { categories, loading, error } = useCategories()
  const follows = useFollows()
  const picked = categories.filter((c) => follows.isFollowing(c.slug)).length
  const done = () => navigate(next, { replace: true })

  return (
    <div className="card form narrow welcome">
      <Lumi mood="curious" size={110} />
      <h1>What do you want to hear about?</h1>
      <p className="muted">Pick a few. When something new is posted in them, I&apos;ll show it under the bell. You can change this any time.</p>
      <ErrorBox message={error} />
      {loading ? <Spinner /> : (
        <div className="welcome-chips">
          {categories.map((c) => {
            const on = follows.isFollowing(c.slug)
            return (
              <button key={c.id} type="button" className={`chip ${on ? 'active' : ''}`} aria-pressed={on}
                onClick={() => follows.toggle(c.slug)}>{c.name}</button>
            )
          })}
        </div>
      )}
      <p className="muted small">Want phone notifications too? Turn them on in <Link to="/notifications">Notifications</Link>.</p>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={done} disabled={!picked}>
          {picked ? `Continue with ${picked}` : 'Pick at least one'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={done}>Skip for now</button>
      </div>
    </div>
  )
}
