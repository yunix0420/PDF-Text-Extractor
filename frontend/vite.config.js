import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      // Force requests starting with /api/ to bypass Vite's SPA fallback
      // so Wails AssetServer / Middleware handles them in dev mode
      '^/api/': {
        bypass(req, res, options) {
          return false;
        }
      }
    }
  }
});
