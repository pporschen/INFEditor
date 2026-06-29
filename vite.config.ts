import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// viteSingleFile inlines everything into one dist/index.html, so the editor
// runs offline by double-clicking the file — important for exam machines.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
})
