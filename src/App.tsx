import MapContainer from './components/Map/MapContainer'
import PWAInstallPrompt from './components/PWAInstallPrompt/PWAInstallPrompt'

function App() {
  return (
    <div className="h-screen w-screen">
      <MapContainer />
      <PWAInstallPrompt />
    </div>
  )
}

export default App
