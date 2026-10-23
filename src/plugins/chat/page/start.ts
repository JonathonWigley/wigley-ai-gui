import '../../../shared/page/markdown.css';
import './chat.css';
import type {
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import {
  createLayoutLoader,
  showLayouts,
} from '../../../shared/page/layout-loader';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsPageEvents,
  SessionsPageExports,
} from '../../sessions/contract';
import type { ChatChannel, ChatPageExports } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { ChatLayout } from '../layouts/layout';
import { chatManifest } from '../manifest';
import { addAccountCommands } from './account-commands';
import { chatCommandHandlers, createPermissionActions } from './chat-commands';
import { createCloseConfirm, createReasonBox } from './chat-dialogs';
import { mountChatView } from './chat-view';
import { createPicker } from './picker';
import { readChatLayout } from './read-chat-layout';
import { createSignInDialog } from './sign-in-dialog';
import { createSlashCommands } from './slash-commands';
import { createStartPrompt } from './start-prompt';

type ChatApi = PageApi<
  typeof chatManifest,
  ChatChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsPageEvents>
>;

// Shows each chat session main holds in its session's Chat tab: the entries,
// drawn by the chat layout main chooses, under a floating composer holding
// the message box, the controls as chips and send. The new-session prompt
// asks for a folder, a profile and a new or saved session in the picker and
// starts or resumes a session there, signing a signed-out profile in first.
// Sending `/login`, `/logout`, `/status` or another app slash command runs it
// in the page in place of sending it; the exports register more. The
// picker, the deny reason box, the end-session confirmation and the sign-in
// dialog sit in the overlay layer, each over a scope of its own; another
// session's Chat tab showing closes the reason box, the confirmation and a
// control picker, and leaves the start prompt and the sign-in dialog open.
export const chatPagePart: PagePart<typeof chatManifest> = {
  manifest: chatManifest,
  start(api: ChatApi) {
    const { services } = api;
    const sessions = api.dependency<SessionsPageExports>('sessions');
    const keys = api.dependency<KeysPageExports>('keys');
    const run = (command: string) => api.commands.run(command);
    const reasonBox = createReasonBox({
      overlay: api.areas.overlay,
      editor: services.editor,
      keys,
      platform: api.platform,
      run,
      pushScope: () => api.keys.pushScope('reason'),
      log: services.log,
    });
    const confirm = createCloseConfirm({
      overlay: api.areas.overlay,
      keys,
      platform: api.platform,
      run,
      pushScope: () => api.keys.pushScope('confirm'),
      log: services.log,
    });
    const signIn = createSignInDialog({
      overlay: api.areas.overlay,
      editor: services.editor,
      keys,
      platform: api.platform,
      run,
      pushScope: () => api.keys.pushScope('signIn'),
      log: services.log,
      channel: api.channel,
      toast: services.toast,
    });
    const slashCommands = createSlashCommands();
    addAccountCommands({
      commands: slashCommands,
      signIn,
      channel: api.channel,
      toast: services.toast,
    });
    const picker = createPicker({
      overlay: api.areas.overlay,
      editor: services.editor,
      pushScope: (scope) => api.keys.pushScope(scope),
      log: services.log,
    });
    const permissions = createPermissionActions({
      channel: api.channel,
      reasonBox,
      log: services.log,
    });
    const view = mountChatView({
      channel: api.channel,
      paths: services.paths,
      sessions,
      onSessionRemoved: (listener) =>
        api.events.on('sessions.sessionRemoved', ({ sessionId }) =>
          listener(sessionId),
        ),
      editor: services.editor,
      markdown: services.markdown,
      keys,
      platform: api.platform,
      run,
      permissions,
      confirm,
      slashCommandNames: () => slashCommands.names(),
      setScope: () => api.keys.setScope('chat'),
      otherSessionShown: () => {
        picker.closeSessionBound();
        reasonBox.cancel();
        confirm.keep();
      },
      log: services.log,
      toast: services.toast,
    });
    showLayouts<ChatLayout>({
      channel: {
        onLayoutChanged: (listener) =>
          api.channel.on('layoutChanged', listener),
        readLayout: () => api.channel.invoke('layout'),
      },
      loader: createLayoutLoader<ChatLayout>({
        importModule: (url) => import(/* @vite-ignore */ url),
        dataUrl: (path, revision) => api.dataUrl(path, revision),
        defaultLayout,
        head: document.head,
        read: readChatLayout,
      }),
      setLayout: (layout, name) => view.setLayout(layout, name),
      log: services.log,
      logSource: 'chat',
      dataFolderLabel: "chat's data folder",
      toast: services.toast,
    });
    const startPrompt = createStartPrompt({
      picker,
      signIn,
      channel: api.channel,
      profiles: () => api.settings().profiles,
      reveal: (sessionId) => view.reveal(sessionId),
      paths: services.paths,
      homeDir: services.homeDir,
      log: services.log,
      toast: services.toast,
    });
    const exports: ChatPageExports = {
      addSlashCommand: (command) => slashCommands.add(command),
    };
    return {
      commands: {
        ...chatCommandHandlers({
          tabs: view,
          channel: api.channel,
          permissions,
          reasonBox,
          confirm,
          picker,
          signIn,
          slashCommands,
          toast: services.toast,
          log: services.log,
        }),
        newSession: () => startPrompt.open(),
        toggleArchive: () => startPrompt.toggleArchive(),
        showArchived: () => startPrompt.showArchived(),
      },
      exports,
    };
  },
};
