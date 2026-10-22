import '../../../shared/page/dialog.css';
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
import type { ChatChannel } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { ChatLayout } from '../layouts/layout';
import { chatManifest } from '../manifest';
import { chatCommandHandlers, createPermissionActions } from './chat-commands';
import { createCloseConfirm, createReasonBox } from './chat-dialogs';
import { mountChatView } from './chat-view';
import { createPicker } from './picker';
import { readChatLayout } from './read-chat-layout';
import { createStartPrompt } from './start-prompt';

type ChatApi = PageApi<
  typeof chatManifest,
  ChatChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsPageEvents>
>;

// Shows each chat session main holds in its session's Chat tab: the entries,
// drawn by the chat layout main chooses, a message box and the controls'
// status line. The new-session prompt asks for a folder, a profile and a new
// or saved session in the picker and starts or resumes a session there. The
// picker, the deny reason box and the end-session confirmation sit in the
// overlay layer, each over a scope of its own; another session's Chat tab
// showing closes the dialogs and a control picker, and leaves the start prompt
// open.
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
      run,
      pushScope: () => api.keys.pushScope('reason'),
      log: services.log,
    });
    const confirm = createCloseConfirm({
      overlay: api.areas.overlay,
      keys,
      run,
      pushScope: () => api.keys.pushScope('confirm'),
      log: services.log,
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
      sessions,
      onSessionRemoved: (listener) =>
        api.events.on('sessions.sessionRemoved', ({ sessionId }) =>
          listener(sessionId),
        ),
      editor: services.editor,
      markdown: services.markdown,
      keys,
      permissions,
      confirm,
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
      channel: api.channel,
      profiles: () => api.settings().profiles,
      reveal: (sessionId) => view.reveal(sessionId),
      log: services.log,
      toast: services.toast,
    });
    return {
      commands: {
        ...chatCommandHandlers({
          tabs: view,
          channel: api.channel,
          permissions,
          reasonBox,
          confirm,
          picker,
          toast: services.toast,
          log: services.log,
        }),
        newSession: () => startPrompt.open(),
        toggleArchive: () => startPrompt.toggleArchive(),
        showArchived: () => startPrompt.showArchived(),
      },
    };
  },
};
