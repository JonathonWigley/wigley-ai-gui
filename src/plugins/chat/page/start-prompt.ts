import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { PageChannel, ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type {
  ChatChannel,
  ChatProfile,
  PastSessionRow,
  RecentFolder,
} from '../contract';
import type { Picker, PickerHandle } from './picker';
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
  paths: Paths;
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

// The session step: its saved sessions, the lines last opened, and the
// picker handle of the request showing them.
interface SessionStep {
  context: PromptContext;
  projectDir: string;
  profile: ChatProfile;
  rows: PastSessionRow[];
  showArchived: boolean;
  items: SessionItem[];
  shown: PickerHandle | null;
  // True while a `setArchived` for this step awaits its answer.
  isWriting: boolean;
}

// What the prompt has gathered once its first answers arrive.
interface PromptContext {
  deps: StartPromptDeps;
  recent: readonly RecentFolder[];
  homeDir: string;
  profiles: readonly ChatProfile[];
}

export function createStartPrompt(deps: StartPromptDeps): StartPrompt {
  const { channel, log } = deps;
  // The session step the prompt last opened; null once one of its lines is
  // picked or the prompt opens again.
  let step: SessionStep | null = null;

  // The session step while its own request is the picker's open one; null
  // when the picker is closed or shows another list.
  const shownStep = (): SessionStep | null =>
    step?.shown?.isOpen() === true ? step : null;

  const openPrompt = () => {
    step = null;
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
        openFolderStep({ deps, recent, homeDir, profiles });
      },
      (error: unknown) => {
        log('chat', `start prompt not opened: ${errorText(error)}`);
        deps.toast(`Start prompt not opened: ${errorText(error)}`, 'error');
      },
    );
  };

  const openFolderStep = (context: PromptContext) => {
    deps.picker.open<FolderItem>({
      title: 'Folder',
      items: folderItems(context.recent, context.homeDir, deps.paths),
      label: (item) => item.label,
      selected: 0,
      picked: (item) =>
        item.kind === 'recent'
          ? openProfileStep(context, item.folder.projectDir)
          : chooseFolder(context),
    });
  };

  // The folder dialog; dismissing it returns to the folder step.
  const chooseFolder = (context: PromptContext) => {
    void channel.invoke('chooseFolder').then(
      (projectDir) => {
        if (projectDir === null) {
          log('chat', 'no folder chosen');
          openFolderStep(context);
          return;
        }
        openProfileStep(context, projectDir);
      },
      (error: unknown) => {
        log('chat', `folder dialog failed: ${errorText(error)}`);
        deps.toast(`Folder dialog failed: ${errorText(error)}`, 'error');
      },
    );
  };

  const openProfileStep = (context: PromptContext, projectDir: string) => {
    const { profiles } = context;
    if (profiles.length === 1) {
      listSessions(context, projectDir, profiles[0]);
      return;
    }
    deps.picker.open<ChatProfile>({
      title: 'Profile',
      items: profiles,
      label: profileLabel,
      selected: preselectedProfile(
        profiles,
        context.recent,
        projectDir,
        deps.paths,
      ),
      picked: (profile) => listSessions(context, projectDir, profile),
    });
  };

  // Opens the session step on the folder's saved sessions; with none, starts
  // a new session at once. A failed listing opens the step with the
  // new-session line alone.
  const listSessions = (
    context: PromptContext,
    projectDir: string,
    profile: ChatProfile,
  ) => {
    const openWith = (rows: PastSessionRow[]) => {
      const opened: SessionStep = {
        context,
        projectDir,
        profile,
        rows,
        showArchived: false,
        items: [],
        shown: null,
        isWriting: false,
      };
      step = opened;
      openSessionStep(opened, 0);
    };
    void channel.invoke('pastSessions', projectDir, profile.name).then(
      (rows) => {
        if (rows.length === 0) {
          startSession(context, projectDir, profile);
          return;
        }
        openWith(rows);
      },
      (error: unknown) => {
        log('chat', `saved sessions not listed: ${errorText(error)}`);
        deps.toast(`Saved sessions not listed: ${errorText(error)}`, 'error');
        openWith([]);
      },
    );
  };

  // Opens, or reopens over itself, the session step on its rows with the
  // cursor on `selected`.
  const openSessionStep = (opened: SessionStep, selected: number) => {
    opened.items = sessionItems(opened.rows, opened.showArchived);
    opened.shown = deps.picker.open<SessionItem>({
      title: SESSION_STEP_TITLE,
      scope: 'resume',
      items: opened.items,
      label: (item) => item.label,
      selected,
      picked: (item) => {
        step = null;
        if (item.kind === 'new') {
          startSession(opened.context, opened.projectDir, opened.profile);
        } else {
          resumeSession(opened, item.row);
        }
      },
    });
  };

  // Reopens the step on its changed rows, keeping the cursor on the item it
  // was on in `before` where the new lines still hold it.
  const reopenSessionStep = (
    opened: SessionStep,
    before: readonly SessionItem[],
    cursor: number | null,
  ) => {
    const after = sessionItems(opened.rows, opened.showArchived);
    openSessionStep(opened, selectedAfterChange(before, cursor, after));
  };

  // Archives or restores the row under the cursor. A press while an earlier
  // write for the step awaits its answer is ignored, since the row's state
  // it would flip is not yet known. The answer reopens the list only while
  // the step is still shown.
  const toggleArchive = () => {
    const shown = shownStep();
    const cursor = deps.picker.cursorIndex();
    if (shown === null || cursor === null) {
      log('chat', 'no session under the cursor');
      return;
    }
    const item = shown.items[cursor];
    if (item.kind === 'new') {
      log('chat', 'New session cannot be archived');
      return;
    }
    if (shown.isWriting) {
      log('chat', 'archive ignored: an archive write is in flight');
      return;
    }
    const { hostSessionId, title } = item.row;
    const archived = !item.row.archived;
    shown.isWriting = true;
    void channel.invoke('setArchived', hostSessionId, archived).then(
      () => {
        shown.isWriting = false;
        shown.rows = withArchived(shown.rows, hostSessionId, archived);
        if (shownStep() !== shown) {
          return;
        }
        reopenSessionStep(shown, shown.items, deps.picker.cursorIndex());
        log('chat', `${archived ? 'archived' : 'restored'} ${title}`);
      },
      (error: unknown) => {
        shown.isWriting = false;
        log('chat', `archive failed: ${errorText(error)}`);
        deps.toast(`Archive failed: ${errorText(error)}`, 'error');
      },
    );
  };

  const toggleShowArchived = () => {
    const shown = shownStep();
    if (shown === null) {
      log('chat', 'no session list shown');
      return;
    }
    const before = shown.items;
    const cursor = deps.picker.cursorIndex();
    shown.showArchived = !shown.showArchived;
    reopenSessionStep(shown, before, cursor);
    log('chat', `archived sessions ${shown.showArchived ? 'shown' : 'hidden'}`);
  };

  return {
    open: openPrompt,
    toggleArchive,
    showArchived: toggleShowArchived,
  };
}

function resumeSession(step: SessionStep, row: PastSessionRow) {
  const { deps, homeDir } = step.context;
  const { projectDir, profile } = step;
  deps.log(
    'chat',
    `resuming ${row.title} in ${displayPath(projectDir, homeDir, deps.paths)} with ${profile.name}`,
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
    `starting a session in ${displayPath(projectDir, context.homeDir, deps.paths)} with ${profile.name}`,
  );
  void deps.channel.invoke('start', { projectDir, profile: profile.name }).then(
    (sessionId) => deps.reveal(sessionId),
    (error: unknown) => {
      deps.log('chat', `session not started: ${errorText(error)}`);
      deps.toast(`Session not started: ${errorText(error)}`, 'error');
    },
  );
}
