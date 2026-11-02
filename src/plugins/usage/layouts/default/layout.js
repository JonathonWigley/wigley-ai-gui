// @ts-check

// The built-in usage look: the status-bar line as wrapping groups (each plan
// meter, or the note), each session's line as one inline run (its context,
// cache and spend), and the details as a section per profile and one for the
// shown session.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  statusLine(parent, input, kit) {
    const line = kit.el(parent, 'div', 'usage-status-line');
    const planGroups =
      input.note === null
        ? input.plans.map((meter) => planMeter(line, meter, kit))
        : [kit.el(line, 'span', 'usage-group usage-note', input.note)];
    for (const group of planGroups) {
      group.classList.toggle('is-stale', input.stale);
      if (input.profileName !== null) {
        group.title = input.profileName;
      }
    }
    return line;
  },
  sessionLine(parent, input, kit) {
    const line = kit.el(parent, 'span', 'usage-session-line');
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
  details(parent, input, kit) {
    const root = kit.el(parent, 'div', 'usage-details');
    if (input.profiles.length === 0) {
      kit.el(root, 'p', 'usage-freshness', 'No profiles');
    }
    for (const profile of input.profiles) {
      const section = kit.el(root, 'section', 'usage-profile');
      const header = kit.sectionHeader(section, profile.name);
      if (profile.isDefault) {
        kit.tag(header, 'default');
      }
      for (const row of profile.rows) {
        kit.row(section, {
          density: 'list',
          label: row.label,
          detail: row.resets,
          trailing: meterTrailing(row, kit),
        });
      }
      if (profile.extraUsage !== null) {
        kit.row(section, {
          density: 'list',
          label: 'Extra usage',
          trailing: textTrailing(profile.extraUsage, kit),
        });
      }
      kit.el(section, 'p', 'usage-freshness', profile.freshness);
      if (profile.error !== null) {
        kit.el(section, 'p', 'usage-error', profile.error);
      }
    }
    if (input.session !== null) {
      const session = input.session;
      const section = kit.el(root, 'section', 'usage-session-details');
      kit.sectionHeader(section, 'Session');
      kit.row(section, {
        density: 'list',
        label: 'Context',
        trailing: meterTrailing(session.context, kit),
      });
      textRow(section, 'Left', session.remaining, kit);
      textRow(section, 'Window', session.window, kit);
      const limits = textTrailing(
        `${session.configuredLimit} configured · ${session.reportedLimit} reported`,
        kit,
      );
      if (session.limitsDiffer) {
        kit.tag(limits, 'differ', 'warning');
      }
      kit.row(section, {
        density: 'list',
        label: 'Autocompact',
        trailing: limits,
      });
      textRow(section, 'Cache', session.cache, kit);
      textRow(section, 'Spend', session.spend, kit);
    }
    return root;
  },
};

// One plan meter on the line: `<label> <meter> <text>`.
/**
 * @param {HTMLElement} line
 * @param {import('../layout').MeterInput} meter
 * @param {import('../layout').UsageKit} kit
 */
function planMeter(line, meter, kit) {
  const group = kit.el(line, 'span', 'usage-group usage-plan');
  kit.el(group, 'span', 'usage-label', meter.label);
  kit.meter(group, meter.percent, meter.tone);
  kit.el(group, 'span', 'usage-text', meter.text);
  return group;
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

/**
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {string} text
 * @param {import('../layout').UsageKit} kit
 */
function textRow(parent, label, text, kit) {
  kit.row(parent, {
    density: 'list',
    label,
    trailing: textTrailing(text, kit),
  });
}

export default layout;
