/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';
// Vite's `?raw` suffix imports a file's text.
declare module '*?raw' {
  const text: string;
  export default text;
}

// Vite's `?url` suffix imports a file's URL.
declare module '*?url' {
  const url: string;
  export default url;
}

interface Window {
  wigley: { claim(): import('./contracts/bridge').Bridge };
}
