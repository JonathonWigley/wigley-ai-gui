import '../../../shared/page/markdown.css';
import './chat.css';
import type { Registrations } from '../../../contracts/disposable';
import type {
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { createPartStore } from '../../../shared/page/contributed-parts';
import { keysPageKey } from '../../keys/contract';
import {
  type SessionsPageEvents,
  sessionsPageKey,
} from '../../sessions/contract';
import type {
  ChatChannel,
  ChatComposerPart,
  ChatPageEvents,
  ChatPageExports,
  ChatSidePart,
  ChatStatusPart,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { ChatLayout } from '../layouts/layout';
import { chatManifest } from '../manifest';
import { addAccountCommands } from './account-commands';
import {
  chatCommandHandlers,
  createPermissionActions,
  fillComposer,
} from './chat-commands';
import { createCloseConfirm, createReasonBox } from './chat-dialogs';
import { createChatLayouts } from './chat-layouts';
import { addClearCommands } from './clear-commands';
import { clipboardWriter } from './clipboard';
import { createCompletionRows, descriptionDraw } from './completion-rows';
import { mountChatView } from './chat-view';
import { createImageViewer } from './image-viewer';
import { createMainAgentPart } from './main-agent-part';
import { createPicker } from './picker';
import { readChatLayout } from './read-chat-layout';
import { createRowClock } from './row-clock';
import { createSessionPart } from './session-part';
import { createSideSections } from './side-sections';
import { createSignInDialog } from './sign-in-dialog';
import { createSlashCommands } from './slash-commands';
import { createStartPrompt } from './start-prompt';

type ChatApi = PageApi<
  typeof chatManifest,
  ChatChannel,
  ChatPageEvents,
  QualifiedEvents<'sessions', SessionsPageEvents>
>;

// Shows each chat session main holds in its session's Chat tab: the entries
// under a floating composer holding the message box, the controls as chips
// and send. The entries, the composer, the picker rows, the dialogs and the
// image viewer draw through the chat layout the `chat.layout` setting names.
// The new-session prompt asks for a folder, a profile and a new or saved
// session in the picker and starts or resumes a session there, signing a
// signed-out profile in first.
// A message sent while the session's turn runs shows as a pending row after
// the entries until main writes it to the agent; pulling it back puts it into
// the box.
// Sending `/login`, `/logout`, `/status` or another app slash command runs it
// in the page in place of sending it; each `/` completion row shows its
// command's description through the `completionDescription` part while the
// `chat.completionDescriptions` setting is on; the exports register more
// commands and row draws, fill a session's box, and add parts above every
// composer and sections to every tab's session hub, which `toggleSideParts` hides or shows in every tab; chat's own
// Main agent section holds the activity dock, and its Session section the
// session's facts. Images
// pasted or dropped into a Chat tab attach to its next message, other files go
// into the box as file chips, and a sent message's images open full size in
// the image viewer. The picker, the deny
// reason box, the end-session confirmation, the sign-in dialog and the image
// viewer sit in the overlay layer, each over a scope of its own; another
// session's Chat tab showing closes the reason box, the confirmation, a
// control picker and the image viewer, and leaves the sign-in dialog and the
// start prompt open. A resting session's Chat tab keys as a running one's
// does; its control chips are disabled until a message starts its process.
// Each session's row shows its run time, and the exports and `activeTimeChanged`
// offer its clock to other plugins.
export const chatPagePart: PagePart<typeof chatManifest> = {
  manifest: chatManifest,
  start(api: ChatApi) {
    const { services } = api;
    void api.channel
      .invoke('loaded')
      .catch((error: unknown) =>
        services.log(`chat page load not sent: ${errorText(error)}`),
      );
    const sessions = api.dependency(sessionsPageKey);
    const keys = api.dependency(keysPageKey);
    const run = (command: string) => api.commands.run(command);
    const layouts = createChatLayouts(services.log);
    // What every surface's layout kit reads.
    const partDeps = {
      layouts,
      markdown: services.markdown,
      keys,
      commands: {
        exists: (id: string) => api.keys.command(id) !== undefined,
        run: (id: string) => api.commands.run(id),
      },
      platform: api.platform.os,
      log: services.log,
    };
    const reasonBox = createReasonBox({
      ...partDeps,
      overlay: api.areas.overlay,
      editor: services.editor,
      run,
      pushScope: () => api.keys.pushScope('reason'),
    });
    const confirm = createCloseConfirm({
      ...partDeps,
      overlay: api.areas.overlay,
      run,
      pushScope: () => api.keys.pushScope('confirm'),
    });
    const writeClipboard = clipboardWriter(services.runMode);
    const signIn = createSignInDialog({
      ...partDeps,
      overlay: api.areas.overlay,
      editor: services.editor,
      run,
      pushScope: () => api.keys.pushScope('signIn'),
      channel: api.channel,
      writeClipboard,
      toast: services.toast,
    });
    const slashCommands = createSlashCommands();
    addAccountCommands({
      commands: slashCommands,
      signIn,
      channel: api.channel,
    });
    addClearCommands({ commands: slashCommands, channel: api.channel });
    const completionRows = createCompletionRows(services.log);
    const picker = createPicker({
      ...partDeps,
      overlay: api.areas.overlay,
      editor: services.editor,
      matcher: services.fuzzy,
      pushScope: (scope) => api.keys.pushScope(scope),
    });
    const viewer = createImageViewer({
      ...partDeps,
      overlay: api.areas.overlay,
      pushScope: () => api.keys.pushScope('image'),
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
    const composerParts = createPartStore<ChatComposerPart>();
    const statusParts = createPartStore<ChatStatusPart>();
    const sideParts = createPartStore<ChatSidePart>();
    const sideSections = createSideSections({
      layouts,
      kit: partDeps,
      parts: sideParts,
      uiState: services.uiState,
      timers: services.timers,
      log: services.log,
    });
    const rowClock = createRowClock({
      layouts,
      kit: partDeps,
      clock: services.clock,
      timers: services.timers,
      log: services.log,
      activeTime: (sessionId) => view.activeTime(sessionId),
    });
    const view = mountChatView({
      channel: api.channel,
      paths: services.paths,
      homeDir: services.homeDir,
      sessions,
      onSessionRemoved: (listener) =>
        api.events.on('sessions.sessionRemoved', ({ sessionId }) =>
          listener(sessionId),
        ),
      onActiveChanged: (listener) =>
        api.events.on('sessions.activeChanged', ({ sessionId }) =>
          listener(sessionId),
        ),
      onSessionHostChanged: (listener) =>
        api.events.on('sessions.sessionHostChanged', ({ sessionId }) =>
          listener(sessionId),
        ),
      onScopeChanged: (listener) => api.keys.onScopeChanged(() => listener()),
      activeTimeListeners: [
        (sessionId, activeTime) =>
          api.events.emit('activeTimeChanged', { sessionId, activeTime }),
        (sessionId) => rowClock.changed(sessionId),
      ],
      editor: services.editor,
      markdown: services.markdown,
      keys,
      run,
      commands: partDeps.commands,
      platform: api.platform.os,
      layouts,
      composerParts,
      statusParts,
      sideParts,
      sideSections,
      permissions,
      confirm,
      viewer,
      slashCommands: () => slashCommands.list(),
      completionRows,
      setScope: (scope) => api.keys.setScope(scope),
      otherSessionShown: () => {
        closeSessionDialogs();
        viewer.close();
      },
      visibleSessionRested: closeSessionDialogs,
      log: services.log,
      toast: services.toast,
      timers: services.timers,
      clock: services.clock,
      drops: api.drops,
    });
    sessions.addRowPart(rowClock.part);
    sideParts.add(
      createMainAgentPart({
        surfaceOf: (sessionId) => view.composerOf(sessionId),
      }),
    );
    sideParts.add(
      createSessionPart({
        ...partDeps,
        sourceOf: (sessionId) => view.sessionFactsSource(sessionId),
      }),
    );
    api.layouts.show<ChatLayout>({
      defaultLayout,
      defaultStylesheet,
      read: readChatLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => layouts.set(shown),
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
    completionRows.add(
      descriptionDraw({
        isEnabled: () => api.settings().completionDescriptions,
        // The part is a leaf whose element dies with the popup row, so its
        // `dispose` is dropped.
        drawPart: (row, description) => {
          layouts.draw('completionDescription', row, (builder, at) => ({
            element: builder(at, { description }).element,
          }));
        },
      }),
    );
    const exports = (consumer: Registrations): ChatPageExports => ({
      addSlashCommand: (command) => consumer.track(slashCommands.add(command)),
      addCompletionRow: (draw) => consumer.track(completionRows.add(draw)),
      fillComposer: (sessionId, text) =>
        fillComposer({ tabs: view, log: services.log }, sessionId, text),
      addComposerPart: (part) => consumer.track(composerParts.add(part)),
      addStatusPart: (part) => consumer.track(statusParts.add(part)),
      addSidePart: (part) => consumer.track(sideParts.add(part)),
      focusedEntry: () => view.focusedEntry(),
      focusedBlock: () => view.focusedBlock(),
      activeTime: (sessionId) => view.activeTime(sessionId),
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
          signIn,
          slashCommands,
          viewer,
          writeClipboard,
          toast: services.toast,
          log: services.log,
        }),
        newSession: () => startPrompt.open(),
        startNewSession: () => startPrompt.openForNewSession(),
        toggleArchive: () => startPrompt.toggleArchive(),
        showArchived: () => startPrompt.showArchived(),
        toggleSideParts: () => sideSections.toggleHidden(),
      },
      exports,
      dispose: () => view.dispose(),
    };
  },
};
