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

// Route flag: /v2/* renders the redesigned UI. Everything else falls through
// to the existing app, which stays bit-for-bit untouched.
const isV2 = typeof window !== 'undefined' && window.location.pathname.startsWith('/v2');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isV2 ? <V2App /> : <App />}
  </StrictMode>,
)
