import Map from './components/Map'
import Sidebar from './components/Sidebar'

function App() {
  return (
    <>
      <Map center={[52.5200, 13.4050]} zoom={10} height="100vh" />
      <Sidebar />
    </>
  )
}

export default App
