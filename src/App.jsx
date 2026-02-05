import { useState, lazy, Suspense } from 'react'

const TwilightTradingVisualizerLive = lazy(() => import('./TwilightTradingVisualizerLive'))
const CEXComparisonPage = lazy(() => import('./CEXComparisonPage'))

function App() {
  const [currentPage, setCurrentPage] = useState('twilight')

  return (
    <Suspense fallback={<div className="app-loading">Loading…</div>}>
      {currentPage === 'cex' ? (
        <CEXComparisonPage onNavigateToTwilight={() => setCurrentPage('twilight')} />
      ) : (
        <TwilightTradingVisualizerLive onNavigateToCEX={() => setCurrentPage('cex')} />
      )}
    </Suspense>
  )
}

export default App
