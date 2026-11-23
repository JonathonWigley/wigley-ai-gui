import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorHost } from '../../../contracts/editor';
import type { ListPickerRequest } from '../../../contracts/list-picker';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  asHtml,
  FakeElement,
  FocusFakeElement,
  findAll,
  installFakeDom,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import type { ChatLayouts } from './chat-layouts';
import { createPicker } from './picker';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

const NOOP = () => undefined;

// Appends a part root holding `text` to `parent`, as a layout's builder does.
function drawnPart(parent: HTMLElement, text: string) {
  const root = new FakeElement('div');
  root.textContent = text;
  parent.append(asHtml(root));
  return { element: asHtml(root) };
}

// Draws each row and heading with a text only the fake's builders write.
const layouts = {
  onChange: () => ({ dispose: NOOP }),
  draw(
    part: 'pickerRow' | 'pickerHeading',
    parent: HTMLElement,
    build: (
      builder: unknown,
      at: HTMLElement,
      rollback: unknown,
    ) => { element: HTMLElement },
  ) {
    const builders = {
      pickerRow: (at: HTMLElement, input: { label: string }) =>
        drawnPart(at, `row ${input.label}`),
      pickerHeading: (at: HTMLElement, input: { title: string }) =>
        drawnPart(at, `heading ${input.title}`),
    };
    const built = build(builders[part], parent, { recordAnchor: NOOP });
    return { built, dispose: NOOP };
  },
} as unknown as ChatLayouts;

const filterEditor = {
  create: () => ({ setText: NOOP }),
} as unknown as EditorHost;

// `listOpens` records each request the chat picker hands its list.
function pickerSetup() {
  let layer: FakeElement | null = null;
  const listOpens: ListPickerRequest<unknown>[] = [];
  const service = fakeListPickerService({
    place(element) {
      layer = asFake(element);
    },
    editor: filterEditor,
  });
  const picker = createPicker({
    picker: {
      create(options) {
        const list = service.create(options);
        const open = list.open;
        list.open = (request) => {
          listOpens.push(request as ListPickerRequest<unknown>);
          open(request);
        };
        return list;
      },
    },
    layouts,
    log: NOOP,
    keys: recordingAnchors().keys,
    markdown: {} as never,
    commands: { exists: () => true, argShape: () => undefined, run: NOOP },
    platform: 'macos',
    state: noLayoutState,
  });
  return { picker, layer: layer as unknown as FakeElement, listOpens };
}

function choicesRequest(items: string[], keepFilter?: boolean) {
  return {
    title: 'Branch',
    items,
    label: (item: string) => item,
    rowInput: (item: string) => ({
      list: 'choices' as const,
      label: item,
      isCurrent: false,
    }),
    keepFilter,
    picked: NOOP,
  };
}

describe('chat picker', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws a section heading above its rows through the heading part', () => {
    const { picker, layer } = pickerSetup();
    const sections = new Map([
      ['Fix login', 'Recently closed'],
      ['Add cache', 'Recently closed'],
      ['~/dev/app', 'Folders'],
    ]);

    picker.open<string>({
      title: 'Folder',
      items: [...sections.keys()],
      label: (item) => item,
      rowInput: (item) => ({ list: 'choices', label: item, isCurrent: false }),
      section: (item) => sections.get(item) ?? null,
      picked: NOOP,
    });

    const [list] = findAll(layer, 'ui-picker-list');
    expect(list.children.map((child) => child.textContent)).toEqual([
      'heading Recently closed',
      'row Fix login',
      'row Add cache',
      'heading Folders',
      'row ~/dev/app',
    ]);
  });

  // A kept focus outside an open list of the same scope would sit in a
  // filter box the list just cleared.
  it.each([
    { case: 'OpenInTheSameScope', firstScope: 'picker' as const, keeps: true },
    { case: 'Closed', firstScope: null, keeps: false },
    { case: 'OpenInAnotherScope', firstScope: 'resume' as const, keeps: false },
  ])(
    'open_KeepFilter_ReachesTheListAndKeepsFocus ($case, keeps $keeps)',
    ({ firstScope, keeps }) => {
      const doc = installFocusFakeDom((name, value) =>
        vi.stubGlobal(name, value),
      );
      const { picker, listOpens } = pickerSetup();
      if (firstScope !== null) {
        picker.open({ ...choicesRequest(['main', 'a']), scope: firstScope });
      }
      const box = new FocusFakeElement('input');
      box.focus();

      picker.open(choicesRequest(['main', 'b', 'a'], true));

      expect(listOpens.at(-1)?.keepFilter).toBe(true);
      expect(doc.activeElement === box).toBe(keeps);
    },
  );

  // A replaced request that hears nothing leaves its opener waiting for good;
  // one that hears `cancelled` would end callers that reopen over themselves.
  it.each<{
    case: string;
    act: (picker: ReturnType<typeof createPicker>) => void;
    heard: string[];
  }>([
    { case: 'close', act: (picker) => picker.close(), heard: ['cancelled'] },
    {
      case: 'open in the same scope',
      act: (picker) => picker.open(choicesRequest(['b'])),
      heard: ['superseded'],
    },
    {
      case: 'open in another scope',
      act: (picker) =>
        picker.open({ ...choicesRequest(['b']), scope: 'resume' }),
      heard: ['superseded'],
    },
    {
      case: 'pick, then open',
      act: (picker) => {
        picker.pick();
        picker.open(choicesRequest(['b']));
      },
      heard: ['picked'],
    },
    {
      case: 'close, then open',
      act: (picker) => {
        picker.close();
        picker.open(choicesRequest(['b']));
      },
      heard: ['cancelled'],
    },
  ])('open_EndOfTheRequest_RunsItsOneHook ($case)', ({ act, heard }) => {
    const { picker } = pickerSetup();
    const events: string[] = [];
    picker.open({
      ...choicesRequest(['main', 'a']),
      picked: () => events.push('picked'),
      cancelled: () => events.push('cancelled'),
      superseded: () => events.push('superseded'),
    });

    act(picker);

    expect(events).toEqual(heard);
  });
});
