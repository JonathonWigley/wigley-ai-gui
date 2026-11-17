import type {
  ListPicker,
  ListPickerRequest,
} from '../../../contracts/list-picker';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type {
  PageChannel,
  PushedScope,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import { type ButtonVariant, textButton } from '../../../shared/page/ui/button';
import {
  createDialog,
  type DrawDialogFrame,
} from '../../../shared/page/ui/dialog';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import {
  type CreateKind,
  type CreatePlace,
  type DocsChannel,
  docsAnswerConfirmCommand,
  type FolderEntry,
  type IndexEntry,
} from '../contract';
import { CREATE_KINDS, nameProblem, placesFor } from '../kinds';
import {
  COMPLETION_LIMIT,
  completeTyped,
  completionQuery,
  completions,
} from '../path-completion';
import type { DocsKit } from '../layouts/layout';
import {
  type DocChangeRecord,
  noPlaceText,
  provisionalEntry,
  renameRecord,
  trashQuestion,
} from './docs-state';
import type { AppSlot } from '../../../shared/page/layout-host/app-slot';
import { type DocsParts, type DrawnPart } from './layout/docs-parts';
import { keepingFocusAndScroll } from '../../../shared/page/layout-host/keeping-focus';
import { textBoxInput } from '../../../shared/page/text-box';

// The scopes the dialogs push over the view's pane scope.
export type DialogScope = 'box' | 'confirm';

// Draws a dialog's frame through the layout's `dialogFrame` in `scope`,
// disposing the earlier draw once the next returns; `dispose` disposes the
// last draw.
interface FrameDrawer {
  draw: DrawDialogFrame;
  dispose(): void;
}

function frameDrawer(parts: DocsParts, scope: DialogScope): FrameDrawer {
  let last: { dispose(): void } | null = null;
  return {
    draw: (parent, input) => {
      const next = parts.dialogFrame(parent, input, scope);
      last?.dispose();
      last = next;
      return next.frame;
    },
    dispose() {
      last?.dispose();
      last = null;
    },
  };
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

// A one-line text box in a dialog, scope `docs.box` pushed while it shows,
// its body drawn by the layout's `boxDialog` around the app's input frame and
// completion list (in `default`, with the `⇥ complete` hint between them for
// a path), each completion a `completion` part.
interface TextBox {
  element: HTMLElement;
  open(request: BoxRequest): void;
  isOpen(): boolean;
  complete(): void;
  accept(): void;
  cancel(): void;
  // Closes the box without hearing a cancel.
  close(): void;
  // Draws the frame again, then the open box's body and completions.
  redraw(): void;
}

interface TextBoxDeps {
  channel: PageChannel<DocsChannel>;
  homeDir: string;
  paths: Paths;
  log: PluginLog;
  pushScope(): PushedScope;
  closed(): void;
  parts: DocsParts;
  drawFrame: DrawDialogFrame;
}

function createTextBox(deps: TextBoxDeps): TextBox {
  const dialog = createDialog('', { drawFrame: deps.drawFrame });
  const frame = inputFrame();
  const input = textBoxInput('docs-box');
  frame.append(input);
  const list = element('ol', 'docs-completion');
  list.hidden = true;
  let drawnBody: DrawnPart | null = null;
  let drawnCompletions: DrawnPart[] = [];
  // The completions shown under the box.
  let completionTexts: string[] = [];

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
        deps.log(`not listed ${folder}: ${errorText(error)}`);
        return [];
      });
    listings.set(folder, listed);
    return listed;
  };

  // The matches for `typed`, once its folder is listed.
  const matchesFor = async (typed: string) => {
    const query = completionQuery(typed, deps.homeDir, deps.paths);
    return completions(await listing(query.folder), query.prefix, deps.paths);
  };

  // Draws the body part around the input frame and the completion list; the
  // frame goes first and the list last when the part leaves them out.
  const drawBody = (shown: BoxRequest) => {
    drawnBody?.dispose();
    let placing: { textBox: AppSlot; completions: AppSlot } | null = null;
    drawnBody = deps.parts.draw(
      'boxDialog',
      dialog.body,
      { label: shown.label, completes: shown.completes },
      (kit, slotFor) => {
        const textBox = slotFor(frame, 'textBox');
        const completions = slotFor(list, 'completions');
        placing = { textBox, completions };
        return {
          ...kit,
          textBox: textBox.place,
          completions: completions.place,
        };
      },
    );
    const placed = placing as { textBox: AppSlot; completions: AppSlot } | null;
    placed?.textBox.placeIfLeftOut(drawnBody.element, 'start');
    placed?.completions.placeIfLeftOut(drawnBody.element);
  };

  const drawCompletions = () => {
    for (const drawn of drawnCompletions) {
      drawn.dispose();
    }
    drawnCompletions = completionTexts.map((text) =>
      deps.parts.draw('completion', list, { text }, (kit) => kit),
    );
    list.hidden = completionTexts.length === 0;
  };

  // Draws the matches for the box's text, unless it changed meanwhile.
  const refresh = async () => {
    const shown = request;
    const typed = input.value;
    const matches = await matchesFor(typed);
    if (request !== shown || input.value !== typed) {
      return;
    }
    completionTexts = matches
      .slice(0, COMPLETION_LIMIT)
      .map((match) => match.text);
    drawCompletions();
  };

  const refreshQuietly = () => {
    if (request?.completes === true) {
      refresh().catch((error) =>
        deps.log(`completion failed: ${errorText(error)}`),
      );
    }
  };

  const hide = () => {
    dialog.hide();
    completionTexts = [];
    drawCompletions();
    drawnBody?.dispose();
    drawnBody = null;
    request = null;
    pushed?.pop();
    pushed = null;
    deps.closed();
  };

  const cursorToEnd = () =>
    input.setSelectionRange(input.value.length, input.value.length);

  input.addEventListener('input', refreshQuietly);

  const box: TextBox = {
    element: dialog.element,
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
      dialog.setTitle(next.label);
      input.value = next.text;
      completionTexts = [];
      drawCompletions();
      drawBody(next);
      dialog.show();
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
          input.value = completeTyped(typed, matches, deps.paths);
          cursorToEnd();
          await refresh();
          deps.log(`completed to ${input.value}`);
        })
        .catch((error) => deps.log(`completion failed: ${errorText(error)}`));
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
    redraw() {
      dialog.redrawFrame();
      if (request === null) {
        return;
      }
      drawBody(request);
      drawCompletions();
    },
  };
  return box;
}

// A yes/no prompt in a dialog, scope `docs.confirm` pushed while it shows,
// its body and its answer buttons drawn by the layout's `confirmDialog` (in
// `default`, Keep it and Move to the Trash, each holding its key); a click
// answers as the key does, and the base scope changing under it answers no.
interface Confirm {
  element: HTMLElement;
  open(question: string, yes: () => void, no: () => void): void;
  isOpen(): boolean;
  yes(): void;
  no(): void;
  // Closes the prompt without an answer.
  close(): void;
  // Draws the frame again, then the open prompt's body and buttons.
  redraw(): void;
}

// A Trash answer: a button whose click runs `answer`, a `docs.answerConfirm`
// runner, and which holds the key hint of `command`, appended to `parent`.
function answerButton(
  kit: DocsKit,
  parent: HTMLElement,
  command: 'confirmYes' | 'confirmNo',
  label: string,
  variant: ButtonVariant | undefined,
  answer: () => void,
): HTMLButtonElement {
  const hint = kit.keyHint(parent, command);
  const button = textButton(label, answer, { variant, hint });
  parent.append(button);
  return button;
}

// A click answers through `docs.answerConfirm` for the view `viewId`, so the
// prompt that drew the button takes it.
function createConfirm(
  pushScope: () => PushedScope,
  closed: () => void,
  parts: DocsParts,
  drawFrame: DrawDialogFrame,
  viewId: string,
): Confirm {
  const dialog = createDialog('Move to the Trash', { drawFrame });

  let answers: { yes(): void; no(): void } | null = null;
  let pushed: PushedScope | null = null;
  let question = '';
  let drawn: DrawnPart | null = null;

  const removeDrawn = () => {
    drawn?.dispose();
    drawn = null;
    dialog.actions.replaceChildren();
  };

  const hide = () => {
    answers = null;
    dialog.hide();
    removeDrawn();
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

  // Each attempt starts from an empty actions row.
  const draw = () => {
    removeDrawn();
    drawn = parts.draw('confirmDialog', dialog.body, { question }, (kit) => {
      dialog.actions.replaceChildren();
      return {
        ...kit,
        actions: () => dialog.actions,
        answer: (parent, pick, label, variant) =>
          answerButton(
            kit,
            parent,
            pick === 'yes' ? 'confirmYes' : 'confirmNo',
            label,
            variant,
            kit.command(docsAnswerConfirmCommand.id, {
              viewId,
              answer: pick,
            }),
          ),
      };
    });
  };

  const confirm: Confirm = {
    element: dialog.element,
    open(nextQuestion, yes, no) {
      confirm.close();
      const scope = pushScope();
      scope.onBaseChanged(() => {
        if (pushed === scope) {
          answer('no');
        }
      });
      pushed = scope;
      answers = { yes, no };
      question = nextQuestion;
      draw();
      dialog.show();
    },
    isOpen: () => answers !== null,
    yes: () => answer('yes'),
    no: () => answer('no'),
    close() {
      if (answers !== null) {
        hide();
      }
    },
    redraw() {
      dialog.redrawFrame();
      if (answers !== null) {
        draw();
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
  // The view the dialogs belong to, which a Trash button's click names.
  viewId: string;
  channel: PageChannel<DocsChannel>;
  homeDir: string;
  paths: Paths;
  toast(text: string, tone: ToastTone): void;
  log: PluginLog;
  // The handle `createDocsPicker` gave this view.
  picker: ListPicker;
  // Draws the dialogs' bodies and the list picker's rows through the docs
  // layout.
  parts: DocsParts;
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

// The view's dialogs: its handle on the list picker, the name and path boxes and
// the Trash confirm, and the create, rename and trash flows that run through
// them and main. Each flow's refusals before a dialog opens are the view's.
// `elements` are the box and confirm; the list sits in the overlay already.
export interface DocsDialogs {
  elements: HTMLElement[];
  picker: ListPicker;
  createByKind(): void;
  // The path box prefilled with `folder`, the home folder when null.
  createByPath(folder: string | null): void;
  rename(entry: IndexEntry): void;
  trash(entry: IndexEntry): void;
  isBoxOpen(): boolean;
  // Whether the picker, the box or the confirm prompt shows.
  isAnyOpen(): boolean;
  boxComplete(): void;
  boxAccept(): void;
  boxCancel(): void;
  confirmYes(): void;
  confirmNo(): void;
  // Closes every dialog without hearing a cancel.
  close(): void;
  // The `drawRow` of a list picker request titled `title`: each row is a
  // `pickerRow` part, whose anchors the picker disposes.
  pickerRow<T>(title: string): NonNullable<ListPickerRequest<T>['drawRow']>;
  // Draws the open dialogs' parts and the open list's rows again when a
  // layout pick changed for one of them, keeping the box's text, cursor and
  // focus.
  redraw(): void;
  // Closes every dialog, which disposes their drawn parts.
  dispose(): void;
}

// Every docs view's handle on the one list. A handle's `open` marks its view as
// the opener, and its `close` does nothing unless its view opened the open
// request, so one view's closing leaves a list another view has open.
export function createDocsPicker(list: ListPicker): {
  forView(viewId: string): ListPicker;
} {
  let openerViewId: string | null = null;
  return {
    forView: (viewId) => ({
      ...list,
      open(request) {
        list.open(request);
        openerViewId = viewId;
      },
      close() {
        if (openerViewId === viewId) {
          list.close();
        }
      },
    }),
  };
}

export function createDocsDialogs(deps: DocsDialogsDeps): DocsDialogs {
  const { channel, log, paths, toast, picker } = deps;
  const { parts } = deps;
  const boxFrame = frameDrawer(parts, 'box');
  const confirmFrame = frameDrawer(parts, 'confirm');
  const box = createTextBox({
    channel,
    homeDir: deps.homeDir,
    paths,
    log,
    pushScope: () => deps.pushScope('box'),
    closed: deps.dialogClosed,
    parts,
    drawFrame: boxFrame.draw,
  });
  const confirm = createConfirm(
    () => deps.pushScope('confirm'),
    deps.dialogClosed,
    parts,
    confirmFrame.draw,
    deps.viewId,
  );

  // The picker places the row, appends a trailing element the row left out,
  // and disposes the draw.
  const pickerRow =
    <T>(title: string): NonNullable<ListPickerRequest<T>['drawRow']> =>
    (list, _item, { label, trailing }) =>
      parts.draw('pickerRow', list, { picker: title, label }, (kit) => ({
        ...kit,
        trailing: () => trailing,
      }));

  const createCancelled = () => log('create cancelled');

  const failed = (error: unknown) => toast(errorText(error), 'error');

  // Whether a delete is waiting on main to name what it moves.
  let isTrashAsking = false;

  const pickPlace = (kind: CreateKind) => {
    const kindTitle = CREATE_KIND_TITLES[kind];
    const places = placesFor(kind, deps.entries(), deps.homeDir, paths);
    if (places.length === 0) {
      toast(noPlaceText(kindTitle), 'info');
      createCancelled();
      deps.dialogClosed();
      return;
    }
    const title = `Place for the ${kindTitle}`;
    picker.open({
      title,
      items: places,
      drawRow: pickerRow(title),
      label: (place) => place.title,
      selected: 0,
      chosen: (place) => nameDoc(kind, place),
      cancelled: () => {
        createCancelled();
        deps.dialogClosed();
      },
    });
    log(`create ${kindTitle}: pick a place`);
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
                  paths,
                )
              : provisionalEntry(created.path, kind, deps.entries(), paths);
          deps.changed({ type: 'created', entry }, null);
          await deps.openInEditor(entry, created.line);
          log(
            kind === 'followup'
              ? `created follow-up ${name.trim()}`
              : `created ${paths.base(created.path)}`,
          );
        } catch (error) {
          failed(error);
        }
      },
      cancelled: createCancelled,
    });
    log(`create ${kindTitle}: name it`);
  };

  const dialogs: DocsDialogs = {
    elements: [box.element, confirm.element],
    picker,
    createByKind() {
      const title = 'New doc by kind';
      picker.open({
        title,
        items: CREATE_KINDS,
        drawRow: pickerRow(title),
        label: (kind) => CREATE_KIND_TITLES[kind],
        selected: 0,
        chosen: (kind) => {
          try {
            pickPlace(kind);
          } catch (error) {
            failed(error);
          }
        },
        cancelled: () => {
          createCancelled();
          deps.dialogClosed();
        },
      });
      log('create: pick a kind');
    },
    createByPath(folder) {
      const { homeDir } = deps;
      box.open({
        label: 'New file',
        text: `${paths.tilde(folder ?? homeDir, homeDir)}${paths.separator}`,
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
              paths,
            );
            deps.changed({ type: 'created', entry }, null);
            await deps.openInEditor(entry, created.line);
            log(`created ${paths.base(created.path)}`);
          } catch (error) {
            failed(error);
          }
        },
        cancelled: createCancelled,
      });
      log('create by path: type the path');
    },
    rename(entry) {
      box.open({
        label: 'Rename to',
        text: paths.tilde(entry.path, deps.homeDir),
        completes: true,
        accept: async (typed) => {
          try {
            const renamed = await channel.invoke(
              'renameDoc',
              entry.path,
              typed,
            );
            box.close();
            const record = renameRecord(entry.path, renamed, paths);
            deps.changed(record, renamed);
            log(
              `renamed ${paths.base(record.from)} to ${paths.base(record.to)}`,
            );
          } catch (error) {
            failed(error);
          }
        },
        cancelled: () => log('rename cancelled'),
      });
      log('rename: type the new path');
    },
    // Main names what goes before the question, so a link's target is named
    // beside the link; a delete while that is asked is ignored. A trash that
    // fails partway still applies what moved, and toasts the failure.
    trash(entry) {
      if (isTrashAsking) {
        log('delete ignored: one is already being asked');
        return;
      }
      isTrashAsking = true;
      channel
        .invoke('trashTargets', entry.path)
        .finally(() => {
          isTrashAsking = false;
        })
        .then((targets) => {
          const name = paths.base(targets[targets.length - 1]);
          confirm.open(
            trashQuestion(targets, deps.homeDir, paths),
            () => {
              channel
                .invoke('trashDoc', entry.path)
                .then((result) => {
                  deps.changed(
                    { type: 'trashed', paths: result.trashed },
                    null,
                  );
                  if (result.error === null) {
                    log(`moved ${name} to the Trash`);
                  } else {
                    failed(result.error);
                    log(
                      `moved ${result.trashed.map((path) => paths.base(path)).join(', ')} to the Trash, then failed: ${result.error}`,
                    );
                  }
                })
                .catch(failed);
            },
            () => log(`kept ${name}`),
          );
          log(`asked to move ${name} to the Trash`);
        })
        .catch(failed);
    },
    isBoxOpen: () => box.isOpen(),
    isAnyOpen: () => picker.isOpen() || box.isOpen() || confirm.isOpen(),
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
    pickerRow,
    redraw() {
      parts.redrawIfChanged(() => {
        keepingFocusAndScroll(box.element, [], () => box.redraw());
        confirm.redraw();
        picker.redraw();
      });
    },
    dispose() {
      dialogs.close();
      boxFrame.dispose();
      confirmFrame.dispose();
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
  paths: Paths,
): IndexEntry {
  return {
    ...provisionalEntry(path, 'followup', entries, paths),
    id: `${path}#L${line}`,
    line,
    title,
    meta: { status: 'open', gist: '', section: null },
  };
}
