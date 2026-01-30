import { useState } from 'react'
import TwilightTradingVisualizerLive from './TwilightTradingVisualizerLive'
import CEXComparisonPage from './CEXComparisonPage'

function App() {
  const [currentPage, setCurrentPage] = useState('twilight')

  if (currentPage === 'cex') {
    return <CEXComparisonPage onNavigateToTwilight={() => setCurrentPage('twilight')} />
  }

  return <TwilightTradingVisualizerLive onNavigateToCEX={() => setCurrentPage('cex')} />
}

export default App
