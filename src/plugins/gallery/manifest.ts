import { definePlugin } from '../../shared/define-plugin';

// Gallery mode, a debug view of every design primitive in every state, with a
// switch between full and reduced transparency that holds for the page load
// only and a swap of the shell to a test layout and back. Its main part only
// registers the layout contract. Names only `keys`, for its key hints.
export const galleryManifest = definePlugin({
  id: 'gallery',
  dependsOn: { main: [], page: ['keys'] },
  reads: { main: [], page: [] },
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
    lineDown: { label: 'scroll a line down', group: 'gallery', runsIn: 'page' },
    lineUp: { label: 'scroll a line up', group: 'gallery', runsIn: 'page' },
    halfPageDown: {
      label: 'scroll half a page down',
      group: 'gallery',
      runsIn: 'page',
    },
    halfPageUp: {
      label: 'scroll half a page up',
      group: 'gallery',
      runsIn: 'page',
    },
  },
  scopes: { gallery: 'In the gallery' },
  settings: { layout: 'default' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The gallery layout Gallery mode draws in: a folder name in gallery's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
