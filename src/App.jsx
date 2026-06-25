import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { CURRENT_SEASON } from './lib/constants'
import HomePage from './pages/HomePage'
import TeamsPage from './pages/TeamsPage'
import TeamPage from './pages/TeamPage'
import EventsPage from './pages/EventsPage'
import EventPage from './pages/EventPage'
import ComparePage from './pages/ComparePage'
import AllianceComparePage from './pages/AllianceComparePage'
import MethodologyPage from './pages/MethodologyPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to={`/teams/${CURRENT_SEASON}`} replace />} />
        <Route path="/teams" element={<Navigate to={`/teams/${CURRENT_SEASON}`} replace />} />
        <Route path="/teams/:season" element={<TeamsPage />} />
        <Route path="/team/:teamNumber" element={<Navigate to={`/teams/${CURRENT_SEASON}`} replace />} />
        <Route path="/team/:teamNumber/:season" element={<TeamPage />} />
        <Route path="/events" element={<Navigate to={`/events/${CURRENT_SEASON}`} replace />} />
        <Route path="/events/:season" element={<EventsPage />} />
        <Route path="/event/:season/:eventCode" element={<EventPage />} />
        <Route path="/compare" element={<Navigate to={`/compare/${CURRENT_SEASON}`} replace />} />
        <Route path="/compare/:season" element={<ComparePage />} />
        <Route path="/alliance" element={<Navigate to={`/alliance/${CURRENT_SEASON}`} replace />} />
        <Route path="/alliance/:season" element={<AllianceComparePage />} />
        <Route path="/methodology" element={<MethodologyPage />} />
      </Routes>
    </BrowserRouter>
  )
}
