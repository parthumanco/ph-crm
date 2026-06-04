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

// Route flag: /legacy/* renders the original app for fallback or comparison.
// Everything else (root, /v2/* alias) renders the redesigned UI.
//
// This flip only exists on the ux/redesign-v2 branch — main stays bit-for-bit
// unchanged, so production Netlify continues to serve the legacy app at root.
const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
const isLegacy = pathname.startsWith('/legacy');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isLegacy ? <App /> : <V2App />}
  </StrictMode>,
)
