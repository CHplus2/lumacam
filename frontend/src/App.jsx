import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Listing from './pages/Listing'
import Detail from './pages/Detail'
import AnnouncementForm from './pages/AnnouncementForm'
import CategoryForm from './pages/CategoryForm'
import Categories from './pages/Categories'
import Trash from './pages/Trash'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="explore" element={<Listing />} />
        <Route path="category/:slug" element={<Listing />} />
        <Route path="announcements/:id" element={<Detail />} />
        <Route path="announcements/:id/edit" element={<AnnouncementForm />} />
        <Route path="create" element={<AnnouncementForm />} />
        <Route path="categories" element={<Categories />} />
        <Route path="trash" element={<Trash />} />
        <Route path="categories/new" element={<CategoryForm />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
