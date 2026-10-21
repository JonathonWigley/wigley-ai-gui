import type { Log } from '../../../contracts/log';
import type {
  PageChannel,
  PushedScope,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import type {
  CreateKind,
  CreatePlace,
  DocsChannel,
  FolderEntry,
  IndexEntry,
} from '../contract';
import { baseName, tildePath } from '../doc-paths';
import { CREATE_KINDS, nameProblem, placesFor, skillFolder } from '../kinds';
import {
  COMPLETION_LIMIT,
  completeTyped,
  completionQuery,
  completions,
} from '../path-completion';
import {
  type DocChangeRecord,
  type DocsKeysFor,
  noPlaceText,
  provisionalEntry,
  renameRecord,
  trashQuestion,
} from './docs-state';
import { textBoxInput } from './text-box';

// The scopes the dialogs push over the view's pane scope.
export type DialogScope = 'picker' | 'box' | 'confirm';

export interface PickerRequest<T> {
  title: string;
  items: readonly T[];
  label(item: T): string;
  selected: number;
  chosen(item: T): void;
  // Escape, or the base scope changing under the list.
  cancelled?(): void;
}

// A list over the view, scope `docs.picker` pushed while it shows; the base
// scope changing under it cancels it.
export interface ListPicker {
  element: HTMLElement;
  open<T>(request: PickerRequest<T>): void;
  down(): void;
  up(): void;
  choose(): void;
  cancel(): void;
  // Closes the list without hearing a cancel.
  close(): void;
}

export function createListPicker(
  pushScope: () => PushedScope,
  log: Log,
): ListPicker {
  const overlay = element('div', 'docs-overlay');
  const dialog = element('div', 'dialog docs-picker');
  const title = element('h2', 'dialog-title');
  const list = element('ol', 'docs-picker-list');
  dialog.append(title, list);
  overlay.append(dialog);
  overlay.hidden = true;

  let labels: string[] = [];
  let cursor = 0;
  let chooseAt: ((index: number) => void) | null = null;
  let cancelled: (() => void) | null = null;
  let pushed: PushedScope | null = null;

  const draw = () => {
    list.replaceChildren(
      ...labels.map((label, index) => {
        const item = element('li', 'docs-picker-item', label);
        item.classList.toggle('is-cursor', index === cursor);
        item.addEventListener('mousedown', (event) => event.preventDefault());
        item.addEventListener('click', () => {
          cursor = index;
          picker.choose();
        });
        return item;
      }),
    );
    list.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
  };

  const hide = () => {
    overlay.hidden = true;
    chooseAt = null;
    cancelled = null;
    pushed?.pop();
    pushed = null;
  };

  const move = (by: 1 | -1) => {
    cursor = Math.min(Math.max(cursor + by, 0), labels.length - 1);
    draw();
  };

  const picker: ListPicker = {
    element: overlay,
    open(request) {
      if (pushed === null) {
        const scope = pushScope();
        scope.onBaseChanged(() => {
          if (pushed === scope) {
            picker.cancel();
          }
        });
        pushed = scope;
      }
      labels = request.items.map(request.label);
      cursor = Math.min(Math.max(request.selected, 0), labels.length - 1);
      chooseAt = (index) => request.chosen(request.items[index]);
      cancelled = request.cancelled ?? null;
      title.textContent = request.title;
      overlay.hidden = false;
      draw();
      log('docs', `picker shown: ${request.title}`);
    },
    down: () => move(1),
    up: () => move(-1),
    choose() {
      const chosen = chooseAt;
      if (chosen === null || labels.length === 0) {
        return;
      }
      const index = cursor;
      hide();
      chosen(index);
    },
    cancel() {
      if (chooseAt === null) {
        return;
      }
      const heard = cancelled;
      hide();
      heard?.();
    },
    close() {
      if (chooseAt !== null) {
        hide();
      }
    },
  };
  return picker;
}

interface BoxRequest {
  label: string;
  text: string;
  // Lists the typed folder's matches under the box, and Tab completes them.
  completes: boolean;
  // Enter: the box stays open until the request closes it.
  accept(text: string): Promise<void>;
  cancelled(): void;
}

// A one-line text box over the view, scope `docs.box` pushed while it shows,
// with the completion list under it for a path.
interface TextBox {
  element: HTMLElement;
  open(request: BoxRequest): void;
  isOpen(): boolean;
  complete(): void;
  accept(): void;
  cancel(): void;
  // Closes the box without hearing a cancel.
  close(): void;
}

interface TextBoxDeps {
  channel: PageChannel<DocsChannel>;
  homeDir: Promise<string>;
  log: Log;
  pushScope(): PushedScope;
  closed(): void;
}

function createTextBox(deps: TextBoxDeps): TextBox {
  const overlay = element('div', 'docs-overlay');
  const dialog = element('div', 'dialog docs-box-dialog');
  const label = element('h2', 'dialog-title');
  const input = textBoxInput('docs-box docs-path-box');
  const list = element('ol', 'docs-completion');
  dialog.append(label, input, list);
  overlay.append(dialog);
  overlay.hidden = true;
  list.hidden = true;

  let request: BoxRequest | null = null;
  let pushed: PushedScope | null = null;
  let isAccepting = false;
  // Each folder is listed once per open box.
  let listings = new Map<string, Promise<FolderEntry[]>>();

  const listing = (folder: string): Promise<FolderEntry[]> => {
    const known = listings.get(folder);
    if (known !== undefined) {
      return known;
    }
    const listed = deps.channel
      .invoke('listFolder', folder)
      .catch((error: unknown) => {
        deps.log('docs', `not listed ${folder}: ${errorText(error)}`);
        return [];
      });
    listings.set(folder, listed);
    return listed;
  };

  // The matches for `typed`, once its folder is listed.
  const matchesFor = async (typed: string) => {
    const query = completionQuery(typed, await deps.homeDir);
    return completions(await listing(query.folder), query.prefix);
  };

  // Draws the matches for the box's text, unless it changed meanwhile.
  const refresh = async () => {
    const shown = request;
    const typed = input.value;
    const matches = await matchesFor(typed);
    if (request !== shown || input.value !== typed) {
      return;
    }
    const texts = matches.slice(0, COMPLETION_LIMIT).map((match) => match.text);
    list.replaceChildren(
      ...texts.map((text) => element('li', 'docs-completion-item', text)),
    );
    list.hidden = texts.length === 0;
  };

  const refreshQuietly = () => {
    if (request?.completes === true) {
      refresh().catch((error) =>
        deps.log('docs', `completion failed: ${errorText(error)}`),
      );
    }
  };

  const hide = () => {
    overlay.hidden = true;
    list.hidden = true;
    list.replaceChildren();
    request = null;
    pushed?.pop();
    pushed = null;
    deps.closed();
  };

  const cursorToEnd = () =>
    input.setSelectionRange(input.value.length, input.value.length);

  input.addEventListener('input', refreshQuietly);

  const box: TextBox = {
    element: overlay,
    open(next) {
      if (pushed === null) {
        const scope = deps.pushScope();
        scope.onBaseChanged(() => {
          if (pushed === scope) {
            box.cancel();
          }
        });
        pushed = scope;
      }
      request = next;
      listings = new Map();
      isAccepting = false;
      label.textContent = next.label;
      input.value = next.text;
      overlay.hidden = false;
      list.hidden = true;
      input.focus();
      cursorToEnd();
      refreshQuietly();
    },
    isOpen: () => request !== null,
    complete() {
      const shown = request;
      if (shown === null || !shown.completes) {
        return;
      }
      const typed = input.value;
      matchesFor(typed)
        .then(async (matches) => {
          if (request !== shown || input.value !== typed) {
            return;
          }
          input.value = completeTyped(typed, matches);
          cursorToEnd();
          await refresh();
          deps.log('docs', `completed to ${input.value}`);
        })
        .catch((error) =>
          deps.log('docs', `completion failed: ${errorText(error)}`),
        );
    },
    accept() {
      const shown = request;
      if (shown === null || isAccepting) {
        return;
      }
      isAccepting = true;
      shown.accept(input.value).finally(() => {
        if (request === shown) {
          isAccepting = false;
        }
      });
    },
    cancel() {
      const shown = request;
      if (shown === null) {
        return;
      }
      hide();
      shown.cancelled();
    },
    close() {
      if (request !== null) {
        hide();
      }
    },
  };
  return box;
}

// A yes/no prompt over the view, scope `docs.confirm` pushed while it shows;
// the base scope changing under it answers no.
interface Confirm {
  element: HTMLElement;
  open(text: string, yes: () => void, no: () => void): void;
  yes(): void;
  no(): void;
  // Closes the prompt without an answer.
  close(): void;
}

function createConfirm(
  pushScope: () => PushedScope,
  closed: () => void,
): Confirm {
  const overlay = element('div', 'docs-overlay');
  const dialog = element('div', 'dialog docs-confirm');
  const text = element('p', 'docs-confirm-text');
  dialog.append(text);
  overlay.append(dialog);
  overlay.hidden = true;

  let answers: { yes(): void; no(): void } | null = null;
  let pushed: PushedScope | null = null;

  const hide = () => {
    answers = null;
    overlay.hidden = true;
    pushed?.pop();
    pushed = null;
    closed();
  };

  const answer = (pick: 'yes' | 'no') => {
    const held = answers;
    if (held !== null) {
      hide();
      held[pick]();
    }
  };

  const confirm: Confirm = {
    element: overlay,
    open(question, yes, no) {
      confirm.close();
      const scope = pushScope();
      scope.onBaseChanged(() => {
        if (pushed === scope) {
          answer('no');
        }
      });
      pushed = scope;
      answers = { yes, no };
      text.textContent = question;
      overlay.hidden = false;
    },
    yes: () => answer('yes'),
    no: () => answer('no'),
    close() {
      if (answers !== null) {
        hide();
      }
    },
  };
  return confirm;
}

const CREATE_KIND_TITLES: Record<CreateKind, string> = {
  instructions: 'instructions',
  rule: 'rule',
  skill: 'skill',
  subagent: 'subagent',
  command: 'command',
  learning: 'learning',
  reference: 'reference',
  'feature-doc': 'feature doc',
  followup: 'follow-up',
};

export interface DocsDialogsDeps {
  channel: PageChannel<DocsChannel>;
  homeDir: Promise<string>;
  toast(text: string, tone: ToastTone): void;
  log: Log;
  keysFor: DocsKeysFor;
  pushScope(scope: DialogScope): PushedScope;
  // The view's entries now.
  entries(): readonly IndexEntry[];
  // Applies a change main made; `selectPath` names the doc to select after
  // a rename.
  changed(record: DocChangeRecord, selectPath: string | null): void;
  // Opens the entry's file in the view's document editor at `line`.
  openInEditor(entry: IndexEntry, line: number): Promise<void>;
  // Focus goes back to the view's pane once a dialog closes.
  dialogClosed(): void;
}

// The view's dialogs: the list picker, the name and path boxes and the Trash
// confirm, and the create, rename and trash flows that run through them and
// main. Each flow's refusals before a dialog opens are the view's.
export interface DocsDialogs {
  elements: HTMLElement[];
  picker: ListPicker;
  createByKind(): void;
  // The path box prefilled with `folder`, the home folder when null.
  createByPath(folder: string | null): void;
  rename(entry: IndexEntry): void;
  trash(entry: IndexEntry): void;
  isBoxOpen(): boolean;
  boxComplete(): void;
  boxAccept(): void;
  boxCancel(): void;
  confirmYes(): void;
  confirmNo(): void;
  // Closes every dialog without hearing a cancel.
  close(): void;
}

export function createDocsDialogs(deps: DocsDialogsDeps): DocsDialogs {
  const { channel, log, toast } = deps;
  const picker = createListPicker(() => deps.pushScope('picker'), log);
  const box = createTextBox({
    channel,
    homeDir: deps.homeDir,
    log,
    pushScope: () => deps.pushScope('box'),
    closed: deps.dialogClosed,
  });
  const confirm = createConfirm(
    () => deps.pushScope('confirm'),
    deps.dialogClosed,
  );

  const createCancelled = () => log('docs', 'create cancelled');

  const failed = (error: unknown) => toast(errorText(error), 'error');

  const pickPlace = async (kind: CreateKind) => {
    const kindTitle = CREATE_KIND_TITLES[kind];
    const places = placesFor(kind, deps.entries(), await deps.homeDir);
    if (places.length === 0) {
      toast(
        noPlaceText(kindTitle, deps.keysFor('createByPath', 'tree')),
        'info',
      );
      createCancelled();
      deps.dialogClosed();
      return;
    }
    picker.open({
      title: `Place for the ${kindTitle}`,
      items: places,
      label: (place) => place.title,
      selected: 0,
      chosen: (place) => nameDoc(kind, place),
      cancelled: () => {
        createCancelled();
        deps.dialogClosed();
      },
    });
    log('docs', `create ${kindTitle}: pick a place`);
  };

  const nameDoc = (kind: CreateKind, place: CreatePlace) => {
    const kindTitle = CREATE_KIND_TITLES[kind];
    box.open({
      label: kind === 'followup' ? 'Title' : 'Name',
      text: '',
      completes: false,
      accept: async (name) => {
        const problem = nameProblem(kind, name);
        if (problem !== null) {
          toast(problem, 'error');
          return;
        }
        try {
          const created = await channel.invoke('createDoc', {
            type: 'kind',
            kind,
            place,
            name,
          });
          box.close();
          const entry =
            kind === 'followup'
              ? followupEntry(
                  created.path,
                  created.line,
                  name.trim(),
                  deps.entries(),
                )
              : provisionalEntry(created.path, kind, deps.entries());
          deps.changed({ type: 'created', entry }, null);
          await deps.openInEditor(entry, created.line);
          log(
            'docs',
            kind === 'followup'
              ? `created follow-up ${name.trim()}`
              : `created ${baseName(created.path)}`,
          );
        } catch (error) {
          failed(error);
        }
      },
      cancelled: createCancelled,
    });
    log('docs', `create ${kindTitle}: name it`);
  };

  const dialogs: DocsDialogs = {
    elements: [picker.element, box.element, confirm.element],
    picker,
    createByKind() {
      picker.open({
        title: 'New doc by kind',
        items: CREATE_KINDS,
        label: (kind) => CREATE_KIND_TITLES[kind],
        selected: 0,
        chosen: (kind) => {
          pickPlace(kind).catch(failed);
        },
        cancelled: () => {
          createCancelled();
          deps.dialogClosed();
        },
      });
      log('docs', 'create: pick a kind');
    },
    createByPath(folder) {
      void deps.homeDir.then((homeDir) => {
        box.open({
          label: 'New file',
          text: `${tildePath(folder ?? homeDir, homeDir)}/`,
          completes: true,
          accept: async (path) => {
            try {
              const created = await channel.invoke('createDoc', {
                type: 'path',
                path,
              });
              box.close();
              const entry = provisionalEntry(
                created.path,
                null,
                deps.entries(),
              );
              deps.changed({ type: 'created', entry }, null);
              await deps.openInEditor(entry, created.line);
              log('docs', `created ${baseName(created.path)}`);
            } catch (error) {
              failed(error);
            }
          },
          cancelled: createCancelled,
        });
        log('docs', 'create by path: type the path');
      });
    },
    rename(entry) {
      void deps.homeDir.then((homeDir) => {
        box.open({
          label: 'Rename to',
          text: tildePath(entry.path, homeDir),
          completes: true,
          accept: async (typed) => {
            try {
              const renamed = await channel.invoke(
                'renameDoc',
                entry.path,
                typed,
              );
              box.close();
              const record = renameRecord(entry.path, renamed);
              deps.changed(record, renamed);
              log(
                'docs',
                `renamed ${baseName(record.from)} to ${baseName(record.to)}`,
              );
            } catch (error) {
              failed(error);
            }
          },
          cancelled: () => log('docs', 'rename cancelled'),
        });
        log('docs', 'rename: type the new path');
      });
    },
    trash(entry) {
      const skill = skillFolder(entry.path);
      const name = baseName(skill ?? entry.path);
      confirm.open(
        trashQuestion(name, {
          yes: deps.keysFor('confirmYes', 'confirm'),
          no: deps.keysFor('confirmNo', 'confirm'),
        }),
        () => {
          channel
            .invoke('trashDoc', entry.path)
            .then((path) => {
              deps.changed({ type: 'trashed', path }, null);
              log('docs', `moved ${name} to the Trash`);
            })
            .catch(failed);
        },
        () => log('docs', `kept ${name}`),
      );
      log('docs', `asked to move ${name} to the Trash`);
    },
    isBoxOpen: () => box.isOpen(),
    boxComplete: () => box.complete(),
    boxAccept: () => box.accept(),
    boxCancel: () => box.cancel(),
    confirmYes: () => confirm.yes(),
    confirmNo: () => confirm.no(),
    close() {
      picker.close();
      box.close();
      confirm.close();
    },
  };
  return dialogs;
}

// The entry a follow-up appended at `line` of `path` gets until a build
// lists it.
function followupEntry(
  path: string,
  line: number,
  title: string,
  entries: readonly IndexEntry[],
): IndexEntry {
  return {
    ...provisionalEntry(path, 'followup', entries),
    id: `${path}#L${line}`,
    line,
    title,
    meta: { status: 'open', gist: '', section: null },
  };
}
