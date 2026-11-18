import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import { useAuth } from './auth'
import Home from './pages/Home'
import Listing from './pages/Listing'
import Detail from './pages/Detail'
import AnnouncementForm from './pages/AnnouncementForm'
import Login from './pages/Login'
import Admin from './pages/Admin'

function RequireAuth({ admin = false, children }) {
  const { user, loading, isAdmin } = useAuth()
  const location = useLocation()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (admin && !isAdmin) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="explore" element={<Listing />} />
        <Route path="category/:slug" element={<Listing />} />
        <Route path="announcements/:id" element={<Detail />} />
        <Route path="login" element={<Login />} />
        <Route path="create" element={<AnnouncementForm />} />
        <Route path="admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
