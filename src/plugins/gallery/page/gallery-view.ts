import './gallery.css';
import type { Timers } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { ResizeTarget } from '../../../contracts/panes';
import type { OsName } from '../../../contracts/platform';
import type { ShownLayouts } from '../../../contracts/plugin';
import type { UiState } from '../../../contracts/ui-state';
import { capitalised } from '../../../shared/capitalised';
import { element } from '../../../shared/page/dom';
import { type ButtonVariant, textButton } from '../../../shared/page/ui/button';
import { card, createCollapsibleCard } from '../../../shared/page/ui/card';
import { chip } from '../../../shared/page/ui/chip';
import { createDialog } from '../../../shared/page/ui/dialog';
import {
  createDragReorder,
  type DragReorder,
} from '../../../shared/page/ui/drag-reorder';
import { emptyState } from '../../../shared/page/ui/empty-state';
import { floatingPanel } from '../../../shared/page/ui/floating-panel';
import { createHScroller } from '../../../shared/page/ui/h-scroller';
import { icon } from '../../../shared/page/ui/icon';
import { iconButton } from '../../../shared/page/ui/icon-button';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { kbd } from '../../../shared/page/ui/kbd';
import {
  type AnchorNamer,
  boxHint,
  keyChevron,
  keyEdge,
  keyStack,
} from '../../../shared/page/ui/key-anchors';
import { keyPrompt } from '../../../shared/page/ui/key-prompt';
import { type MeterTone, meter } from '../../../shared/page/ui/meter';
import { row } from '../../../shared/page/ui/row';
import { sectionHeader } from '../../../shared/page/ui/section-header';
import { sheet } from '../../../shared/page/ui/sheet';
import { createSplit, type Split } from '../../../shared/page/ui/split';
import { type DotStatus, statusDot } from '../../../shared/page/ui/status-dot';
import { tab, tabStrip } from '../../../shared/page/ui/tabs';
import { tag, type TagTone } from '../../../shared/page/ui/tag';
import { setToggleMark, toggleMark } from '../../../shared/page/ui/toggle-mark';
import type { GalleryHeadInput, Layout } from '../layouts/layout';
import {
  createGalleryParts,
  type GalleryPartsDeps,
  type SampleCell,
} from './layout/gallery-parts';

// What the view reads: the sample primitives' platform, the split sample's
// saved width and the timers its resize prompt lingers on, and what the
// gallery's layout parts read.
export interface GalleryViewDeps extends GalleryPartsDeps {
  uiState: UiState;
  timers: Timers;
}

// What the split sample builds its split with.
interface SplitSampleDeps {
  uiState: UiState;
  anchor: AnchorNamer<never>;
  timers: Timers;
}

// The split the split sample made last; null until the first draw.
interface KeptSplit {
  split: Split | null;
}

// The HScroller samples' scrollers and state observers the last draw made.
interface KeptHScrollers {
  disposables: Disposable[];
}

// The drag the DragReorder sample made last; null until the first draw.
interface KeptDragReorder {
  reorder: DragReorder | null;
}

// `element` is the mode's root: the transparency status line (the layout's
// `head`), a one-tab strip and `sheet`, the scrolling sheet holding a section
// per primitive with each of its states. `showTransparency` draws the head
// again with the override in force, null for none. `setLayouts` draws the head
// and every section again in the new layouts, with fresh samples, at the same
// scroll position. `resizeTarget` is the split sample the last draw made,
// which the resize keys move while the mode shows; each `setLayouts` makes a
// new one, so the caller reads it again after. `dispose` disposes the HScroller
// samples' scrollers and observers and the split sample the last draw made; a
// second `dispose` does nothing.
export interface GalleryView {
  element: HTMLElement;
  sheet: HTMLElement;
  showTransparency(overridden: Transparency): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  resizeTarget(): ResizeTarget;
  dispose(): void;
}

// The transparency override in force, null when the setting decides.
type Transparency = GalleryHeadInput['transparency'];

// A primitive's block: its name, and either rows of state cells or one
// framed sample, built fresh on each draw.
type SectionSpec =
  | { kind: 'section'; name: string; cells(): SampleCell[][] }
  | { kind: 'framed'; name: string; isDialog: boolean; sample(): HTMLElement };

// A live sample takes clicks and does nothing with them.
const ignore = () => {};

// The view, its head drawn with `transparency`, the override in force at the
// start.
export function createGalleryView(
  deps: GalleryViewDeps,
  transparency: Transparency,
): GalleryView {
  const parts = createGalleryParts(deps);
  const root = element('div', 'gallery');
  // The head's slot draws no box, so the head lays out as the root's child.
  const headSlot = element('div');
  headSlot.style.display = 'contents';

  const strip = tabStrip([tab('Gallery', ignore)]);
  strip.firstElementChild?.classList.add('is-active');

  const gallerySheet = sheet();
  const sections = element('div', 'gallery-sections');
  gallerySheet.append(sections);
  root.append(headSlot, strip, gallerySheet);

  const kept: KeptSplit = { split: null };
  const keptHScrollers: KeptHScrollers = { disposables: [] };
  const keptDragReorder: KeptDragReorder = { reorder: null };
  const specs = sectionSpecs(
    deps.platform,
    {
      uiState: deps.uiState,
      anchor: deps.keys.anchor,
      timers: deps.timers,
    },
    kept,
    { log: deps.log, kept: keptHScrollers },
    keptDragReorder,
  );
  let headInput: GalleryHeadInput = { transparency };

  const drawHead = () => parts.drawHead(headSlot, headInput);
  const drawSections = () => {
    for (const spec of specs) {
      if (spec.kind === 'section') {
        parts.drawSection(sections, spec.name, spec.cells());
      } else {
        parts.drawFramedSection(
          sections,
          { name: spec.name, isDialog: spec.isDialog },
          spec.sample(),
        );
      }
    }
  };
  drawHead();
  drawSections();

  return {
    element: root,
    sheet: gallerySheet,
    showTransparency(overridden) {
      headInput = { transparency: overridden };
      drawHead();
    },
    setLayouts(next) {
      parts.setLayouts(next);
      const scrollTop = gallerySheet.scrollTop;
      drawHead();
      drawSections();
      gallerySheet.scrollTop = scrollTop;
    },
    resizeTarget() {
      // The view draws its sections as it is made, so a split is kept.
      if (kept.split === null) {
        throw new Error('the gallery drew no split sample');
      }
      return kept.split;
    },
    dispose() {
      disposeHScrollers(keptHScrollers);
      kept.split?.dispose();
      kept.split = null;
      keptDragReorder.reorder?.dispose();
      keptDragReorder.reorder = null;
    },
  };
}

// Every primitive's block, in the order the sheet shows them. `kept` holds the
// split the split sample made last; `hScrollers` what the HScroller samples
// log through and the scrollers they made last; `keptDragReorder` the drag the
// DragReorder sample made last.
function sectionSpecs(
  platform: OsName,
  splitDeps: SplitSampleDeps,
  kept: KeptSplit,
  hScrollers: { log: PluginLog; kept: KeptHScrollers },
  keptDragReorder: KeptDragReorder,
): SectionSpec[] {
  return [
    section('Materials', materialsCells),
    section('Kbd', () => kbdCells(platform)),
    section('KeyPrompt', () => keyPromptCells(platform)),
    section('Key anchors', () => keyAnchorsCells(platform)),
    section('Button', () => buttonCells(platform)),
    section('IconButton', iconButtonCells),
    section('Chip', chipCells),
    section('Tag', tagCells),
    section('ToggleMark', toggleMarkCells),
    section('StatusDot', statusDotCells),
    section('Meter', meterCells),
    section('InputFrame', inputFrameCells),
    section('Row, list', listRowCells),
    section('Row, tree', treeRowCells),
    section('Tabs', tabsCells),
    framed('Split', () => splitSample(splitDeps, kept)),
    section('HScroller', () => hScrollerCells(hScrollers.log, hScrollers.kept)),
    section('Card', cardCells),
    section('Collapsible card', collapsibleCells),
    framed('FloatingPanel', () => floatingPanelSample(platform)),
    framed('Dialog', dialogSample, true),
    section('EmptyState', () => emptyStateCells(platform)),
    section('SectionHeader', () => sectionHeaderCells(platform)),
    section('DragReorder', () => dragReorderCells(keptDragReorder)),
  ];
}

// A primitive's block of state cells.
function section(name: string, cells: () => SampleCell[][]): SectionSpec {
  return { kind: 'section', name, cells };
}

// A block spanning the whole grid row, its name over one framed sample.
function framed(
  name: string,
  sample: () => HTMLElement,
  isDialog = false,
): SectionSpec {
  return { kind: 'framed', name, isDialog, sample };
}

// One state: the sample over its caption. A wide cell gives a sample that
// fills its width, such as a row or a card, a fixed width.
function cell(
  sample: HTMLElement,
  caption: string,
  isWide = false,
): SampleCell {
  return { sample, caption, isWide };
}

function withClass<T extends HTMLElement>(node: T, ...classNames: string[]): T {
  node.classList.add(...classNames);
  return node;
}

function disabled<T extends HTMLButtonElement>(node: T): T {
  node.disabled = true;
  return node;
}

function materialsCells(): SampleCell[][] {
  const sample = (className: string, text: string) =>
    element('div', `gallery-material ${className}`, text);
  return [
    [
      cell(sample('material-chrome', 'Chrome'), 'Chrome', true),
      cell(
        sample('material-chrome material-chrome--dense', 'Chrome, dense'),
        'Chrome, dense',
        true,
      ),
      cell(sample('material-floating', 'Floating'), 'Floating', true),
    ],
  ];
}

function kbdCells(platform: OsName): SampleCell[][] {
  const hints = ['Space z g', '<A-o>', '<D-Enter>', 'j / k', '1–9'];
  return [hints.map((keys) => cell(kbd(keys, platform), keys))];
}

// `sample` between two words, so its kept or dropped space shows.
function between(sample: HTMLElement): HTMLElement {
  const node = element('span', 'gallery-hint-line');
  node.append('before', sample, 'after');
  return node;
}

function keyPromptCells(platform: OsName): SampleCell[][] {
  return [
    [
      cell(keyPrompt('<A-o>', platform), 'Keys'),
      cell(keyPrompt('s', platform, 'star'), 'Keys and label'),
      cell(
        between(withClass(keyPrompt('s', platform, 'star'), 'is-hint-hidden')),
        'Hidden, keeps its space',
      ),
    ],
  ];
}

// The parts views build around anchors. Each sample anchor is a span holding
// a KeyPrompt, as the core draws it; an unbound one is empty.
function keyAnchorsCells(platform: OsName): SampleCell[][] {
  const shown = (keys: string, label?: string) => {
    const node = element('span', 'ui-key-anchor');
    node.append(keyPrompt(keys, platform, label));
    return node;
  };
  const hidden = (keys: string, label?: string) =>
    withClass(shown(keys, label), 'is-hint-hidden');
  const unbound = () => element('span', 'ui-key-anchor');
  const sessionPair = () =>
    keyEdge('', [
      shown('<A-S-i>'),
      keyChevron('▲'),
      keyChevron('▼'),
      shown('<A-S-o>'),
    ]);
  const onFrame = (hint: HTMLElement) => {
    const node = inputFrame();
    node.classList.add('gallery-box-hint-frame');
    node.append(element('span', 'gallery-placeholder', 'Type a note'), hint);
    return node;
  };
  return [
    [
      cell(keyEdge('', [keyChevron('‹ tree'), shown('<A-h>')]), 'Chevron'),
      cell(
        between(keyEdge('', [keyChevron('‹ tree'), hidden('<A-h>')])),
        'Chevron, anchor hidden',
      ),
      cell(between(keyEdge('', [keyChevron('›'), unbound()])), 'Unbound'),
    ],
    [
      cell(sessionPair(), 'Edge prompt'),
      cell(
        between(withClass(sessionPair(), 'is-no-target')),
        'Edge, no target, keeps its space',
      ),
    ],
    [
      cell(
        onFrame(boxHint('', [shown('<S-Tab>'), shown('<Tab>')])),
        'Box hint',
        true,
      ),
      cell(
        onFrame(boxHint('', [hidden('<S-Tab>'), hidden('<Tab>')])),
        'Box hint, hidden, paints nothing',
        true,
      ),
    ],
    [
      cell(
        between(
          keyStack('', [hidden('<D-Enter>'), shown('<D-Enter>', 'send')]),
        ),
        'Stack, one scope in force',
      ),
      cell(
        between(
          keyStack('', [hidden('<D-Enter>'), hidden('<D-Enter>', 'send')]),
        ),
        'Stack, hidden, keeps its space',
      ),
      cell(between(keyStack('', [unbound(), unbound()])), 'Unbound, no space'),
    ],
  ];
}

function buttonCells(platform: OsName): SampleCell[][] {
  const variantRow = (
    variant: ButtonVariant,
    name: string,
    label: string,
    hasSelected: boolean,
  ): SampleCell[] => {
    const make = () =>
      textButton(label, ignore, {
        variant,
        hint: variant === 'primary' ? kbd('<D-Enter>', platform) : null,
      });
    return [
      cell(make(), `${name}, live`),
      cell(withClass(make(), 'is-hover'), `${name}, hover`),
      cell(withClass(make(), 'is-pressed'), `${name}, pressed`),
      ...(hasSelected
        ? [cell(withClass(make(), 'is-selected'), `${name}, selected`)]
        : []),
      cell(disabled(make()), `${name}, disabled`),
    ];
  };
  return [
    variantRow('primary', 'Primary', 'Submit', false),
    variantRow('secondary', 'Secondary', 'Cancel round', true),
    variantRow('ghost', 'Ghost', 'Close', true),
    variantRow('danger', 'Danger', 'Cancel the round', false),
  ];
}

function iconButtonCells(): SampleCell[][] {
  const states = (make: () => HTMLButtonElement, name: string) => [
    cell(make(), `${name}, live`),
    cell(withClass(make(), 'is-hover'), `${name}, hover`),
    cell(withClass(make(), 'is-pressed'), `${name}, pressed`),
    cell(withClass(make(), 'is-active'), `${name}, active`),
    cell(disabled(make()), `${name}, disabled`),
  ];
  return [
    states(() => iconButton('send', 'Send', ignore), 'Send'),
    states(() => iconButton('close', 'Close', ignore, 'sm'), 'Close, small'),
  ];
}

function chipCells(): SampleCell[][] {
  const make = () => chip('Mode', 'default', ignore) as HTMLButtonElement;
  return [
    [
      cell(make(), 'Live'),
      cell(withClass(make(), 'is-hover'), 'Hover'),
      cell(withClass(make(), 'is-active'), 'Active'),
      cell(disabled(make()), 'Disabled'),
      cell(chip('Effort', 'high', null), 'Static'),
    ],
  ];
}

function tagCells(): SampleCell[][] {
  const tags: [string, TagTone][] = [
    ['Nit', 'neutral'],
    ['Recommended', 'accent'],
    ['Running', 'running'],
    ['Applied', 'success'],
    ['Minor', 'warning'],
    ['Needs you', 'attention'],
    ['Critical', 'error'],
  ];
  return [tags.map(([text, tone]) => cell(tag(text, tone), capitalised(tone)))];
}

function toggleMarkCells(): SampleCell[][] {
  const make = (isOn: boolean) =>
    toggleMark({ isOn, label: 'Include the item', onToggle: ignore });
  let isLiveOn = false;
  const live = toggleMark({
    isOn: isLiveOn,
    label: 'Include the item',
    onToggle: () => {
      isLiveOn = !isLiveOn;
      setToggleMark(live, isLiveOn);
    },
  });
  return [
    [
      cell(make(false), 'Off'),
      cell(make(true), 'On'),
      cell(withClass(make(false), 'is-hover'), 'Off, hover'),
      cell(withClass(make(true), 'is-hover'), 'On, hover'),
      cell(withClass(make(false), 'is-pressed'), 'Off, pressed'),
      cell(disabled(make(false)), 'Off, disabled'),
      cell(disabled(make(true)), 'On, disabled'),
      cell(live, 'Live'),
    ],
    [
      cell(
        row({
          density: 'list',
          label: 'Write the store',
          leading: make(true),
        }),
        'Beside a row label',
        true,
      ),
    ],
  ];
}

function statusDotCells(): SampleCell[][] {
  const statuses: DotStatus[] = [
    'idle',
    'running',
    'success',
    'warning',
    'attention',
    'error',
  ];
  return [
    statuses.map((status) => cell(statusDot(status), capitalised(status))),
  ];
}

function meterCells(): SampleCell[][] {
  const samples: { percent: number; tone: MeterTone }[] = [
    { percent: 30, tone: 'normal' },
    { percent: 75, tone: 'warning' },
    { percent: 95, tone: 'critical' },
  ];
  return [
    samples.map(({ percent, tone }) =>
      cell(meter(percent, tone), `${capitalised(tone)}, ${percent}%`),
    ),
  ];
}

// The frame holds no editor, so no box takes the gallery's keys.
function inputFrameCells(): SampleCell[][] {
  const make = () => {
    const node = inputFrame();
    node.append(element('span', 'gallery-placeholder', 'Type a message'));
    return node;
  };
  return [
    [
      cell(make(), 'Default', true),
      cell(withClass(make(), 'is-hover'), 'Hover', true),
      cell(withClass(make(), 'is-cursor'), 'Focus', true),
    ],
  ];
}

function listRowCells(): SampleCell[][] {
  const make = () =>
    row({
      density: 'list',
      label: 'selftest',
      detail: 'Needs you',
      leading: statusDot('attention'),
      trailing: tag('claude'),
      onClick: ignore,
    });
  return [
    [
      cell(make(), 'Live', true),
      cell(withClass(make(), 'is-hover'), 'Hover', true),
      cell(withClass(make(), 'is-selected'), 'Selected', true),
      cell(withClass(make(), 'is-cursor'), 'Cursor', true),
      cell(
        withClass(make(), 'is-selected', 'is-cursor'),
        'Selected and cursor',
        true,
      ),
      cell(withClass(make(), 'is-disabled'), 'Disabled', true),
    ],
  ];
}

function treeRowCells(): SampleCell[][] {
  const tree = element('div', 'gallery-stack');
  const labels = ['Instructions', 'CLAUDE.md', 'style.md'];
  labels.forEach((label, depth) => {
    const node = row({
      density: 'tree',
      label,
      leading: icon('chevron-right'),
      depth,
    });
    node.classList.toggle('is-selected', depth === 1);
    tree.append(node);
  });
  return [[cell(tree, 'Depths 0 to 2, depth 1 selected', true)]];
}

// A click on a tab moves `is-active` to it and shows its name on the sheet.
function tabsCells(): SampleCell[][] {
  const content = element('p', 'gallery-tab-content', 'Form');
  const tabs: HTMLButtonElement[] = [];
  for (const label of ['Form', 'Chat', 'Docs']) {
    const node = tab(label, () => {
      for (const other of tabs) {
        other.classList.toggle('is-active', other === node);
      }
      content.textContent = label;
    });
    tabs.push(node);
  }
  tabs[0].classList.add('is-active');
  tabs[1].classList.add('is-hover');
  const tabSheet = sheet();
  tabSheet.append(content);
  const sample = element('div', 'gallery-tabs');
  sample.append(tabStrip(tabs), tabSheet);
  return [
    [cell(sample, 'Form active, Chat hover; a click moves active', true)],
  ];
}

// A fresh split sample; it disposes the split `kept` holds, and keeps its own
// there.
function splitSample(deps: SplitSampleDeps, kept: KeptSplit): HTMLElement {
  kept.split?.dispose();
  const split = createSplit({
    ...deps,
    stateKey: 'split',
    initial: 240,
    min: 160,
    endMin: 160,
  });
  kept.split = split;
  for (const label of ['First session', 'Second session', 'Third session']) {
    split.start.append(row({ density: 'list', label }));
  }
  split.end.append(
    element(
      'p',
      'gallery-split-text',
      'Drag the line to resize; the width is kept.',
    ),
  );
  return split.element;
}

function disposeHScrollers(kept: KeptHScrollers) {
  for (const disposable of kept.disposables) {
    disposable.dispose();
  }
  kept.disposables = [];
}

// Fresh HScroller samples of Tags; they dispose what `kept` holds and keep
// their own scrollers and observers there. Each sample, once it has a width,
// refreshes and logs its chevron state:
// `[gallery] hscroller <caption>: overflow <bool> back <bool> forward <bool>`.
function hScrollerCells(log: PluginLog, kept: KeptHScrollers): SampleCell[][] {
  disposeHScrollers(kept);
  // `revealed` is the 1-based item revealed before the sample has a layout.
  const sample = (caption: string, count: number, revealed?: number) => {
    const scroller = createHScroller();
    for (let item = 1; item <= count; item++) {
      scroller.track.append(tag(`Item ${item}`));
    }
    if (revealed !== undefined) {
      scroller.reveal(scroller.track.children[revealed - 1] as HTMLElement);
    }
    const observer = new ResizeObserver(([observed]) => {
      if (observed.contentRect.width === 0) {
        return;
      }
      observer.disconnect();
      scroller.refresh();
      log(`hscroller ${caption}: ${hScrollerState(scroller.element)}`);
    });
    observer.observe(scroller.element);
    kept.disposables.push(scroller, { dispose: () => observer.disconnect() });
    return cell(scroller.element, caption, true);
  };
  return [
    [
      sample('No overflow', 2),
      sample('At start', 12),
      sample('In the middle', 12, 6),
      sample('At end', 12, 12),
    ],
  ];
}

// `overflow <bool> back <bool> forward <bool>`, back and forward true while
// that chevron shows.
function hScrollerState(root: HTMLElement): string {
  const [back, forward] = Array.from(
    root.querySelectorAll('.ui-h-scroller-chevron'),
    (chevron) => !chevron.classList.contains('is-no-target'),
  );
  return `overflow ${root.dataset.overflow} back ${back} forward ${forward}`;
}

function cardCells(): SampleCell[][] {
  const attention = card('attention');
  const actions = element('div', 'gallery-actions');
  actions.append(
    textButton('Allow once', ignore, { variant: 'primary' }),
    textButton('Deny', ignore),
  );
  attention.append(element('p', 'gallery-card-text', 'Run npm test?'), actions);
  const withText = (node: HTMLElement, text: string) => {
    node.append(element('p', 'gallery-card-text', text));
    return node;
  };
  return [
    [
      cell(withText(card(), 'A card on the sheet.'), 'Default', true),
      cell(
        withText(withClass(card(), 'is-cursor'), 'A card on the sheet.'),
        'Cursor',
        true,
      ),
      cell(attention, 'Attention', true),
      cell(withText(card('error'), 'The agent stopped.'), 'Error', true),
    ],
  ];
}

function collapsibleCells(): SampleCell[][] {
  const body = () => element('p', 'gallery-card-text', 'Tests passed');
  return [
    [
      cell(
        createCollapsibleCard({
          summary: 'Bash  npm test',
          mono: true,
          leading: statusDot('running'),
          body,
        }).element,
        'Closed, mono',
        true,
      ),
      cell(
        createCollapsibleCard({
          summary: 'Bash  npm test',
          mono: true,
          leading: statusDot('success'),
          open: true,
          body,
        }).element,
        'Open',
        true,
      ),
      cell(
        createCollapsibleCard({ summary: 'Thinking', body }).element,
        'Closed',
        true,
      ),
    ],
    [
      cell(
        createCollapsibleCard({
          summary: 'Bash  npm test',
          mono: true,
          plain: true,
          leading: statusDot('success'),
          body,
        }).element,
        'Plain, closed',
        true,
      ),
      cell(
        createCollapsibleCard({
          summary: 'Bash  npm test',
          mono: true,
          plain: true,
          leading: statusDot('success'),
          open: true,
          body,
        }).element,
        'Plain, open',
        true,
      ),
    ],
  ];
}

function floatingPanelSample(platform: OsName): HTMLElement {
  const panel = floatingPanel();
  panel.append(
    sectionHeader('Space z'),
    row({ density: 'list', label: 'Gallery', trailing: kbd('g', platform) }),
    row({ density: 'list', label: 'Layouts', trailing: kbd('l', platform) }),
  );
  return panel;
}

function dialogSample(): HTMLElement {
  const dialog = createDialog('Cancel the round?');
  dialog.body.append(element('p', '', 'The agent gets no answers.'));
  dialog.actions.append(
    textButton('Keep it', ignore),
    textButton('Cancel the round', ignore, { variant: 'danger' }),
  );
  dialog.show();
  return dialog.element;
}

function emptyStateCells(platform: OsName): SampleCell[][] {
  return [
    [
      cell(
        emptyState(
          'No sessions yet. Start one with',
          kbd('Space k n', platform),
        ),
        'Default',
      ),
    ],
  ];
}

function sectionHeaderCells(platform: OsName): SampleCell[][] {
  return [
    [
      cell(sectionHeader('Findings'), 'Plain', true),
      cell(
        sectionHeader('Keys', kbd('Space ?', platform)),
        'With a trailing hint',
        true,
      ),
    ],
  ];
}

// Fresh DragReorder samples: it disposes the drag `kept` holds and keeps its
// own there. A live ordered zone and a live unordered zone that reorder on
// drop, then each state held still.
function dragReorderCells(kept: KeptDragReorder): SampleCell[][] {
  kept.reorder?.dispose();
  const zones = [
    { id: 'Ordered', isOrdered: true, keys: ['First', 'Second', 'Third'] },
    { id: 'Unordered', isOrdered: false, keys: [] as string[] },
  ].map((zone) => ({ ...zone, element: withClass(card(), 'gallery-stack') }));
  const draw = () => {
    reorder.clear();
    for (const zone of zones) {
      reorder.zone(zone.element, zone.id, { ordered: zone.isOrdered });
      zone.element.replaceChildren(sectionHeader(zone.id));
      for (const key of zone.keys) {
        const item = row({ density: 'list', label: key });
        zone.element.append(item);
        reorder.item(item, item, key, zone.id);
      }
    }
  };
  const reorder = createDragReorder({
    dropped({ key, zone: zoneId, index }) {
      for (const zone of zones) {
        zone.keys = zone.keys.filter((held) => held !== key);
        if (zone.id === zoneId) {
          zone.keys.splice(index, 0, key);
        }
      }
      draw();
    },
    started: ignore,
    ended: ignore,
  });
  kept.reorder = reorder;
  draw();
  const stateRow = (state: string) =>
    withClass(
      row({ density: 'list', label: 'Item' }),
      'ui-drag-reorder-item',
      state,
    );
  return [
    zones.map((zone) => cell(zone.element, `${zone.id}, live`, true)),
    [
      cell(stateRow('is-dragging'), 'Dragging', true),
      cell(stateRow('is-drop-before'), 'Drop before', true),
      cell(stateRow('is-drop-after'), 'Drop after', true),
      cell(
        withClass(
          withClass(card(), 'gallery-stack'),
          'ui-drag-reorder-zone',
          'is-drop-target',
        ),
        'Drop target',
        true,
      ),
    ],
  ];
}
