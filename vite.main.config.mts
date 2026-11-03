import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The build's `WIGLEY_CLONE_DIR` when absolute, else the repo the build runs
// in.
const envCloneDir = process.env.WIGLEY_CLONE_DIR ?? '';
const cloneDir = path.isAbsolute(envCloneDir)
  ? envCloneDir
  : path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config
export default defineConfig({
  define: {
    WIGLEY_CLONE_DIR: JSON.stringify(cloneDir),
  },
});
