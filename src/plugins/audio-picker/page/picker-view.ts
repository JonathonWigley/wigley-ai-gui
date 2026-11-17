import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { ContentScroll, ScrollStep } from '../../../contracts/editor';
import type { PluginLog } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { FocusTarget, ResizeTarget } from '../../../contracts/panes';
import type { OsName } from '../../../contracts/platform';
import type {
  KeyHints,
  PluginAreas,
  PushedScope,
  ShownLayouts,
} from '../../../contracts/plugin';
import type { LayoutState } from '../../../contracts/state';
import { scrollContent } from '../../../shared/content-scroll';
import { saveLabel, saveState } from '../../../shared/page/autosave';
import { createConfirmPrompt } from '../../../shared/page/confirm-prompt';
import { element } from '../../../shared/page/dom';
import {
  type EditorBoxes,
  keepFocusedBox,
} from '../../../shared/page/editor-boxes';
import type { KitCommands } from '../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  drawPart,
  type PartPick,
  requireDialogFrame,
  requireElementIn,
  type RollbackDeps,
} from '../../../shared/page/layout-host/draw-part';
import { pickLayout } from '../../../shared/page/layout-host/pick';
import { createSessionFormPopups } from '../../../shared/page/session-form-popups';
import {
  activeForm,
  formById,
  formOfSession,
} from '../../../shared/page/session-forms';
import { textLineHeightPx } from '../../../shared/page/text-line';
import { type ButtonVariant, textButton } from '../../../shared/page/ui/button';
import type { DialogFramePart } from '../../../shared/page/ui/dialog';
import {
  disposeAnchors,
  recordingAnchor,
} from '../../../shared/page/ui/key-anchors';
import {
  NEEDS_YOU_ACTIVITY,
  type SessionsPageExports,
} from '../../sessions/contract';
import {
  type AudioPickerPlace,
  audioPickerSelectRowCommand,
} from '../contract';
import {
  type AudioPickerCommandName,
  audioPickerCommand,
  audioPickerScope,
  type AudioPickerScopeName,
} from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type {
  AudioPickerLayout,
  CandidateRowInput,
  HeadInput,
  MomentInput,
  NoneRowInput,
  NotesInput,
  PickerLayoutPart,
} from '../layouts/layout';
import {
  createCandidateKit,
  createConfirmKit,
  createNotesKit,
  createPickerKit,
  type PickerBox,
  type PickerPartKitDeps,
} from './layout/picker-kit';
import {
  listedPicker,
  type OpenPicker,
  type PickerState,
  scopeOf,
  statusOf,
} from './picker-state';
import type { PickerStore } from './picker-store';

// Every part's input for one picker: the head, then per moment its own parts.
export interface PickerInputs {
  head: HeadInput;
  moments: {
    moment: MomentInput;
    candidates: CandidateRowInput[];
    none: NoneRowInput;
    notes: NotesInput;
  }[];
}

// `closesAtOnce` says whether the close key ends the session's picker with it;
// `beforeClose` answers whether the session may close. `setScope` sets the key
// scope to `scopeOf` the state while a picker popup is the visible surface;
// `pushConfirmScope` lays the cancel prompt's scope over it. `keys` anchors each
// key hint the view and its layout draw and reads the keys a layout asks for.
// `run` runs a button's command; `commands` is what a layout's `kit.command`
// and a row's click reach. `platform` is the OS the layouts' key hints draw
// for. `savedPlaces` holds the places the last page saved, read once at start:
// a picker it holds was shown before the reload, and its popup comes back
// hidden or shown as that page left it.
export interface PickerViewDeps {
  areas: Pick<PluginAreas, 'overlay'>;
  sessions: Pick<
    SessionsPageExports,
    'addPopup' | 'addRowPart' | 'setActivity'
  >;
  closesAtOnce(sessionId: string): boolean;
  beforeClose(sessionId: string): boolean;
  setScope(scope: AudioPickerScopeName): void;
  // Both called with null after each setScope: the picker is one pane.
  setResizeTarget(target: ResizeTarget | null): void;
  setFocusTarget(target: FocusTarget | null): void;
  pushConfirmScope(): PushedScope;
  store: PickerStore;
  boxes: EditorBoxes<PickerBox>;
  markdown: MarkdownRenderer;
  keys: Pick<KeyHints, 'anchor' | 'keysFor'>;
  run(command: CommandId): void;
  commands: KitCommands;
  platform: OsName;
  state: LayoutState;
  log: PluginLog;
  savedPlaces: ReadonlyMap<string, AudioPickerPlace>;
}

// `forgetSession` drops a session's picker popup entry and destroys its picker
// view once sessions dropped the popup, so the next render rebuilds a picker
// still open for the session in a new popup. `scrollBy` scrolls the active
// picker's list, down for 1 and up for -1; null with no active picker.
// `setLayouts` draws every part whose picked layout changed again, keeping the
// focused box. `isShown` is whether a picker popup is the visible surface.
// `dispose` destroys every open picker view.
export interface PickerPopups {
  forgetSession(sessionId: string): void;
  scrollBy(step: ScrollStep, direction: 1 | -1): ContentScroll | null;
  setLayouts(shown: ShownLayouts<AudioPickerLayout>): void;
  isShown(): boolean;
  dispose(): void;
}

// One open picker's DOM in its session's picker popup. `update` draws again
// each part whose input or picked layout changed; `dispose` disposes every
// part's anchors and boxes and the footer's anchors.
interface PickerFormView {
  element: HTMLElement;
  update(picker: OpenPicker): void;
  scrollBy(step: ScrollStep, direction: 1 | -1): ContentScroll;
  dispose(): void;
}

type PartDeps = PickerPartKitDeps & { log: PluginLog };

type PartName = keyof AudioPickerLayout;

// An app-owned slot one part draws into, and what it last drew: the input and
// pick it drew from, and the draw itself.
interface PartSlot {
  element: HTMLElement;
  drawnKey: string | null;
  pick: PartPick<AudioPickerLayout> | null;
  drawn: DrawnPart<{ element: HTMLElement }> | null;
}

// One moment's slots, in the order its section holds them.
interface SectionSlots {
  moment: PartSlot;
  candidates: PartSlot[];
  none: PartSlot;
  notes: PartSlot;
}

// One part to draw again: its slot, the name it draws under, the key of its
// input, and the draw.
interface PartDraw {
  slot: PartSlot;
  name: PartName;
  key: string;
  draw(pick: PartPick<AudioPickerLayout>): DrawnPart<{ element: HTMLElement }>;
}

const FOOTER: [AudioPickerCommandName, string, ButtonVariant][] = [
  ['askCancel', 'Cancel picker', 'secondary'],
  ['submit', 'Send', 'primary'],
];

// Every audio picker drawn in its session's picker popup, focused or not, and
// the cancel prompt in the overlay layer, serving the active picker, which
// alone takes keys. Every store change renders it; a change a render's own
// dispatch makes renders again once that render ends. While a picker popup is
// the visible surface the key scope follows the state; the cancel prompt
// pushes its own scope over it and is dismissed when another view sets the
// scope. Each part draws through the layouts the last `setLayouts` handed it,
// `default` alone until the first.
export function mountPickerPopups(deps: PickerViewDeps): PickerPopups {
  const { areas, store, boxes } = deps;
  const views = new Map<string, PickerFormView>();
  const setScopeFor = (state: PickerState) => {
    deps.setScope(scopeOf(state));
    deps.setResizeTarget(null);
    deps.setFocusTarget(null);
  };
  const popups = createSessionFormPopups({
    addPopup: (sessionId, popup, options) =>
      deps.sessions.addPopup(sessionId, popup, options),
    popupId: 'audio-picker',
    title: 'Audio picker',
    icon: 'unmute',
    className: 'audio-picker-tab',
    statusPartId: 'audio-picker.status',
    closesAtOnce: (sessionId) => deps.closesAtOnce(sessionId),
    beforeClose: (sessionId) => deps.beforeClose(sessionId),
    shown: () => setScopeFor(store.get()),
    formShown: (sessionId, shown) =>
      deps.sessions.setActivity(
        sessionId,
        'audio-picker',
        shown ? NEEDS_YOU_ACTIVITY : null,
      ),
  });
  const statusPart = deps.sessions.addRowPart(popups.statusPart);
  let shownLayouts: ShownLayouts<AudioPickerLayout> = {
    layouts: new Map([['default', defaultLayout]]),
    user: 'default',
  };
  // The last draw of each cancel prompt part, disposed once the next draw of
  // that part returns.
  let drawnPromptBody: DrawnPart<{ element: HTMLElement }> | null = null;
  let drawnPromptFrame: DrawnPart<DialogFramePart> | null = null;
  const confirm = createConfirmPrompt({
    title: 'Cancel this picker?',
    body: 'The agent is told the picker was cancelled. Your choices stay saved.',
    keep: {
      label: 'Keep choosing',
      command: audioPickerCommand('dismissConfirm'),
    },
    confirm: {
      label: 'Cancel picker',
      command: audioPickerCommand('confirmCancel'),
    },
    scope: audioPickerScope('confirm'),
    keys: deps.keys,
    run: (command) => deps.run(command),
    pushScope: () => deps.pushConfirmScope(),
    isAsked: () => store.get().view === 'confirm',
    isSending: () => (activeForm(store.get())?.sending ?? null) !== null,
    dismiss: () => store.dispatch({ type: 'dismissConfirm' }),
    log: deps.log,
    drawFrame(parent, input) {
      const drawn = drawPart({
        owner: 'audio-picker',
        parent,
        pick: pickPart(shownLayouts, 'dialogFrame'),
        defaultLayout,
        part: (layout) => layout.dialogFrame,
        build: (builder, into, rollback) =>
          requireDialogFrame(
            builder(into, input, createConfirmKit(deps, rollback)),
            input,
            'dialogFrame',
          ),
        log: deps.log,
        partName: 'dialogFrame',
      });
      drawnPromptFrame?.dispose();
      drawnPromptFrame = drawn;
      return drawn.built;
    },
    drawBody(body, promptParts) {
      const drawn = drawLayoutPart(
        body,
        pickPart(shownLayouts, 'confirmBody'),
        deps,
        {
          name: 'confirmBody',
          part: (layout) => layout.confirmBody,
          input: { body: promptParts.body },
          kit: (rollback) => ({
            kit: {
              ...createConfirmKit(deps, rollback),
              keepButton: promptParts.keepButton,
              confirmButton: promptParts.confirmButton,
            },
          }),
        },
      );
      drawnPromptBody?.dispose();
      drawnPromptBody = drawn;
    },
  });
  areas.overlay.contribute(confirm.element);

  const destroyView = (formId: string) => {
    const view = views.get(formId);
    if (view === undefined) {
      return;
    }
    view.dispose();
    boxes.destroyForm(formId);
    boxes.forgetForm(formId);
    view.element.remove();
    views.delete(formId);
  };

  // A view per open picker, built when the picker appears, which mounts it in
  // its session's popup, and destroyed with its boxes when the picker leaves.
  const syncViews = (state: PickerState) => {
    for (const formId of views.keys()) {
      if (formById(state, formId) === undefined) {
        destroyView(formId);
      }
    }
    for (const picker of state.forms) {
      if (!views.has(picker.formId)) {
        const restored = deps.savedPlaces.has(picker.formId);
        const view = createPickerFormView(
          (root) => popups.mount(picker.sessionId, root, restored),
          picker,
          deps,
          () => shownLayouts,
        );
        views.set(picker.formId, view);
      }
    }
  };

  const renderOnce = () => {
    if (!confirm.settleOwedDismiss()) {
      return;
    }
    const state = store.get();
    // Left before syncViews destroys a closed picker's boxes with its view,
    // and under the cancel prompt, so its keys never type into the note.
    const box = boxes.active();
    if (box !== null && listedPicker(state)?.formId !== box.formId) {
      boxes.leave();
    }
    syncViews(state);
    popups.sync((sessionId) => {
      const picker = formOfSession(state, sessionId);
      return picker === undefined ? null : statusOf(picker);
    });
    for (const picker of state.forms) {
      views.get(picker.formId)?.update(picker);
    }
    confirm.setBaseScope(() => {
      if (popups.isShown()) {
        setScopeFor(state);
      }
    });
  };
  // A notes redraw refocuses its box, whose focus can dispatch.
  let isRendering = false;
  let isRenderOwed = false;
  const render = () => {
    if (isRendering) {
      isRenderOwed = true;
      return;
    }
    isRendering = true;
    try {
      do {
        isRenderOwed = false;
        renderOnce();
      } while (isRenderOwed);
    } finally {
      isRendering = false;
    }
  };
  const storeSubscription = store.subscribe(render);
  render();
  return {
    forgetSession(sessionId) {
      popups.forget(sessionId);
      for (const picker of store.get().forms) {
        if (picker.sessionId === sessionId) {
          destroyView(picker.formId);
        }
      }
    },
    scrollBy(step, direction) {
      const state = store.get();
      const picker = state.view === 'idle' ? null : activeForm(state);
      const view = picker === null ? undefined : views.get(picker.formId);
      return view?.scrollBy(step, direction) ?? null;
    },
    setLayouts(shown) {
      shownLayouts = shown;
      confirm.redraw();
      render();
    },
    isShown: () => popups.isShown(),
    dispose() {
      statusPart.dispose();
      storeSubscription.dispose();
      drawnPromptBody?.dispose();
      drawnPromptFrame?.dispose();
      for (const formId of views.keys()) {
        destroyView(formId);
      }
    },
  };
}

// The picker's DOM: a scroller holding the head slot, then a section per
// moment holding its moment, candidate, None of these and notes slots, then
// the footer with the Cancel picker and Send buttons. `attach` places the
// root in the page once, before any box mounts. `shown` reads the layouts the
// parts are picked from now.
function createPickerFormView(
  attach: (root: HTMLElement) => void,
  picker: OpenPicker,
  deps: PickerViewDeps,
  shown: () => ShownLayouts<AudioPickerLayout>,
): PickerFormView {
  const root = element('div', 'audio-picker-form');
  const scroller = element('div', 'audio-picker-scroller');
  const head = partSlot(scroller);
  const sections = picker.picker.moments.map((moment): SectionSlots => {
    const section = element('section', 'audio-picker-section');
    scroller.append(section);
    return {
      moment: partSlot(section),
      candidates: moment.candidates.map(() => partSlot(section)),
      none: partSlot(section),
      notes: partSlot(section),
    };
  });
  const anchors: Disposable[] = [];
  const keys = { anchor: recordingAnchor(deps.keys.anchor, anchors) };
  const footer = element('div', 'audio-picker-footer');
  const buttons = FOOTER.map(([command, label, variant]) => {
    const qualified = audioPickerCommand(command);
    const hint = element('span', 'audio-picker-footer-key');
    keys.anchor(hint, qualified, { scope: audioPickerScope('list') });
    const node = textButton(label, () => deps.run(qualified), {
      variant,
      hint,
    });
    footer.append(node);
    return node;
  });
  root.append(scroller, footer);
  // Editors mount into attached elements, so they can measure themselves.
  attach(root);
  const partDeps: PartDeps = {
    markdown: deps.markdown,
    keys: deps.keys,
    commands: deps.commands,
    platform: deps.platform,
    state: deps.state,
    boxes: deps.boxes,
    log: deps.log,
  };
  const { formId } = picker;
  let drawnCursor: string | null = null;

  return {
    element: root,
    update(current) {
      const inputs = pickerInputs(current);
      const draws = partDraws(current, inputs, head, sections, partDeps);
      const layouts = shown();
      const stale = draws.flatMap((draw) => {
        const pick = pickPart(layouts, draw.name);
        const isStale =
          draw.key !== draw.slot.drawnKey || !isSamePick(draw.slot.pick, pick);
        return isStale ? [{ draw, pick }] : [];
      });
      const redraw = () => {
        for (const { draw, pick } of stale) {
          redrawSlot(draw, pick);
        }
      };
      if (stale.some(({ draw }) => draw.name === 'notes')) {
        keepFocusedBox(deps.boxes, formId, redraw);
      } else {
        redraw();
      }
      for (const button of buttons) {
        button.disabled = current.sending !== null;
      }
      const cursor = `${current.cursor.moment}.${current.cursor.row}`;
      if (drawnCursor !== null && cursor !== drawnCursor) {
        cursorRoot(sections, current)?.scrollIntoView({ block: 'nearest' });
      }
      drawnCursor = cursor;
    },
    scrollBy(step, direction) {
      return scrollContent(
        scroller,
        step,
        direction,
        textLineHeightPx(scroller),
      );
    },
    dispose() {
      head.drawn?.dispose();
      for (const section of sections) {
        for (const slot of [
          section.moment,
          ...section.candidates,
          section.none,
          section.notes,
        ]) {
          slot.drawn?.dispose();
        }
      }
      disposeAnchors(anchors);
    },
  };
}

// An empty slot appended to `parent`; it lays out as its part alone.
function partSlot(parent: HTMLElement): PartSlot {
  const slot = element('div', 'audio-picker-part');
  parent.append(slot);
  return { element: slot, drawnKey: null, pick: null, drawn: null };
}

// Disposes the slot's draw first, then draws it again: the old draw's release
// would detach the box the new draw just placed.
function redrawSlot(draw: PartDraw, pick: PartPick<AudioPickerLayout>) {
  const { slot } = draw;
  slot.drawn?.dispose();
  slot.element.replaceChildren();
  slot.drawn = draw.draw(pick);
  slot.drawnKey = draw.key;
  slot.pick = pick;
}

// The root of the part drawn on the cursor row, if it is drawn.
function cursorRoot(
  sections: SectionSlots[],
  picker: OpenPicker,
): HTMLElement | null {
  const { moment, row } = picker.cursor;
  const section = sections[moment];
  const slot = section.candidates[row] ?? section.none;
  return slot.drawn?.built.element ?? null;
}

// Every part of the picker with its input's key and its draw.
function partDraws(
  picker: OpenPicker,
  inputs: PickerInputs,
  head: PartSlot,
  sections: SectionSlots[],
  deps: PartDeps,
): PartDraw[] {
  const plainKit = (rollback: RollbackDeps) => ({
    kit: createPickerKit(deps, rollback),
  });
  const draws: PartDraw[] = [
    {
      slot: head,
      name: 'head',
      key: JSON.stringify(inputs.head),
      draw: (pick) =>
        drawLayoutPart(head.element, pick, deps, {
          name: 'head',
          part: (layout) => layout.head,
          input: inputs.head,
          kit: plainKit,
        }),
    },
  ];
  inputs.moments.forEach((parts, m) => {
    const section = sections[m];
    draws.push({
      slot: section.moment,
      name: 'moment',
      key: JSON.stringify(parts.moment),
      draw: (pick) =>
        drawLayoutPart(section.moment.element, pick, deps, {
          name: 'moment',
          part: (layout) => layout.moment,
          input: parts.moment,
          kit: plainKit,
        }),
    });
    parts.candidates.forEach((input, c) => {
      const { peaks } = picker.loads[m][c];
      const slot = section.candidates[c];
      draws.push({
        slot,
        name: 'candidate',
        key: JSON.stringify([input, peaks]),
        draw: (pick) => {
          const drawn = drawLayoutPart(slot.element, pick, deps, {
            name: 'candidate',
            part: (layout) => layout.candidate,
            input,
            kit: (rollback) => ({
              kit: createCandidateKit(deps, input, peaks, rollback),
            }),
          });
          return markRow(drawn, input, deps);
        },
      });
    });
    draws.push({
      slot: section.none,
      name: 'none',
      key: JSON.stringify(parts.none),
      draw: (pick) => {
        const drawn = drawLayoutPart(section.none.element, pick, deps, {
          name: 'none',
          part: (layout) => layout.none,
          input: parts.none,
          kit: plainKit,
        });
        return markRow(drawn, parts.none, deps);
      },
    });
    const box = { formId: picker.formId, moment: m };
    const note = picker.answers[m].note;
    draws.push({
      slot: section.notes,
      name: 'notes',
      key: JSON.stringify(parts.notes),
      draw: (pick) =>
        drawLayoutPart(section.notes.element, pick, deps, {
          name: 'notes',
          part: (layout) => layout.notes,
          input: parts.notes,
          kit: (rollback) => createNotesKit(deps, box, note, rollback),
        }),
    });
  });
  return draws;
}

type LayoutBuilder<Kit, Input> = (
  parent: HTMLElement,
  input: Input,
  kit: Kit,
) => PickerLayoutPart;

// One part's draw: its name, its builder in a layout, its input, and its kit,
// with what the app appends to the part once the layout drew it.
interface PartSpec<Kit, Input> {
  name: PartName;
  part(layout: AudioPickerLayout): LayoutBuilder<Kit, Input> | undefined;
  input: Input;
  kit(rollback: RollbackDeps): {
    kit: Kit;
    appendUnplacedBox?(part: HTMLElement): void;
  };
}

// The part through the layout `pick` names, falling back to `default`.
function drawLayoutPart<Kit, Input>(
  parent: HTMLElement,
  pick: PartPick<AudioPickerLayout>,
  deps: PartDeps,
  spec: PartSpec<Kit, Input>,
): DrawnPart<{ element: HTMLElement }> {
  return drawPart({
    owner: 'audio-picker',
    parent,
    pick,
    defaultLayout,
    part: spec.part,
    build(builder, buildParent, rollback) {
      const { kit, appendUnplacedBox } = spec.kit(rollback);
      const drawn: PickerLayoutPart | null | undefined = builder(
        buildParent,
        spec.input,
        kit,
      );
      const element = requireElementIn(buildParent, drawn?.element, spec.name);
      appendUnplacedBox?.(element);
      return { element };
    },
    log: deps.log,
    partName: spec.name,
  });
}

// Marks a row part's root for the cursor and the choice, and makes a click on
// it move the cursor to the row and choose it.
function markRow(
  drawn: DrawnPart<{ element: HTMLElement }>,
  input: { moment: number; row: number; isCursor: boolean; isChosen: boolean },
  deps: Pick<PartDeps, 'commands'>,
): DrawnPart<{ element: HTMLElement }> {
  const root = drawn.built.element;
  root.classList.toggle('is-cursor', input.isCursor);
  root.classList.toggle('is-selected', input.isChosen);
  root.addEventListener('click', () =>
    deps.commands.run(audioPickerSelectRowCommand.id, {
      moment: input.moment,
      row: input.row,
    }),
  );
  return drawn;
}

// The layout the user's setting names, then `default`, for the first that
// defines the part.
function pickPart(
  shown: ShownLayouts<AudioPickerLayout>,
  name: PartName,
): PartPick<AudioPickerLayout> {
  return pickLayout(
    [shown.user, 'default'],
    shown.layouts,
    (layout) => layout[name] !== undefined,
  );
}

function isSamePick(
  drawn: PartPick<AudioPickerLayout> | null,
  next: PartPick<AudioPickerLayout>,
): boolean {
  return drawn?.name === next.name && drawn.layout === next.layout;
}

// Every part's input, built from the picker's form, answers, cursor, loads and
// play.
export function pickerInputs(picker: OpenPicker): PickerInputs {
  const { moments } = picker.picker;
  const { answers, cursor, playing } = picker;
  const choices = answers.map((answer) => answer.choice);
  return {
    head: {
      heading: picker.picker.heading,
      overview: picker.picker.overview,
      moments: moments.length,
      onRecommendation: moments.filter(
        (moment, m) => choices[m] === moment.recommend,
      ).length,
      noneOfThese: choices.filter((choice) => choice === 0).length,
      saveLabel: saveLabel(saveState(picker), picker.saveError),
    },
    moments: moments.map((moment, m) => {
      const noneRow = moment.candidates.length;
      const isCursorAt = (row: number) =>
        cursor.moment === m && cursor.row === row;
      return {
        moment: {
          moment: m,
          number: m + 1,
          title: moment.title,
          reason: moment.reason,
          isCursor: cursor.moment === m,
        },
        candidates: moment.candidates.map((candidate, row) => {
          const load = picker.loads[m][row];
          return {
            moment: m,
            row,
            number: row + 1,
            name: candidate.name,
            library: candidate.library,
            play: candidate.play,
            fileCount: candidate.files.length,
            pitch: candidate.pitch,
            loudnessLufs: candidate.loudnessLufs,
            durationSeconds: load.durationSeconds,
            load: load.load,
            error: load.error,
            isPlaying: playing?.moment === m && playing.candidate === row,
            isCursor: isCursorAt(row),
            isChosen: choices[m] === row + 1,
            isRecommended: moment.recommend === row + 1,
          };
        }),
        none: {
          moment: m,
          row: noneRow,
          number: noneRow + 1,
          isCursor: isCursorAt(noneRow),
          isChosen: choices[m] === 0,
        },
        notes: { moment: m, number: m + 1, isNone: choices[m] === 0 },
      };
    }),
  };
}
