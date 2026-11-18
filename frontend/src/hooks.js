import { useCallback, useEffect, useState } from 'react'
import api, { parseError } from './api'

/** Fetch the category list (small, changes rarely). */
export function useCategories() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    setLoading(true); setError('')
    api.get('/categories/')
      .then(({ data }) => setCategories(data))
      .catch((e) => setError(parseError(e).message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])
  return { categories, loading, error, reload: load }
}

export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
