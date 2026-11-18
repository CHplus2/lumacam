import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Clock, Flag, FolderPlus, Layers, Trash2, X } from 'lucide-react'
import api, { parseError } from '../api'
import { CategoryBadge, EmptyState, ErrorBox, Spinner, StatusBadge } from '../components/ui'
import { ICONS, fmtDate } from '../utils'

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
  { key: 'reports', label: 'Reports' },
  { key: 'categories', label: 'Categories' },
]

function Stat({ icon: Icon, label, value, tone }) {
  return (
    <div className={`stat tone-${tone}`}>
      <Icon size={20} />
      <div><div className="stat-value">{value ?? '-'}</div><div className="stat-label">{label}</div></div>
    </div>
  )
}

export default function Admin() {
  const [tab, setTab] = useState('pending')
  const [stats, setStats] = useState(null)
  const [items, setItems] = useState([])
  const [reports, setReports] = useState([])
  const [cats, setCats] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadStats = useCallback(() => {
    api.get('/admin/stats/').then(({ data }) => setStats(data)).catch((e) => setError(parseError(e).message))
  }, [])

  const load = useCallback(async (pageNo = 1) => {
    setLoading(true); setError('')
    try {
      if (tab === 'categories') {
        const { data } = await api.get('/admin/categories/')
        setCats(data)
      } else if (tab === 'reports') {
        const { data } = await api.get('/admin/reports/', { params: { status: 'open' } })
        setReports(data.results)
      } else {
        const { data } = await api.get('/admin/announcements/', {
          params: { status: tab === 'all' ? undefined : tab, page: pageNo },
        })
        setItems((prev) => (pageNo === 1 ? data.results : [...prev, ...data.results]))
        setHasMore(Boolean(data.next)); setPage(pageNo)
      }
    } catch (e) { setError(parseError(e).message) } finally { setLoading(false) }
  }, [tab])

  useEffect(loadStats, [loadStats])
  useEffect(() => { load(1) }, [load])

  const act = async (fn) => {
    setError('')
    try { await fn(); await Promise.all([load(1), loadStats()]) } catch (e) { setError(parseError(e).message) }
  }
  const approve = (a) => act(() => api.post(`/admin/announcements/${a.id}/approve/`))
  const reject = (a) => {
    const reason = window.prompt('Reason for rejection (shown to the publisher):', '')
    if (reason === null) return
    act(() => api.post(`/admin/announcements/${a.id}/reject/`, { reason }))
  }
  const remove = (a) => {
    if (!window.confirm(`Permanently delete "${a.title}"?`)) return
    act(() => api.delete(`/admin/announcements/${a.id}/`))
  }
  const approveCategory = (c) => act(() => api.post(`/admin/categories/${c.id}/approve/`))
  const deleteCategory = (c) => {
    const note = c.announcement_count ? ` Its ${c.announcement_count} announcement(s) will move to "Other Announcements".` : ''
    if (!window.confirm(`Delete the category "${c.name}"?${note}`)) return
    act(() => api.delete(`/admin/categories/${c.id}/`))
  }
  const closeReport = (r, how) => act(() => api.post(`/admin/reports/${r.id}/${how}/`))

  return (
    <>
      <h1>Administrator dashboard</h1>
      <div className="stats">
        <Stat icon={Layers} label="Total" value={stats?.total} tone="blue" />
        <Stat icon={Clock} label="Pending" value={stats?.pending} tone="orange" />
        <Stat icon={Check} label="Approved" value={stats?.approved} tone="emerald" />
        <Stat icon={X} label="Rejected" value={stats?.rejected} tone="rose" />
        <Stat icon={Flag} label="Open reports" value={stats?.open_reports} tone="violet" />
        <Stat icon={FolderPlus} label="New categories" value={stats?.pending_categories} tone="teal" />
      </div>

      <div className="chips" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key}
            className={`chip ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}{t.key === 'pending' && stats?.pending ? ` (${stats.pending})` : ''}
            {t.key === 'categories' && stats?.pending_categories ? ` (${stats.pending_categories})` : ''}
          </button>
        ))}
      </div>

      <ErrorBox message={error} />
      {loading && !items.length && !reports.length && !cats.length ? <Spinner /> : tab === 'categories' ? (
        <ul className="list">
          {cats.map((c) => {
            const Icon = ICONS[c.icon]
            return (
              <li key={c.id} className="card list-row">
                <span className={`cat-icon tone-${c.color}`}>{Icon && <Icon size={22} />}</span>
                <div className="grow">
                  <div className="row wrap">
                    <strong>{c.name}</strong>
                    <span className={`status status-${c.is_approved ? 'approved' : 'pending'}`}>{c.is_approved ? 'live' : 'pending'}</span>
                  </div>
                  {c.description && <p className="ann-desc">{c.description}</p>}
                  <p className="muted small">{c.announcement_count} announcement(s)</p>
                </div>
                <div className="row">
                  {!c.is_approved && <button className="btn btn-sm btn-success" onClick={() => approveCategory(c)}><Check size={14} /> Approve</button>}
                  {c.slug !== 'other' && <button className="btn btn-sm btn-danger" onClick={() => deleteCategory(c)}><Trash2 size={14} /> Delete</button>}
                </div>
              </li>
            )
          })}
        </ul>
      ) : tab === 'reports' ? (
        reports.length === 0 ? <EmptyState title="No open reports" text="Reported announcements will show up here." /> : (
          <ul className="list">
            {reports.map((r) => (
              <li key={r.id} className="card list-row">
                <div className="grow">
                  <Link to={`/announcements/${r.announcement}`}><strong>{r.announcement_title}</strong></Link>
                  <p className="muted small">Reported by {r.reporter_name} on {fmtDate(r.created_at)}</p>
                  <p>{r.reason}</p>
                </div>
                <div className="row">
                  <button className="btn btn-sm" onClick={() => closeReport(r, 'dismiss')}>Dismiss</button>
                  <button className="btn btn-sm" onClick={() => closeReport(r, 'resolve')}>Mark resolved</button>
                  <button className="btn btn-sm btn-danger" onClick={() => remove({ id: r.announcement, title: r.announcement_title })}>
                    <Trash2 size={14} /> Delete post
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : items.length === 0 ? (
        <EmptyState title={`No ${tab === 'all' ? '' : tab} announcements`} />
      ) : (
        <>
          <ul className="list">
            {items.map((a) => (
              <li key={a.id} className="card list-row">
                {a.image_url && <img className="row-thumb" src={a.image_url} alt="" />}
                <div className="grow">
                  <div className="row wrap">
                    <CategoryBadge category={a.category_detail} /><StatusBadge status={a.status} />
                    {a.open_reports > 0 && <span className="status status-rejected">{a.open_reports} report(s)</span>}
                  </div>
                  <Link to={`/announcements/${a.id}`}><strong>{a.title}</strong></Link>
                  <p className="ann-desc">{a.description}</p>
                  <p className="muted small">{a.publisher_name} · {fmtDate(a.created_at)}</p>
                </div>
                <div className="row">
                  {a.status !== 'approved' && <button className="btn btn-sm btn-success" onClick={() => approve(a)}><Check size={14} /> Approve</button>}
                  {a.status !== 'rejected' && <button className="btn btn-sm" onClick={() => reject(a)}><X size={14} /> Reject</button>}
                  <button className="btn btn-sm btn-danger" onClick={() => remove(a)}><Trash2 size={14} /> Delete</button>
                </div>
              </li>
            ))}
          </ul>
          {hasMore && <div className="center"><button className="btn" disabled={loading} onClick={() => load(page + 1)}>Load more</button></div>}
        </>
      )}
    </>
  )
}
