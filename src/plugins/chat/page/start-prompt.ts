import type { AgentHarnessInfo } from '../../../contracts/agent';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { PageChannel, ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  type RegisteredProfile,
  registeredProfiles,
} from '../../../shared/harness-profiles';
import type {
  ChatChannel,
  ChatProject,
  ProjectPastSessionRow,
  RecentFolder,
  ResumeSectionRow,
  ResumeSectionRows,
  StartTarget,
} from '../contract';
import type { Picker, PickerHandle } from './picker';
import {
  folderRowInput,
  profileRowInput,
  projectRowInput,
  sessionRowInput,
} from './picker-row';
import {
  archiveStateOf,
  newSessionIndex,
  type SessionItem,
  SESSION_STEP_TITLE,
  selectedAfterChange,
  sessionItems,
  sessionSection,
  withArchived,
} from './resume-items';
import type { SignInDialog } from './sign-in-dialog';
import {
  displayPath,
  type FolderItem,
  folderName,
  folderItems,
  folderSection,
  PROJECT_STEP_TITLE,
  type ProjectItem,
  projectItems,
  projectName,
  projectSection,
  preselectedProfile,
  profileLabel,
  recentFolderHarness,
} from './start-prompt-items';

export interface StartPromptDeps {
  picker: Picker;
  signIn: Pick<SignInDialog, 'open'>;
  channel: Pick<PageChannel<ChatChannel>, 'invoke'>;
  chooseFolder(): Promise<string | null>;
  // `core.agentHarnesses`, read at each open.
  harnesses(): ReadonlyMap<string, AgentHarnessInfo>;
  // Chat's `defaultHarness` setting, read at each open.
  defaultHarness(): string;
  reveal(sessionId: string): void;
  paths: Paths;
  homeDir: string;
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
}

// `open` asks for a project — or, through `Other folder…` or with no
// projects, a folder — then a profile of the target's harness unless the
// project fixes one or that harness has one, then signs a signed-out profile in through the sign-in dialog,
// then asks for a new session or one of the project's or folder's saved
// sessions, and starts or resumes a chat session there, revealing its Chat
// tab. With no saved sessions to list, archived ones counted, it skips that
// step and starts a new session at once. Its first step also lists the resume
// sections' rows at the top, a pick resuming that session at once, and its
// session step those of its folders and profile. Esc at any step starts
// nothing. Opening the prompt again drops the earlier one: an answer or a
// sign-in that arrives for it is logged and goes no further. The target's
// harness is chat's `defaultHarness`, a picked recent folder's recorded harness
// while it is registered, or a fixed profile's harness; with `defaultHarness`
// not registered the prompt toasts and opens nothing.
// `openForNewSession` asks the same way but lists no sections and no saved
// sessions, so it starts a new session once the profile is signed in.
// `toggleArchive` and `showArchived` act on the session step while it is open.
export interface StartPrompt {
  open(): void;
  openForNewSession(): void;
  toggleArchive(): void;
  showArchived(): void;
}

// Where the prompt starts a session: a folder, with the harness it starts on,
// or a project.
type PromptTarget =
  | { kind: 'folder'; projectDir: string; harness: string }
  | { kind: 'project'; project: ChatProject };

// The session step: its saved sessions, each resuming in its own folder, the
// lines last opened, and the picker handle of the request showing them.
interface SessionStep {
  context: PromptContext;
  target: PromptTarget;
  profile: RegisteredProfile;
  rows: ProjectPastSessionRow[];
  showArchived: boolean;
  items: SessionItem<ProjectPastSessionRow>[];
  shown: PickerHandle | null;
  // True while a `setArchived` for this step awaits its answer.
  isWriting: boolean;
}

// What the prompt has gathered once its first answers arrive. `isCurrent`
// is false once the prompt has opened again. `projects` are chat's checked
// projects; none when they cannot be read. `profiles` are every registered
// harness's, and `defaultHarness` is registered.
interface PromptContext {
  deps: StartPromptDeps;
  isCurrent(): boolean;
  offersSavedSessions: boolean;
  recent: readonly RecentFolder[];
  sections: readonly ResumeSectionRows[];
  projects: readonly ChatProject[];
  harnesses: ReadonlyMap<string, AgentHarnessInfo>;
  defaultHarness: string;
  profiles: readonly RegisteredProfile[];
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

  // The sections' rows; none when they cannot be read.
  const readSections = (): Promise<ResumeSectionRows[]> =>
    channel.invoke('resumeSections').catch((error: unknown) => {
      log(`resume sections not read: ${errorText(error)}`);
      return [];
    });

  // Logs and toasts that the harness has no profiles to start under.
  const reportNoProfiles = (harness: string) => {
    log(`harness ${harness} has no profiles`);
    deps.toast("Add a profile to the harness's profiles setting first", 'error');
  };

  // Chat's projects; none when they cannot be read.
  const readProjects = (): Promise<ChatProject[]> =>
    channel.invoke('projects').catch((error: unknown) => {
      log(`projects not read: ${errorText(error)}`);
      return [];
    });

  const openPrompt = (offersSavedSessions: boolean) => {
    step = null;
    opens += 1;
    const opened = opens;
    const isCurrent = () => opens === opened;
    void Promise.all([
      channel.invoke('recentFolders'),
      offersSavedSessions ? readSections() : [],
      readProjects(),
    ]).then(
      ([recent, sections, projects]) => {
        if (isStale(isCurrent, 'recent folders')) {
          return;
        }
        const harnesses = deps.harnesses();
        const defaultHarness = deps.defaultHarness();
        const defaultInfo = harnesses.get(defaultHarness);
        if (defaultInfo === undefined) {
          const text = `No agent harness "${defaultHarness}" is registered. Set chat's defaultHarness to a registered harness.`;
          log(text);
          deps.toast(text, 'error');
          return;
        }
        if (defaultInfo.profiles.length === 0) {
          reportNoProfiles(defaultHarness);
          return;
        }
        for (const { title, rows } of sections) {
          log(`resume section ${title}: ${rows.length} rows`);
        }
        const context: PromptContext = {
          deps,
          isCurrent,
          offersSavedSessions,
          recent,
          sections,
          projects,
          harnesses,
          defaultHarness,
          profiles: registeredProfiles(harnesses),
        };
        if (projects.length === 0) {
          openFolderStep(context);
        } else {
          openProjectStep(context);
        }
      },
      (error: unknown) => {
        log(`start prompt not opened: ${errorText(error)}`);
        deps.toast(`Start prompt not opened: ${errorText(error)}`, 'error');
      },
    );
  };

  // Opens the project step with the cursor on its first project, below the
  // section rows.
  const openProjectStep = (context: PromptContext) => {
    const items = projectItems(
      context.projects,
      context.sections,
      deps.homeDir,
      deps.paths,
    );
    const sectionRows = items.filter((item) => item.kind === 'section').length;
    deps.picker.open<ProjectItem>({
      title: PROJECT_STEP_TITLE,
      items,
      label: (item) => item.label,
      name: projectName,
      rowInput: (item) => projectRowInput(item, deps.paths),
      section: (item) => projectSection(item, sectionRows > 0),
      selected: sectionRows,
      picked: (item) => {
        if (item.kind === 'section') {
          resumeSectionRow(context, item.row);
        } else if (item.kind === 'project') {
          openProfileStep(context, { kind: 'project', project: item.project });
        } else {
          openFolderStep(context);
        }
      },
    });
  };

  // Opens the folder step with the cursor on its first folder, below the
  // section rows.
  const openFolderStep = (context: PromptContext) => {
    const items = folderItems(
      context.recent,
      context.sections,
      deps.homeDir,
      deps.paths,
    );
    const sectionRows = items.filter((item) => item.kind === 'section').length;
    deps.picker.open<FolderItem>({
      title: 'Folder',
      items,
      label: (item) => item.label,
      name: (item) => folderName(item, deps.paths),
      rowInput: (item) => folderRowInput(item, deps.paths),
      section: (item) => folderSection(item, sectionRows > 0),
      selected: sectionRows,
      picked: (item) => {
        if (item.kind === 'section') {
          resumeSectionRow(context, item.row);
        } else if (item.kind === 'recent') {
          openProfileStep(context, {
            kind: 'folder',
            projectDir: item.folder.projectDir,
            harness: recentFolderHarness(
              item.folder,
              context.harnesses,
              context.defaultHarness,
            ),
          });
        } else {
          chooseFolder(context);
        }
      },
    });
  };

  // Resumes a first step's section row once its profile is signed in; a profile
  // no longer in the settings goes straight to `resume`, which rejects it.
  const resumeSectionRow = (context: PromptContext, row: ResumeSectionRow) => {
    const goOn = () =>
      resumeSession(
        context,
        row.projectDir,
        row.harness,
        row.profile,
        row.hostSessionId,
        row.title,
        row.headless === true,
      );
    const profile = context.profiles.find(({ name }) => name === row.profile);
    if (profile === undefined) {
      goOn();
      return;
    }
    checkAccount(context, profile, goOn);
  };

  // The folder dialog; dismissing it returns to the folder step.
  const chooseFolder = (context: PromptContext) => {
    void deps.chooseFolder().then(
      (projectDir) => {
        if (isStale(context.isCurrent, 'chosen folder')) {
          return;
        }
        if (projectDir === null) {
          log('no folder chosen');
          openFolderStep(context);
          return;
        }
        openProfileStep(context, {
          kind: 'folder',
          projectDir,
          harness: context.defaultHarness,
        });
      },
      (error: unknown) => {
        log(`folder dialog failed: ${errorText(error)}`);
        deps.toast(`Folder dialog failed: ${errorText(error)}`, 'error');
      },
    );
  };

  // Asks for the profile of the target's harness to start `target` under:
  // none for a project that fixes one or when that harness has one. A folder,
  // or a folder project's folder, pre-selects the profile last used there; a
  // pool project pre-selects the first.
  const openProfileStep = (context: PromptContext, target: PromptTarget) => {
    const harness =
      target.kind === 'folder' ? target.harness : context.defaultHarness;
    const profiles = context.profiles.filter(
      (profile) => profile.harnessId === harness,
    );
    const fixed =
      target.kind === 'project'
        ? fixedProfileOrReport(context, target.project)
        : null;
    if (fixed === false) {
      return;
    }
    if (fixed !== null) {
      checkProfile(context, target, fixed);
      return;
    }
    if (profiles.length === 0) {
      reportNoProfiles(harness);
      return;
    }
    if (profiles.length === 1) {
      checkProfile(context, target, profiles[0]);
      return;
    }
    deps.picker.open<RegisteredProfile>({
      title: 'Profile',
      items: profiles,
      label: profileLabel,
      rowInput: profileRowInput,
      selected: preselectedProfileOf(context, target, profiles),
      picked: (profile) => checkProfile(context, target, profile),
    });
  };

  // The profile `project` fixes, from every registered harness's profiles the
  // prompt opened with; null when it fixes none. One missing from them is
  // logged and toasted, and answers false.
  const fixedProfileOrReport = (
    context: PromptContext,
    project: ChatProject,
  ): RegisteredProfile | null | false => {
    if (project.profile === null) {
      return null;
    }
    const fixed = context.profiles.find(({ name }) => name === project.profile);
    if (fixed !== undefined) {
      return fixed;
    }
    const text = `Profile ${project.profile} of ${project.name} is not in the harness's profiles setting`;
    log(text);
    deps.toast(text, 'error');
    return false;
  };

  const preselectedProfileOf = (
    context: PromptContext,
    target: PromptTarget,
    profiles: readonly RegisteredProfile[],
  ): number => {
    const preselectedIn = (projectDir: string) =>
      preselectedProfile(
        profiles,
        context.recent,
        projectDir,
        deps.paths,
      );
    if (target.kind === 'folder') {
      return preselectedIn(target.projectDir);
    }
    const { project } = target;
    if (project.kind === 'pool') {
      return 0;
    }
    return preselectedIn(deps.paths.expandTilde(project.folder, deps.homeDir));
  };

  // Once the profile picked for `target` — or the one its project fixes — is
  // signed in, lists its saved sessions for the session step when the prompt
  // offers them, and otherwise starts a new session at once.
  const checkProfile = (
    context: PromptContext,
    target: PromptTarget,
    profile: RegisteredProfile,
  ) => {
    checkAccount(context, profile, () => {
      if (context.offersSavedSessions) {
        listSessions(context, target, profile);
      } else {
        openSessionStepOn(context, target, profile, []);
      }
    });
  };

  // Runs `goOn` when the profile is signed in; a signed-out profile opens the
  // sign-in dialog first, going on only once it finishes signed in. A status
  // that cannot be read goes on. Nothing goes on once the prompt has opened
  // again.
  const checkAccount = (
    context: PromptContext,
    profile: RegisteredProfile,
    goOn: () => void,
  ) => {
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

  // Opens the session step on `rows` with the cursor on `New session`; with no
  // `rows`, and so no section rows, starts a new session instead.
  const openSessionStepOn = (
    context: PromptContext,
    target: PromptTarget,
    profile: RegisteredProfile,
    rows: ProjectPastSessionRow[],
  ) => {
    if (rows.length === 0) {
      step = null;
      startSession(context, target, profile);
      return;
    }
    const opened: SessionStep = {
      context,
      target,
      profile,
      rows,
      showArchived: false,
      items: [],
      shown: null,
      isWriting: false,
    };
    step = opened;
    const items = sessionStepItems(opened);
    openSessionStep(opened, items, newSessionIndex(items));
  };

  // Opens the session step on the saved sessions of the folder
  // (`pastSessions`) or of every folder the project covers
  // (`projectPastSessions`); with none, or when the listing fails, starts a
  // new session at once.
  const listSessions = (
    context: PromptContext,
    target: PromptTarget,
    profile: RegisteredProfile,
  ) => {
    const openWith = (rows: ProjectPastSessionRow[]) =>
      openSessionStepOn(context, target, profile, rows);
    void readSavedSessions(target, profile).then(
      (rows) => {
        if (isStale(context.isCurrent, 'saved sessions')) {
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

  // The target's saved sessions, each with the folder it ran in.
  const readSavedSessions = (
    target: PromptTarget,
    profile: RegisteredProfile,
  ): Promise<ProjectPastSessionRow[]> => {
    if (target.kind === 'project') {
      return channel.invoke(
        'projectPastSessions',
        target.project.name,
        profile.name,
      );
    }
    const { projectDir } = target;
    return channel
      .invoke('pastSessions', projectDir, profile.name)
      .then((rows) => rows.map((row) => ({ ...row, projectDir })));
  };

  // A project covers many folders, so its step matches section rows in any.
  const sessionStepItems = (
    opened: SessionStep,
  ): SessionItem<ProjectPastSessionRow>[] =>
    sessionItems(
      opened.rows,
      opened.context.sections,
      {
        projectDir:
          opened.target.kind === 'folder' ? opened.target.projectDir : null,
        profile: opened.profile.name,
      },
      deps.paths,
      opened.showArchived,
    );

  // Opens, or reopens over itself, the session step on `items` with the cursor
  // on `selected`.
  const openSessionStep = (
    opened: SessionStep,
    items: SessionItem<ProjectPastSessionRow>[],
    selected: number,
  ) => {
    const showsSections = items.some((item) => item.kind === 'section');
    opened.items = items;
    opened.shown = deps.picker.open<SessionItem<ProjectPastSessionRow>>({
      title: SESSION_STEP_TITLE,
      scope: 'resume',
      archiveState: archiveStateOf,
      items,
      label: (item) => item.label,
      rowInput: sessionRowInput,
      section: (item) => sessionSection(item, showsSections),
      selected,
      picked: (item) => {
        step = null;
        if (item.kind === 'new') {
          startSession(opened.context, opened.target, opened.profile);
        } else {
          resumeSession(
            opened.context,
            item.row.projectDir,
            opened.profile.harnessId,
            opened.profile.name,
            item.row.hostSessionId,
            shownTitle(item),
            item.kind === 'section' && item.closed.headless === true,
          );
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
    const after = sessionStepItems(opened);
    openSessionStep(opened, after, selectedAfterChange(before, cursor, after));
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
      log(`${item.label} cannot be archived`);
      return;
    }
    if (shown.isWriting) {
      log('archive ignored: an archive write is in flight');
      return;
    }
    const { hostSessionId } = item.row;
    const title = shownTitle(item);
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

// The title a saved session's line shows and resumes under.
function shownTitle(item: Exclude<SessionItem, { kind: 'new' }>): string {
  return item.kind === 'section' ? item.closed.title : item.row.title;
}

// `harness` undefined resumes on the harness that declares the profile.
function resumeSession(
  context: PromptContext,
  projectDir: string,
  harness: string | undefined,
  profileName: string,
  hostSessionId: string,
  title: string,
  headless: boolean,
) {
  const { deps } = context;
  deps.log(
    `resuming ${title} in ${displayPath(projectDir, deps.homeDir, deps.paths)} with ${profileName}`,
  );
  void deps.channel
    .invoke('resume', {
      projectDir,
      ...(harness === undefined ? {} : { harness }),
      profile: profileName,
      hostSessionId,
      title,
      headless,
    })
    .then(
      (sessionId) => deps.reveal(sessionId),
      (error: unknown) => {
        deps.log(`session not resumed: ${errorText(error)}`);
        deps.toast(`Session not resumed: ${errorText(error)}`, 'error');
      },
    );
}

// Starts a session at `target`: a folder, or a project.
function startSession(
  context: PromptContext,
  target: PromptTarget,
  profile: RegisteredProfile,
) {
  const { deps } = context;
  deps.log(
    `starting a session in ${targetName(target, deps)} with ${profile.name}`,
  );
  void deps.channel
    .invoke('start', {
      ...startTargetOf(target),
      harness: profile.harnessId,
      profile: profile.name,
    })
    .then(
      (sessionId) => deps.reveal(sessionId),
      (error: unknown) => {
        deps.log(`session not started: ${errorText(error)}`);
        deps.toast(`Session not started: ${errorText(error)}`, 'error');
      },
    );
}

function startTargetOf(target: PromptTarget): StartTarget {
  return target.kind === 'folder'
    ? { projectDir: target.projectDir }
    : { project: target.project.name };
}

// The folder as the prompt shows it, or the project's name.
function targetName(
  target: PromptTarget,
  deps: Pick<StartPromptDeps, 'homeDir' | 'paths'>,
): string {
  if (target.kind === 'folder') {
    return displayPath(target.projectDir, deps.homeDir, deps.paths);
  }
  return target.project.name;
}
