// @ts-check

// The built-in Builds look: the side bar's queue hint, All entry, each backend's heading with its problem under it
// and its games as list rows ending in a status dot; the list pane's game head with a button per kind and set, or the
// All feed's three filter chips; one list row per build (kind, number and version, then branch, revision and subject,
// ending in its state and who queued it), and a set run's rows under its heading; the detail pane's build head (its
// title, where it was built from, its state, step and status text, then its links, its backend page and a button per
// file with each file's download), its job graph (a box per job in columns left to right, joined by curved arrows from
// each prerequisite to the jobs that wait on it, scrolling sideways), and the selected job's panel (its state, how
// long it ran, its step, then Log ↓ with the log's save and its backend page); the empty states; the pickers' rows;
// the line under a session row (its newest build and its state); the hub's builds (each with its branch, revision,
// jobs, links and Open in Builds); and the offer card with its Queue and Dismiss buttons.

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

// Each drawn graph's arrowhead marker gets its own id, so two graphs on a page never share one.
let markerCount = 0;

// Each drawn graph's arrow observer by the observer, holding the graph's root.
/** @type {Map<ResizeObserver, HTMLElement>} */
const arrowObservers = new Map();

/** @type {Record<import('../layout').EmptyInput['reason'], string>} */
const EMPTY_TEXTS = {
  noBackends: 'No build backends. Add one to builds.backends in settings.json.',
  noGames: 'No tracked games.',
  noBuilds: 'No builds yet.',
  noMatches: 'No builds match the filter.',
};

/** @type {{ filter: import('../layout').FeedHeaderInput['filter']; label: string }[]} */
const FILTER_CHIPS = [
  { filter: 'all', label: 'All' },
  { filter: 'running', label: 'Running' },
  { filter: 'sessions', label: 'From sessions' },
];

/** @type {Record<'success' | 'failure' | 'cancelled', { text: string; tone: import('../../../../shared/page/layout-host/kit').TagTone }>} */
const RESULTS = {
  success: { text: 'Succeeded', tone: 'success' },
  failure: { text: 'Failed', tone: 'error' },
  cancelled: { text: 'Cancelled', tone: 'warning' },
};

/** @type {import('../layout').CompleteBuildsLayout} */
const layout = {
  sideBar(parent, kit) {
    const element = kit.el(parent, 'div', 'builds-side-bar');
    kit.keyHint(element, 'pickQueue', {
      label: true,
      className: 'builds-hint',
    });
    kit.entries(element);
    return { element };
  },
  main(parent, kit) {
    const element = kit.el(parent, 'div', 'builds-main-pane');
    kit.body(element);
    return { element };
  },
  detail(parent, kit) {
    const element = kit.el(parent, 'div', 'builds-detail-pane');
    kit.body(element);
    return { element };
  },
  allEntry(parent, kit) {
    return kit.row(parent, { density: 'list', tag: 'li', label: 'All' });
  },
  backendHeading(parent, input, kit) {
    const element = kit.el(parent, 'li', 'builds-backend-heading');
    kit.sectionHeader(element, input.label);
    if (input.problem !== null) {
      kit.el(element, 'span', 'builds-problem', input.problem);
    }
    return element;
  },
  gameEntry(parent, input, kit) {
    const row = kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.label,
    });
    row.title = input.label;
    kit.statusDot(kit.rowTrailing(row), input.dot);
    return row;
  },
  gameHeader(parent, input, kit) {
    const element = kit.el(parent, 'div', 'builds-game-header');
    const head = kit.el(element, 'div', 'builds-game-title');
    kit.el(head, 'h2', 'builds-heading', input.label);
    kit.el(head, 'span', 'builds-muted', input.backendLabel);
    kit.keyHint(head, 'pickQueue', {
      label: true,
      className: 'builds-hint',
    });
    if (!input.canQueue) {
      return element;
    }
    const actions = kit.el(element, 'div', 'builds-actions');
    for (const kind of input.kinds) {
      kit.button(actions, kind.label, 'builds.queueButton', {
        arg: { backend: input.backendId, game: input.gameId, kind: kind.id },
      });
    }
    for (const set of input.sets) {
      kit.button(actions, set.label, 'builds.queueButton', {
        arg: { backend: input.backendId, game: input.gameId, kind: set.id },
      });
      if (set.withAgent) {
        kit.button(actions, `${set.label} with agent`, 'builds.withAgent', {
          arg: { backend: input.backendId, game: input.gameId, set: set.id },
          variant: 'ghost',
        });
      }
    }
    return element;
  },
  feedHeader(parent, input, kit) {
    const element = kit.el(parent, 'div', 'builds-feed-header');
    for (const chip of FILTER_CHIPS) {
      const button = kit.button(element, chip.label, 'builds.setFilter', {
        arg: chip.filter,
        variant: 'ghost',
      });
      const isShown = chip.filter === input.filter;
      button.classList.add('builds-chip');
      button.classList.toggle('is-selected', isShown);
      button.setAttribute('aria-pressed', String(isShown));
    }
    return element;
  },
  setGroup(parent, input, kit) {
    const element = kit.el(parent, 'li', 'builds-set-group');
    const head = kit.el(element, 'div', 'builds-set-head');
    kit.el(head, 'span', 'builds-set-label', input.label);
    if (input.shortRevision !== null) {
      kit.el(head, 'span', 'builds-revision', input.shortRevision);
    }
    kit.rows(element);
    return element;
  },
  buildRow(parent, input, kit) {
    const row = kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: rowLabel(input),
      detail: rowDetail(input),
    });
    row.classList.add('builds-row');
    const trailing = kit.rowTrailing(row);
    drawState(trailing, input, kit);
    if (input.queuedBy !== null) {
      kit.el(trailing, 'span', 'builds-muted', input.queuedBy);
    }
    return row;
  },
  empty(parent, input, kit) {
    return kit.emptyState(parent, EMPTY_TEXTS[input.reason]);
  },
  buildHeader(parent, input, kit) {
    const element = kit.el(parent, 'div', 'builds-build-header');
    kit.el(element, 'h2', 'builds-heading', headerLabel(input));
    kit.el(element, 'div', 'builds-muted', rowDetail(input));
    const state = kit.el(element, 'div', 'builds-state-line');
    drawState(state, input, kit);
    if (input.stepText !== null) {
      kit.el(element, 'div', 'builds-muted builds-step', input.stepText);
    }
    if (input.statusText !== null) {
      kit.el(element, 'p', 'builds-status', input.statusText);
    }
    const actions = kit.el(element, 'div', 'builds-actions');
    for (const link of input.links) {
      kit.button(actions, link.label, 'builds.openLink', { arg: link.url });
    }
    if (input.webUrl !== null) {
      kit.button(actions, `${input.backendLabel} ↗`, 'builds.openLink', {
        arg: input.webUrl,
        variant: 'ghost',
      });
    }
    kit.keyHint(actions, 'openWeb');
    if (input.canCancel) {
      kit.keyHint(actions, 'cancel', { label: true });
    }
    for (const file of input.files) {
      const button = kit.button(
        actions,
        `${file.label} ↓`,
        'builds.downloadFile',
        { arg: file.entry },
      );
      button.classList.add('builds-file-button');
      button.dataset.entry = String(file.entry);
      drawDownload(actions, file.download, kit);
    }
    if (input.files.length > 0) {
      kit.keyHint(actions, 'download');
    }
    return element;
  },
  jobGraph(parent, input, kit) {
    const root = kit.el(parent, 'div', 'builds-graph');
    const grid = kit.el(root, 'div', 'builds-graph-grid');
    /** @type {Map<string, HTMLElement>} */
    const boxes = new Map();
    input.columns.forEach((column, columnIndex) => {
      column.forEach((job, rowIndex) => {
        const box = kit.el(grid, 'div', 'builds-job-box');
        box.dataset.jobId = job.id;
        box.style.gridColumn = String(columnIndex + 1);
        box.style.gridRow = String(rowIndex + 1);
        const label = kit.el(box, 'span', 'builds-job-label', job.label);
        label.title = job.label;
        const state = kit.el(box, 'div', 'builds-state-line');
        drawState(state, { ...job, startsInMs: null }, kit);
        drawRan(state, job, kit);
        boxes.set(job.id, box);
      });
    });
    drawArrows(root, grid, boxes, input.edges);
    return root;
  },
  jobPanel(parent, input, kit) {
    const element = kit.el(parent, 'div', 'builds-job-panel');
    kit.el(element, 'span', 'builds-job-label', input.label);
    const state = kit.el(element, 'div', 'builds-state-line');
    drawState(state, { ...input, startsInMs: null }, kit);
    drawRan(state, input, kit);
    if (input.stepText !== null) {
      kit.el(element, 'div', 'builds-muted builds-step', input.stepText);
    }
    const actions = kit.el(element, 'div', 'builds-actions');
    if (input.canSaveLog) {
      kit.button(actions, 'Log ↓', 'builds.saveLog');
    }
    kit.keyHint(actions, 'saveLog');
    drawDownload(actions, input.log, kit);
    if (input.webUrl !== null) {
      kit.button(actions, `${input.backendLabel} ↗`, 'builds.openLink', {
        arg: input.webUrl,
        variant: 'ghost',
      });
    }
    kit.keyHint(actions, 'openJob');
    return element;
  },
  detailEmpty(parent, _input, kit) {
    return kit.emptyState(parent, 'Pick a build to see its jobs.');
  },
  pickerRow(parent, input, kit) {
    return kit.row(parent, {
      density: 'list',
      tag: 'li',
      label: input.label,
      trailing: kit.trailing(),
    });
  },
  rowLine(parent, input, kit) {
    const element = kit.el(parent, 'div', 'builds-row-line');
    kit.el(element, 'span', 'builds-line-label', buildLabel(input));
    drawState(element, { ...input, startsInMs: null }, kit);
    return element;
  },
  hubBuild(parent, input, kit) {
    const element = kit.el(parent, 'div', 'builds-hub-build');
    const head = kit.el(element, 'div', 'builds-hub-head');
    kit.el(head, 'span', 'builds-line-label', buildLabel(input));
    drawState(
      head,
      { ...input, percent: null, leftMs: null, startsInMs: null },
      kit,
    );
    const where = kit.el(element, 'div', 'builds-muted');
    where.append(input.branch);
    if (input.shortRevision !== null) {
      where.append(' · ');
      kit.el(where, 'span', 'builds-revision', input.shortRevision);
    }
    for (const job of input.jobs) {
      const line = kit.el(element, 'div', 'builds-job');
      kit.el(line, 'span', 'builds-job-label', job.label);
      drawState(line, { ...job, startsInMs: null }, kit);
    }
    const actions = kit.el(element, 'div', 'builds-actions');
    for (const link of input.links) {
      kit.button(actions, link.label, 'builds.openLink', { arg: link.url });
    }
    const open = kit.button(actions, 'Open in Builds', 'builds.showBuild', {
      arg: { backend: input.backendId, build: input.buildId },
      variant: 'ghost',
    });
    open.classList.add('builds-open-in-builds');
    return element;
  },
  offerCard(parent, input, kit) {
    const element = kit.el(parent, 'div', 'builds-offer-card');
    const text = kit.el(element, 'div', 'builds-offer-text');
    kit.el(
      text,
      'span',
      'builds-line-label',
      `Build ${input.gameLabel} ${input.choiceLabel}?`,
    );
    const where = kit.el(text, 'span', 'builds-muted');
    where.append(input.branch);
    if (input.shortRevision !== null) {
      where.append(' · ');
      kit.el(where, 'span', 'builds-revision', input.shortRevision);
    }
    if (input.subject !== null) {
      where.append(` ${input.subject}`);
    }
    const actions = kit.el(element, 'div', 'builds-actions');
    kit.button(actions, 'Queue', 'builds.queueSessionOffer', {
      arg: input.sessionId,
    });
    kit.button(actions, 'Dismiss', 'builds.dismissSessionOffer', {
      arg: input.sessionId,
      variant: 'ghost',
    });
    return element;
  },
};

/**
 * A session part's build: the game, the kind and `#<number>`.
 * @param {{ gameLabel: string; kindLabel: string; number: string | null }} input
 * @returns {string}
 */
function buildLabel(input) {
  const parts = [input.gameLabel, input.kindLabel];
  if (input.number !== null) {
    parts.push(`#${input.number}`);
  }
  return parts.join(' ');
}

/**
 * The row's first line: the game in the All feed, the kind, `#<number>` and `(<version>)`.
 * @param {import('../layout').BuildRowInput} input
 * @returns {string}
 */
function rowLabel(input) {
  const parts = input.inFeed
    ? [input.gameLabel, input.kindLabel]
    : [input.kindLabel];
  if (input.number !== null) {
    parts.push(`#${input.number}`);
  }
  if (input.version !== null) {
    parts.push(`(${input.version})`);
  }
  return parts.join(' ');
}

/**
 * The build head's title: the game, the kind, `#<number>` and `(<version>)`.
 * @param {import('../layout').BuildHeaderInput} input
 * @returns {string}
 */
function headerLabel(input) {
  const parts = [input.gameLabel, input.kindLabel];
  if (input.number !== null) {
    parts.push(`#${input.number}`);
  }
  if (input.version !== null) {
    parts.push(`(${input.version})`);
  }
  return parts.join(' ');
}

/**
 * A row's or a build head's second line: the branch, then the short revision and the commit's subject.
 * @param {{ branch: string; shortRevision: string | null; subject: string | null }} input
 * @returns {string}
 */
function rowDetail(input) {
  const parts = [input.branch];
  if (input.shortRevision !== null) {
    parts.push(
      input.subject === null
        ? input.shortRevision
        : `${input.shortRevision} ${input.subject}`,
    );
  }
  return parts.join(' · ');
}

/**
 * A build's or a job's state: a meter and the time left while it runs (`Running` with no percent), `starts in
 * <time>` or `Queued` while queued, and its result once finished (`Ended` with none).
 * @param {HTMLElement} parent
 * @param {{ state: 'queued' | 'running' | 'finished'; result: 'success' | 'failure' | 'cancelled' | null; percent: number | null; leftMs: number | null; startsInMs: number | null }} input
 * @param {import('../layout').BaseKit} kit
 */
function drawState(parent, input, kit) {
  switch (input.state) {
    case 'running':
      if (input.percent === null) {
        kit.el(parent, 'span', 'builds-state', 'Running');
      } else {
        kit.meter(parent, input.percent, 'normal');
      }
      if (input.leftMs !== null) {
        kit.el(
          parent,
          'span',
          'builds-muted',
          `${kit.duration(input.leftMs)} left`,
        );
      }
      return;
    case 'queued':
      kit.el(
        parent,
        'span',
        'builds-state',
        input.startsInMs === null
          ? 'Queued'
          : `starts in ${kit.duration(input.startsInMs)}`,
      );
      return;
    case 'finished':
      if (input.result === null) {
        kit.tag(parent, 'Ended', 'neutral');
      } else {
        kit.tag(parent, RESULTS[input.result].text, RESULTS[input.result].tone);
      }
  }
}

/**
 * `ran <duration>` once a job or build finished with both its times.
 * @param {HTMLElement} parent
 * @param {{ state: 'queued' | 'running' | 'finished'; durationMs: number | null }} input
 * @param {import('../layout').BaseKit} kit
 */
function drawRan(parent, input, kit) {
  if (input.state === 'finished' && input.durationMs !== null) {
    kit.el(
      parent,
      'span',
      'builds-muted',
      `ran ${kit.duration(input.durationMs)}`,
    );
  }
}

/**
 * A log save's or a file download's state: `Saving…`, a `Saved` Tag and the file's name, or `Failed: <problem>`.
 * @param {HTMLElement} parent
 * @param {import('../layout').DownloadStateInput | null} download
 * @param {import('../layout').BaseKit} kit
 */
function drawDownload(parent, download, kit) {
  if (download === null) {
    return;
  }
  switch (download.state) {
    case 'running':
      kit.el(parent, 'span', 'builds-muted', 'Saving…');
      return;
    case 'saved':
      kit.tag(parent, 'Saved', 'success');
      if (download.fileName !== null) {
        kit.el(parent, 'span', 'builds-muted', download.fileName);
      }
      return;
    case 'failed':
      kit.el(
        parent,
        'span',
        'builds-problem',
        download.problem === null ? 'Failed' : `Failed: ${download.problem}`,
      );
  }
}

/**
 * The graph's arrows: one `svg.builds-graph-arrows` over `grid`, a horizontal curve per edge from the middle of the
 * prerequisite box's end edge to the middle of the dependent box's start edge, its arrowhead at the dependent's end.
 * The paths come from the boxes as laid out: drawn in the next frame and again each time the grid's size changes,
 * nothing while `root` is not in the page. A size change that finds `root` gone stops watching, and so does the next
 * graph's draw, since a grid removed while hidden reports no size change.
 * @param {HTMLElement} root
 * @param {HTMLElement} grid
 * @param {Map<string, HTMLElement>} boxes
 * @param {{ from: string; to: string }[]} edges
 */
function drawArrows(root, grid, boxes, edges) {
  disconnectRemovedGraphs();
  markerCount += 1;
  const markerId = `builds-arrowhead-${markerCount}`;
  const svg = svgNode('svg', 'builds-graph-arrows');
  svg.setAttribute('aria-hidden', 'true');
  grid.append(svg);
  const draw = () => {
    if (!root.isConnected) {
      return;
    }
    const paths = edges.flatMap((edge) => {
      const from = boxes.get(edge.from);
      const to = boxes.get(edge.to);
      if (from === undefined || to === undefined) {
        return [];
      }
      const startX = from.offsetLeft + from.offsetWidth;
      const startY = from.offsetTop + from.offsetHeight / 2;
      const endX = to.offsetLeft;
      const endY = to.offsetTop + to.offsetHeight / 2;
      const bend = (endX - startX) / 2;
      const path = svgNode('path', 'builds-graph-arrow');
      path.setAttribute(
        'd',
        `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`,
      );
      path.setAttribute('marker-end', `url(#${markerId})`);
      return [path];
    });
    svg.replaceChildren(arrowhead(markerId), ...paths);
  };
  requestAnimationFrame(draw);
  const observer = new ResizeObserver(() => {
    if (!root.isConnected) {
      observer.disconnect();
      arrowObservers.delete(observer);
      return;
    }
    draw();
  });
  observer.observe(grid);
  arrowObservers.set(observer, root);
}

// Stops and forgets each arrow observer whose graph is no longer in the page. Runs before a new graph's root is
// placed, so that root, not yet connected, is never among them.
function disconnectRemovedGraphs() {
  for (const [observer, root] of arrowObservers) {
    if (!root.isConnected) {
      observer.disconnect();
      arrowObservers.delete(observer);
    }
  }
}

/**
 * The arrowhead marker the arrows' ends name by `id`.
 * @param {string} id
 * @returns {SVGElement}
 */
function arrowhead(id) {
  const defs = svgNode('defs', 'builds-graph-defs');
  const marker = svgNode('marker', 'builds-graph-arrowhead');
  marker.setAttribute('id', id);
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '10');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight', '8');
  marker.setAttribute('orient', 'auto');
  const head = svgNode('path', 'builds-graph-arrowhead-path');
  head.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  marker.append(head);
  defs.append(marker);
  return defs;
}

/**
 * An SVG element; its `className` is read-only, so its class goes on as an attribute.
 * @param {string} tag
 * @param {string} className
 * @returns {SVGElement}
 */
function svgNode(tag, className) {
  const node = /** @type {SVGElement} */ (
    document.createElementNS(SVG_NAMESPACE, tag)
  );
  node.setAttribute('class', className);
  return node;
}

export default layout;
