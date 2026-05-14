import { BrowserRouter, Routes, Route } from 'react-router-dom'
import TeamsPage from './pages/TeamsPage'
import TeamPage from './pages/TeamPage'
import EventsPage from './pages/EventsPage'
import EventPage from './pages/EventPage'
import MethodologyPage from './pages/MethodologyPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TeamsPage />} />
        <Route path="/team/:teamNumber" element={<TeamPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/:eventCode" element={<EventPage />} />
        <Route path="/methodology" element={<MethodologyPage />} />
      </Routes>
    </BrowserRouter>
  )
}
