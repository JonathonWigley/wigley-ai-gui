import type { Disposable } from '../../contracts/disposable';
import type { Log } from '../../contracts/log';
import type {
  FenceContribution,
  FenceView,
  MarkdownRenderer,
} from '../../contracts/markdown';
import { errorText } from '../error-text';
import { moveConnected } from './dom';

// `liveFences` false keeps every fence whose contribution runs its source as
// code; one that only formats it still draws. True when left out.
export interface MarkdownDrawOptions {
  liveFences?: boolean;
}

// Draws MarkdownRenderer HTML into an element and owns the fence views it
// hydrates. A later draw keeps a view whose fence's language, closed flag and
// source are unchanged when it draws into the view's target, or into a target
// in the same parent that the view's target was removed from or redrew
// without. A sibling that still shows the view keeps it unless it is removed
// before the task's microtasks run. Once they run, a view no draw took, or
// whose target was removed from its parent, is disposed; a target moved to
// another parent keeps its views. A target drawn with no parent is never
// swept as removed. `dispose` disposes every view it holds.
export interface MarkdownMount extends Disposable {
  draw(target: HTMLElement, html: string, options?: MarkdownDrawOptions): void;
}

// A fence placeholder as `block` and `document` emit it.
interface Fence {
  placeholder: HTMLElement;
  language: string;
  closed: boolean;
  source: string;
}

// A view lent to another target's placeholder while its own target may still
// show it; the sweep settles it. `fallback` is what the placeholder held.
interface Borrow {
  oldPlaceholder: HTMLElement;
  fence: Fence;
  fallback: Node[];
  target: HTMLElement;
  host: ParentNode | null;
  liveFences: boolean;
}

// One live view: its fence's key, the target it sits in and that target's
// parent (`host`, null when it was drawn with none) as of the last draw or
// sweep.
interface ViewRecord {
  language: string;
  closed: boolean;
  source: string;
  view: FenceView;
  target: HTMLElement;
  host: ParentNode | null;
  isSuperseded: boolean;
  borrow: Borrow | null;
}

// A record a draw may take, and whether it only borrows it.
interface Candidate {
  record: ViewRecord;
  isBorrowed: boolean;
}

const PLACEHOLDER = '.md-fence';

export function createMarkdownMount(
  fences: Pick<MarkdownRenderer, 'fence'>,
  log: Log,
): MarkdownMount {
  let records: ViewRecord[] = [];
  let isDisposed = false;
  let isSweepQueued = false;

  // The contribution a draw mounts for `fence`; undefined leaves its code.
  const contributionFor = (
    fence: Fence,
    liveFences: boolean,
  ): FenceContribution | undefined => {
    const contribution = fences.fence(fence.language);
    const isSkipped = !liveFences && contribution?.live === true;
    return isSkipped ? undefined : contribution;
  };

  // Mounts a new view into `fence`'s placeholder and records it in `target`;
  // nothing when no contribution mounts it or its `mount` throws.
  const mountNew = (
    fence: Fence,
    contribution: FenceContribution,
    target: HTMLElement,
  ): void => {
    let view: FenceView;
    try {
      view = contribution.mount(fence.source, fence.closed);
    } catch (error) {
      log(
        'markdown',
        `fence ${fence.language} not mounted: ${errorText(error)}`,
      );
      return;
    }
    fence.placeholder.replaceChildren(view.element);
    records.push({
      language: fence.language,
      closed: fence.closed,
      source: fence.source,
      view,
      target,
      host: target.parentNode,
      isSuperseded: false,
      borrow: null,
    });
  };

  const disposeView = (record: ViewRecord): void => {
    try {
      record.view.dispose();
    } catch (error) {
      log(
        'markdown',
        `fence ${record.language} view dispose failed: ${errorText(error)}`,
      );
    }
  };

  // Gives a borrowed view back to its own target when that target still
  // shows it, putting the borrowing placeholder's code back and mounting a
  // new view over it; else hands the record to the borrowing target, which
  // supersedes it when the borrowing placeholder is no longer drawn.
  const settle = (record: ViewRecord, borrow: Borrow): void => {
    record.borrow = null;
    const { fence } = borrow;
    const isStillDrawn = borrow.target.contains(fence.placeholder);
    const isOwnTargetDone = isRemoved(record) || record.isSuperseded;
    if (isOwnTargetDone) {
      record.target = borrow.target;
      record.host = borrow.host;
      record.isSuperseded = !isStillDrawn;
      return;
    }
    moveInto(borrow.oldPlaceholder, record.view.element);
    fence.placeholder.replaceChildren(...borrow.fallback);
    const contribution = contributionFor(fence, borrow.liveFences);
    if (contribution !== undefined && isStillDrawn) {
      mountNew(fence, contribution, borrow.target);
    }
  };

  const sweep = (): void => {
    isSweepQueued = false;
    if (isDisposed) {
      return;
    }
    for (const record of records) {
      if (record.borrow !== null) {
        settle(record, record.borrow);
      }
    }
    const kept: ViewRecord[] = [];
    for (const record of records) {
      if (record.isSuperseded || isRemoved(record)) {
        disposeView(record);
        continue;
      }
      if (record.host !== null) {
        record.host = record.target.parentNode;
      }
      kept.push(record);
    }
    records = kept;
  };

  // Marks every record of `target` that this draw did not take superseded,
  // a lent one included.
  const supersedeUntaken = (
    target: HTMLElement,
    taken: Set<ViewRecord>,
  ): void => {
    for (const record of records) {
      if (record.target === target && !taken.has(record)) {
        record.isSuperseded = true;
      }
    }
  };

  const queueSweep = (): void => {
    if (!isSweepQueued) {
      isSweepQueued = true;
      queueMicrotask(sweep);
    }
  };

  // Own records first, then those whose target was removed from `target`'s
  // parent or was superseded, then the live siblings', which a draw only
  // borrows.
  const candidatesFor = (target: HTMLElement): Candidate[] => {
    const parent = target.parentNode;
    const own: Candidate[] = [];
    const left: Candidate[] = [];
    const siblings: Candidate[] = [];
    for (const record of records) {
      if (record.borrow !== null) {
        continue;
      }
      const isInParent = parent !== null && record.host === parent;
      if (record.target === target) {
        own.push({ record, isBorrowed: false });
      } else if (isInParent && isRemoved(record)) {
        left.push({ record, isBorrowed: false });
      } else if (isInParent && record.isSuperseded) {
        left.push({ record, isBorrowed: false });
      } else if (isInParent) {
        siblings.push({ record, isBorrowed: true });
      }
    }
    return [...own, ...left, ...siblings];
  };

  const drawStaged = (
    target: HTMLElement,
    html: string,
    liveFences: boolean,
    candidates: Candidate[],
  ): void => {
    const staging = document.createElement('div');
    staging.innerHTML = html;
    const taken = new Set<ViewRecord>();
    const placed: { candidate: Candidate; fence: Fence }[] = [];
    const fresh: { fence: Fence; contribution: FenceContribution }[] = [];
    for (const fence of fencesIn(staging)) {
      const contribution = contributionFor(fence, liveFences);
      if (contribution === undefined) {
        continue;
      }
      const candidate = candidates.find(
        ({ record }) => !taken.has(record) && hasKeyOf(record, fence),
      );
      if (candidate === undefined) {
        fresh.push({ fence, contribution });
      } else {
        taken.add(candidate.record);
        placed.push({ candidate, fence });
      }
    }
    const shown = [...target.childNodes];
    target.append(...staging.childNodes);
    for (const { candidate, fence } of placed) {
      const { record } = candidate;
      const oldPlaceholder = record.view.element.parentNode as HTMLElement;
      const fallback = [...fence.placeholder.childNodes];
      moveInto(fence.placeholder, record.view.element);
      record.isSuperseded = false;
      if (candidate.isBorrowed) {
        record.borrow = {
          oldPlaceholder,
          fence,
          fallback,
          target,
          host: target.parentNode,
          liveFences,
        };
      } else {
        record.target = target;
        record.host = target.parentNode;
      }
    }
    for (const node of shown) {
      node.remove();
    }
    supersedeUntaken(target, taken);
    for (const { fence, contribution } of fresh) {
      mountNew(fence, contribution, target);
    }
  };

  return {
    draw(target, html, options = {}) {
      const liveFences = options.liveFences ?? true;
      const candidates = isDisposed ? [] : candidatesFor(target);
      if (candidates.length > 0) {
        drawStaged(target, html, liveFences, candidates);
        queueSweep();
        return;
      }
      target.innerHTML = html;
      if (isDisposed) {
        return;
      }
      supersedeUntaken(target, new Set());
      for (const fence of fencesIn(target)) {
        const contribution = contributionFor(fence, liveFences);
        if (contribution !== undefined) {
          mountNew(fence, contribution, target);
        }
      }
      queueSweep();
    },
    dispose() {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      for (const record of records) {
        disposeView(record);
      }
      records = [];
    },
  };
}

function fencesIn(root: HTMLElement): Fence[] {
  return [...root.querySelectorAll<HTMLElement>(PLACEHOLDER)].map(readFence);
}

function readFence(placeholder: HTMLElement): Fence {
  return {
    placeholder,
    language: placeholder.dataset.fenceLanguage ?? '',
    closed: placeholder.dataset.fenceClosed === 'true',
    source: placeholder.textContent ?? '',
  };
}

function hasKeyOf(record: ViewRecord, fence: Fence): boolean {
  return (
    record.language === fence.language &&
    record.closed === fence.closed &&
    record.source === fence.source
  );
}

// True when the record's target was drawn in a parent and has since been
// removed from it, rather than moved to another.
function isRemoved(record: ViewRecord): boolean {
  return record.host !== null && record.target.parentNode === null;
}

// Puts `element`, which sits in another placeholder, alone in `placeholder`.
function moveInto(placeholder: HTMLElement, element: HTMLElement): void {
  placeholder.replaceChildren();
  moveConnected(placeholder, element);
}
