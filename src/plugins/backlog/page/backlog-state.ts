import type {
  FollowupDraft,
  FollowupItem,
} from '../../../shared/followups/followup-file';
import type {
  BacklogEdit,
  BacklogFeature,
  BacklogHome,
  BacklogPlan,
  BacklogRead,
  BacklogTask,
} from '../contract';

export const AGENT_READY = 'agent-ready';

// Where the list keys act: the side bar's homes, the open home's rows, or the
// detail pane.
export type BacklogFocus = 'homes' | 'items' | 'detail';

export type EditorField = 'title' | 'oneLine' | 'tags' | 'body';

export const EDITOR_FIELDS: readonly EditorField[] = [
  'title',
  'oneLine',
  'tags',
  'body',
];

// Each editor box's text; `tags` is comma-separated.
export type DraftTexts = Record<EditorField, string>;

// `path` and `baseline` are null for a create, which writes to `homeRoot`'s
// create target. `baseline` is the item as the editor opened it; `initial`
// the text the editor opened with.
export interface BacklogEditor {
  kind: 'create' | 'edit';
  homeRoot: string;
  path: string | null;
  baseline: FollowupDraft | null;
  initial: DraftTexts;
  draft: DraftTexts;
}

export type BacklogConfirm =
  | { kind: 'delete'; homeRoot: string; path: string; title: string }
  | { kind: 'discard' };

export interface BacklogState {
  homes: readonly BacklogHome[];
  message: string | null;
  isLoaded: boolean;
  focus: BacklogFocus;
  // An index into `orderedHomes`.
  homeCursor: number;
  openRoot: string | null;
  selectedKey: string | null;
  // The title of a follow-up to select once a load holds it: a save's reload
  // can land after the save asks for its row.
  pendingSelect: string | null;
  // The plan and feature paths whose task rows show.
  expanded: readonly string[];
  filter: string;
  isDoneShown: boolean;
  isAgentReadyOnly: boolean;
  editor: BacklogEditor | null;
  confirm: BacklogConfirm | null;
}

export type BacklogRow =
  | { kind: 'followup'; key: string; path: string; item: FollowupItem }
  | { kind: 'plan'; key: string; plan: BacklogPlan; isExpanded: boolean }
  | {
      kind: 'feature';
      key: string;
      feature: BacklogFeature;
      isExpanded: boolean;
    }
  | { kind: 'task'; key: string; task: BacklogTask };

export type BacklogAction =
  | { type: 'loaded'; read: BacklogRead }
  | { type: 'move'; to: 'down' | 'up' | 'top' | 'bottom' }
  | { type: 'open' }
  | { type: 'toggle' }
  | { type: 'back' }
  | { type: 'focus'; focus: BacklogFocus }
  | { type: 'openHome'; root: string }
  | { type: 'select'; key: string }
  | { type: 'selectFollowup'; title: string }
  | { type: 'setFilter'; text: string }
  | { type: 'toggleDone' }
  | { type: 'toggleAgentReadyOnly' }
  | { type: 'openCreate' }
  | { type: 'openEdit' }
  | { type: 'draftChanged'; field: EditorField; text: string }
  | { type: 'closeEditor' }
  | { type: 'askDelete' }
  | { type: 'askDiscard' }
  | { type: 'dismissConfirm' };

export function initialBacklogState(): BacklogState {
  return {
    homes: [],
    message: null,
    isLoaded: false,
    focus: 'homes',
    homeCursor: 0,
    openRoot: null,
    selectedKey: null,
    pendingSelect: null,
    expanded: [],
    filter: '',
    isDoneShown: false,
    isAgentReadyOnly: false,
    editor: null,
    confirm: null,
  };
}

// The homes in side bar order: grouped by repo, each repo where its first
// home falls in the read.
export function orderedHomes(state: BacklogState): BacklogHome[] {
  const repos = [...new Set(state.homes.map((home) => home.repo))];
  return repos.flatMap((repo) =>
    state.homes.filter((home) => home.repo === repo),
  );
}

export function openHome(state: BacklogState): BacklogHome | null {
  return state.homes.find((home) => home.root === state.openRoot) ?? null;
}

// The home the change keys act on: the side bar's cursor home while the side
// bar has focus, else the open home.
export function actedHome(state: BacklogState): BacklogHome | null {
  if (state.focus === 'homes') {
    return orderedHomes(state)[state.homeCursor] ?? null;
  }
  return openHome(state);
}

export function selectedRow(state: BacklogState): BacklogRow | null {
  return (
    visibleRows(state).find((row) => row.key === state.selectedKey) ?? null
  );
}

// The selected row when it is a follow-up.
export function selectedFollowup(
  state: BacklogState,
): Extract<BacklogRow, { kind: 'followup' }> | null {
  const row = selectedRow(state);
  return row?.kind === 'followup' ? row : null;
}

// The row the row keys act on: the selected row while focus is off the side
// bar.
export function actedRow(state: BacklogState): BacklogRow | null {
  return state.focus === 'homes' ? null : selectedRow(state);
}

// The follow-up the follow-up keys act on: the selected follow-up while focus
// is off the side bar.
export function actedFollowup(
  state: BacklogState,
): Extract<BacklogRow, { kind: 'followup' }> | null {
  return state.focus === 'homes' ? null : selectedFollowup(state);
}

export function rowTitle(row: BacklogRow): string {
  switch (row.kind) {
    case 'followup':
      return row.item.title;
    case 'plan':
      return row.plan.title;
    case 'feature':
      return row.feature.slug;
    case 'task':
      return row.task.title;
  }
}

// The open home's rows in list order: follow-ups, then plans, then features,
// each expanded plan or feature followed by its task rows. Done follow-ups
// show only while `isDoneShown`; `isAgentReadyOnly` keeps only follow-ups
// tagged `agent-ready`. The filter matches a follow-up's title, one line or
// tags, a plan's title or feature, and a feature's slug, ignoring case.
export function visibleRows(state: BacklogState): BacklogRow[] {
  const home = openHome(state);
  if (home === null) {
    return [];
  }
  const query = state.filter.toLowerCase();
  const matches = (...texts: string[]) =>
    texts.some((text) => text.toLowerCase().includes(query));
  const rows: BacklogRow[] = [];
  for (const file of home.followupFiles) {
    for (const item of file.items) {
      const isDoneHidden = item.done && !state.isDoneShown;
      const isUntaggedHidden =
        state.isAgentReadyOnly && !item.tags.includes(AGENT_READY);
      if (
        isDoneHidden ||
        isUntaggedHidden ||
        !matches(item.title, item.oneLine, ...item.tags)
      ) {
        continue;
      }
      rows.push({
        kind: 'followup',
        key: followupKey(file.path, item.title),
        path: file.path,
        item,
      });
    }
  }
  if (state.isAgentReadyOnly) {
    return rows;
  }
  for (const plan of home.plans) {
    if (!matches(plan.title, plan.feature)) {
      continue;
    }
    const isExpanded = state.expanded.includes(plan.path);
    rows.push({ kind: 'plan', key: docKey(plan.path), plan, isExpanded });
    rows.push(...taskRows(plan.tasks, isExpanded));
  }
  for (const feature of home.features) {
    if (!matches(feature.slug)) {
      continue;
    }
    const isExpanded = state.expanded.includes(feature.path);
    rows.push({
      kind: 'feature',
      key: docKey(feature.path),
      feature,
      isExpanded,
    });
    rows.push(...taskRows(feature.tasks, isExpanded));
  }
  return rows;
}

// The tags a Tags box's comma-separated text names, trimmed, empties dropped.
export function tagsOf(text: string): string[] {
  return text
    .split(',')
    .map((each) => each.trim())
    .filter((each) => each !== '');
}

// `tags` with `tag` removed when present, else appended; the others keep
// their order.
export function withTagToggled(tags: readonly string[], tag: string): string[] {
  return tags.includes(tag)
    ? tags.filter((each) => each !== tag)
    : [...tags, tag];
}

// The draft the editor's boxes hold. The title, one line and tags take one
// line, so a line break typed in one of them joins the lines with a space.
export function draftOf(texts: DraftTexts): FollowupDraft {
  const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim();
  return {
    title: oneLine(texts.title),
    oneLine: oneLine(texts.oneLine),
    tags: tagsOf(oneLine(texts.tags)),
    body: texts.body.trim(),
  };
}

// The write the editor's save sends: a create, or an edit of the item it
// opened carrying that item as its baseline.
export function editorEdit(
  editor: BacklogEditor,
): Extract<BacklogEdit, { type: 'create' | 'edit' }> {
  const draft = draftOf(editor.draft);
  const { baseline } = editor;
  return baseline === null
    ? { type: 'create', draft }
    : { type: 'edit', title: baseline.title, draft, baseline };
}

// Why the open home shows no rows, for the empty list's text.
// `agentReadyNone`: the agent-ready toggle hides every row; `allDone`: every
// follow-up is done and done ones are hidden.
export type EmptyReason =
  | 'noHome'
  | 'filter'
  | 'allDone'
  | 'agentReadyNone'
  | 'nothing';

// Null while a row shows.
export function emptyReason(state: BacklogState): EmptyReason | null {
  const home = openHome(state);
  if (home === null) {
    return 'noHome';
  }
  if (visibleRows(state).length > 0) {
    return null;
  }
  if (state.filter !== '') {
    return 'filter';
  }
  const items = home.followupFiles.flatMap((file) => file.items);
  const isEveryFollowupDone =
    items.length > 0 && items.every((item) => item.done);
  if (isEveryFollowupDone && !state.isDoneShown) {
    return 'allDone';
  }
  return state.isAgentReadyOnly ? 'agentReadyNone' : 'nothing';
}

export function isDraftChanged(editor: BacklogEditor): boolean {
  return EDITOR_FIELDS.some(
    (field) => editor.draft[field] !== editor.initial[field],
  );
}

export function backlogReducer(
  state: BacklogState,
  action: BacklogAction,
): BacklogState {
  switch (action.type) {
    case 'loaded':
      return loaded(state, action.read);
    case 'move':
      return move(state, action.to);
    case 'open':
      return openOrStepIn(state);
    case 'toggle':
      return toggle(state);
    case 'back':
      return back(state);
    case 'focus':
      return focusOn(state, action.focus);
    case 'openHome':
      return openHomeAt(state, action.root);
    case 'select':
      return { ...state, selectedKey: action.key };
    case 'selectFollowup':
      return selectPending({ ...state, pendingSelect: action.title });
    case 'setFilter':
      return reselect(state, { ...state, filter: action.text });
    case 'toggleDone':
      return reselect(state, { ...state, isDoneShown: !state.isDoneShown });
    case 'toggleAgentReadyOnly':
      return reselect(state, {
        ...state,
        isAgentReadyOnly: !state.isAgentReadyOnly,
      });
    case 'openCreate':
      return openCreate(state);
    case 'openEdit':
      return openEdit(state);
    case 'draftChanged':
      return state.editor === null
        ? state
        : {
            ...state,
            editor: {
              ...state.editor,
              draft: { ...state.editor.draft, [action.field]: action.text },
            },
          };
    case 'closeEditor':
      return state.editor === null
        ? state
        : { ...state, editor: null, confirm: null, focus: 'items' };
    case 'askDelete': {
      const row = actedFollowup(state);
      const home = openHome(state);
      if (row === null || home === null || state.editor !== null) {
        return state;
      }
      return {
        ...state,
        confirm: {
          kind: 'delete',
          homeRoot: home.root,
          path: row.path,
          title: row.item.title,
        },
      };
    }
    case 'askDiscard':
      return state.editor === null
        ? state
        : { ...state, confirm: { kind: 'discard' } };
    case 'dismissConfirm':
      return state.confirm === null ? state : { ...state, confirm: null };
  }
}

function followupKey(path: string, title: string): string {
  return `followup:${path}#${title}`;
}

function docKey(path: string): string {
  return `doc:${path}`;
}

function taskRows(
  tasks: readonly BacklogTask[],
  isExpanded: boolean,
): BacklogRow[] {
  if (!isExpanded) {
    return [];
  }
  return tasks.map((task) => ({ kind: 'task', key: docKey(task.path), task }));
}

function clampIndex(index: number, count: number): number {
  return Math.max(0, Math.min(count - 1, index));
}

// Keeps `next`'s selection when its row still shows; else selects the row
// now at the selected row's place in `previous`, clamped, or nothing.
function reselect(previous: BacklogState, next: BacklogState): BacklogState {
  const rows = visibleRows(next);
  if (rows.some((row) => row.key === next.selectedKey)) {
    return next;
  }
  const previousIndex = visibleRows(previous).findIndex(
    (row) => row.key === previous.selectedKey,
  );
  const index = clampIndex(Math.max(previousIndex, 0), rows.length);
  return { ...next, selectedKey: rows[index]?.key ?? null };
}

// Selects the visible follow-up titled `pendingSelect` and clears it; with
// none showing, `pendingSelect` waits for the next load.
function selectPending(state: BacklogState): BacklogState {
  const found = visibleRows(state).find(
    (row) => row.kind === 'followup' && row.item.title === state.pendingSelect,
  );
  return found === undefined
    ? state
    : { ...state, selectedKey: found.key, pendingSelect: null };
}

// The open home stays open while the read still holds it; the side bar's
// cursor stays on its home, else on its place, clamped. A pending follow-up
// is selected when the read holds it, and is cleared either way.
function loaded(state: BacklogState, read: BacklogRead): BacklogState {
  const cursorRoot = orderedHomes(state)[state.homeCursor]?.root ?? null;
  const next: BacklogState = {
    ...state,
    homes: read.homes,
    message: read.message,
    isLoaded: true,
  };
  const homes = orderedHomes(next);
  const cursorIndex = homes.findIndex((home) => home.root === cursorRoot);
  next.homeCursor = clampIndex(
    cursorIndex === -1 ? state.homeCursor : cursorIndex,
    homes.length,
  );
  const isOpenHomeGone = state.openRoot !== null && openHome(next) === null;
  if (isOpenHomeGone) {
    return {
      ...next,
      openRoot: null,
      selectedKey: null,
      pendingSelect: null,
      focus: state.editor === null ? 'homes' : state.focus,
    };
  }
  const reselected = reselect(state, next);
  if (state.pendingSelect === null) {
    return reselected;
  }
  return { ...selectPending(reselected), pendingSelect: null };
}

function move(
  state: BacklogState,
  to: 'down' | 'up' | 'top' | 'bottom',
): BacklogState {
  const step = (index: number, count: number): number => {
    switch (to) {
      case 'down':
        return clampIndex(index + 1, count);
      case 'up':
        return clampIndex(index - 1, count);
      case 'top':
        return 0;
      case 'bottom':
        return count - 1;
    }
  };
  if (state.focus === 'homes') {
    const count = orderedHomes(state).length;
    return count === 0
      ? state
      : { ...state, homeCursor: step(state.homeCursor, count) };
  }
  if (state.focus !== 'items') {
    return state;
  }
  const rows = visibleRows(state);
  if (rows.length === 0) {
    return state;
  }
  const index = rows.findIndex((row) => row.key === state.selectedKey);
  return { ...state, selectedKey: rows[step(index, rows.length)].key };
}

// Opens `root` with focus on its rows; reopening the open home keeps its
// selection, and a newly opened home selects its first row.
function openHomeAt(state: BacklogState, root: string): BacklogState {
  const homes = orderedHomes(state);
  const index = homes.findIndex((home) => home.root === root);
  if (index === -1) {
    return state;
  }
  if (state.openRoot === root) {
    return { ...state, homeCursor: index, focus: 'items' };
  }
  const next: BacklogState = {
    ...state,
    homeCursor: index,
    openRoot: root,
    focus: 'items',
    filter: '',
    expanded: [],
  };
  return { ...next, selectedKey: visibleRows(next)[0]?.key ?? null };
}

function setExpanded(
  state: BacklogState,
  path: string,
  isExpanded: boolean,
): BacklogState {
  const others = state.expanded.filter((each) => each !== path);
  return { ...state, expanded: isExpanded ? [...others, path] : others };
}

function expandablePath(row: BacklogRow): string | null {
  if (row.kind === 'plan') {
    return row.plan.path;
  }
  return row.kind === 'feature' ? row.feature.path : null;
}

// `l`: on the homes, opens the cursor home. On a row: a collapsed plan or
// feature expands, an expanded one steps to its first task, and any other
// row, or one with no tasks, moves focus to the detail.
function openOrStepIn(state: BacklogState): BacklogState {
  if (state.focus === 'homes') {
    const home = orderedHomes(state)[state.homeCursor];
    return home === undefined ? state : openHomeAt(state, home.root);
  }
  const row = selectedRow(state);
  if (state.focus !== 'items' || row === null) {
    return state;
  }
  const path = expandablePath(row);
  if (path === null || hasNoTasks(row)) {
    return focusOn(state, 'detail');
  }
  if (!state.expanded.includes(path)) {
    return setExpanded(state, path, true);
  }
  const rows = visibleRows(state);
  const firstTask = rows[rows.indexOf(row) + 1];
  return firstTask?.kind === 'task'
    ? { ...state, selectedKey: firstTask.key }
    : state;
}

function hasNoTasks(row: BacklogRow): boolean {
  if (row.kind === 'plan') {
    return row.plan.tasks.length === 0;
  }
  return row.kind === 'feature' && row.feature.tasks.length === 0;
}

// Enter: on the homes, opens the cursor home. On a plan or feature, expands
// or collapses its task rows; on any other row, moves focus to the detail.
function toggle(state: BacklogState): BacklogState {
  if (state.focus === 'homes') {
    return openOrStepIn(state);
  }
  const row = selectedRow(state);
  if (state.focus !== 'items' || row === null) {
    return state;
  }
  const path = expandablePath(row);
  if (path === null) {
    return focusOn(state, 'detail');
  }
  return setExpanded(state, path, !state.expanded.includes(path));
}

// `h` from the rows returns focus to the homes, the cursor on the open home.
function back(state: BacklogState): BacklogState {
  if (state.focus !== 'items') {
    return state;
  }
  const index = orderedHomes(state).findIndex(
    (home) => home.root === state.openRoot,
  );
  return {
    ...state,
    focus: 'homes',
    homeCursor: index === -1 ? state.homeCursor : index,
  };
}

// The detail takes focus only with a row selected.
function focusOn(state: BacklogState, focus: BacklogFocus): BacklogState {
  if (focus === 'detail' && selectedRow(state) === null) {
    return state;
  }
  return state.focus === focus ? state : { ...state, focus };
}

const EMPTY_DRAFT: DraftTexts = { title: '', oneLine: '', tags: '', body: '' };

// A create goes to the create target of the acted home's repo.
function openCreate(state: BacklogState): BacklogState {
  const acted = actedHome(state);
  if (acted === null || state.editor !== null) {
    return state;
  }
  const target = state.homes.find(
    (home) => home.repo === acted.repo && home.isCreateTarget,
  );
  if (target === undefined) {
    return state;
  }
  return {
    ...state,
    focus: 'detail',
    editor: {
      kind: 'create',
      homeRoot: target.root,
      path: null,
      baseline: null,
      initial: EMPTY_DRAFT,
      draft: EMPTY_DRAFT,
    },
  };
}

function openEdit(state: BacklogState): BacklogState {
  const row = actedFollowup(state);
  const home = openHome(state);
  if (row === null || home === null || state.editor !== null) {
    return state;
  }
  const { title, oneLine, tags, body } = row.item;
  const texts: DraftTexts = { title, oneLine, tags: tags.join(', '), body };
  return {
    ...state,
    focus: 'detail',
    editor: {
      kind: 'edit',
      homeRoot: home.root,
      path: row.path,
      baseline: { title, oneLine, tags, body },
      initial: texts,
      draft: texts,
    },
  };
}
