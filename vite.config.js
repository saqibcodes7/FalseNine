import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Exposes the dev server on your LAN so you can test on a real phone.
    // Visit http://<your-computer-ip>:5173 from the phone.
    host: true,
    port: 5173,
  },
})
