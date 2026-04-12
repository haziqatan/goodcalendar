import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Serve index.html for all paths (SPA fallback) so /auth/callback works
    historyApiFallback: true,
  },
});
