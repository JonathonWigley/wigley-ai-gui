import type { Timers } from '../../../contracts/ambient';
import type { CommandId, CommandKey } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type {
  DocumentEditor,
  EditorHost,
  ScrollStep,
} from '../../../contracts/editor';
import type { PluginLog } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type {
  FocusTarget,
  PaneDirection,
  ResizeTarget,
} from '../../../contracts/panes';
import type {
  KeyHints,
  PageChannel,
  PushedScope,
  ShownLayouts,
  ToastTone,
} from '../../../contracts/plugin';
import type { UiState } from '../../../contracts/ui-state';
import {
  edgeText,
  type ScrollEdge,
  scrollContent,
  scrollText,
  scrollToEdge,
} from '../../../shared/content-scroll';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import {
  saveLabel,
  saveState,
  startAutosave,
} from '../../../shared/page/autosave';
import { createConfirmPrompt } from '../../../shared/page/confirm-prompt';
import { appended, element } from '../../../shared/page/dom';
import {
  createEditorBoxes,
  keepFocusedBox,
} from '../../../shared/page/editor-boxes';
import { appSlot } from '../../../shared/page/layout-host/app-slot';
import type { OwnerKitServices } from '../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  disposeDraws,
  requireDialogFrame,
  type RollbackDeps,
} from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { createMarkdownMount } from '../../../shared/page/markdown-mount';
import { onPageHide } from '../../../shared/page/page-hide';
import { createReducerStore } from '../../../shared/page/reducer-store';
import { textButton } from '../../../shared/page/ui/button';
import { rowAction } from '../../../shared/page/ui/row';
import { createSplit } from '../../../shared/page/ui/split';
import { tab, tabStrip } from '../../../shared/page/ui/tabs';
import { textLineHeightPx } from '../../../shared/page/text-line';
import { qualify } from '../../../shared/plugin-manifests';
import {
  type OpenedProblem,
  type PracticeChannel,
  type PracticePlace,
  practiceOpenSubmissionRowCommand,
  practiceShowTabCommand,
  type SubmissionRecord,
  VERDICT_NAMES,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  CompletePracticeLayout,
  PracticeLayout,
  ResultInput,
} from '../layouts/layout';
import { caseInputText, valueText } from './case-text';
import {
  createPracticeKit,
  type PracticeKitScope,
} from './layout/practice-kit';
import {
  CONSOLE_TABS,
  type ConsoleTab,
  type Draft,
  DRAFT_IDS,
  type DraftId,
  type DraftMark,
  draftMark,
  initialWorkspaceState,
  type JudgeKind,
  type JudgeState,
  PROBLEM_TABS,
  type ProblemTab,
  submissionsNewestFirst,
  type WorkspaceAction,
  type WorkspaceState,
  workspaceReducer,
} from './workspace-state';

const PLUGIN_ID = 'practice';

// How long the user's edits pause before a draft saves.
export const AUTOSAVE_DELAY_MS = 800;

// The form id every workspace box carries.
const FORM_ID = 'workspace';

const CODE_FILE = 'solution.cpp';

const DRAFT_FILES: Record<DraftId, string> = {
  code: CODE_FILE,
  notes: 'notes.md',
  customCases: 'custom-cases.json',
};

const SAVED_LINES: Record<DraftId, string> = {
  code: 'saved code',
  notes: 'saved notes',
  customCases: 'saved custom cases',
};

const TAB_TITLES: Record<ProblemTab | ConsoleTab, string> = {
  description: 'Description',
  submissions: 'Submissions',
  notes: 'Notes',
  solution: 'Solution',
  testcase: 'Testcase',
  result: 'Result',
};

type PaneMoves = Record<
  WorkspacePane,
  Partial<Record<PaneDirection, WorkspacePane>>
>;

// Where Alt+hjkl moves from each pane: the problem pane on the left, the
// editor over the console on the right. A move with no entry leaves the
// workspace.
export const PANE_MOVES: PaneMoves = {
  problem: { right: 'editor' },
  editor: { left: 'problem', down: 'console' },
  console: { left: 'problem', up: 'editor' },
};

// The same moves while the problem | code split stacks, in a narrow column:
// the problem pane over the editor over the console.
export const STACKED_PANE_MOVES: PaneMoves = {
  problem: { down: 'editor' },
  editor: { up: 'problem', down: 'console' },
  console: { up: 'editor' },
};

// The two boxes: the notes on the Notes tab, the custom cases on Testcase.
type BoxId = Exclude<DraftId, 'code'>;

// A drawn part whose root the workspace keeps, and the dispose of its anchors
// and boxes.
type DrawnRoot = DrawnPart<{ element: HTMLElement }>;

// The pane of the column holding the keys.
export type WorkspacePane = 'problem' | 'editor' | 'console';

// How a `show` ended: the problem shows; the shown problem was kept because a
// draft of it did not save; or a later `show` or the dispose overtook it.
export type ShowResult = 'shown' | 'kept' | 'overtaken';

// What of the page's place the workspace keeps.
export type WorkspacePlace = Pick<
  PracticePlace,
  'pane' | 'problemTab' | 'consoleTab'
>;

// The page commands the workspace handles.
export type WorkspaceCommand =
  | 'run'
  | 'submit'
  | 'nextTab'
  | 'prevTab'
  | 'paneDown'
  | 'paneUp'
  | 'paneTop'
  | 'paneBottom'
  | 'lineDown'
  | 'lineUp'
  | 'halfPageDown'
  | 'halfPageUp'
  | 'openSubmission'
  | 'closeSubmission'
  | 'editBox'
  | 'leaveBox'
  | 'confirmYes'
  | 'confirmNo';

export interface ProblemWorkspaceDeps {
  channel: PageChannel<PracticeChannel>;
  editor: EditorHost;
  markdown: MarkdownRenderer;
  // What each part's kit draws with.
  kitServices: OwnerKitServices;
  keys: KeyHints;
  uiState: UiState;
  timers: Timers;
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
  // Runs the command `key` with `arg`, as a click does.
  runKey<A>(key: CommandKey<A>, arg: A): void;
  // Runs a command by its qualified id, as a button does.
  run(command: CommandId): void;
  pushScope(scope: 'confirm'): PushedScope;
  addOverlay(element: HTMLElement): void;
  // Whether the column holds the keys now, so a pane change moves the DOM
  // focus with it.
  hasKeys(): boolean;
  // Runs after each change of the pane holding the keys and as the confirm
  // shows or hides: the view sets its scope, resize target and focus target
  // again.
  paneChanged(): void;
  // The one function that applies an `open` result, with the mark taken as
  // its read began; a Submit's own `open` goes through it.
  applyOpened(problem: OpenedProblem, mark: DraftMark): void;
  // The last page's place; the first show of its open problem puts its pane
  // and tabs back.
  savedPlace: PracticePlace | null;
  // Hears the pane and tabs after each change, once a problem shows.
  placeChanged(place: WorkspacePlace): void;
}

// The open problem's workspace: the problem pane (Description, Submissions,
// Notes, Solution) over the editor holding `solution.cpp` over the console
// (Testcase, Result), with `interviewerSlot`, an empty slot under the editor
// and console, hidden until `setInterviewerShown`; each divider a `Split` kept
// in `uiState`. The drafts of the code, the notes and the custom cases
// autosave once typing pauses, and every unsaved one saves at once before a
// Run, a Submit or another problem shows. Every decision about what shows
// lives in `workspaceReducer`; the workspace draws its state after each
// change, each tab's part only when what it shows changed.
export interface ProblemWorkspace {
  element: HTMLElement;
  interviewerSlot: HTMLElement;
  setInterviewerShown(isShown: boolean): void;
  // The divider over `interviewerSlot`, then the problem | code split.
  interviewerResizeTarget: ResizeTarget;
  // The divider over `interviewerSlot` alone.
  interviewerDivider: ResizeTarget;
  // Saves every unsaved draft first when another problem shows, edits typed
  // during the save included, then shows `problem` on its first tabs, the
  // problem pane holding the keys; the saved place's open problem shows with
  // the place's pane and tabs instead. A draft that fails to save keeps the
  // shown problem and its drafts, and resolves `kept`.
  show(problem: OpenedProblem): Promise<ShowResult>;
  // The mark a read of `open` takes as it begins, of the drafts as they stand
  // whatever problem shows.
  readMark(): DraftMark;
  // Takes the shown problem read again, keeping every unsaved draft and every
  // draft saved after `mark` was taken, and drops a `show` of another problem
  // still waiting on its save, which resolves `overtaken`; another problem is
  // ignored.
  refresh(problem: OpenedProblem, mark: DraftMark): void;
  pane(): WorkspacePane;
  // Moves the DOM focus to the pane that held the keys last.
  focus(): void;
  // Alt+j and Alt+k between the panes; every other move returns false.
  focusTarget: FocusTarget;
  // The focused pane's divider, the vertical one else the problem | code
  // split.
  resizeTarget: ResizeTarget;
  setLayouts(shown: ShownLayouts<PracticeLayout>): void;
  commands: Record<WorkspaceCommand, () => void>;
  // Shows the tab `tab` names, as a click on it does; an id no tab holds logs
  // `no tab <id>`.
  showTab(tab: string): void;
  // Shows the code of the submission whose time is `time`.
  openSubmissionRow(time: string): void;
  // Why the page may not stop now: a draft still unsaved; else null.
  mayStop(): string | null;
  // Saves every unsaved draft now, before its timer, to the folder main
  // serves; a failed save is toasted.
  saveDrafts(): Promise<void>;
  dispose(): void;
}

export function createProblemWorkspace(
  deps: ProblemWorkspaceDeps,
): ProblemWorkspace {
  const { channel, log } = deps;
  const store = createReducerStore(initialWorkspaceState(), workspaceReducer);
  const dispatch = (action: WorkspaceAction) => store.dispatch(action);
  let isDisposed = false;

  // ── Layouts ────────────────────────────────────────────────────────────
  const parts = createLayoutParts<PracticeLayout, CompletePracticeLayout>({
    owner: PLUGIN_ID,
    defaultLayout,
    log,
  });
  const kitFor = (scope: PracticeKitScope, rollback: RollbackDeps) =>
    createPracticeKit(deps.kitServices, scope, rollback);

  // ── Elements ───────────────────────────────────────────────────────────
  const problemTabs = new Map(
    PROBLEM_TABS.map((id) => [id, tabFor(id, deps)] as const),
  );
  const consoleTabs = new Map(
    CONSOLE_TABS.map((id) => [id, tabFor(id, deps)] as const),
  );
  const problemStrip = tabStrip([...problemTabs.values()]);
  const consoleStrip = tabStrip([...consoleTabs.values()]);
  for (const strip of [problemStrip, consoleStrip]) {
    strip.classList.add('ui-tabs--scroll');
  }
  const problemBody = element('div', 'practice-tab-body');
  problemBody.tabIndex = -1;
  const consoleBody = element('div', 'practice-tab-body');
  consoleBody.tabIndex = -1;
  const editorSlot = element('div', 'practice-editor');
  const saveStateLabel = element('span', 'practice-save-state');
  const actions = element('span', 'practice-console-actions');
  const actionAnchors = (['run', 'submit'] as const).map((command) => {
    const qualified = qualify(PLUGIN_ID, command);
    const hint = element('span', 'practice-button-key');
    actions.append(
      textButton(
        command === 'run' ? 'Run' : 'Submit',
        () => deps.run(qualified),
        { variant: command === 'run' ? 'secondary' : 'primary', hint },
      ),
    );
    return deps.keys.anchor(hint, qualified);
  });

  const splitDeps = {
    uiState: deps.uiState,
    anchor: deps.keys.anchor,
    timers: deps.timers,
  };
  const inner = createSplit({
    ...splitDeps,
    axis: 'column',
    sizedPane: 'end',
    stateKey: 'consoleHeight',
    initial: 200,
    min: 96,
    endMin: 160,
  });
  const outer = createSplit({
    ...splitDeps,
    axis: 'row',
    stateKey: 'problemWidth',
    initial: 600,
    min: 320,
    endMin: 400,
  });
  const interviewerSplit = createSplit({
    ...splitDeps,
    axis: 'column',
    sizedPane: 'end',
    stateKey: 'interviewerHeight',
    initial: 240,
    min: 120,
    endMin: 280,
  });
  const interviewerSlot = element('div', 'practice-interviewer');
  interviewerSplit.start.append(inner.element);
  interviewerSplit.end.append(interviewerSlot);
  interviewerSplit.setEndHidden(true);
  outer.end.append(interviewerSplit.element);
  const workspaceRoot = element('div', 'practice-workspace');
  workspaceRoot.append(outer.element);

  // ── Boxes and the editor ───────────────────────────────────────────────
  const boxes = createEditorBoxes<BoxId>(
    deps.editor,
    {
      changed: (id, text) => {
        const { slug } = store.get().drafts[id];
        dispatch({ type: 'draftChanged', id, slug, text });
      },
      activated: (id) => notePane(paneOfBox(id)),
    },
    log,
    {
      formIdOf: () => FORM_ID,
      keyOf: (id) => id,
      describe: (id) => `${DRAFT_FILES[id]} box`,
    },
  );
  let docEditor: DocumentEditor | null = null;

  // ── Panes and focus ────────────────────────────────────────────────────
  let pane: WorkspacePane = 'problem';
  let shownPlace: WorkspacePlace | null = null;
  let savedPlace = deps.savedPlace;

  const bodyOf = (of: WorkspacePane): HTMLElement =>
    of === 'console' ? consoleBody : problemBody;

  const focusPane = () => {
    if (pane === 'editor') {
      docEditor?.focus();
      return;
    }
    bodyOf(pane).focus();
  };

  // Sets the pane holding the keys, logging `<pane> focused`, and tells the
  // view; `always` logs and tells it even when the pane is unchanged.
  // `movesFocus` takes the DOM focus there while the column holds the keys.
  const setPane = (
    next: WorkspacePane,
    options: { always?: boolean; movesFocus: boolean },
  ) => {
    if (next === pane && options.always !== true) {
      return;
    }
    if (pane === 'editor' && next !== 'editor') {
      docEditor?.blur();
    }
    pane = next;
    log(`${next} focused`);
    deps.paneChanged();
    notePlace(store.get());
    if (options.movesFocus && deps.hasKeys()) {
      focusPane();
    }
  };
  // The DOM focus went into `next` already, by a click or a box's focus.
  const notePane = (next: WorkspacePane) =>
    setPane(next, { movesFocus: false });

  outer.start.addEventListener('focusin', () => notePane('problem'));
  inner.start.addEventListener('focusin', () => notePane('editor'));
  inner.end.addEventListener('focusin', () => notePane('console'));

  const focusTarget: FocusTarget = {
    move(direction) {
      const isStacked = outer.element.classList.contains('is-stacked');
      const moves = isStacked ? STACKED_PANE_MOVES : PANE_MOVES;
      const next = moves[pane][direction];
      if (next === undefined) {
        return false;
      }
      setPane(next, { movesFocus: true });
      return true;
    },
  };

  // The problem pane's right divider is the problem | code split; the editor
  // and console move their shared divider, else the problem | code split on
  // their left; the interviewer moves the divider over it, else that split.
  const resizeTarget: ResizeTarget = {
    nudge(direction) {
      if (pane === 'problem') {
        return outer.nudge(direction);
      }
      return inner.nudge(direction) || outer.nudge(direction);
    },
  };
  const interviewerResizeTarget: ResizeTarget = {
    nudge: (direction) =>
      interviewerSplit.nudge(direction) || outer.nudge(direction),
  };

  const notePlace = (state: WorkspaceState) => {
    if (state.problem === null) {
      return;
    }
    const place: WorkspacePlace = {
      pane,
      problemTab:
        state.problemTab === 'solution'
          ? (shownPlace?.problemTab ?? 'description')
          : state.problemTab,
      consoleTab: state.consoleTab,
    };
    const isChanged =
      shownPlace === null ||
      place.pane !== shownPlace.pane ||
      place.problemTab !== shownPlace.problemTab ||
      place.consoleTab !== shownPlace.consoleTab;
    if (isChanged) {
      shownPlace = place;
      deps.placeChanged(place);
    }
  };

  // ── Markdown ───────────────────────────────────────────────────────────
  // Each text's rendered html, kept for the shown problem.
  const rendered = new Map<string, string>();
  const rendering = new Set<string>();
  // The html of `text`, or null while it renders; the render draws again
  // once it lands.
  const htmlOf = (text: string): string | null => {
    const html = rendered.get(text);
    if (html !== undefined) {
      return html;
    }
    if (!rendering.has(text)) {
      rendering.add(text);
      deps.markdown.document(text).then(
        (landed) => htmlLanded(text, landed),
        (error: unknown) => {
          log(`not rendered: ${errorText(error)}`);
          htmlLanded(text, '');
        },
      );
    }
    return null;
  };
  const htmlLanded = (text: string, html: string) => {
    rendering.delete(text);
    rendered.set(text, html);
    if (!isDisposed) {
      render();
    }
  };

  // A doc kit's `document`: a `div.md` holding `html`, through a markdown
  // mount the draw's rollback disposes; empty while it renders.
  const documentSlot =
    (html: string | null, rollback: RollbackDeps) =>
    (parent: HTMLElement): HTMLElement => {
      const node = appended(parent, element('div', 'md'));
      if (html !== null) {
        const mount = createMarkdownMount(deps.markdown, log);
        rollback.recordAnchor(mount);
        mount.draw(node, html);
      }
      return node;
    };

  // A box kit's `textBox`: the box's frame placed in `parent` with the
  // draft's text, released with the draw. A box placed for another problem or
  // an earlier draft is destroyed first, so a fresh editor holds the new text.
  // A second call in one draw throws `textBox placed twice`, so the part draws
  // with `default`.
  const textBoxSlot = (id: BoxId, rollback: RollbackDeps) => {
    let isPlaced = false;
    return (parent: HTMLElement): HTMLElement => {
      if (isPlaced) {
        throw new Error('textBox placed twice');
      }
      isPlaced = true;
      const { problem, drafts } = store.get();
      if (problem === null) {
        throw new Error(`the ${id} box draws with no problem open`);
      }
      const placeKey = boxTabKey(id, problem.summary.slug);
      if (placeKey !== placedFor[id]) {
        boxes.destroyBox(id);
      }
      const frame = boxes.place(parent, id, drafts[id].text);
      placedFor[id] = placeKey;
      frame.classList.add('practice-box', `practice-box--${id}`);
      rollback.recordBox(() => boxes.release(id));
      return frame;
    };
  };

  // ── Drawing ────────────────────────────────────────────────────────────
  let problemDraws: DrawnRoot[] = [];
  let consoleDraws: DrawnRoot[] = [];
  // What the shown tab of each pane was drawn from; null to draw again.
  let drawnProblemKey: string | null = null;
  let drawnConsoleKey: string | null = null;
  // Counts each replace of a box's text from disk, so its tab draws again.
  const boxReplaces: Record<BoxId, number> = { notes: 0, customCases: 0 };
  // The box tab key each box was last placed for; null before its first place.
  const placedFor: Record<BoxId, string | null> = {
    notes: null,
    customCases: null,
  };
  // What a box's tab draws from, as text: a new problem or a draft replaced
  // from disk changes it.
  const boxTabKey = (id: BoxId, slug: string): string =>
    id === 'notes'
      ? JSON.stringify(['notes', slug, boxReplaces.notes])
      : JSON.stringify(['testcase', slug, boxReplaces.customCases]);
  let loggedProblemTab: ProblemTab = store.get().problemTab;
  let isPromptShown = false;

  const drawPanes = () => {
    parts.redraw('problemPane', outer.start, (problemPane, into, rollback) => {
      const tabs = appSlot(problemStrip, 'tabs', rollback);
      const body = appSlot(problemBody, 'body', rollback);
      const drawn = problemPane(into, {
        ...kitFor('problem', rollback),
        tabs: tabs.place,
        body: body.place,
      });
      tabs.placeIfLeftOut(drawn.element);
      body.placeIfLeftOut(drawn.element);
      return drawn;
    });
    parts.redraw('editorPane', inner.start, (editorPane, into, rollback) => {
      const editor = appSlot(editorSlot, 'editor', rollback);
      const label = appSlot(saveStateLabel, 'saveState', rollback);
      const drawn = editorPane(
        into,
        { fileName: CODE_FILE },
        {
          ...kitFor('editor', rollback),
          editor: editor.place,
          saveState: label.place,
        },
      );
      label.placeIfLeftOut(drawn.element);
      editor.placeIfLeftOut(drawn.element);
      return drawn;
    });
    parts.redraw('consolePane', inner.end, (consolePane, into, rollback) => {
      const tabs = appSlot(consoleStrip, 'tabs', rollback);
      const buttons = appSlot(actions, 'actions', rollback);
      const body = appSlot(consoleBody, 'body', rollback);
      const drawn = consolePane(into, {
        ...kitFor('console', rollback),
        tabs: tabs.place,
        actions: buttons.place,
        body: body.place,
      });
      tabs.placeIfLeftOut(drawn.element);
      buttons.placeIfLeftOut(drawn.element);
      body.placeIfLeftOut(drawn.element);
      return drawn;
    });
  };

  // What the problem pane's shown tab draws from, as text: a change draws it
  // again.
  const problemTabKey = (
    state: WorkspaceState,
    problem: OpenedProblem,
  ): string => {
    const slug = problem.summary.slug;
    switch (state.problemTab) {
      case 'description':
        return JSON.stringify([
          'description',
          problem.summary,
          htmlOf(problem.statement),
        ]);
      case 'submissions': {
        const code = state.isSubmissionOpen
          ? submissionsNewestFirst(problem.submissions)[state.submissionCursor]
              ?.code
          : undefined;
        return JSON.stringify([
          'submissions',
          slug,
          problem.submissions,
          state.submissionCursor,
          code === undefined ? null : htmlOf(cppFence(code)),
        ]);
      }
      case 'notes':
        return boxTabKey('notes', slug);
      case 'solution':
        return JSON.stringify([
          'solution',
          slug,
          state.peek.status === 'held'
            ? htmlOf(solutionText(state.peek))
            : null,
        ]);
    }
  };

  const consoleTabKey = (
    state: WorkspaceState,
    problem: OpenedProblem,
  ): string => {
    const slug = problem.summary.slug;
    return state.consoleTab === 'testcase'
      ? boxTabKey('customCases', slug)
      : JSON.stringify(['result', slug, state.judge]);
  };

  const drawProblemTab = (state: WorkspaceState, problem: OpenedProblem) => {
    switch (state.problemTab) {
      case 'description':
        problemDraws.push(
          parts.draw(
            'descriptionTab',
            problemBody,
            (descriptionTab, into, rollback) => ({
              element: descriptionTab(
                into,
                {
                  title: problem.summary.title,
                  difficulty: problem.summary.difficulty,
                  tags: problem.summary.tags,
                  lists: problem.summary.lists,
                },
                {
                  ...kitFor('problem', rollback),
                  document: documentSlot(htmlOf(problem.statement), rollback),
                },
              ),
            }),
          ),
        );
        return;
      case 'submissions':
        drawSubmissions(state, problem);
        return;
      case 'notes':
        problemDraws.push(drawBoxTab('notesTab', 'notes', problemBody));
        return;
      case 'solution': {
        const { peek } = state;
        if (peek.status !== 'held') {
          return;
        }
        problemDraws.push(
          parts.draw(
            'solutionTab',
            problemBody,
            (solutionTab, into, rollback) => ({
              element: solutionTab(
                into,
                { approach: peek.approach, reference: peek.reference },
                {
                  ...kitFor('problem', rollback),
                  document: documentSlot(htmlOf(solutionText(peek)), rollback),
                },
              ),
            }),
          ),
        );
        return;
      }
    }
  };

  // The Submissions tab: the cursor row's code while it is open, else one
  // row per submission, newest first, or `empty`.
  const drawSubmissions = (state: WorkspaceState, problem: OpenedProblem) => {
    const rows = submissionsNewestFirst(problem.submissions);
    const shown = state.isSubmissionOpen ? rows[state.submissionCursor] : null;
    if (shown !== null && shown !== undefined) {
      problemDraws.push(
        parts.draw(
          'submissionCode',
          problemBody,
          (submissionCode, into, rollback) => ({
            element: submissionCode(
              into,
              {
                time: localTime(shown.time),
                verdictLabel: VERDICT_NAMES[shown.verdict],
              },
              {
                ...kitFor('problem', rollback),
                document: documentSlot(htmlOf(cppFence(shown.code)), rollback),
              },
            ),
          }),
        ),
      );
      return;
    }
    if (rows.length === 0) {
      problemDraws.push(
        parts.draw('empty', problemBody, (empty, into, rollback) => ({
          element: empty(
            into,
            { reason: 'noSubmissions', filter: '', message: null },
            kitFor('problem', rollback),
          ),
        })),
      );
      return;
    }
    const list = appended(
      problemBody,
      element('ol', 'practice-submission-rows'),
    );
    rows.forEach((record, index) => {
      const drawn = parts.draw(
        'submissionRow',
        list,
        (submissionRow, into, rollback) => ({
          element: submissionRow(
            into,
            submissionRowInput(record),
            kitFor('problem', rollback),
          ),
        }),
      );
      problemDraws.push(drawn);
      const root = drawn.built.element;
      rowAction(root, () =>
        deps.runKey(practiceOpenSubmissionRowCommand, record.time),
      );
      const isCursor = index === state.submissionCursor;
      root.classList.toggle('is-selected', isCursor);
      root.classList.toggle('is-cursor', isCursor && pane === 'problem');
    });
    list.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  };

  // A box tab's part with its box; a box the part leaves out is appended at
  // the end of its root, so `i` always reaches it.
  const drawBoxTab = (
    key: 'notesTab' | 'testcaseTab',
    id: BoxId,
    parent: HTMLElement,
  ): DrawnRoot =>
    parts.draw(key, parent, (boxTab, into, rollback) => {
      const textBox = textBoxSlot(id, rollback);
      const root = boxTab(into, {
        ...kitFor(paneOfBox(id), rollback),
        textBox,
      });
      if (!boxes.isPlaced(id)) {
        textBox(root);
      }
      return { element: root };
    });

  const drawConsoleTab = (state: WorkspaceState, problem: OpenedProblem) => {
    if (state.consoleTab === 'testcase') {
      consoleDraws.push(drawBoxTab('testcaseTab', 'customCases', consoleBody));
      return;
    }
    const failingSlot = element('div', 'practice-failing-case');
    consoleDraws.push(
      parts.draw('resultTab', consoleBody, (resultTab, into, rollback) => {
        const failing = appSlot(failingSlot, 'failingCase', rollback);
        const root = resultTab(into, resultInput(state.judge), {
          ...kitFor('console', rollback),
          failingCase: failing.place,
        });
        failing.placeIfLeftOut(root);
        return { element: root };
      }),
    );
    const failingCase =
      state.judge.state === 'done' ? state.judge.result.failing : null;
    if (failingCase === null) {
      return;
    }
    consoleDraws.push(
      parts.draw('caseResult', failingSlot, (caseResult, into, rollback) => ({
        element: caseResult(
          into,
          {
            label: `Case ${String(failingCase.index + 1)}`,
            source: failingCase.source,
            input: caseInputText(problem.signature, failingCase.input),
            expected: valueText(failingCase.expected),
            output:
              failingCase.output === null
                ? 'No output'
                : valueText(failingCase.output),
            stdout: failingCase.stdout,
          },
          kitFor('console', rollback),
        ),
      })),
    );
  };

  // Draws each pane's shown tab again when what it shows changed, keeping
  // the focused box focused.
  const drawBodies = (state: WorkspaceState) => {
    const { problem } = state;
    const problemKey = problem === null ? null : problemTabKey(state, problem);
    const consoleKey = problem === null ? null : consoleTabKey(state, problem);
    if (problemKey === drawnProblemKey && consoleKey === drawnConsoleKey) {
      return;
    }
    keepFocusedBox(boxes, FORM_ID, () => {
      if (problemKey !== drawnProblemKey) {
        drawnProblemKey = problemKey;
        const heldProblemDraws = problemDraws;
        problemDraws = [];
        disposeDraws(heldProblemDraws);
        problemBody.replaceChildren();
        if (problem !== null) {
          drawProblemTab(state, problem);
        }
      }
      if (consoleKey !== drawnConsoleKey) {
        drawnConsoleKey = consoleKey;
        const heldConsoleDraws = consoleDraws;
        consoleDraws = [];
        disposeDraws(heldConsoleDraws);
        consoleBody.replaceChildren();
        if (problem !== null) {
          drawConsoleTab(state, problem);
        }
      }
    });
  };

  // ── The confirm ────────────────────────────────────────────────────────
  const prompt = createConfirmPrompt({
    title: 'Open the solution?',
    body: 'This attempt counts as peeked, and the problem goes back to the first review step.',
    keep: { label: 'Keep solving', command: qualify(PLUGIN_ID, 'confirmNo') },
    confirm: { label: 'Open it', command: qualify(PLUGIN_ID, 'confirmYes') },
    scope: qualify(PLUGIN_ID, 'confirm'),
    keys: deps.keys,
    run: deps.run,
    pushScope: () => deps.pushScope('confirm'),
    isAsked: () => store.get().peek.status === 'asked',
    isSending: () => false,
    dismiss: () => dispatch({ type: 'confirmNo' }),
    log,
    drawFrame: (parent, input) =>
      parts.redraw(
        'dialogFrame',
        parent,
        (dialogFrame, into, rollback) =>
          requireDialogFrame(
            dialogFrame(into, input, kitFor('confirm', rollback)),
            input,
            'dialogFrame',
          ),
        'dialogFrame:confirm',
      ).built,
    drawBody(body, promptParts) {
      parts.redraw('confirmBody', body, (confirmBody, into, rollback) => ({
        element: confirmBody(
          into,
          { body: promptParts.body },
          {
            ...kitFor('confirm', rollback),
            keepButton: promptParts.keepButton,
            confirmButton: promptParts.confirmButton,
          },
        ),
      }));
    },
  });
  deps.addOverlay(prompt.element);

  const syncPrompt = (state: WorkspaceState) => {
    const isAsked = state.peek.status === 'asked';
    if (isAsked === isPromptShown) {
      return;
    }
    isPromptShown = isAsked;
    if (isAsked) {
      log('solution confirm asked');
    }
    prompt.setBaseScope(() => deps.paneChanged());
  };

  // ── Render ─────────────────────────────────────────────────────────────
  const render = () => {
    if (isDisposed) {
      return;
    }
    const state = store.get();
    for (const [id, node] of problemTabs) {
      node.classList.toggle('is-active', id === state.problemTab);
    }
    for (const [id, node] of consoleTabs) {
      node.classList.toggle('is-active', id === state.consoleTab);
    }
    if (state.problemTab !== loggedProblemTab) {
      loggedProblemTab = state.problemTab;
      log(`problem tab ${TAB_TITLES[state.problemTab]}`);
    }
    drawBodies(state);
    const code = state.drafts.code;
    saveStateLabel.textContent =
      state.problem === null ? '' : saveLabel(saveState(code), code.saveError);
    syncPrompt(state);
    notePlace(state);
  };
  drawPanes();
  store.subscribe(render);

  // ── Saving ─────────────────────────────────────────────────────────────
  const saveText = (id: DraftId, slug: string, text: string): Promise<void> => {
    switch (id) {
      case 'code':
        return channel.invoke('saveCode', slug, text);
      case 'notes':
        return channel.invoke('saveNotes', slug, text);
      case 'customCases':
        return channel.invoke('saveCustomCases', slug, text);
    }
  };

  const autosave: Disposable = startAutosave<Draft, Draft>({
    subscribe: (listener) => store.subscribe(listener),
    drafts() {
      const state = store.get();
      return state.problem === null
        ? []
        : DRAFT_IDS.map((id) => state.drafts[id]);
    },
    idOf: draftKey,
    bodyOf: (draft) => draft,
    saveStarted(key, revision) {
      dispatch({ type: 'saveStarted', ...parseDraftKey(key), revision });
    },
    saveFinished(key, revision, error) {
      const { id, slug } = parseDraftKey(key);
      dispatch({ type: 'saveFinished', id, slug, revision, error });
      if (error === null) {
        log(SAVED_LINES[id]);
      }
    },
    save: (_key, draft) => saveText(draft.id, draft.slug, draft.text),
    delayMs: () => AUTOSAVE_DELAY_MS,
    onPageHide,
    timers: deps.timers,
    log,
  });

  // Saves draft `id` now, as autosave's own save does, so its pending timer
  // later finds it saved; a failed save is toasted. Resolves false when it
  // failed.
  const saveNow = async (id: DraftId): Promise<boolean> => {
    const draft = store.get().drafts[id];
    if (saveState(draft) === 'saved') {
      return true;
    }
    const { slug, revision, text } = draft;
    dispatch({ type: 'saveStarted', id, slug, revision });
    try {
      await saveText(id, slug, text);
    } catch (error) {
      if (isDisposed) {
        return false;
      }
      const message = errorText(error);
      dispatch({ type: 'saveFinished', id, slug, revision, error: message });
      log(`draft not saved for ${id}: ${message}`);
      deps.toast(message, 'error');
      return false;
    }
    if (isDisposed) {
      return true;
    }
    dispatch({ type: 'saveFinished', id, slug, revision, error: null });
    log(SAVED_LINES[id]);
    return true;
  };

  const saveAllNow = async (ids: readonly DraftId[]): Promise<boolean> => {
    const saved = await Promise.all(ids.map(saveNow));
    return saved.every(Boolean);
  };

  // ── Opening ────────────────────────────────────────────────────────────
  // `settledShow` is the last `show` that showed or kept, or the count a
  // `refresh` took to drop a waiting one; while `showCount` is ahead of it, a
  // show waits on a save.
  let showCount = 0;
  let settledShow = 0;

  const buildEditor = (problem: OpenedProblem) => {
    docEditor?.destroy();
    const slug = problem.summary.slug;
    docEditor = deps.editor.createDocument(
      editorSlot,
      problem.code,
      { fileName: CODE_FILE, readOnly: false, line: 1 },
      {
        changed: (text) =>
          dispatch({ type: 'draftChanged', id: 'code', slug, text }),
        write: () => void saveNow('code'),
        writeQuit() {
          void saveNow('code').then(() => {
            if (!isDisposed) {
              setPane('problem', { movesFocus: true });
            }
          });
        },
        quit: () => setPane('problem', { movesFocus: true }),
        modeChanged: () => undefined,
      },
    );
  };

  // The saved place, once, when `slug` is its open problem.
  const takeSavedPlace = (slug: string): PracticePlace | null => {
    const place = savedPlace;
    savedPlace = null;
    return place?.openSlug === slug ? place : null;
  };

  // ── Judging and peeking ────────────────────────────────────────────────
  let isJudging = false;
  let isPeeking = false;

  const judge = async (kind: JudgeKind) => {
    const { problem } = store.get();
    if (problem === null) {
      log('no problem open');
      deps.toast('Open a problem first', 'info');
      return;
    }
    if (isJudging) {
      log('judge busy');
      return;
    }
    const slug = problem.summary.slug;
    const judgedShow = showCount;
    isJudging = true;
    try {
      const isSaved = await saveAllNow(
        kind === 'run' ? ['code', 'customCases'] : ['code'],
      );
      if (!isSaved || isDisposed) {
        return;
      }
      dispatch({ type: 'judgeStarted', kind });
      log(`${kind} started ${slug}`);
      let result;
      try {
        result =
          kind === 'run'
            ? await channel.invoke('run', slug)
            : await channel.invoke('submit', slug);
      } catch (error) {
        if (isDisposed) {
          return;
        }
        dispatch({ type: 'judgeFailed', slug, message: errorText(error) });
        log(`${kind} failed ${slug}: ${errorText(error)}`);
        return;
      }
      if (isDisposed) {
        return;
      }
      dispatch({ type: 'judgeDone', slug, result });
      log(
        `${kind} ${slug}: ${result.verdict} ${String(result.passed)}/${String(result.total)}`,
      );
    } finally {
      isJudging = false;
    }
    if (kind === 'submit' && !isDisposed) {
      await reopen(slug, judgedShow);
    }
  };

  // Reads `slug` again after a Submit, so the Submissions tab and the summary
  // show the new record. Dropped once a `show` after `judgedShow` began, or
  // the dispose.
  const reopen = async (slug: string, judgedShow: number) => {
    let problem: OpenedProblem;
    const mark = draftMark(store.get());
    try {
      problem = await channel.invoke('open', slug);
    } catch (error) {
      if (!isDisposed) {
        log(`not refreshed ${slug}: ${errorText(error)}`);
      }
      return;
    }
    const isStillShown =
      !isDisposed &&
      showCount === judgedShow &&
      store.get().problem?.summary.slug === slug;
    if (isStillShown) {
      deps.applyOpened(problem, mark);
    }
  };

  const fetchPeek = async (slug: string) => {
    isPeeking = true;
    try {
      const answer = await channel.invoke('peek', slug);
      if (isDisposed) {
        return;
      }
      const state = store.get();
      const isStillWanted =
        state.problem?.summary.slug === slug &&
        state.peek.status === 'fetching';
      log(`peeked ${slug}`);
      if (isStillWanted) {
        dispatch({ type: 'peeked', ...answer });
      }
    } catch (error) {
      if (isDisposed) {
        return;
      }
      log(`not peeked ${slug}: ${errorText(error)}`);
      deps.toast(errorText(error), 'error');
      dispatch({ type: 'peekFailed' });
    } finally {
      isPeeking = false;
    }
  };
  store.subscribe(() => {
    const { problem, peek } = store.get();
    if (problem !== null && peek.status === 'fetching' && !isPeeking) {
      void fetchPeek(problem.summary.slug);
    }
  });

  // ── Commands ───────────────────────────────────────────────────────────
  // `run` while a problem shows; nothing otherwise.
  const whileOpen = (run: (problem: OpenedProblem) => void) => (): void => {
    const { problem } = store.get();
    if (problem !== null) {
      run(problem);
    }
  };

  // The pane the tab keys act on: the console's tabs from the console, else
  // the problem pane's.
  const tabPane = (): 'problem' | 'console' =>
    pane === 'console' ? 'console' : 'problem';

  const isRowsShown = (state: WorkspaceState) =>
    state.problemTab === 'submissions' && !state.isSubmissionOpen;

  const scrollBody = (step: ScrollStep, direction: 1 | -1) => {
    const body = bodyOf(tabPane());
    const scroll = scrollContent(body, step, direction, textLineHeightPx(body));
    log(scrollText(`the ${tabPane()}`, step, direction, scroll));
  };
  const scrollBodyTo = (edge: ScrollEdge) => {
    scrollToEdge(bodyOf(tabPane()), edge);
    log(edgeText(`the ${tabPane()}`, edge));
  };

  // `j`/`k`/`gg`/`G`: the cursor on the Submissions rows, else a scroll.
  const paneMove = (to: 'down' | 'up' | 'top' | 'bottom') =>
    whileOpen(() => {
      if (tabPane() === 'problem' && isRowsShown(store.get())) {
        dispatch({ type: 'moveCursor', to });
        return;
      }
      if (to === 'down' || to === 'up') {
        scrollBody('line', to === 'down' ? 1 : -1);
        return;
      }
      scrollBodyTo(to === 'top' ? 'top' : 'end');
    });

  // The box the shown tab of the pane holding the keys holds, or null.
  const boxOfShownTab = (): BoxId | null => {
    const state = store.get();
    if (tabPane() === 'console') {
      return state.consoleTab === 'testcase' ? 'customCases' : null;
    }
    return state.problemTab === 'notes' ? 'notes' : null;
  };

  const commands: Record<WorkspaceCommand, () => void> = {
    run: () => void judge('run'),
    submit: () => void judge('submit'),
    nextTab: whileOpen(() => dispatch({ type: 'nextTab', pane: tabPane() })),
    prevTab: whileOpen(() => dispatch({ type: 'prevTab', pane: tabPane() })),
    paneDown: paneMove('down'),
    paneUp: paneMove('up'),
    paneTop: paneMove('top'),
    paneBottom: paneMove('bottom'),
    lineDown: whileOpen(() => scrollBody('line', 1)),
    lineUp: whileOpen(() => scrollBody('line', -1)),
    halfPageDown: whileOpen(() => scrollBody('halfPage', 1)),
    halfPageUp: whileOpen(() => scrollBody('halfPage', -1)),
    openSubmission: whileOpen(() => {
      if (isRowsShown(store.get())) {
        dispatch({ type: 'openSubmission', time: null });
      }
    }),
    closeSubmission: () => dispatch({ type: 'closeSubmission' }),
    editBox: whileOpen(() => {
      const id = boxOfShownTab();
      if (id === null) {
        log('no box on this tab');
        return;
      }
      boxes.focus(id);
    }),
    leaveBox() {
      const id = boxes.active();
      boxes.leave();
      if (id !== null && deps.hasKeys()) {
        bodyOf(paneOfBox(id)).focus();
      }
    },
    confirmYes: () => dispatch({ type: 'confirmYes' }),
    confirmNo: () => dispatch({ type: 'confirmNo' }),
  };

  return {
    element: workspaceRoot,
    interviewerSlot,
    setInterviewerShown: (isShown) => interviewerSplit.setEndHidden(!isShown),
    interviewerResizeTarget,
    interviewerDivider: interviewerSplit,
    async show(problem) {
      const count = ++showCount;
      const shown = store.get().problem;
      const isOtherProblem =
        shown !== null && shown.summary.slug !== problem.summary.slug;
      while (isOtherProblem && !isEveryDraftSaved(store.get())) {
        const isSaved = await saveAllNow(DRAFT_IDS);
        if (count !== showCount || isDisposed) {
          return 'overtaken';
        }
        if (!isSaved) {
          settledShow = count;
          return 'kept';
        }
      }
      settledShow = count;
      const place = takeSavedPlace(problem.summary.slug);
      if (isOtherProblem) {
        rendered.clear();
      }
      buildEditor(problem);
      dispatch({
        type: 'opened',
        problem,
        problemTab: place?.problemTab ?? 'description',
        consoleTab: place?.consoleTab ?? 'testcase',
      });
      setPane(place?.pane ?? 'problem', { always: true, movesFocus: true });
      return 'shown';
    },
    readMark: () => draftMark(store.get()),
    refresh(problem, mark) {
      const before = store.get();
      if (before.problem?.summary.slug !== problem.summary.slug) {
        return;
      }
      if (settledShow !== showCount) {
        showCount += 1;
        settledShow = showCount;
      }
      dispatch({ type: 'refreshed', problem, mark });
      const after = store.get();
      if (after.drafts.code.text !== before.drafts.code.text) {
        docEditor?.setText(after.drafts.code.text);
      }
      for (const id of ['notes', 'customCases'] as const) {
        if (after.drafts[id].text !== before.drafts[id].text) {
          boxReplaces[id] += 1;
        }
      }
      render();
    },
    pane: () => pane,
    focus: focusPane,
    focusTarget,
    resizeTarget,
    setLayouts(shown) {
      parts.setLayouts(shown);
      keepFocusedBox(boxes, FORM_ID, () => {
        drawPanes();
        drawnProblemKey = null;
        drawnConsoleKey = null;
        drawBodies(store.get());
      });
      prompt.redraw();
    },
    commands,
    showTab(id) {
      const isTab = (TAB_IDS as readonly string[]).includes(id);
      if (!isTab) {
        log(`no tab ${id}`);
        return;
      }
      if (store.get().problem !== null) {
        dispatch({ type: 'showTab', tab: id as ProblemTab | ConsoleTab });
      }
    },
    openSubmissionRow: (time) => dispatch({ type: 'openSubmission', time }),
    mayStop() {
      const state = store.get();
      const unsaved = unsavedDraft(state);
      return state.problem === null || unsaved === undefined
        ? null
        : `Practice is still saving ${DRAFT_FILES[unsaved]}`;
    },
    async saveDrafts() {
      if (store.get().problem !== null) {
        await saveAllNow(DRAFT_IDS);
      }
    },
    dispose() {
      isDisposed = true;
      const draws = [...problemDraws, ...consoleDraws];
      problemDraws = [];
      consoleDraws = [];
      const editor = docEditor;
      docEditor = null;
      callEach<() => void>(
        [
          () => autosave.dispose(),
          ...draws.map((draw) => () => draw.dispose()),
          () => boxes.destroyForm(FORM_ID),
          () => editor?.destroy(),
          ...[...actionAnchors].map((anchor) => () => anchor.dispose()),
          () => parts.dispose(),
          () => outer.dispose(),
          () => inner.dispose(),
          () => interviewerSplit.dispose(),
        ],
        (step) => step(),
      );
    },
  };
}

const TAB_IDS: readonly (ProblemTab | ConsoleTab)[] = [
  ...PROBLEM_TABS,
  ...CONSOLE_TABS,
];

// One tab of a strip, whose click runs `practice.showTab` with its id.
function tabFor(
  id: ProblemTab | ConsoleTab,
  deps: Pick<ProblemWorkspaceDeps, 'runKey'>,
): HTMLButtonElement {
  return tab(TAB_TITLES[id], () => deps.runKey(practiceShowTabCommand, id));
}

// The first draft not yet saved, or undefined when every one is.
function unsavedDraft(state: WorkspaceState): DraftId | undefined {
  return DRAFT_IDS.find((id) => saveState(state.drafts[id]) !== 'saved');
}

function isEveryDraftSaved(state: WorkspaceState): boolean {
  return unsavedDraft(state) === undefined;
}

function paneOfBox(id: BoxId): 'problem' | 'console' {
  return id === 'notes' ? 'problem' : 'console';
}

// Autosave's id of a draft: its id, a space, its problem's slug.
function draftKey(draft: Draft): string {
  return `${draft.id} ${draft.slug}`;
}

function parseDraftKey(key: string): { id: DraftId; slug: string } {
  const space = key.indexOf(' ');
  return {
    id: key.slice(0, space) as DraftId,
    slug: key.slice(space + 1),
  };
}

// `code` in a C++ fence longer than any run of backticks it holds.
function cppFence(code: string): string {
  const longestRun = Math.max(
    0,
    ...(code.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}cpp\n${code}\n${fence}`;
}

function solutionText(peek: { approach: string; reference: string }): string {
  return `${peek.approach}\n\n${cppFence(peek.reference)}`;
}

// An ISO 8601 time as local `YYYY-MM-DD HH:mm`.
function localTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function submissionRowInput(record: SubmissionRecord) {
  return {
    time: localTime(record.time),
    verdict: record.verdict,
    verdictLabel: VERDICT_NAMES[record.verdict],
    passed: record.passed,
    total: record.total,
    runtime: `${String(record.ms)} ms`,
  };
}

function resultInput(judge: JudgeState): ResultInput {
  const empty: ResultInput = {
    state: judge.state,
    kind: null,
    verdict: null,
    verdictLabel: null,
    passed: 0,
    total: 0,
    runtime: null,
    message: null,
    compileOutput: null,
    stderr: null,
  };
  switch (judge.state) {
    case 'empty':
      return empty;
    case 'running':
      return { ...empty, kind: judge.kind };
    case 'failed':
      return { ...empty, kind: judge.kind, message: judge.message };
    case 'done': {
      const { result } = judge;
      return {
        ...empty,
        kind: judge.kind,
        verdict: result.verdict,
        verdictLabel: VERDICT_NAMES[result.verdict],
        passed: result.passed,
        total: result.total,
        runtime: `${String(result.ms)} ms`,
        compileOutput: result.compileOutput,
        stderr:
          result.verdict === 'runtimeError'
            ? (result.failing?.stderr ?? null)
            : null,
      };
    }
  }
}
