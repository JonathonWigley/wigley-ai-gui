import type {
  BaseKit,
  ConfirmButtonsKit,
  DialogFrameInput,
  DialogFramePart,
} from '../../../shared/page/layout-host/kit';

// The audio picker layout contract: what a layout in `layouts/audio-picker/<name>/layout.js` draws the audio picker
// popup with. A layout defines only the parts it changes; every part it leaves out, and every part that throws or
// returns no element appended to `parent`, is drawn by `default` instead. The app sets
// `data-layout-owner="audio-picker"` and `data-layout="<name>"` on the element each part returns, `<name>` being the
// layout that drew it, so `[data-layout-owner="audio-picker"][data-layout="<name>"] …` in a layout's CSS selects only
// its own parts.
//
// The app draws the `head` part over the moments, then, per moment, a section of its own holding, in order, the
// `moment` part, a `candidate` part per candidate, the `none` part and the `notes` part. The app keeps the click on
// each `candidate` and `none` part root (it moves the cursor to the row and chooses it), `is-cursor` on the cursor
// row's part root and `is-selected` on the chosen row's; the footer (the Cancel picker and Send buttons and their
// keys), the cancel prompt's scrim, keys and focus, scrolling and the notes boxes themselves. `dialogFrame` and
// `confirmBody` draw the cancel prompt's panel, title, body and buttons.
//
// The app draws a part again only when its input changes, so moving the cursor redraws two rows; a layout keeps no
// state between draws. A `notes` part drawn again keeps its box, with its text, cursor, vim mode and undo, and its
// focus while the box had it.

export type PlayMode = 'one-shot' | 'loop' | 'variants';

// `moments` is the moment count, `onRecommendation` the moments whose choice is their recommended candidate, and
// `noneOfThese` the moments whose choice is None of these. `saveLabel` is the draft's save state.
export interface HeadInput {
  heading: string;
  overview: string;
  moments: number;
  onRecommendation: number;
  noneOfThese: number;
  saveLabel: string;
}

// `moment` is 0-based and `number` its 1-based place. `isCursor` is true on the moment holding the cursor row.
export interface MomentInput {
  moment: number;
  number: number;
  title: string;
  reason: string;
  isCursor: boolean;
}

// `row` is the candidate's 0-based place in its moment's rows (the candidates, then None of these), and `number` is
// `row + 1`, the digit that chooses it. `fileCount` is the files a variant set plays from. `durationSeconds` is the
// decoded length, null until it decodes; `load` is the decode's state, with the failure's text in `error`.
// `isPlaying` is true while the row's sound plays, `isCursor` on the cursor row, `isChosen` on the moment's chosen
// row, and `isRecommended` on the agent's recommended row.
export interface CandidateRowInput {
  moment: number;
  row: number;
  number: number;
  name: string;
  library: string;
  play: PlayMode;
  fileCount: number;
  pitch: { min: number; max: number } | null;
  loudnessLufs: number | null;
  durationSeconds: number | null;
  load: 'loading' | 'ready' | 'error';
  error: string | null;
  isPlaying: boolean;
  isCursor: boolean;
  isChosen: boolean;
  isRecommended: boolean;
}

// The None of these row, after the moment's candidates: `row` is the candidate count, and `number` is `row + 1`.
export interface NoneRowInput {
  moment: number;
  row: number;
  number: number;
  isCursor: boolean;
  isChosen: boolean;
}

// `isNone` is true while the moment's choice is None of these, when its note says what to search for instead.
export interface NotesInput {
  moment: number;
  number: number;
  isNone: boolean;
}

// `body` is the cancel prompt's question.
export interface ConfirmBodyInput {
  body: string;
}

// `element` is the part's own node, appended to `parent`.
export interface PickerLayoutPart {
  element: HTMLElement;
}

// Every part appends itself to `parent` and returns what it appended. `keyHint`, `keys` and `keysFor` read scope
// `audio-picker.list` in every part.
export type PickerKit = BaseKit;

export interface CandidateKit extends PickerKit {
  // The row's play IconButton: Play, or Stop while the row plays. A click plays or stops the row's sound and does not
  // choose the row.
  playButton(parent: HTMLElement): HTMLElement;
  // `span.audio-picker-waveform`: the row's waveform as an SVG of one bar per peak; empty, with `is-loading`, until
  // the sound decodes.
  waveform(parent: HTMLElement): HTMLElement;
}

// The cancel prompt's kit, in scope `audio-picker.confirm`: `keyHint`, `keys` and `keysFor` read that scope.
export interface ConfirmBodyKit extends PickerKit, ConfirmButtonsKit {}

export interface NotesKit extends PickerKit {
  // The moment's notes box in its field (`div.audio-picker-notes-field`), with its `⇧⇥ ⇥` box keys on the frame. It
  // places once per draw; asking for it again throws. When a part leaves it out, the app appends it at the part's end,
  // so the box keys always reach it.
  textBox(parent: HTMLElement): HTMLElement;
}

export interface AudioPickerLayout {
  // The picker's heading, overview and counts, over the moments.
  head?(
    parent: HTMLElement,
    input: HeadInput,
    kit: PickerKit,
  ): PickerLayoutPart;
  // A moment's title and reason, over its rows.
  moment?(
    parent: HTMLElement,
    input: MomentInput,
    kit: PickerKit,
  ): PickerLayoutPart;
  candidate?(
    parent: HTMLElement,
    input: CandidateRowInput,
    kit: CandidateKit,
  ): PickerLayoutPart;
  none?(
    parent: HTMLElement,
    input: NoneRowInput,
    kit: PickerKit,
  ): PickerLayoutPart;
  // The moment's notes, after its None of these row.
  notes?(
    parent: HTMLElement,
    input: NotesInput,
    kit: NotesKit,
  ): PickerLayoutPart;
  // The cancel prompt's body, scope `audio-picker.confirm`: `input.body` and the prompt's two buttons. A button the
  // part leaves out goes at the end of the frame's actions row.
  confirmBody?(
    parent: HTMLElement,
    input: ConfirmBodyInput,
    kit: ConfirmBodyKit,
  ): PickerLayoutPart;
  // The frame of the cancel prompt: the panel, its title (`input.title`) and, when `input.hasActions`, its actions
  // row. Return the panel, appended to `parent`, with `body` and `actions` inside it; the app fills them. The app
  // keeps the scrim, showing and hiding, keys and focus. A frame whose `body` or `actions` is not inside its panel,
  // or whose `actions` is not null exactly when `hasActions` is false, draws with `default`.
  dialogFrame?(
    parent: HTMLElement,
    input: DialogFrameInput,
    kit: PickerKit,
  ): DialogFramePart;
}

// The built-in `default` layout, which defines every part.
export interface CompleteAudioPickerLayout extends AudioPickerLayout {
  head(parent: HTMLElement, input: HeadInput, kit: PickerKit): PickerLayoutPart;
  moment(
    parent: HTMLElement,
    input: MomentInput,
    kit: PickerKit,
  ): PickerLayoutPart;
  candidate(
    parent: HTMLElement,
    input: CandidateRowInput,
    kit: CandidateKit,
  ): PickerLayoutPart;
  none(
    parent: HTMLElement,
    input: NoneRowInput,
    kit: PickerKit,
  ): PickerLayoutPart;
  notes(
    parent: HTMLElement,
    input: NotesInput,
    kit: NotesKit,
  ): PickerLayoutPart;
  confirmBody(
    parent: HTMLElement,
    input: ConfirmBodyInput,
    kit: ConfirmBodyKit,
  ): PickerLayoutPart;
  dialogFrame(
    parent: HTMLElement,
    input: DialogFrameInput,
    kit: PickerKit,
  ): DialogFramePart;
}
