import { LayoutGrid, List } from 'lucide-react'
import { useViewMode } from '../viewMode'

/** Grid / list switch, like a file manager. */
export default function ViewToggle() {
  const [mode, setMode] = useViewMode()
  return (
    <div className="view-toggle" role="radiogroup" aria-label="Show posts as">
      <button type="button" role="radio" aria-checked={mode === 'grid'} aria-label="Cards" title="Cards"
        className={mode === 'grid' ? 'on' : ''} onClick={() => setMode('grid')}><LayoutGrid size={16} /></button>
      <button type="button" role="radio" aria-checked={mode === 'list'} aria-label="List" title="List"
        className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}><List size={16} /></button>
    </div>
  )
}

/** The container for post cards, in the chosen layout. */
export function PostList({ children }) {
  const [mode] = useViewMode()
  return <div className={`ann-grid ${mode === 'list' ? 'is-list' : ''}`}>{children}</div>
}
