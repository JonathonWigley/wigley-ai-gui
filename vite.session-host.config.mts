import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    lib: {
      entry: 'src/session-host/session-host.ts',
      formats: ['cjs'],
      // `install-app` tells the host from the app by this name on its command line.
      fileName: () => 'session-host.js',
    },
    // Joins the Vite plugin's own `rollupOptions.external`; `forge.config.mts`
    // copies node-pty into the package's `node_modules`, which the bundle's `require` finds up its folders.
    rollupOptions: { external: ['node-pty'] },
  },
});
