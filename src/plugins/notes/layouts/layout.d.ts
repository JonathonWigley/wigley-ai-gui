import type {
  BaseKit,
  DialogFrameInput,
  DialogFramePart,
  KitRowOptions,
} from '../../../shared/page/layout-host/kit';

// The contract of a notes layout: the note popup's field rows and their values, the image entries, the action
// buttons, the discard confirmation, the markup toolbar and the rows of the notes list picker. Each part appends its
// root element to `parent` and returns `{ element }`; the app sets `data-layout="<name>"` and
// `data-layout-owner="notes"` on that root. A layout's `layout.css` restyles under
// `[data-layout-owner="notes"][data-layout="<name>"]`.
//
// The app keeps the dialogs' scrims, keys and focus, the title box and the body editor, the markup editor, the cursor
// prompt (moved to the selected row), `is-cursor` on the rows, and the picker's panel, title, filter and cursor.
// `dialogFrame` draws each dialog's panel, title and actions row.
//
// The app's container lays out each part's root as one item: the fields grid a `row`, the row's value slot (a
// wrapping flex line) a value part, the dialog's actions row `actions`, the confirmation's body `confirm`, and the
// markup view's wrapping flex toolbar `markupToolbar`. `default`'s roots that only group (`.notes-tags`,
// `.notes-session-value`, `.notes-actions`, `.notes-markup-groups`) are `display: contents` in `default`'s
// `layout.css`, which stays linked whichever layout is picked, so the container lays out their children; a layout's own root that should do the same sets `display: contents` in
// its `layout.css`.
//
// What a part leaves out:
// - a row's `valueSlot`: the app appends a `div.notes-row-value` at the end of the row root. The app fills each slot:
//   the title row with the title box, the body row with the body editor, the other rows with their value part.
// - an image of `images`: the app draws it with `image` at the end of the part's root, in position order, so each
//   image the popup's keys select is shown.
// - a button of `actions`, `confirm` or `markupToolbar`, and the markup toolbar's `colourKeys`: the app appends it at
//   the end of the part's root, in the app's order, so every command keeps a key anchor.
// - a `pickerRow`'s `trailing`: the app appends it at the end of the row root.
// The list picker sets `title`, `is-selected`, `is-cursor`, `ui-row--action`, a mousedown that takes no focus and the
// click on a `pickerRow` root, the click dropped while the root is `is-disabled`, so the row gives `kit.row` no
// `onClick`.
//
// Kit scopes: rows, values, images and actions `notes.popup`; `confirm` `notes.confirm`; `markupToolbar`
// `notes.markup`; `pickerRow` `notes.picker`; `dialogFrame` `notes.popup` for the Note popup, `notes.confirm` for the
// discard confirmation.

export type NoteField =
  | 'target'
  | 'title'
  | 'body'
  | 'tags'
  | 'images'
  | 'session';
export type NoteAction =
  | 'discard'
  | 'appendFollowup'
  | 'sendSession'
  | 'sendFollowup';
export type ConfirmAction = 'confirmNo' | 'confirmYes';
export type MarkupTool = 'select' | 'pen' | 'text' | 'arrow' | 'box';
export type MarkupColour = 'red' | 'yellow' | 'green' | 'blue';
export type MarkupCommand = 'undo' | 'redo' | 'closeMarkup';

export interface NoteRowInput {
  field: NoteField;
  label: string;
}
// The target's home label, or null for no target.
export interface TargetInput {
  text: string | null;
}
export interface TagsInput {
  tags: string[];
}
export interface ImagesInput {
  count: number;
}
// `position` counts from 1: 1 is the first image. `alt` is `Image <position>`; `isSelected` marks the image the
// popup's keys act on.
export interface NoteImageInput {
  position: number;
  src: string;
  alt: string;
  hasMarkup: boolean;
  isSelected: boolean;
}
// The session chip's text, or null for no session.
export interface SessionInput {
  text: string | null;
}
// The open picker's title and the row's line.
export interface PickerRowInput {
  picker: 'Target' | 'Tags' | 'Session' | 'Follow-up';
  label: string;
}

// A part's root, appended to `parent`.
export interface NotesPart {
  element: HTMLElement;
}

export interface NotesKit extends BaseKit {}
export interface RowKit extends NotesKit {
  // Appends the row's `div.notes-row-value`, which the app fills, and returns it; a second call throws
  // `valueSlot placed twice`, so the row draws with `default`.
  valueSlot(parent: HTMLElement): HTMLElement;
  // The key hint of the command that picks the row's value, labelled `pick`; an empty `span` for a field with none.
  pickHint(parent: HTMLElement): HTMLElement;
}
export interface ImagesKit extends NotesKit {
  // Draws the `image` part for the image at `position` (from 1) into `parent` and returns its root; throws for a
  // position the note does not hold. The app draws each position the part leaves out at the end of its root.
  image(parent: HTMLElement, position: number): HTMLElement;
}
export interface ImageKit extends NotesKit {
  // `button.notes-image-remove`: runs `notes.removeImageAt` with this image's index on click.
  removeButton(parent: HTMLElement): HTMLButtonElement;
}
export interface SessionKit extends NotesKit {
  // `button.ui-chip.notes-session` reading `text`: picks another session on click.
  sessionChip(parent: HTMLElement, text: string): HTMLElement;
  // An icon button that runs `notes.removeSession` with the session's id on click; with no session id it runs
  // nothing.
  removeButton(parent: HTMLElement): HTMLButtonElement;
}
export interface ActionsKit extends NotesKit {
  // The action's button: its label, variant and key hint; runs `notes.<action>` on click.
  actionButton(parent: HTMLElement, action: NoteAction): HTMLButtonElement;
}
export interface ConfirmKit extends NotesKit {
  // Keep (`confirmNo`) or Discard (`confirmYes`): its label, variant and key hint; runs `notes.<action>` on click.
  actionButton(parent: HTMLElement, action: ConfirmAction): HTMLButtonElement;
}
export interface PickerRowKit extends NotesKit {
  // The app's element for the end of the cursor row, or null on every other row; pass it as
  // `KitRowOptions.trailing`.
  trailing(): HTMLElement | null;
}
export interface MarkupKit extends NotesKit {
  // The tool's button with its key hint; the app marks the tool in use `is-active`.
  toolButton(parent: HTMLElement, tool: MarkupTool): HTMLButtonElement;
  // `button.notes-colour` with its `span.notes-swatch`; the app marks the colour in use `is-active`.
  colourButton(parent: HTMLElement, colour: MarkupColour): HTMLButtonElement;
  // `span.notes-markup-keys`: the keys that step the colour.
  colourKeys(parent: HTMLElement): HTMLElement;
  // Undo, Redo or Done with its key hint.
  commandButton(parent: HTMLElement, command: MarkupCommand): HTMLButtonElement;
}

// A layout defines only the parts it changes; `default` draws the rest.
export interface Layout {
  // One per field, top to bottom: the label, the value slot and the pick keys.
  row?(parent: HTMLElement, input: NoteRowInput, kit: RowKit): NotesPart;
  // The values drawn into the target, tags, images and session slots.
  target?(parent: HTMLElement, input: TargetInput, kit: NotesKit): NotesPart;
  tags?(parent: HTMLElement, input: TagsInput, kit: NotesKit): NotesPart;
  images?(parent: HTMLElement, input: ImagesInput, kit: ImagesKit): NotesPart;
  image?(parent: HTMLElement, input: NoteImageInput, kit: ImageKit): NotesPart;
  session?(
    parent: HTMLElement,
    input: SessionInput,
    kit: SessionKit,
  ): NotesPart;
  // The note dialog's buttons, drawn into its actions row.
  actions?(parent: HTMLElement, kit: ActionsKit): NotesPart;
  // The discard confirmation's text and buttons, drawn into its body.
  confirm?(parent: HTMLElement, kit: ConfirmKit): NotesPart;
  // The markup view's toolbar, over the image under markup.
  markupToolbar?(parent: HTMLElement, kit: MarkupKit): NotesPart;
  pickerRow?(
    parent: HTMLElement,
    input: PickerRowInput,
    kit: PickerRowKit,
  ): NotesPart;
  // The frame of the Note popup and the discard confirmation: the panel, its title (`input.title`) and, when
  // `input.hasActions`, its actions row. Return the panel, appended to `parent`, with `body` and `actions` inside it;
  // the app fills them. The app keeps the scrim, showing and hiding, keys and focus. A frame whose `body` or
  // `actions` is not inside its panel, or whose `actions` is not null exactly when `hasActions` is false, draws with
  // `default`.
  dialogFrame?(
    parent: HTMLElement,
    input: DialogFrameInput,
    kit: NotesKit,
  ): DialogFramePart;
}

// The built-in `default` layout defines every part.
export interface CompleteLayout extends Required<Layout> {}

export type { KitRowOptions };
