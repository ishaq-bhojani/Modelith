import { createRoot } from 'react-dom/client'

// Self-hosted so the app makes no outbound request at launch. The design
// imports these from Google Fonts; our CSP sets `font-src 'self' data:` and
// the project promises no phone-home, so they are bundled instead.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter-tight/500.css'

import './app/theme.css'
import { App } from './app/App.js'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')
createRoot(root).render(<App />)
