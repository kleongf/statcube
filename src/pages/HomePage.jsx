import Navbar from '../components/Navbar'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Navbar />
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-3xl font-bold text-white">Welcome</h1>
      </div>
    </div>
  )
}
