import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api, { ensureCsrf } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        await ensureCsrf()
        const { data } = await api.get('/auth/me/')
        if (active) setUser(data)
      } catch {
        if (active) setUser(null)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  const login = useCallback(async (username, password) => {
    const { data } = await api.post('/auth/login/', { username, password })
    setUser(data)
    return data
  }, [])

  const logout = useCallback(async () => {
    await api.post('/auth/logout/')
    setUser(null)
    await ensureCsrf()
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, logout, isAdmin: user?.role === 'admin' }),
    [user, loading, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
