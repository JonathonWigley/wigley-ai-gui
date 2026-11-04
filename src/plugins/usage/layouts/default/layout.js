// @ts-check

// The built-in usage look: the status-bar line as every profile stacked, one
// line each, its name before its meters, each meter in a column shared across
// profiles; each session's line as one row (its compacting chip while it
// compacts, its context, cache and spend) in its Chat status line or tab bar
// that drops whole items from its end when narrow, its meter pulsing while it
// compacts; each session's row line as its context meter and used tokens; each
// session's row cache as a cache icon, its tooltip the time left; and the
// details as one card per profile, its freshness beside its name. In the status
// line and the details, the 5h and Week rows always show; any other row (a
// model-scoped limit) shows only while used, and extra usage, the status line's
// last column until the window narrows, only while on and spent.

// Labels the adapter gives the session and weekly limits.
const ALWAYS_SHOWN_ROWS = new Set(['5h', 'Week']);

/** @type {import('../layout').CompleteLayout} */
const layout = {
  statusLine(parent, input, kit) {
    const line = kit.el(parent, 'div', 'usage-status-line');
    if (input.profiles.length === 0) {
      kit.el(line, 'span', 'usage-group usage-note', 'no profiles');
    }
    // Each label shown in any profile owns one column trio (label, meter,
    // text), in first-seen order, so the same meter lines up across profiles;
    // a profile without that label leaves its trio empty.
    const labels = [
      ...new Set(
        input.profiles.flatMap((profile) =>
          profile.plans.filter(isRowShown).map((meter) => meter.label),
        ),
      ),
    ];
    const hasExtraUsage = input.profiles.some(
      (profile) =>
        profile.note === null && isExtraUsageShown(profile.extraUsage),
    );
    const columns = 1 + labels.length * 3 + (hasExtraUsage ? 2 : 0);
    line.style.setProperty('--usage-columns', String(columns));
    for (const profile of input.profiles) {
      const group = kit.el(line, 'span', 'usage-group usage-profile-line');
      group.classList.toggle('is-stale', profile.stale);
      kit.el(group, 'span', 'usage-profile-name', profile.name);
      if (profile.note !== null) {
        kit.el(group, 'span', 'usage-note', profile.note);
        continue;
      }
      const shown = profile.plans.filter(isRowShown);
      for (const label of labels) {
        const meter = shown.find((candidate) => candidate.label === label);
        if (meter === undefined) {
          kit.el(group, 'span', 'usage-label');
          kit.el(group, 'span');
          kit.el(group, 'span');
          continue;
        }
        kit.el(group, 'span', 'usage-label', meter.label);
        kit.meter(group, meter.percent, meter.tone);
        kit.el(group, 'span', 'usage-text', meter.text);
      }
      if (isExtraUsageShown(profile.extraUsage)) {
        kit.el(group, 'span', 'usage-label usage-extra', 'Extra');
        kit.el(group, 'span', 'usage-text usage-extra', profile.extraUsage);
      } else if (hasExtraUsage) {
        kit.el(group, 'span', 'usage-label usage-extra');
        kit.el(group, 'span', 'usage-extra');
      }
    }
    return line;
  },
  sessionLine(parent, input, kit) {
    const line = kit.el(parent, 'span', 'usage-session-line');
    line.classList.toggle('is-compacting', input.compacting !== null);
    if (input.compacting !== null) {
      kit.tag(line, input.compacting, 'accent');
      line.style.setProperty(
        '--usage-compacting-elapsed',
        `${input.compactingElapsedMs}ms`,
      );
    }
    kit.meter(line, input.context.percent, input.context.tone);
    kit.el(line, 'span', 'usage-text', input.context.text);
    if (input.cache !== null) {
      kit.el(line, 'span', 'usage-text', input.cache);
    }
    if (input.spend !== null) {
      kit.el(line, 'span', 'usage-text', input.spend);
    }
    return line;
  },
  rowLine(parent, input, kit) {
    const line = kit.el(parent, 'span', 'usage-row-line');
    kit.meter(line, input.context.percent, input.context.tone);
    kit.el(line, 'span', 'usage-text', input.context.text);
    return line;
  },
  rowCache(parent, input, kit) {
    const mark = kit.el(parent, 'span', 'usage-row-cache');
    kit.icon(mark, 'database');
    mark.title = input.tooltip;
    mark.classList.toggle('is-cold', input.isCold);
    return mark;
  },
  details(parent, input, kit) {
    const root = kit.el(parent, 'div', 'usage-details');
    if (input.profiles.length === 0) {
      kit.el(root, 'p', 'usage-freshness', 'No profiles');
    }
    for (const profile of input.profiles) {
      const card = kit.card(root, 'usage-profile');
      const header = kit.sectionHeader(card, profile.name);
      kit.el(header, 'span', 'usage-freshness', profile.freshness);
      if (profile.isDefault) {
        kit.tag(header, 'default');
      }
      for (const row of profile.rows.filter(isRowShown)) {
        kit.row(card, {
          density: 'list',
          label: row.label,
          detail: row.resets,
          trailing: meterTrailing(row, kit),
        });
      }
      if (isExtraUsageShown(profile.extraUsage)) {
        kit.row(card, {
          density: 'list',
          label: 'Extra usage',
          trailing: textTrailing(profile.extraUsage, kit),
        });
      }
      if (profile.error !== null) {
        kit.el(card, 'p', 'usage-error', profile.error);
      }
    }
    return root;
  },
};

/** @param {import('../layout').MeterInput} row */
function isRowShown(row) {
  return ALWAYS_SHOWN_ROWS.has(row.label) || row.percent > 0;
}

// Extra usage reads `off`, or `<used> / <limit>` with `used` as money text.
/**
 * @param {string | null} extraUsage
 * @returns {extraUsage is string}
 */
function isExtraUsageShown(extraUsage) {
  if (!extraUsage || extraUsage === 'off') {
    return false;
  }
  const used = extraUsage.split(' / ')[0];
  return /[1-9]/.test(used);
}

// A meter and its text, not yet placed, for a row's trailing end.
/**
 * @param {import('../layout').MeterInput} meter
 * @param {import('../layout').UsageKit} kit
 */
function meterTrailing(meter, kit) {
  const trailing = document.createElement('span');
  trailing.className = 'usage-trailing';
  kit.meter(trailing, meter.percent, meter.tone);
  kit.el(trailing, 'span', 'usage-text', meter.text);
  return trailing;
}

// `text`, not yet placed, for a row's trailing end.
/**
 * @param {string} text
 * @param {import('../layout').UsageKit} kit
 */
function textTrailing(text, kit) {
  const trailing = document.createElement('span');
  trailing.className = 'usage-trailing';
  kit.el(trailing, 'span', 'usage-text', text);
  return trailing;
}

export default layout;
