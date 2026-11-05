import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Registrations } from '../../../contracts/disposable';
import { createRegistrations } from '../../../shared/registrations';
import {
  fakeDependency,
  noCounts,
  startPagePart,
  type PartCounts,
} from '../../../shared/plugin-part-harness.test-support';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import {
  type ChatComposerPart,
  type ChatPageExports,
  type ChatSidePart,
  chatPageKey,
} from '../../chat/contract';
import { type DocsPageExports, docsPageKey } from '../../docs/contract';
import { type KeysPageExports, keysPageKey } from '../../keys/contract';
import {
  type SessionPart,
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import type {
  PageStage,
  PageWorkflow,
  SessionFlow,
  StripInput,
  WorkflowDraw,
  WorkflowPageExports,
} from '../contract';
import { newFlow } from '../flow';
import { workflowPagePart } from './start';

const NONE_LIVE: PartCounts = noCounts;

const noHandle = (consumer: Registrations) => () =>
  consumer.track({ dispose: () => undefined });

// Files `part` in `parts` until its registration is disposed.
function holdsPart<T>(consumer: Registrations, parts: Set<T>, part: T) {
  parts.add(part);
  return consumer.track({ dispose: () => parts.delete(part) });
}

// Workflow's page part over fakes that file each part they take under it, as
// sessions' and chat's views do.
function startWorkflow() {
  installFakeDom((name, value) => vi.stubGlobal(name, value));
  const rowParts = new Set<SessionPart>();
  const composerParts = new Set<ChatComposerPart>();
  const sideParts = new Set<ChatSidePart>();
  const harness = startPagePart(workflowPagePart, {
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        (consumer) =>
          ({
            addRowPart: (part: SessionPart) =>
              holdsPart(consumer, rowParts, part),
            addTab: noHandle(consumer),
            selectedSessionId: () => null,
            setActivity: () => undefined,
          }) as unknown as SessionsPageExports,
      ),
      fakeDependency(
        chatPageKey,
        (consumer) =>
          ({
            addComposerPart: (part: ChatComposerPart) =>
              holdsPart(consumer, composerParts, part),
            addSidePart: (part: ChatSidePart) =>
              holdsPart(consumer, sideParts, part),
          }) as unknown as ChatPageExports,
      ),
      fakeDependency(
        docsPageKey,
        () => ({ openDoc: () => undefined }) as unknown as DocsPageExports,
      ),
      fakeDependency(
        keysPageKey,
        (consumer) =>
          ({
            anchor: noHandle(consumer),
            keysFor: () => null,
          }) as unknown as KeysPageExports,
      ),
    ],
    invoke: () => Promise.resolve([]),
  });
  const exportsFor = (consumer: Registrations) =>
    harness.started().exports?.(consumer) as WorkflowPageExports;
  const ids = () => [...sideParts].map((part) => part.id);
  return { harness, exportsFor, rowParts, composerParts, sideParts, ids };
}

function stageOf(id: string, order: number): PageStage {
  return {
    id,
    label: id,
    inStepper: true,
    order,
    actions: [],
    detail: () => '',
    status: () => 'running',
  };
}

// A workflow `light` over a draw that records each strip and draws one `div` for
// each part.
function stubLight(stages: readonly PageStage[] = [stageOf('build', 10)]) {
  const strips: StripInput[] = [];
  const part = (parent: HTMLElement) => {
    const element = asHtml(new FakeElement('div'));
    parent.append(element);
    return { element, dispose: () => element.remove() };
  };
  const draw: WorkflowDraw = {
    sideTitle: 'List',
    chip: part,
    strip(parent, input) {
      strips.push(input);
      return part(parent);
    },
    sidePane: part,
  };
  const workflow: PageWorkflow = {
    id: 'light',
    label: 'Light',
    badge: 'L',
    stages,
    draw,
    runAction: async () => undefined,
  };
  return { workflow, strips };
}

function flowOfLight(stage: string): SessionFlow {
  return { ...newFlow('s1', '/p'), workflow: 'light', stage };
}

describe('workflow page part', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stop_LeavesNoLiveRegistration', async () => {
    const { harness } = startWorkflow();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(NONE_LIVE);
  });

  it('stopThenStart_StartsAgain', async () => {
    const { harness } = startWorkflow();

    await harness.restart();

    expect(Object.keys(harness.started().commands)).toContain('mainAction');
    await harness.stop();
    expect(harness.counts()).toEqual(NONE_LIVE);
  });

  it('start_AddsHeavysSidePart', () => {
    const { sideParts } = startWorkflow();

    expect(
      [...sideParts].map(({ id, title, order }) => [id, title, order]),
    ).toEqual([['workflow-heavy.sidePane', 'Plan', 20]]);
  });

  it('exports_AddWorkflow_DrawsAndConsumerDisposeRemovesBoth', () => {
    const { harness, exportsFor, rowParts, ids } = startWorkflow();
    const consumer = createRegistrations();
    const { workflow } = stubLight();
    const wrapper = new FakeElement('div');

    exportsFor(consumer).addWorkflow(workflow);
    harness.send('flows', [flowOfLight('build')]);
    [...rowParts][0].build(asHtml(wrapper), 's1');
    const whileAdded = { chip: wrapper.children.length, ids: ids() };
    consumer.dispose();

    expect(whileAdded.chip).toBe(1);
    expect(whileAdded.ids).toContain('light.sidePane');
    expect(wrapper.children).toHaveLength(0);
    expect(ids()).not.toContain('light.sidePane');
    expect(() =>
      exportsFor(createRegistrations()).addWorkflow(workflow),
    ).not.toThrow();
  });

  it('exports_AddWorkflow_HeldId_Throws', () => {
    const { exportsFor } = startWorkflow();
    const consumer = createRegistrations();
    const { workflow } = stubLight();
    exportsFor(consumer).addWorkflow(workflow);

    expect(() => exportsFor(consumer).addWorkflow(workflow)).toThrow(
      'light is already added',
    );
  });

  it('AddWorkflow_Sorts', () => {
    const { harness, exportsFor, composerParts } = startWorkflow();
    const { workflow, strips } = stubLight([
      stageOf('later', 20),
      stageOf('first', 10),
    ]);
    exportsFor(createRegistrations()).addWorkflow(workflow);
    [...composerParts][0].build(asHtml(new FakeElement('div')), 's1');

    harness.send('flows', [flowOfLight('first')]);

    expect(strips.at(-1)?.steps.map((step) => step.id)).toEqual([
      'first',
      'later',
    ]);
  });

  it('exports_NameTheWorkflowSurface', () => {
    const { exportsFor } = startWorkflow();
    const exported = exportsFor(createRegistrations());

    expect('addStage' in exported).toBe(false);
    expect(typeof exported.createWorkflowDraw).toBe('function');
    expect(typeof exported.runCommand).toBe('function');
  });
});
