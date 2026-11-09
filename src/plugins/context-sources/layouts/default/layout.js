// @ts-check

// The built-in context-sources look: a stacked bar of the sources, the window's fill under it with a tick where
// compaction starts, then one row per source with its tokens and share, the largest five until the user shows them
// all through the more line under them. A source with items opens on a click into its items, indented under it. Each
// source's colour comes from its place in the list, through `data-position`.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  breakdown(parent, input, kit) {
    const element = kit.el(parent, 'div', 'context-sources');
    const bar = kit.el(element, 'div', 'context-sources-bar');
    for (const source of input.sources) {
      const segment = kit.el(bar, 'span', 'context-sources-segment');
      segment.dataset.position = String(colourOf(source.position));
      segment.style.setProperty(
        '--context-sources-share',
        String(source.share),
      );
      segment.title = `${source.label} ${source.tokens}`;
    }
    if (input.window !== null) {
      drawWindow(element, input.window, kit);
    }
    const shown = input.showsAll
      ? input.sources
      : input.sources.slice(0, SHOWN_SOURCES);
    for (const source of shown) {
      drawSource(element, source, input.toggle, kit);
    }
    if (input.sources.length > SHOWN_SOURCES) {
      const more = kit.el(
        element,
        'div',
        'context-sources-more',
        input.showsAll
          ? 'Show fewer'
          : `+ ${input.sources.length - SHOWN_SOURCES} more`,
      );
      more.addEventListener('click', () => input.toggleShowsAll());
    }
    if (input.deferred !== null) {
      kit.el(
        element,
        'div',
        'context-sources-note',
        `${input.deferred} deferred tools, not loaded`,
      );
    }
    return { element };
  },
};

// The ten colours the CSS defines, repeating past the tenth source.
const COLOURS = 10;

// The sources listed until the user shows them all.
const SHOWN_SOURCES = 5;

/** @param {number} position */
function colourOf(position) {
  return ((position - 1) % COLOURS) + 1;
}

/**
 * @param {HTMLElement} parent
 * @param {import('../layout').ContextWindowFill} fill
 * @param {import('../../../../shared/page/layout-host/kit').BaseKit} kit
 */
function drawWindow(parent, fill, kit) {
  const track = kit.el(parent, 'div', 'context-sources-window');
  const used = kit.el(track, 'span', 'context-sources-window-fill');
  used.style.setProperty('--context-sources-share', String(fill.share));
  if (fill.autocompactShare !== null) {
    const tick = kit.el(track, 'span', 'context-sources-window-tick');
    tick.style.setProperty(
      '--context-sources-share',
      String(fill.autocompactShare),
    );
  }
  const caption = kit.el(parent, 'div', 'context-sources-caption');
  kit.el(caption, 'span', '', fill.text);
  if (fill.autocompactText !== null) {
    kit.el(caption, 'span', '', fill.autocompactText);
  }
}

/**
 * @param {HTMLElement} parent
 * @param {import('../layout').ContextSourceRow} source
 * @param {(id: string) => void} toggle
 * @param {import('../../../../shared/page/layout-host/kit').BaseKit} kit
 */
function drawSource(parent, source, toggle, kit) {
  const opens = source.items.length > 0;
  const row = kit.el(parent, 'div', 'context-sources-row');
  const swatch = kit.el(row, 'span', 'context-sources-swatch');
  swatch.dataset.position = String(colourOf(source.position));
  const marker = opens ? (source.isOpen ? '▾' : '▸') : '';
  kit.el(row, 'span', 'context-sources-marker', marker);
  kit.el(row, 'span', 'context-sources-name', source.label).title =
    source.label;
  kit.el(row, 'span', 'context-sources-tokens', source.tokens);
  kit.el(row, 'span', 'context-sources-share', source.shareText);
  if (!opens) {
    return;
  }
  row.classList.add('context-sources-row--opens');
  row.addEventListener('click', () => toggle(source.id));
  if (!source.isOpen) {
    return;
  }
  const items = kit.el(parent, 'div', 'context-sources-items');
  for (const item of source.items) {
    const itemRow = kit.el(items, 'div', 'context-sources-row');
    kit.el(itemRow, 'span', 'context-sources-name', item.label).title =
      item.label;
    kit.el(itemRow, 'span', 'context-sources-tokens', item.tokens);
  }
}

export default layout;
