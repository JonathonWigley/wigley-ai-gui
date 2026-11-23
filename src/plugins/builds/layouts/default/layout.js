// @ts-check

// The built-in Builds look: the side bar's All entry, each backend's heading with its problem under it and its games
// as list rows ending in a status dot; the sheet's game head with a button per kind and set, or the All feed's three
// filter chips; one list row per build (kind, number and version, then branch, revision and subject, ending in its
// state and who queued it), a set run's rows under its heading, and the open build's detail under its row (its step
// text while it lists no job, each job with its progress and step, the status text, then its links and Open in the
// backend); the empty states; the queue picker's rows; the line under a session row (its newest build and its state); the hub's builds
// (each with its branch, revision, jobs and links); and the offer card with its Queue and Dismiss buttons.

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
    kit.entries(element);
    return { element };
  },
  main(parent, kit) {
    const element = kit.el(parent, 'div', 'builds-main-pane');
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
  buildDetail(parent, input, kit) {
    const element = kit.el(parent, 'li', 'builds-detail');
    // A build with jobs shows its step on its running job's line.
    if (input.stepText !== null && input.jobs.length === 0) {
      kit.el(element, 'div', 'builds-muted builds-step', input.stepText);
    }
    for (const job of input.jobs) {
      const line = kit.el(element, 'div', 'builds-job');
      kit.el(line, 'span', 'builds-job-label', job.label);
      drawState(line, { ...job, startsInMs: null }, kit);
      if (job.stepText !== null) {
        kit.el(line, 'span', 'builds-muted builds-step', job.stepText);
      }
    }
    if (input.statusText !== null) {
      kit.el(element, 'p', 'builds-status', input.statusText);
    }
    const hasActions = input.links.length > 0 || input.webUrl !== null;
    if (hasActions) {
      const actions = kit.el(element, 'div', 'builds-actions');
      for (const link of input.links) {
        kit.button(actions, link.label, 'builds.openLink', { arg: link.url });
      }
      if (input.webUrl !== null) {
        kit.button(actions, 'Open in the backend', 'builds.openLink', {
          arg: input.webUrl,
          variant: 'ghost',
        });
      }
    }
    return element;
  },
  empty(parent, input, kit) {
    return kit.emptyState(parent, EMPTY_TEXTS[input.reason]);
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
    if (input.links.length > 0) {
      const actions = kit.el(element, 'div', 'builds-actions');
      for (const link of input.links) {
        kit.button(actions, link.label, 'builds.openLink', { arg: link.url });
      }
    }
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
 * The row's second line: the branch, then the short revision and the commit's subject.
 * @param {import('../layout').BuildRowInput} input
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

export default layout;
