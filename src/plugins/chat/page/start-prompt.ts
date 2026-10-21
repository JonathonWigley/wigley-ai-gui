import type { Log } from '../../../contracts/log';
import type { PageChannel, ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type {
  ChatChannel,
  ChatProfile,
  PastSessionRow,
  RecentFolder,
} from '../contract';
import type { Picker } from './picker';
import {
  type SessionItem,
  SESSION_STEP_TITLE,
  selectedAfterChange,
  sessionItems,
  withArchived,
} from './resume-items';
import {
  displayPath,
  type FolderItem,
  folderItems,
  preselectedProfile,
  profileLabel,
} from './start-prompt-items';

export interface StartPromptDeps {
  picker: Picker;
  channel: Pick<PageChannel<ChatChannel>, 'invoke'>;
  profiles(): readonly ChatProfile[];
  reveal(sessionId: string): void;
  log: Log;
  toast(text: string, tone: ToastTone): void;
}

// `open` asks for a folder, then a profile when there is more than one, then
// a new or saved session when the folder has saved ones, and starts or
// resumes a chat session there, revealing its Chat tab. Esc at any step
// starts nothing. `toggleArchive` and `showArchived` act on the session step
// while it is open.
export interface StartPrompt {
  open(): void;
  toggleArchive(): void;
  showArchived(): void;
}

// The session step shown: its saved sessions and the lines last opened.
interface SessionStep {
  context: PromptContext;
  projectDir: string;
  profile: ChatProfile;
  rows: PastSessionRow[];
  showArchived: boolean;
  items: SessionItem[];
}

// The session step the prompt last opened; null once one of its lines is
// picked.
interface SessionStepHolder {
  step: SessionStep | null;
}

// What the prompt has gathered once its first answers arrive.
interface PromptContext {
  deps: StartPromptDeps;
  recent: readonly RecentFolder[];
  homeDir: string;
  profiles: readonly ChatProfile[];
  sessions: SessionStepHolder;
}

export function createStartPrompt(deps: StartPromptDeps): StartPrompt {
  const sessions: SessionStepHolder = { step: null };
  return {
    open: () => openPrompt(deps, sessions),
    toggleArchive: () => toggleArchive(deps, sessions),
    showArchived: () => toggleShowArchived(deps, sessions),
  };
}

function openPrompt(deps: StartPromptDeps, sessions: SessionStepHolder) {
  const { channel, log } = deps;
  sessions.step = null;
  void Promise.all([
    channel.invoke('recentFolders'),
    channel.invoke('homeDir'),
  ]).then(
    ([recent, homeDir]) => {
      const profiles = deps.profiles();
      if (profiles.length === 0) {
        log('chat', 'no profiles in the chat settings');
        deps.toast("Add a profile to chat's profiles setting first", 'error');
        return;
      }
      openFolderStep({ deps, recent, homeDir, profiles, sessions });
    },
    (error: unknown) => {
      log('chat', `start prompt not opened: ${errorText(error)}`);
      deps.toast(`Start prompt not opened: ${errorText(error)}`, 'error');
    },
  );
}

function openFolderStep(context: PromptContext) {
  context.deps.picker.open<FolderItem>({
    title: 'Folder',
    items: folderItems(context.recent, context.homeDir),
    label: (item) => item.label,
    selected: 0,
    picked: (item) =>
      item.kind === 'recent'
        ? openProfileStep(context, item.folder.projectDir)
        : chooseFolder(context),
  });
}

// The folder dialog; dismissing it returns to the folder step.
function chooseFolder(context: PromptContext) {
  const { deps } = context;
  void deps.channel.invoke('chooseFolder').then(
    (projectDir) => {
      if (projectDir === null) {
        deps.log('chat', 'no folder chosen');
        openFolderStep(context);
        return;
      }
      openProfileStep(context, projectDir);
    },
    (error: unknown) => {
      deps.log('chat', `folder dialog failed: ${errorText(error)}`);
      deps.toast(`Folder dialog failed: ${errorText(error)}`, 'error');
    },
  );
}

function openProfileStep(context: PromptContext, projectDir: string) {
  const { profiles } = context;
  if (profiles.length === 1) {
    listSessions(context, projectDir, profiles[0]);
    return;
  }
  context.deps.picker.open<ChatProfile>({
    title: 'Profile',
    items: profiles,
    label: profileLabel,
    selected: preselectedProfile(profiles, context.recent, projectDir),
    picked: (profile) => listSessions(context, projectDir, profile),
  });
}

// Opens the session step on the folder's saved sessions; with none, starts a
// new session at once. A failed listing opens the step with the new-session
// line alone.
function listSessions(
  context: PromptContext,
  projectDir: string,
  profile: ChatProfile,
) {
  const { deps } = context;
  const openWith = (rows: PastSessionRow[]) => {
    const step: SessionStep = {
      context,
      projectDir,
      profile,
      rows,
      showArchived: false,
      items: [],
    };
    context.sessions.step = step;
    openSessionStep(step, 0);
  };
  void deps.channel.invoke('pastSessions', projectDir, profile.name).then(
    (rows) => {
      if (rows.length === 0) {
        startSession(context, projectDir, profile);
        return;
      }
      openWith(rows);
    },
    (error: unknown) => {
      deps.log('chat', `saved sessions not listed: ${errorText(error)}`);
      deps.toast(`Saved sessions not listed: ${errorText(error)}`, 'error');
      openWith([]);
    },
  );
}

// Opens, or reopens over itself, the session step on its rows with the
// cursor on `selected`.
function openSessionStep(step: SessionStep, selected: number) {
  const { context } = step;
  step.items = sessionItems(step.rows, step.showArchived);
  context.deps.picker.open<SessionItem>({
    title: SESSION_STEP_TITLE,
    scope: 'resume',
    items: step.items,
    label: (item) => item.label,
    selected,
    picked: (item) => {
      context.sessions.step = null;
      if (item.kind === 'new') {
        startSession(context, step.projectDir, step.profile);
      } else {
        resumeSession(step, item.row);
      }
    },
  });
}

// The open session step; null when the prompt last opened another step or
// the picker is closed.
function openStep(
  deps: StartPromptDeps,
  sessions: SessionStepHolder,
): SessionStep | null {
  return deps.picker.isOpen() ? sessions.step : null;
}

function toggleArchive(deps: StartPromptDeps, sessions: SessionStepHolder) {
  const step = openStep(deps, sessions);
  const cursor = deps.picker.cursorIndex();
  if (step === null || cursor === null) {
    deps.log('chat', 'no session under the cursor');
    return;
  }
  const item = step.items[cursor];
  if (item.kind === 'new') {
    deps.log('chat', 'New session cannot be archived');
    return;
  }
  const { hostSessionId, title } = item.row;
  const archived = !item.row.archived;
  void deps.channel.invoke('setArchived', hostSessionId, archived).then(
    () => {
      const before = step.items;
      step.rows = withArchived(step.rows, hostSessionId, archived);
      reopenSessionStep(step, before, cursor);
      deps.log('chat', `${archived ? 'archived' : 'restored'} ${title}`);
    },
    (error: unknown) => {
      deps.log('chat', `archive failed: ${errorText(error)}`);
      deps.toast(`Archive failed: ${errorText(error)}`, 'error');
    },
  );
}

function toggleShowArchived(
  deps: StartPromptDeps,
  sessions: SessionStepHolder,
) {
  const step = openStep(deps, sessions);
  if (step === null) {
    deps.log('chat', 'no session list shown');
    return;
  }
  const before = step.items;
  const cursor = deps.picker.cursorIndex();
  step.showArchived = !step.showArchived;
  reopenSessionStep(step, before, cursor);
  deps.log(
    'chat',
    `archived sessions ${step.showArchived ? 'shown' : 'hidden'}`,
  );
}

// Reopens the step on its changed rows, keeping the cursor on the item it
// was on in `before` where the new lines still hold it.
function reopenSessionStep(
  step: SessionStep,
  before: readonly SessionItem[],
  cursor: number | null,
) {
  const after = sessionItems(step.rows, step.showArchived);
  openSessionStep(step, selectedAfterChange(before, cursor, after));
}

function resumeSession(step: SessionStep, row: PastSessionRow) {
  const { deps, homeDir } = step.context;
  const { projectDir, profile } = step;
  deps.log(
    'chat',
    `resuming ${row.title} in ${displayPath(projectDir, homeDir)} with ${profile.name}`,
  );
  void deps.channel
    .invoke('resume', {
      projectDir,
      profile: profile.name,
      hostSessionId: row.hostSessionId,
    })
    .then(
      (sessionId) => deps.reveal(sessionId),
      (error: unknown) => {
        deps.log('chat', `session not resumed: ${errorText(error)}`);
        deps.toast(`Session not resumed: ${errorText(error)}`, 'error');
      },
    );
}

function startSession(
  context: PromptContext,
  projectDir: string,
  profile: ChatProfile,
) {
  const { deps } = context;
  deps.log(
    'chat',
    `starting a session in ${displayPath(projectDir, context.homeDir)} with ${profile.name}`,
  );
  void deps.channel.invoke('start', { projectDir, profile: profile.name }).then(
    (sessionId) => deps.reveal(sessionId),
    (error: unknown) => {
      deps.log('chat', `session not started: ${errorText(error)}`);
      deps.toast(`Session not started: ${errorText(error)}`, 'error');
    },
  );
}
