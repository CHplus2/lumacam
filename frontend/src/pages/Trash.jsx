import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArchiveRestore, Trash2 } from 'lucide-react'
import api, { parseError } from '../api'
import { CategoryBadge, EmptyState, ErrorBox, Spinner } from '../components/ui'
import { ICONS, TRASH_DAYS, fmtRelative, timeLeft } from '../utils'

const TABS = [
  { key: 'announcements', label: 'Announcements' },
  { key: 'categories', label: 'Categories' },
]

function useTrashList(tab) {
  const [items, setItems] = useState([])
  const [next, setNext] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (url) => {
    setLoading(true); setError('')
    try {
      // The server only returns your own deleted posts and categories.
      const { data } = await api.get(url || `/trash/${tab}/`)
      // Announcements are paginated; categories come back as a plain list.
      const results = Array.isArray(data) ? data : data.results
      setItems((prev) => (url ? [...prev, ...results] : results))
      setNext(Array.isArray(data) ? null : data.next)
    } catch (e) {
      setError(parseError(e).message)
    } finally { setLoading(false) }
  }, [tab])

  useEffect(() => { setItems([]); load() }, [load])
  return { items, setItems, next, loading, error, load }
}

function ExpiryNote({ item }) {
  return (
    <p className="muted small">
      Deleted {fmtRelative(item.removed_at)} · erased {timeLeft(item.purge_at)}
    </p>
  )
}

export default function Trash() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'categories' ? 'categories' : 'announcements'
  const { items, setItems, next, loading, error, load } = useTrashList(tab)
  const [busyId, setBusyId] = useState(null)
  const [message, setMessage] = useState(null)

  const restore = async (item) => {
    setBusyId(item.id); setMessage(null)
    try {
      const { data } = await api.post(`/trash/${tab}/${item.id}/restore/`)
      setItems((list) => list.filter((x) => x.id !== item.id))
      if (data.restored === 'category') {
        setMessage({ text: `Restored the category "${data.name}".`, to: `/category/${data.slug}`, link: 'View category' })
      } else {
        const extra = data.restored_category ? ` Its category "${data.restored_category}" was restored too.` : ''
        setMessage({ text: `Restored "${data.title}".${extra}`, to: `/announcements/${data.id}`, link: 'View post' })
      }
    } catch (e) {
      setMessage({ error: true, text: parseError(e).message })
    } finally { setBusyId(null) }
  }

  const switchTab = (key) => {
    setMessage(null)
    setParams(key === 'announcements' ? {} : { tab: key }, { replace: true })
  }

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Trash</h1>
          <p className="muted">Deleted posts and categories stay here for {TRASH_DAYS} days, then they are erased for good. You only see what you deleted.</p>
        </div>
      </div>

      <div className="chips" role="tablist" aria-label="Trash sections">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            className={`chip ${tab === t.key ? 'active' : ''}`} onClick={() => switchTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {message && (
        <div className={`alert ${message.error ? 'alert-error' : 'alert-ok'}`} role="status">
          <span>{message.text}</span>
          {message.to && <Link to={message.to} className="btn btn-sm">{message.link}</Link>}
        </div>
      )}
      <ErrorBox message={error} onRetry={() => load()} />

      {loading && items.length === 0 ? <Spinner /> : !error && items.length === 0 ? (
        <EmptyState icon={Trash2} title={`No deleted ${tab}`}
          text={`Anything you delete shows up here for ${TRASH_DAYS} days.`} />
      ) : (
        <>
          <ul className="list">
            {items.map((item) => {
              const isCat = tab === 'categories'
              const Icon = ICONS[isCat ? item.icon : item.category_detail?.icon]
              const tone = isCat ? item.color : item.category_detail?.color
              return (
                <li key={item.id} className="card list-row trash-row">
                  {!isCat && item.image_url
                    ? <img className="row-thumb" src={item.image_url} alt="" />
                    : <span className={`row-icon tone-${tone || 'blue'}`}>{Icon && <Icon size={22} />}</span>}
                  <div className="grow">
                    {isCat ? (
                      <>
                        <strong>{item.name}</strong>
                        {item.description && <p className="ann-desc">{item.description}</p>}
                        {item.trashed_posts > 0 && (
                          <p className="muted small">{item.trashed_posts} deleted post{item.trashed_posts === 1 ? '' : 's'} belong to it</p>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="ann-badges">
                          <CategoryBadge category={item.category_detail} />
                          {item.category_in_trash && <span className="muted small">category also in Trash</span>}
                        </div>
                        <strong>{item.title}</strong>
                        <p className="ann-desc">{item.description}</p>
                      </>
                    )}
                    <ExpiryNote item={item} />
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => restore(item)} disabled={busyId === item.id}>
                    <ArchiveRestore size={15} /> {busyId === item.id ? 'Restoring...' : 'Restore'}
                  </button>
                </li>
              )
            })}
          </ul>
          {next && (
            <div className="center">
              <button className="btn" disabled={loading} onClick={() => load(next.replace(/^.*\/api/, ''))}>
                {loading ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}
