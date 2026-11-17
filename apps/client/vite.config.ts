import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5180,
    strictPort: true,
    fs: { allow: ['../..'] },
    // The API and the game server run beside the game in development (npm run dev starts both).
    proxy: {
      '/api': 'http://127.0.0.1:5181',
      '/colyseus': { target: 'http://127.0.0.1:5181', ws: true },
    },
  },
  build: { target: 'es2022' },
});
