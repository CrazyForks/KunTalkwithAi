import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { TextModeProvider } from './state/TextModeContext'
import { ImageModeProvider } from './state/ImageModeContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TextModeProvider>
      <ImageModeProvider>
        <App />
      </ImageModeProvider>
    </TextModeProvider>
  </StrictMode>,
)
