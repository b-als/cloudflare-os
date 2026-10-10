import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toasty, TooltipProvider } from '@cloudflare/kumo'
import { ThemeProvider } from '../../ThemeContext'
import { applyStoredThemeMode } from '../../theme'
import { DesignReview } from './DesignReview'
import './designReview.css'

const root = document.getElementById('root')
if (!root) throw new Error('Design review mount point is missing.')

if (import.meta.env.DEV) {
  applyStoredThemeMode()
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <TooltipProvider>
          <Toasty><DesignReview /></Toasty>
        </TooltipProvider>
      </ThemeProvider>
    </StrictMode>,
  )
} else {
  root.textContent = 'This UI design review is available only in local development.'
}
