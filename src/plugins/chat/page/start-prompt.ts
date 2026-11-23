import type { AgentHarnessInfo } from '../../../contracts/agent';
import type { Timers } from '../../../contracts/ambient';
import { DEMO_HARNESS_ID, DEMO_PROFILE } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { PageChannel, ToastTone } from '../../../contracts/plugin';
import type { KeyedSlotReader } from '../../../contracts/state';
import { harnessLabel } from '../../../shared/agent-harness-label';
import { errorText } from '../../../shared/error-text';
import {
  listedHarnesses,
  type RegisteredProfile,
  registeredProfiles,
} from '../../../shared/harness-profiles';
import type {
  ChatChannel,
  ChatProject,
  ChatSessionInfo,
  ProjectPastSessionRow,
  RecentFolder,
  ResumeSectionRow,
  ResumeSectionRows,
  StartTarget,
} from '../contract';
import type { SessionRow } from '../../sessions/contract';
import type { Picker, PickerHandle, PickerRequest } from './picker';
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
  // True once chat's page part stopped: a reply landing later does nothing.
  isStopped(): boolean;
  // The page's `chat.session` and `sessions.rows` slots, whose updates a draft
  // waits on for its new session's tab, the view hearing each first.
  sessions: Pick<KeyedSlotReader<ChatSessionInfo>, 'on'>;
  rows: Pick<KeyedSlotReader<SessionRow>, 'on'>;
  // True once the Chat view holds the session's tab: its key and its row
  // have both arrived.
  hasTab(sessionId: string): boolean;
  // Puts `text` in the session's box and reveals its tab, as the
  // `fillComposer` export does.
  fillComposer(sessionId: string, text: string): void;
  timers: Timers;
}

// How long a draft waits, after its start resolved, for the new session's
// tab.
export const JOIN_WAIT_MS = 10_000;

// `open` asks for a project — or, through `Other folder…` or with no
// projects, a folder — then a profile of the target's harness unless the
// project fixes one or that harness has one, then signs a signed-out profile
// in through the sign-in dialog, then asks for a new session or one of the
// project's or folder's saved sessions, and starts or resumes a chat session
// there, revealing its Chat tab. With no saved sessions to list, archived
// ones counted, it skips that step and starts a new session at once. Its
// first step also lists the resume sections' rows at the top, a pick resuming
// that session at once, and its session step those of its folders and
// profile. Esc at any step starts nothing. Opening the prompt again drops the
// earlier one: an answer or a sign-in that arrives for it is logged and goes
// no further. The target's harness is chat's `defaultHarness`, a picked recent
// folder's recorded harness while it is registered, or a fixed profile's
// harness; with `defaultHarness` not registered the prompt toasts and opens
// nothing. While the demo harness is registered the prompt lists no projects
// and no recent folders, so its first step is the folder step, and a section
// row on the demo profile is a sample that toasts and resumes nothing.
// `openForNewSession` asks the same way but lists no sections and no saved
// sessions, so it starts a new session once the profile is signed in.
// `newSessionWithDraft` opens as `openForNewSession` does, and once the
// session it starts has its Chat tab, fills that session's box with `text`,
// unsent; it resolves to the row id once filled. It resolves null, and never
// rejects, when the prompt ends with no session (Esc at a step, another picker
// list replacing a step, a sign-in ending signed out, a prompt that cannot
// open, a failed start), when the prompt opens again before the start, at
// `dispose`, when the new session's key leaves before the fill, and
// `JOIN_WAIT_MS` after the start with no tab, logging
// `newSessionWithDraft: <rowId> never reached the page`. A draft whose session
// started keeps waiting through a later open.
// `toggleArchive` and `showArchived` act on the session step while it is open.
// `dispose` ends a draft's wait with null, as chat's page part stops.
export interface StartPrompt {
  open(): void;
  openForNewSession(): void;
  newSessionWithDraft(text: string): Promise<string | null>;
  toggleArchive(): void;
  showArchived(): void;
  dispose(): void;
}

// A `newSessionWithDraft` call until it resolves: the open carrying it, the
// text, the end of its promise, and its slot listeners and timer once its
// start resolved.
interface DraftWait {
  opened: number;
  text: string;
  resolve(rowId: string | null): void;
  isEnded: boolean;
  listening: Disposable[];
  timer: number | null;
}

// One open's side of its draft wait, each doing nothing for an open with no
// draft: `started` hands it the new row, `dropped` ends it with null.
interface DraftHooks {
  started(rowId: string): void;
  dropped(): void;
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
// harness's, and `defaultHarness` is registered. Each step that ends the
// prompt with no session calls `draft.dropped`.
interface PromptContext {
  deps: StartPromptDeps;
  isCurrent(): boolean;
  draft: DraftHooks;
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

  // The draft the current open carries until its start resolves; null for
  // none.
  let draft: DraftWait | null = null;
  // The drafts whose session started, each waiting for its tab.
  const awaitingTab = new Set<DraftWait>();

  // Ends `wait` with `rowId`, disposing its listeners and timer; nothing once
  // it has ended.
  const endDraft = (wait: DraftWait, rowId: string | null) => {
    if (wait.isEnded) {
      return;
    }
    wait.isEnded = true;
    if (draft === wait) {
      draft = null;
    }
    awaitingTab.delete(wait);
    for (const listening of wait.listening) {
      listening.dispose();
    }
    if (wait.timer !== null) {
      deps.timers.clear(wait.timer);
    }
    wait.resolve(rowId);
  };

  // Fills the new session's box once the view holds its tab: at once when it
  // does, else on the first `chat.session` or `sessions.rows` update after
  // which it does.
  const awaitTab = (wait: DraftWait, rowId: string) => {
    const fillOnceTabbed = () => {
      if (!deps.hasTab(rowId)) {
        return false;
      }
      deps.fillComposer(rowId, wait.text);
      endDraft(wait, rowId);
      return true;
    };
    if (fillOnceTabbed()) {
      return;
    }
    awaitingTab.add(wait);
    wait.listening.push(
      deps.sessions.on((sessionId, info) => {
        if (sessionId !== rowId) {
          return;
        }
        if (info === undefined) {
          log(`newSessionWithDraft: ${rowId} closed before its box filled`);
          endDraft(wait, null);
          return;
        }
        fillOnceTabbed();
      }),
      deps.rows.on((sessionId) => {
        if (sessionId === rowId) {
          fillOnceTabbed();
        }
      }),
    );
    wait.timer = deps.timers.set(() => {
      log(`newSessionWithDraft: ${rowId} never reached the page`);
      endDraft(wait, null);
    }, JOIN_WAIT_MS);
  };

  // Open `opened`'s side of the draft it carries; a started draft leaves the
  // open, so a later open does not drop it.
  const draftHooksOf = (opened: number): DraftHooks => {
    const ownDraft = () => (draft?.opened === opened ? draft : null);
    return {
      started(rowId) {
        const wait = ownDraft();
        if (wait !== null) {
          draft = null;
          awaitTab(wait, rowId);
        }
      },
      dropped() {
        const wait = ownDraft();
        if (wait !== null) {
          endDraft(wait, null);
        }
      },
    };
  };

  // True once chat's page part stopped, and, logging `what` as dropped, once
  // the prompt has opened again since the open `isCurrent` belongs to.
  const isStale = (isCurrent: () => boolean, what: string) => {
    if (deps.isStopped()) {
      return true;
    }
    if (isCurrent()) {
      return false;
    }
    log(`${what} dropped: the start prompt opened again`);
    return true;
  };

  // True while the prompt opens one of its steps, which may replace its own
  // shown step.
  let isOpeningStep = false;

  // Opens a step of `context`'s open, whose Esc, or another list replacing it,
  // ends the open's draft.
  const openStep = <T>(
    context: PromptContext,
    request: PickerRequest<T>,
  ): PickerHandle => {
    isOpeningStep = true;
    try {
      return deps.picker.open<T>({
        ...request,
        cancelled: () => context.draft.dropped(),
        superseded: () => {
          if (!isOpeningStep) {
            context.draft.dropped();
          }
        },
      });
    } finally {
      isOpeningStep = false;
    }
  };

  // The sections' rows; none when they cannot be read.
  const readSections = (): Promise<ResumeSectionRows[]> =>
    channel.invoke('resumeSections').catch((error: unknown) => {
      if (!deps.isStopped()) {
        log(`resume sections not read: ${errorText(error)}`);
      }
      return [];
    });

  // Logs and toasts that the harness has no profiles to start under, the
  // toast naming it by `harnessLabel`.
  const reportNoProfiles = (harness: string) => {
    log(`harness ${harness} has no profiles`);
    const label = harnessLabel(deps.harnesses(), harness);
    deps.toast(`Add a profile to ${label}'s profiles setting first`, 'error');
  };

  // Chat's projects; none when they cannot be read.
  const readProjects = (): Promise<ChatProject[]> =>
    channel.invoke('projects').catch((error: unknown) => {
      if (!deps.isStopped()) {
        log(`projects not read: ${errorText(error)}`);
      }
      return [];
    });

  // Opens the prompt, dropping the earlier open's draft unless its session
  // started; `carried` is the draft this open fills, null for none.
  const openPrompt = (
    offersSavedSessions: boolean,
    carried: Pick<DraftWait, 'text' | 'resolve'> | null = null,
  ) => {
    step = null;
    opens += 1;
    const opened = opens;
    const isCurrent = () => opens === opened;
    if (draft !== null) {
      endDraft(draft, null);
    }
    draft =
      carried === null
        ? null
        : { ...carried, opened, isEnded: false, listening: [], timer: null };
    const draftHooks = draftHooksOf(opened);
    void Promise.all([
      channel.invoke('recentFolders'),
      offersSavedSessions ? readSections() : [],
      readProjects(),
    ]).then(
      ([userRecent, sections, userProjects]) => {
        if (isStale(isCurrent, 'recent folders')) {
          return;
        }
        const harnesses = deps.harnesses();
        const isDemoRunning = harnesses.has(DEMO_HARNESS_ID);
        if (isDemoRunning) {
          log(
            'start prompt: the demo runs, projects and recent folders hidden',
          );
        }
        const recent = isDemoRunning ? [] : userRecent;
        const projects = isDemoRunning ? [] : userProjects;
        const defaultHarness = deps.defaultHarness();
        const defaultInfo = harnesses.get(defaultHarness);
        if (defaultInfo === undefined) {
          const text = `No agent harness "${defaultHarness}" is registered. Set chat's defaultHarness to a registered harness.`;
          log(text);
          deps.toast(text, 'error');
          draftHooks.dropped();
          return;
        }
        if (defaultInfo.profiles.length === 0) {
          reportNoProfiles(defaultHarness);
          draftHooks.dropped();
          return;
        }
        for (const { title, rows } of sections) {
          log(`resume section ${title}: ${rows.length} rows`);
        }
        const context: PromptContext = {
          deps,
          isCurrent,
          draft: draftHooks,
          offersSavedSessions,
          recent,
          sections,
          projects,
          harnesses,
          defaultHarness,
          profiles: registeredProfiles(listedHarnesses(harnesses)),
        };
        if (projects.length === 0) {
          openFolderStep(context);
        } else {
          openProjectStep(context);
        }
      },
      (error: unknown) => {
        if (deps.isStopped()) {
          return;
        }
        log(`start prompt not opened: ${errorText(error)}`);
        deps.toast(`Start prompt not opened: ${errorText(error)}`, 'error');
        draftHooks.dropped();
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
    openStep<ProjectItem>(context, {
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
    openStep<FolderItem>(context, {
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
    if (row.profile === DEMO_PROFILE) {
      log(`sample session ${row.title} not resumed`);
      deps.toast('A sample session: the demo resumes nothing', 'info');
      return;
    }
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
        if (deps.isStopped()) {
          return;
        }
        log(`folder dialog failed: ${errorText(error)}`);
        deps.toast(`Folder dialog failed: ${errorText(error)}`, 'error');
        context.draft.dropped();
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
      context.draft.dropped();
      return;
    }
    if (fixed !== null) {
      checkProfile(context, target, fixed);
      return;
    }
    if (profiles.length === 0) {
      reportNoProfiles(harness);
      context.draft.dropped();
      return;
    }
    if (profiles.length === 1) {
      checkProfile(context, target, profiles[0]);
      return;
    }
    openStep<RegisteredProfile>(context, {
      title: 'Profile',
      items: profiles,
      label: profileLabel,
      rowInput: profileRowInput,
      selected: preselectedProfileOf(context, target, profiles),
      picked: (profile) => checkProfile(context, target, profile),
    });
  };

  // The profile `project` fixes, from every listed harness's profiles the
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
    const text = `Profile ${project.profile} of ${project.name} is not a profile of any registered harness`;
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
      preselectedProfile(profiles, context.recent, projectDir, deps.paths);
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
          context.draft.dropped();
        });
      },
      (error: unknown) => {
        if (deps.isStopped()) {
          return;
        }
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
        if (deps.isStopped()) {
          return;
        }
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
    opened.shown = openStep<SessionItem<ProjectPastSessionRow>>(
      opened.context,
      {
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
      },
    );
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
        if (deps.isStopped() || shownStep() !== shown) {
          return;
        }
        reopenSessionStep(shown, shown.items, deps.picker.cursorIndex());
        log(`${archived ? 'archived' : 'restored'} ${title}`);
      },
      (error: unknown) => {
        shown.isWriting = false;
        if (deps.isStopped()) {
          return;
        }
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
    newSessionWithDraft: (text) =>
      new Promise<string | null>((resolve) => {
        if (deps.isStopped()) {
          resolve(null);
          return;
        }
        openPrompt(false, { text, resolve });
      }),
    toggleArchive,
    showArchived: toggleShowArchived,
    dispose() {
      if (draft !== null) {
        endDraft(draft, null);
      }
      for (const wait of awaitingTab) {
        endDraft(wait, null);
      }
    },
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
      (sessionId) => {
        if (!deps.isStopped()) {
          deps.reveal(sessionId);
        }
      },
      (error: unknown) => {
        if (deps.isStopped()) {
          return;
        }
        deps.log(`session not resumed: ${errorText(error)}`);
        deps.toast(`Session not resumed: ${errorText(error)}`, 'error');
      },
    );
}

// Starts a session at `target`: a folder, or a project, handing the new row to
// the open's draft.
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
      (sessionId) => {
        if (!deps.isStopped()) {
          deps.reveal(sessionId);
          context.draft.started(sessionId);
        }
      },
      (error: unknown) => {
        if (deps.isStopped()) {
          return;
        }
        deps.log(`session not started: ${errorText(error)}`);
        deps.toast(`Session not started: ${errorText(error)}`, 'error');
        context.draft.dropped();
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
