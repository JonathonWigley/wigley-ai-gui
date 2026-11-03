import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  server: {
    // Main serves each owner's live default from the clone, so the dev server
    // leaves those folders to it and reloads no page on a save there.
    watch: { ignored: ['**/layouts/default/**'] },
  },
  build: {
    // The page's CSP allows no `data:` stylesheet; other assets keep Vite's
    // size rule.
    assetsInlineLimit: (filePath) =>
      filePath.endsWith('.css') ? false : undefined,
  },
});
