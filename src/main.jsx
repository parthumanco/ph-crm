import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/playfair-display/400.css'
import '@fontsource/playfair-display/400-italic.css'
import '@fontsource/playfair-display/700.css'
import '@fontsource/playfair-display/800.css'
import './index.css'
import App from './App.jsx'
import V2App from './v2/V2App.jsx'
import ClientPortalPage from './pages/ClientPortalPage.jsx'

// Three-way routing.
//
//   /portal/:token   → ClientPortalPage  (Mike's client-facing portal)
//   /legacy[/...]    → legacy App        (fallback / comparison only)
//   everything else  → V2App             (redesigned UI; legacy pages render
//                                         inside the v2 shell where v2 hasn't
//                                         ported them yet — see V2App)
//
// Only this file decides which tree mounts. Both apps are wired underneath.
const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
const portalMatch = pathname.match(/^\/portal\/([^/]+)/);
const isLegacy    = pathname.startsWith('/legacy');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {portalMatch
      ? <ClientPortalPage token={portalMatch[1]} />
      : isLegacy
        ? <App />
        : <V2App />
    }
  </StrictMode>,
)
