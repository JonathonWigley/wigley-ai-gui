import type { Disposable } from '../../../../contracts/disposable';
import type { PluginLog } from '../../../../contracts/log';
import type { MarkdownRenderer } from '../../../../contracts/markdown';
import type { OsName } from '../../../../contracts/platform';
import type { KeyHints } from '../../../../contracts/plugin';
import type { LayoutState } from '../../../../contracts/state';
import type { BuiltInItemKind } from '../../contract';
import type { LayoutCards } from '../../layouts/layout';
import type { FormsContributions } from '../contributions';
import type { RoundState, TextTarget } from '../round-model';
import type { KitCommands } from '../../../../shared/page/layout-host/base-kit';
import type { MarkdownMount } from '../../../../shared/page/markdown-mount';

// One item's pane, built once; `update` shows the round's current answers.
export interface ItemCard {
  element: HTMLElement;
  update(round: RoundState): void;
}

// What a card reaches outside itself: the round's boxes, which `placeBox`
// places (returning the box's frame) and `releaseBox` releases, keeping each
// editor, the keys bound in a
// scope and the anchors that show them (a card reads and anchors in the forms
// view's), the platform key hints are drawn for, the log, the registered
// commands `kit.command` checks and runs, which every control of the card
// runs through, the card parts other plugins added, the slots `kit.state`
// reads, where each anchor the kit names, each slot subscription the card
// makes and each contributed part's dispose is recorded, and where each
// markdown mount it makes is recorded for disposal.
export interface CardDeps {
  markdown: MarkdownRenderer;
  placeBox(parent: HTMLElement, target: TextTarget, text: string): HTMLElement;
  releaseBox(target: TextTarget): void;
  keys: Pick<KeyHints, 'keysFor' | 'anchor'>;
  platform: OsName;
  log: PluginLog;
  commands: KitCommands;
  contributions: Pick<FormsContributions, 'cardParts'>;
  state: LayoutState;
  recordAnchor(anchor: Disposable): void;
  recordMount(mount: MarkdownMount): void;
}

// The built-in cards' names: the kinds with a card of their own in the Layout
// contract.
export type BuiltInCard = BuiltInItemKind;

// Each built-in card's input and kit, as the layout's card builder takes
// them.
export type CardInputs = {
  [K in BuiltInCard]: Parameters<LayoutCards[K]>[1];
};
export type CardKits = {
  [K in BuiltInCard]: Parameters<LayoutCards[K]>[2];
};
