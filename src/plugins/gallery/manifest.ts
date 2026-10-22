import { definePlugin } from '../../shared/define-plugin';

// Gallery mode, a debug view of every design primitive in every state, with a
// switch between full and reduced transparency that holds for the page load
// only and a swap of the shell to a test layout and back. Page-only, and names
// no other plugin.
export const galleryManifest = definePlugin({
  id: 'gallery',
  dependsOn: [],
  commands: {
    showMode: { label: 'gallery', group: 'modes', runsIn: 'page' },
    toggleTransparency: {
      label: 'switch transparency',
      group: 'gallery',
      runsIn: 'page',
    },
    swapShellLayout: {
      label: 'swap the shell layout',
      group: 'gallery',
      runsIn: 'page',
    },
    scrollTop: { label: 'scroll to the top', group: 'gallery', runsIn: 'page' },
    scrollEnd: { label: 'scroll to the end', group: 'gallery', runsIn: 'page' },
    pageDown: { label: 'scroll down a page', group: 'gallery', runsIn: 'page' },
  },
  scopes: { gallery: 'In the gallery' },
  keys: {
    page: [
      { keys: [' ', 'z', 'g'], scope: 'any', command: 'showMode' },
      { keys: ['t'], scope: 'gallery', command: 'toggleTransparency' },
      { keys: [' ', 'z', 's'], scope: 'any', command: 'swapShellLayout' },
      { keys: ['g', 'g'], scope: 'gallery', command: 'scrollTop' },
      { keys: ['G'], scope: 'gallery', command: 'scrollEnd' },
      { keys: ['d'], scope: 'gallery', command: 'pageDown' },
    ],
    editor: [],
    app: [],
    global: [],
    intercept: [],
  },
  settings: {},
  themeTokens: {},
});
