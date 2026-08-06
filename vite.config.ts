import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the app works on GitHub Pages project sites.
export default defineConfig({
  plugins: [react()],
  base: './',
})
