import type { PluginLog } from '../../../contracts/log';
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
import { folderRowInput, profileRowInput, sessionRowInput } from './picker-row';
import {
  archiveStateOf,
  type SessionItem,
  SESSION_STEP_TITLE,
  selectedAfterChange,
  sessionItems,
  withArchived,
} from './resume-items';
import type { SignInDialog } from './sign-in-dialog';
import {
  displayPath,
  type FolderItem,
  folderName,
  folderItems,
  preselectedProfile,
  profileLabel,
} from './start-prompt-items';

export interface StartPromptDeps {
  picker: Picker;
  signIn: Pick<SignInDialog, 'open'>;
  channel: Pick<PageChannel<ChatChannel>, 'invoke'>;
  profiles(): readonly ChatProfile[];
  reveal(sessionId: string): void;
  paths: Paths;
  homeDir: string;
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
}

// `open` asks for a folder, then a profile when there is more than one, then
// signs a signed-out profile in through the sign-in dialog, then asks for a
// new or saved session when the folder has saved ones, and starts or
// resumes a chat session there, revealing its Chat tab. Esc at any step
// starts nothing. Opening the prompt again drops the earlier one: an answer
// or a sign-in that arrives for it is logged and goes no further.
// `openForNewSession` asks the same way but passes the session step over,
// starting a new session once the profile is signed in. `toggleArchive` and
// `showArchived` act on the session step while it is open.
export interface StartPrompt {
  open(): void;
  openForNewSession(): void;
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

// What the prompt has gathered once its first answer arrives. `isCurrent`
// is false once the prompt has opened again.
interface PromptContext {
  deps: StartPromptDeps;
  isCurrent(): boolean;
  offersSavedSessions: boolean;
  recent: readonly RecentFolder[];
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

  // Counts the prompt's opens, so an answer can tell its own open is gone.
  let opens = 0;

  // True, logging `what` as dropped, once the prompt has opened again since
  // the open `isCurrent` belongs to.
  const isStale = (isCurrent: () => boolean, what: string) => {
    if (isCurrent()) {
      return false;
    }
    log(`${what} dropped: the start prompt opened again`);
    return true;
  };

  const openPrompt = (offersSavedSessions: boolean) => {
    step = null;
    opens += 1;
    const opened = opens;
    const isCurrent = () => opens === opened;
    void channel.invoke('recentFolders').then(
      (recent) => {
        if (isStale(isCurrent, 'recent folders')) {
          return;
        }
        const profiles = deps.profiles();
        if (profiles.length === 0) {
          log('no profiles in the chat settings');
          deps.toast("Add a profile to chat's profiles setting first", 'error');
          return;
        }
        openFolderStep({
          deps,
          isCurrent,
          offersSavedSessions,
          recent,
          profiles,
        });
      },
      (error: unknown) => {
        log(`start prompt not opened: ${errorText(error)}`);
        deps.toast(`Start prompt not opened: ${errorText(error)}`, 'error');
      },
    );
  };

  const openFolderStep = (context: PromptContext) => {
    deps.picker.open<FolderItem>({
      title: 'Folder',
      items: folderItems(context.recent, deps.homeDir, deps.paths),
      label: (item) => item.label,
      name: (item) => folderName(item, deps.paths),
      rowInput: folderRowInput,
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
        if (isStale(context.isCurrent, 'chosen folder')) {
          return;
        }
        if (projectDir === null) {
          log('no folder chosen');
          openFolderStep(context);
          return;
        }
        openProfileStep(context, projectDir);
      },
      (error: unknown) => {
        log(`folder dialog failed: ${errorText(error)}`);
        deps.toast(`Folder dialog failed: ${errorText(error)}`, 'error');
      },
    );
  };

  const openProfileStep = (context: PromptContext, projectDir: string) => {
    const { profiles } = context;
    if (profiles.length === 1) {
      checkAccount(context, projectDir, profiles[0]);
      return;
    }
    deps.picker.open<ChatProfile>({
      title: 'Profile',
      items: profiles,
      label: profileLabel,
      rowInput: profileRowInput,
      selected: preselectedProfile(
        profiles,
        context.recent,
        projectDir,
        deps.paths,
      ),
      picked: (profile) => checkAccount(context, projectDir, profile),
    });
  };

  // Goes on to the session step, or to a new session when the prompt offers no
  // saved ones, when the profile is signed in; a signed-out profile opens the
  // sign-in dialog first, going on only once it finishes signed in. A status
  // that cannot be read goes on. Nothing goes on once the prompt has opened
  // again.
  const checkAccount = (
    context: PromptContext,
    projectDir: string,
    profile: ChatProfile,
  ) => {
    const goOn = () => {
      if (context.offersSavedSessions) {
        listSessions(context, projectDir, profile);
      } else {
        startSession(context, projectDir, profile);
      }
    };
    void channel.invoke('accountStatus', profile.name).then(
      (status) => {
        if (isStale(context.isCurrent, `${profile.name}'s status`)) {
          return;
        }
        if (status.signedIn) {
          goOn();
          return;
        }
        log(`${profile.name} is signed out`);
        deps.signIn.open(profile.name, (signedIn) => {
          if (isStale(context.isCurrent, `${profile.name}'s sign-in`)) {
            return;
          }
          if (signedIn) {
            goOn();
            return;
          }
          log(`no session started: ${profile.name} is signed out`);
        });
      },
      (error: unknown) => {
        log(`account status not read: ${errorText(error)}`);
        if (isStale(context.isCurrent, `${profile.name}'s status`)) {
          return;
        }
        goOn();
      },
    );
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
        if (isStale(context.isCurrent, 'saved sessions')) {
          return;
        }
        if (rows.length === 0) {
          startSession(context, projectDir, profile);
          return;
        }
        openWith(rows);
      },
      (error: unknown) => {
        log(`saved sessions not listed: ${errorText(error)}`);
        if (isStale(context.isCurrent, 'saved sessions')) {
          return;
        }
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
      archiveState: archiveStateOf,
      items: opened.items,
      label: (item) => item.label,
      rowInput: sessionRowInput,
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
      log('no session under the cursor');
      return;
    }
    const item = shown.items[cursor];
    if (item.kind === 'new') {
      log('New session cannot be archived');
      return;
    }
    if (shown.isWriting) {
      log('archive ignored: an archive write is in flight');
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
        log(`${archived ? 'archived' : 'restored'} ${title}`);
      },
      (error: unknown) => {
        shown.isWriting = false;
        log(`archive failed: ${errorText(error)}`);
        deps.toast(`Archive failed: ${errorText(error)}`, 'error');
      },
    );
  };

  const toggleShowArchived = () => {
    const shown = shownStep();
    if (shown === null) {
      log('no session list shown');
      return;
    }
    const before = shown.items;
    const cursor = deps.picker.cursorIndex();
    shown.showArchived = !shown.showArchived;
    reopenSessionStep(shown, before, cursor);
    log(`archived sessions ${shown.showArchived ? 'shown' : 'hidden'}`);
  };

  return {
    open: () => openPrompt(true),
    openForNewSession: () => openPrompt(false),
    toggleArchive,
    showArchived: toggleShowArchived,
  };
}

function resumeSession(step: SessionStep, row: PastSessionRow) {
  const { deps } = step.context;
  const { projectDir, profile } = step;
  deps.log(
    `resuming ${row.title} in ${displayPath(projectDir, deps.homeDir, deps.paths)} with ${profile.name}`,
  );
  void deps.channel
    .invoke('resume', {
      projectDir,
      profile: profile.name,
      hostSessionId: row.hostSessionId,
      title: row.title,
    })
    .then(
      (sessionId) => deps.reveal(sessionId),
      (error: unknown) => {
        deps.log(`session not resumed: ${errorText(error)}`);
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
    `starting a session in ${displayPath(projectDir, deps.homeDir, deps.paths)} with ${profile.name}`,
  );
  void deps.channel.invoke('start', { projectDir, profile: profile.name }).then(
    (sessionId) => deps.reveal(sessionId),
    (error: unknown) => {
      deps.log(`session not started: ${errorText(error)}`);
      deps.toast(`Session not started: ${errorText(error)}`, 'error');
    },
  );
}
