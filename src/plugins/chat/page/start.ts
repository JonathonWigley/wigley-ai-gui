import '../../../shared/page/markdown.css';
import './chat.css';
import type {
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
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
import { createImageViewer } from './image-viewer';
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
// in the page in place of sending it; the exports register more. Images
// pasted or dropped into a Chat tab attach to its next message, and a sent
// message's images open full size in the image viewer. The picker, the deny
// reason box, the end-session confirmation, the sign-in dialog and the image
// viewer sit in the overlay layer, each over a scope of its own; another
// session's Chat tab showing closes the reason box, the confirmation, a
// control picker and the image viewer, and leaves the sign-in dialog and the
// start prompt open. A resting session's Chat tab keys as a running one's
// does; its control chips are disabled until a message starts its process.
export const chatPagePart: PagePart<typeof chatManifest> = {
  manifest: chatManifest,
  start(api: ChatApi) {
    const { services } = api;
    void api.channel
      .invoke('loaded')
      .catch((error: unknown) =>
        services.log('chat', `chat page load not sent: ${errorText(error)}`),
      );
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
    const signIn = createSignInDialog({
      overlay: api.areas.overlay,
      editor: services.editor,
      keys,
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
    });
    const picker = createPicker({
      overlay: api.areas.overlay,
      editor: services.editor,
      pushScope: (scope) => api.keys.pushScope(scope),
      keys,
      log: services.log,
    });
    const viewer = createImageViewer({
      overlay: api.areas.overlay,
      pushScope: () => api.keys.pushScope('image'),
      log: services.log,
    });
    const permissions = createPermissionActions({
      channel: api.channel,
      reasonBox,
      log: services.log,
    });
    // The pickers and dialogs that act on the visible session.
    const closeSessionDialogs = () => {
      picker.closeSessionBound();
      reasonBox.cancel();
      confirm.keep();
    };
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
      run,
      commands: {
        exists: (id) => api.keys.command(id) !== undefined,
        run: (id) => api.commands.run(id),
      },
      platform: api.platform,
      permissions,
      confirm,
      viewer,
      slashCommandNames: () => slashCommands.names(),
      setScope: (scope) => api.keys.setScope(scope),
      otherSessionShown: () => {
        closeSessionDialogs();
        viewer.close();
      },
      visibleSessionRested: closeSessionDialogs,
      log: services.log,
      toast: services.toast,
    });
    api.layouts.show<ChatLayout>({
      defaultLayout,
      read: readChatLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) =>
        view.setLayout(
          shown.layouts.get(shown.user) ?? defaultLayout,
          shown.user,
        ),
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
          viewer,
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
