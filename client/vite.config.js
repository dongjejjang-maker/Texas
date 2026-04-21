import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: true, // 💡 외부 터널(localtunnel) 접속을 프리패스 시켜주는 핵심 코드!
  }
})