import './gallery.css';
import type { Platform } from '../../../contracts/platform';
import type { UiState } from '../../../contracts/ui-state';
import type { KeysPageExports } from '../../keys/contract';
import { capitalised } from '../../../shared/capitalised';
import { element } from '../../../shared/page/dom';
import { type ButtonVariant, textButton } from '../../../shared/page/ui/button';
import { card, createCollapsibleCard } from '../../../shared/page/ui/card';
import { chip } from '../../../shared/page/ui/chip';
import { createDialog } from '../../../shared/page/ui/dialog';
import { emptyState } from '../../../shared/page/ui/empty-state';
import { floatingPanel } from '../../../shared/page/ui/floating-panel';
import { icon } from '../../../shared/page/ui/icon';
import { iconButton } from '../../../shared/page/ui/icon-button';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { kbd } from '../../../shared/page/ui/kbd';
import { keyPrompt } from '../../../shared/page/ui/key-prompt';
import { row } from '../../../shared/page/ui/row';
import { sectionHeader } from '../../../shared/page/ui/section-header';
import { sheet } from '../../../shared/page/ui/sheet';
import { createSplit } from '../../../shared/page/ui/split';
import { type DotStatus, statusDot } from '../../../shared/page/ui/status-dot';
import { tab, tabStrip } from '../../../shared/page/ui/tabs';
import { tag, type TagTone } from '../../../shared/page/ui/tag';
import { setToggleMark, toggleMark } from '../../../shared/page/ui/toggle-mark';
import { qualify } from '../../../shared/plugin-manifests';
import { galleryManifest } from '../manifest';

export interface GalleryViewDeps {
  platform: Platform;
  uiState: UiState;
  anchor: KeysPageExports['anchor'];
}

// `element` is the mode's root: the transparency status line, ending in the
// `t transparency` hint anchored through `anchor`, a one-tab strip and
// `sheet`, the scrolling sheet holding a section per primitive with each of
// its states. `showTransparency` shows the override in force on the status
// line, null for none.
export interface GalleryView {
  element: HTMLElement;
  sheet: HTMLElement;
  showTransparency(overridden: 'full' | 'reduced' | null): void;
}

// A live sample takes clicks and does nothing with them.
const ignore = () => {};

export function createGalleryView(deps: GalleryViewDeps): GalleryView {
  const { platform } = deps;
  const root = element('div', 'gallery');

  const status = element('div', 'gallery-status');
  const statusText = element('span', 'gallery-status-text');
  const transparencyHint = element('span');
  status.append(statusText, transparencyHint);
  deps.anchor(
    transparencyHint,
    qualify(galleryManifest.id, 'toggleTransparency'),
    {
      scope: qualify(galleryManifest.id, 'gallery'),
      label: 'transparency',
    },
  );

  const strip = tabStrip([tab('Gallery', ignore)]);
  strip.firstElementChild?.classList.add('is-active');

  const gallerySheet = sheet();
  const sections = element('div', 'gallery-sections');
  sections.append(
    materialsSection(),
    kbdSection(platform),
    keyPromptSection(platform),
    buttonSection(platform),
    iconButtonSection(),
    chipSection(),
    tagSection(),
    toggleMarkSection(),
    statusDotSection(),
    inputFrameSection(),
    listRowSection(),
    treeRowSection(),
    tabsSection(),
    splitSection(deps.uiState),
    cardSection(),
    collapsibleSection(),
    floatingPanelSection(platform),
    dialogSection(),
    emptyStateSection(platform),
    sectionHeaderSection(platform),
  );
  gallerySheet.append(sections);
  root.append(status, strip, gallerySheet);

  return {
    element: root,
    sheet: gallerySheet,
    showTransparency(overridden) {
      statusText.textContent = `Transparency: ${overridden ?? 'from settings'}`;
    },
  };
}

// A primitive's section: its name over each row of state cells.
function section(name: string, ...rows: HTMLElement[][]): HTMLElement {
  const node = element('section', 'gallery-section');
  node.append(sectionHeader(name));
  for (const cells of rows) {
    const states = element('div', 'gallery-states');
    states.append(...cells);
    node.append(states);
  }
  return node;
}

// A section spanning the whole grid row, its name over `frame`.
function framedSection(name: string, frame: HTMLElement): HTMLElement {
  const node = element('section', 'gallery-section gallery-section--framed');
  node.append(sectionHeader(name), frame);
  return node;
}

function frame(...children: HTMLElement[]): HTMLElement {
  const node = element('div', 'gallery-frame');
  node.append(...children);
  return node;
}

// One state: the sample over its caption. A wide cell gives a sample that
// fills its width, such as a row or a card, a fixed width.
function cell(
  sample: HTMLElement,
  caption: string,
  isWide = false,
): HTMLElement {
  const node = element(
    'figure',
    isWide ? 'gallery-cell gallery-cell--wide' : 'gallery-cell',
  );
  node.append(sample, element('figcaption', 'gallery-caption', caption));
  return node;
}

function withClass<T extends HTMLElement>(node: T, ...classNames: string[]): T {
  node.classList.add(...classNames);
  return node;
}

function disabled<T extends HTMLButtonElement>(node: T): T {
  node.disabled = true;
  return node;
}

function materialsSection(): HTMLElement {
  const sample = (className: string, text: string) =>
    element('div', `gallery-material ${className}`, text);
  return section('Materials', [
    cell(sample('material-chrome', 'Chrome'), 'Chrome', true),
    cell(
      sample('material-chrome material-chrome--dense', 'Chrome, dense'),
      'Chrome, dense',
      true,
    ),
    cell(sample('material-floating', 'Floating'), 'Floating', true),
  ]);
}

function kbdSection(platform: Platform): HTMLElement {
  const hints = ['Space z g', '<A-o>', '<D-Enter>', 'j / k', '1–9'];
  return section(
    'Kbd',
    hints.map((keys) => cell(kbd(keys, platform), keys)),
  );
}

function keyPromptSection(platform: Platform): HTMLElement {
  return section('KeyPrompt', [
    cell(keyPrompt('<A-o>', platform), 'Keys'),
    cell(keyPrompt('s', platform, 'star'), 'Keys and label'),
    cell(
      frame(withClass(keyPrompt('s', platform, 'star'), 'is-hint-hidden')),
      'Hidden, keeps its space',
    ),
  ]);
}

function buttonSection(platform: Platform): HTMLElement {
  const variantRow = (
    variant: ButtonVariant,
    name: string,
    label: string,
    hasSelected: boolean,
  ): HTMLElement[] => {
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
  return section(
    'Button',
    variantRow('primary', 'Primary', 'Submit', false),
    variantRow('secondary', 'Secondary', 'Cancel round', true),
    variantRow('ghost', 'Ghost', 'Close', true),
    variantRow('danger', 'Danger', 'Cancel the round', false),
  );
}

function iconButtonSection(): HTMLElement {
  const states = (make: () => HTMLButtonElement, name: string) => [
    cell(make(), `${name}, live`),
    cell(withClass(make(), 'is-hover'), `${name}, hover`),
    cell(withClass(make(), 'is-pressed'), `${name}, pressed`),
    cell(withClass(make(), 'is-active'), `${name}, active`),
    cell(disabled(make()), `${name}, disabled`),
  ];
  return section(
    'IconButton',
    states(() => iconButton('send', 'Send', ignore), 'Send'),
    states(() => iconButton('close', 'Close', ignore, 'sm'), 'Close, small'),
  );
}

function chipSection(): HTMLElement {
  const make = () => chip('Mode', 'default', ignore) as HTMLButtonElement;
  return section('Chip', [
    cell(make(), 'Live'),
    cell(withClass(make(), 'is-hover'), 'Hover'),
    cell(withClass(make(), 'is-active'), 'Active'),
    cell(disabled(make()), 'Disabled'),
    cell(chip('Effort', 'high', null), 'Static'),
  ]);
}

function tagSection(): HTMLElement {
  const tags: [string, TagTone][] = [
    ['Nit', 'neutral'],
    ['Recommended', 'accent'],
    ['Running', 'running'],
    ['Applied', 'success'],
    ['Minor', 'warning'],
    ['Needs you', 'attention'],
    ['Critical', 'error'],
  ];
  return section(
    'Tag',
    tags.map(([text, tone]) => cell(tag(text, tone), capitalised(tone))),
  );
}

function toggleMarkSection(): HTMLElement {
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
  return section(
    'ToggleMark',
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
  );
}

function statusDotSection(): HTMLElement {
  const statuses: DotStatus[] = [
    'idle',
    'running',
    'success',
    'warning',
    'attention',
    'error',
  ];
  return section(
    'StatusDot',
    statuses.map((status) => cell(statusDot(status), capitalised(status))),
  );
}

// The frame holds no editor, so no box takes the gallery's keys.
function inputFrameSection(): HTMLElement {
  const make = () => {
    const node = inputFrame();
    node.append(element('span', 'gallery-placeholder', 'Type a message'));
    return node;
  };
  return section('InputFrame', [
    cell(make(), 'Default', true),
    cell(withClass(make(), 'is-hover'), 'Hover', true),
    cell(withClass(make(), 'is-cursor'), 'Focus', true),
  ]);
}

function listRowSection(): HTMLElement {
  const make = () =>
    row({
      density: 'list',
      label: 'selftest',
      detail: 'Needs you',
      leading: statusDot('attention'),
      trailing: tag('claude'),
      onClick: ignore,
    });
  return section('Row, list', [
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
  ]);
}

function treeRowSection(): HTMLElement {
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
  return section('Row, tree', [
    cell(tree, 'Depths 0 to 2, depth 1 selected', true),
  ]);
}

// A click on a tab moves `is-active` to it and shows its name on the sheet.
function tabsSection(): HTMLElement {
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
  return section('Tabs', [
    cell(sample, 'Form active, Chat hover; a click moves active', true),
  ]);
}

function splitSection(uiState: UiState): HTMLElement {
  const split = createSplit({
    uiState,
    stateKey: 'split',
    initial: 240,
    min: 160,
    max: 400,
  });
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
  return framedSection('Split', frame(split.element));
}

function cardSection(): HTMLElement {
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
  return section('Card', [
    cell(withText(card(), 'A card on the sheet.'), 'Default', true),
    cell(
      withText(withClass(card(), 'is-cursor'), 'A card on the sheet.'),
      'Cursor',
      true,
    ),
    cell(attention, 'Attention', true),
    cell(withText(card('error'), 'The agent stopped.'), 'Error', true),
  ]);
}

function collapsibleSection(): HTMLElement {
  const body = () => element('p', 'gallery-card-text', 'Tests passed');
  return section('Collapsible card', [
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
  ]);
}

function floatingPanelSection(platform: Platform): HTMLElement {
  const panel = floatingPanel();
  panel.append(
    sectionHeader('Space z'),
    row({ density: 'list', label: 'Gallery', trailing: kbd('g', platform) }),
    row({ density: 'list', label: 'Layouts', trailing: kbd('l', platform) }),
  );
  return framedSection('FloatingPanel', frame(panel));
}

function dialogSection(): HTMLElement {
  const dialog = createDialog('Cancel the round?');
  dialog.body.append(element('p', '', 'The agent gets no answers.'));
  dialog.actions.append(
    textButton('Keep it', ignore),
    textButton('Cancel the round', ignore, { variant: 'danger' }),
  );
  dialog.show();
  return framedSection(
    'Dialog',
    withClass(frame(dialog.element), 'gallery-frame--dialog'),
  );
}

function emptyStateSection(platform: Platform): HTMLElement {
  return section('EmptyState', [
    cell(
      emptyState('No sessions yet. Start one with', kbd('Space k n', platform)),
      'Default',
    ),
  ]);
}

function sectionHeaderSection(platform: Platform): HTMLElement {
  return section('SectionHeader', [
    cell(sectionHeader('Findings'), 'Plain', true),
    cell(
      sectionHeader('Keys', kbd('Space ?', platform)),
      'With a trailing hint',
      true,
    ),
  ]);
}
