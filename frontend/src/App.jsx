import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import Home from './pages/Home'
import Listing from './pages/Listing'
import Detail from './pages/Detail'
import AnnouncementForm from './pages/AnnouncementForm'
import CategoryForm from './pages/CategoryForm'
import Categories from './pages/Categories'
import Trash from './pages/Trash'
import NotificationSettings from './pages/NotificationSettings'
import AuthPage from './pages/AuthPage'

const auth = (el) => <RequireAuth>{el}</RequireAuth>

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="explore" element={<Listing />} />
        <Route path="my-posts" element={auth(<Listing mine />)} />
        <Route path="category/:slug" element={<Listing />} />
        <Route path="announcements/:id" element={<Detail />} />
        <Route path="announcements/:id/edit" element={auth(<AnnouncementForm />)} />
        <Route path="create" element={auth(<AnnouncementForm />)} />
        <Route path="categories" element={<Categories />} />
        <Route path="categories/new" element={auth(<CategoryForm />)} />
        <Route path="categories/:id/edit" element={auth(<CategoryForm />)} />
        <Route path="trash" element={auth(<Trash />)} />
        <Route path="notifications" element={<NotificationSettings />} />
        <Route path="login" element={<AuthPage mode="login" />} />
        <Route path="register" element={<AuthPage mode="register" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
