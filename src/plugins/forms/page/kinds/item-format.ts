import type { PluginLog } from '../../../../contracts/log';
import type { MarkdownRenderer } from '../../../../contracts/markdown';
import type { OsName } from '../../../../contracts/platform';
import type { KeysPageExports } from '../../../keys/contract';
import type { AnswerableKind, ItemKind, Round } from '../../contract';
import type { LayoutCards } from '../../layouts/layout';
import type { FormsContributions } from '../contributions';
import type { FormsAction, RoundState, TextTarget } from '../form-state';
import type { KitCommands } from '../../../../shared/page/layout-host/base-kit';
import type { MarkdownMount } from '../../../../shared/page/markdown-mount';

// One item's pane, built once; `update` shows the round's current answers.
export interface ItemCard {
  element: HTMLElement;
  update(round: RoundState): void;
}

// What a card reaches outside itself: the round's boxes, its actions, the
// Don't-ask command, which also focuses the reason box, the keys bound in a
// scope and the anchors that show them (a card reads and anchors in the forms
// view's), the platform key hints are drawn for, the log, the registered
// commands `kit.command` checks and runs, the card parts other plugins
// added, and where each markdown mount the card makes is recorded for
// disposal.
export interface CardDeps {
  markdown: MarkdownRenderer;
  mountBox(parent: HTMLElement, target: TextTarget, text: string): void;
  destroyBox(target: TextTarget): void;
  dispatch(action: FormsAction): void;
  toggleDontAsk(): void;
  keys: Pick<KeysPageExports, 'keysFor' | 'anchor'>;
  platform: OsName;
  log: PluginLog;
  commands: KitCommands;
  contributions: Pick<FormsContributions, 'cardParts'>;
  recordMount(mount: MarkdownMount): void;
}

// Each kind's card input and kit, as the layout's card builder takes them.
export type CardInputs = {
  [K in keyof LayoutCards]: Parameters<LayoutCards[K]>[1];
};
export type CardKits = {
  [K in keyof LayoutCards]: Parameters<LayoutCards[K]>[2];
};

// How the page shows one kind of item. `index` is 1-based within the kind.
export interface ItemFormat<Input> {
  railPrefix: string;
  title(round: Round, index: number): string;
  // The data a layout builds the item's card from.
  cardInput(round: Round, index: number): Input;
}

export interface AnswerableFormat<Input> extends ItemFormat<Input> {
  choiceTexts(round: Round, index: number): string[];
  // 1-based.
  recommend(round: Round, index: number): number;
}

// Indexing CardInputs by ItemKind stops compiling when a kind has no card in
// the Layout contract.
export type PageFormats = {
  [K in ItemKind]: K extends AnswerableKind
    ? AnswerableFormat<CardInputs[K]>
    : ItemFormat<CardInputs[K]>;
};
