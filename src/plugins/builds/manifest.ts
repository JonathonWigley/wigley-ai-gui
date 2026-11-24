import { definePlugin } from '../../shared/define-plugin';
import { LIST_PICKER_COMMANDS } from '../../shared/list-picker-commands';

// Builds: the CI and local builds of the games each backend entry of `backends` tracks, polled through the backend
// kinds that backend plugins register with `addBackend`, published in `builds.snapshot` and per session in
// `builds.sessions`. Main names `chat` to message a session when its build fails or ends and to launch a set's agent,
// and reads `sessions` for the rows it messages; the page names `sessions` for the row line and activity and `chat`
// for the hub section and the offer card. `queue` and `offer` take a kind or a set id as `kind`. `layout` names the
// layout Builds mode and the session parts draw with. The page's commands run Builds mode (`showMode`), its queue
// picker (`pickQueue` and the list picker's keys), its two lists' keys (the build list's `focusGraph` into the job
// graph and `download` of the build's file among them), the job graph's keys in the `graph` scope (`leaveGraph`, the
// four `graph<Direction>` moves, `graphTop`, `graphBottom`, `saveLog` and `openJob`), and the session's build offer (`queueOffer`,
// `dismissOffer`, and the offer card's keys); the clicks `selectEntry` (a side-bar entry key), `selectBuild`
// (`<backendId>/<buildId>`), `selectJob` (a job id), `downloadFile` (a file's entry), `showBuild` (`{ backend, build }`,
// the hub's Open in Builds), `queueButton`, `withAgent`, `setFilter`, `openLink` (a URL), and the offer card's
// `queueSessionOffer` and `dismissSessionOffer` (a session id) take an arg and have no key.
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
    showMode: {
      label: 'builds (again: toggle the side bar)',
      group: 'modes',
      runsIn: 'page',
    },
    pickQueue: { label: 'queue a build', group: 'build', runsIn: 'page' },
    focusGraph: {
      label: "show the build's jobs",
      group: 'list',
      runsIn: 'page',
    },
    download: {
      label: "download the build's file",
      group: 'list',
      runsIn: 'page',
    },
    openWeb: {
      label: 'open the build in the backend',
      group: 'list',
      runsIn: 'page',
    },
    cancel: { label: 'cancel the build', group: 'list', runsIn: 'page' },
    listDown: { label: 'next build', group: 'list', runsIn: 'page' },
    listUp: { label: 'previous build', group: 'list', runsIn: 'page' },
    listTop: { label: 'first build', group: 'list', runsIn: 'page' },
    listBottom: { label: 'last build', group: 'list', runsIn: 'page' },
    gameDown: { label: 'next game', group: 'games', runsIn: 'page' },
    gameUp: { label: 'previous game', group: 'games', runsIn: 'page' },
    gameTop: { label: 'first game', group: 'games', runsIn: 'page' },
    gameBottom: { label: 'last game', group: 'games', runsIn: 'page' },
    openGame: {
      label: "show the game's builds",
      group: 'games',
      runsIn: 'page',
    },
    selectEntry: {
      label: 'show this entry',
      group: 'games',
      runsIn: 'page',
      arg: 'string',
    },
    selectBuild: {
      label: 'select this build',
      group: 'list',
      runsIn: 'page',
      arg: 'string',
    },
    downloadFile: {
      label: 'download this file',
      group: 'list',
      runsIn: 'page',
      arg: 'number',
    },
    showBuild: {
      label: 'show this build in Builds',
      group: 'list',
      runsIn: 'page',
      arg: { backend: 'string', build: 'string' },
    },
    leaveGraph: { label: 'back to the builds', group: 'graph', runsIn: 'page' },
    graphLeft: { label: 'previous column', group: 'graph', runsIn: 'page' },
    graphRight: { label: 'next column', group: 'graph', runsIn: 'page' },
    graphUp: { label: 'previous job', group: 'graph', runsIn: 'page' },
    graphDown: { label: 'next job', group: 'graph', runsIn: 'page' },
    graphTop: {
      label: 'first job in the column',
      group: 'graph',
      runsIn: 'page',
    },
    graphBottom: {
      label: 'last job in the column',
      group: 'graph',
      runsIn: 'page',
    },
    saveLog: { label: "save the job's log", group: 'graph', runsIn: 'page' },
    openJob: {
      label: 'open the job in the backend',
      group: 'graph',
      runsIn: 'page',
    },
    selectJob: {
      label: 'select this job',
      group: 'graph',
      runsIn: 'page',
      arg: 'string',
    },
    queueButton: {
      label: 'queue this kind or set',
      group: 'build',
      runsIn: 'page',
      arg: { backend: 'string', game: 'string', kind: 'string' },
    },
    withAgent: {
      label: 'make this set with an agent',
      group: 'build',
      runsIn: 'page',
      arg: { backend: 'string', game: 'string', set: 'string' },
    },
    setFilter: {
      label: 'filter the feed',
      group: 'list',
      runsIn: 'page',
      arg: 'string',
    },
    openLink: {
      label: 'open the link',
      group: 'list',
      runsIn: 'page',
      arg: 'string',
    },
    queueOffer: {
      label: "queue the session's build offer",
      group: 'build',
      runsIn: 'page',
    },
    dismissOffer: {
      label: "dismiss the session's build offer",
      group: 'build',
      runsIn: 'page',
    },
    queueSessionOffer: {
      label: 'queue this build offer',
      group: 'build',
      runsIn: 'page',
      arg: 'string',
    },
    dismissSessionOffer: {
      label: 'dismiss this build offer',
      group: 'build',
      runsIn: 'page',
      arg: 'string',
    },
    leaveOffer: {
      label: 'back to the entries',
      group: 'offer',
      runsIn: 'page',
    },
    offerFocusBox: { label: 'type a message', group: 'offer', runsIn: 'page' },
    offerAppendBox: {
      label: 'append to the message',
      group: 'offer',
      runsIn: 'page',
    },
    ...LIST_PICKER_COMMANDS,
  },
  scopes: {
    games: 'In the Builds game list',
    list: 'In the Builds list',
    graph: 'In the Builds job graph',
    picker: 'In the Builds queue picker',
    offer: 'On a build offer card',
  },
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
