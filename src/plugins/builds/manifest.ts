import { definePlugin } from '../../shared/define-plugin';

// Builds: the CI and local builds of the games each backend entry of `backends` tracks, polled through the backend
// kinds that backend plugins register with `addBackend`, published in `builds.snapshot` and per session in
// `builds.sessions`. Main names `chat` to message a session when its build fails or ends and to launch a set's agent,
// and reads `sessions` for the rows it messages; the page names `sessions` for the row line and activity and `chat`
// for the hub section and the offer card. `queue` and `offer` take a kind or a set id as `kind`. `layout` names the
// layout Builds mode and the session parts draw with.
export const buildsManifest = definePlugin({
  id: 'builds',
  label: 'Builds',
  description:
    'Shows the CI and local builds of the games you track, and queues builds and build sets.',
  dependsOn: { main: ['chat'], page: ['sessions', 'chat'] },
  reads: { main: ['sessions'], page: [] },
  commands: {
    queue: {
      label: 'queue a build or a build set',
      group: 'builds',
      runsIn: 'main',
      arg: {
        backend: 'string',
        game: 'string',
        kind: 'string',
        branch: 'string',
      },
      risky: true,
    },
    offer: {
      label: 'offer a build for the user to queue',
      group: 'builds',
      runsIn: 'main',
      arg: {
        backend: 'string',
        game: 'string',
        kind: 'string',
        branch: 'string',
      },
    },
    launchSetAgent: {
      label: 'run the set with its agent',
      group: 'builds',
      runsIn: 'main',
      arg: { backend: 'string', game: 'string', set: 'string' },
    },
  },
  scopes: {},
  settings: { backends: [] as unknown[], layout: 'default' },
  settingControls: { layout: 'layout' },
  settingInfo: {
    backends: {
      label: 'Build backends',
      description:
        'The build backends this machine uses, each with its tracked games, kinds and sets; see the builds design for the shape.',
    },
    layout: {
      label: 'Builds layout',
      description:
        'The layout that draws Builds mode and the session parts: a folder in the layouts/builds folder, or default.',
    },
  },
  themeTokens: {},
});
