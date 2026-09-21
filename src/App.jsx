import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Home from './screens/Home'
import Backdrop from './ui/Backdrop'
import Logo from './ui/Logo'

/*
 * The landing page is the one screen people hit cold, often on a phone on
 * mobile data. Everything Imposter-related pulls in the Supabase client
 * (~140kB gzipped with the realtime websocket layer), so it is split into its
 * own chunk that only downloads once someone actually picks a game.
 */
const ImposterHome = lazy(() => import('./screens/ImposterHome'))
const CreateGame = lazy(() => import('./screens/CreateGame'))
const JoinGame = lazy(() => import('./screens/JoinGame'))
const Lobby = lazy(() => import('./screens/Lobby'))
const Kit = lazy(() => import('./screens/Kit'))

function ChunkFallback() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Backdrop />
      <span className="sr-only">Loading</span>
      <Logo mark className="h-10 animate-pulse text-gold-deep" />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<ChunkFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/imposter" element={<ImposterHome />} />
          <Route path="/imposter/create" element={<CreateGame />} />
          <Route path="/imposter/join" element={<JoinGame />} />
          <Route path="/imposter/lobby/:code" element={<Lobby />} />
          <Route path="/kit" element={<Kit />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
