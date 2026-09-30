/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => {
  // Each build gets an id, in its JavaScript and in dist/build.txt, which the server sends back on every API response. A tab
  // still running an older build sees a different one and reloads (src/sim/build.ts). Vite's dev server has none.
  const build = command === 'build' ? Date.now().toString(36) + Math.random().toString(36).slice(2, 6) : ''
  return {
    plugins: [react(), { name: 'build-id', apply: 'build', generateBundle() { this.emitFile({ type: 'asset', fileName: 'build.txt', source: build }) } }],
    define: { __BUILD__: JSON.stringify(build) },
    test: {
      environment: 'happy-dom',
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }
})
