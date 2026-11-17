import { definePlugin } from '../../shared/define-plugin';

// The installed app's update button: main fetches the clone the app was built
// from every 15 minutes and when the window gains focus, and while origin's
// `main` has moved past the commit the app was built from, the title bar shows
// an Update available button beside the Keys button. A click runs `install`,
// which starts `npm run install-app -- --ref origin/main` detached in that
// clone; the install quits the app and starts the new build. `pressButton`
// presses the drawn button from the keyboard, as a click does. The dev app
// bakes no commit, so it checks nothing and never shows the button.
export const appUpdateManifest = definePlugin({
  id: 'app-update',
  label: 'App update',
  description:
    "Shows an Update available button in the title bar when origin's main has moved past the installed app's commit, and installs it on a click.",
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: {
    install: {
      label: 'install the app update',
      group: 'app',
      runsIn: 'main',
      risky: true,
    },
    check: {
      label: 'check for an app update',
      group: 'app',
      runsIn: 'main',
    },
    pressButton: {
      label: 'press the update button',
      group: 'app',
      runsIn: 'page',
    },
  },
  scopes: {},
  settings: { layout: 'default' },
  settingInfo: {
    layout: {
      label: 'App update layout',
      description:
        'The layout that draws the title bar update button: a folder in the layouts/app-update folder, or default.',
    },
  },
  themeTokens: {},
});
