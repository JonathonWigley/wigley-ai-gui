/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

interface Window {
  wigley: import('./contracts/bridge').Bridge;
}
