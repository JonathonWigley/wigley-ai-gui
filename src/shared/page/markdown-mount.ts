import type { Disposable } from '../../contracts/disposable';
import type { Log } from '../../contracts/log';
import type {
  FenceContribution,
  FenceView,
  MarkdownRenderer,
} from '../../contracts/markdown';
import { errorText } from '../error-text';

// `liveFences` false keeps every fence whose contribution runs its source as
// code; one that only formats it still draws. True when left out.
export interface MarkdownDrawOptions {
  liveFences?: boolean;
}

// Draws MarkdownRenderer HTML into an element and owns the fence views it
// hydrates. A later draw into the same target, or into a target in the same
// parent, keeps a view whose fence's language, closed flag and source are
// unchanged; a view no later draw took is disposed once the task's
// microtasks run. `dispose` disposes every view it holds.
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
// show it; the sweep settles it.
interface Borrow {
  oldPlaceholder: HTMLElement;
  fence: Fence;
  target: HTMLElement;
  host: ParentNode | null;
  liveFences: boolean;
}

// One live view: its fence's key, the target it sits in and that target's
// parent at its draw (`host`, null when it had none).
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

// `moveBefore` keeps an iframe loaded as it moves; lib.dom declares it only
// on Document.
type MovingParent = HTMLElement & {
  moveBefore?(node: Node, child: Node | null): void;
};

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
  // shows, mounting a new one into the borrowing placeholder; else hands the
  // record to the borrowing target.
  const settle = (record: ViewRecord, borrow: Borrow): void => {
    record.borrow = null;
    const isOwnTargetGone = record.target.parentNode !== record.host;
    if (isOwnTargetGone) {
      record.target = borrow.target;
      record.host = borrow.host;
      return;
    }
    moveInto(borrow.oldPlaceholder, record.view.element);
    const { fence } = borrow;
    const contribution = contributionFor(fence, borrow.liveFences);
    const isStillDrawn = borrow.target.contains(fence.placeholder);
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
      const hasLeftHost =
        record.host !== null && record.target.parentNode !== record.host;
      if (record.isSuperseded || hasLeftHost) {
        disposeView(record);
      } else {
        kept.push(record);
      }
    }
    records = kept;
  };

  const queueSweep = (): void => {
    if (!isSweepQueued) {
      isSweepQueued = true;
      queueMicrotask(sweep);
    }
  };

  // Own records first, then those whose target left `target`'s parent or
  // was superseded, then the live siblings', which a draw only borrows.
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
      } else if (isInParent && record.target.parentNode !== parent) {
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
      moveInto(fence.placeholder, record.view.element);
      record.isSuperseded = false;
      if (candidate.isBorrowed) {
        record.borrow = {
          oldPlaceholder,
          fence,
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
    for (const record of records) {
      if (record.target === target && !taken.has(record)) {
        record.isSuperseded = true;
      }
    }
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

// Puts `element`, which sits in another placeholder, alone in `placeholder`,
// through `moveBefore` when both are connected, so a frame in it stays
// loaded.
function moveInto(placeholder: MovingParent, element: HTMLElement): void {
  const canMoveConnected =
    typeof placeholder.moveBefore === 'function' &&
    placeholder.isConnected &&
    element.isConnected;
  if (canMoveConnected) {
    placeholder.replaceChildren();
    placeholder.moveBefore!(element, null);
  } else {
    placeholder.replaceChildren(element);
  }
}
