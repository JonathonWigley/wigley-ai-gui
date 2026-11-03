// The sample visuals the fake harness's `fake: visual` reply and the chat
// layout preview draw: one UI mockup and one systems flowchart, each a whole
// document written to the `wigley:visuals` skill.

export const SAMPLE_MOCKUP_VISUAL = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Settings panel</title>
<style>
  body { margin: 0; background: transparent; color: var(--wg-fg); font-family: var(--wg-font-ui); font-size: var(--wg-text-13); }
  .panel { max-width: 420px; border: 1px solid var(--wg-card-border); border-radius: var(--wg-radius-md); background: var(--wg-card-background); }
  .head { padding: 10px 14px; border-bottom: 1px solid var(--wg-border-subtle); font-weight: var(--wg-weight-semibold); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; }
  .row small { display: block; color: var(--wg-fg-secondary); }
  select { font: inherit; padding: 4px 8px; color: var(--wg-fg); background: var(--wg-input-background); border: 1px solid var(--wg-border-default); border-radius: var(--wg-radius-sm); }
  .switch { position: relative; flex: none; width: 34px; height: 18px; border-radius: 9px; border: 1px solid var(--wg-border-strong); background: var(--wg-block-background); cursor: pointer; }
  .switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--wg-fg-secondary); transition: left 0.15s; }
  .switch.on { background: var(--wg-accent); border-color: var(--wg-accent); }
  .switch.on::after { left: 18px; background: var(--wg-fg-on-accent); }
  .foot { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--wg-border-subtle); }
  button { font: inherit; padding: 4px 12px; color: var(--wg-fg); background: transparent; border: 1px solid var(--wg-border-default); border-radius: var(--wg-radius-sm); }
  button.primary { color: var(--wg-fg-on-accent); background: var(--wg-accent); border-color: var(--wg-accent); }
</style>
</head>
<body>
<div class="panel">
  <div class="head">Chat settings</div>
  <div class="row">
    <label>Default profile<small>The profile a new session starts under.</small></label>
    <select><option>personal</option><option selected>work</option></select>
  </div>
  <div class="row">
    <label>Effort<small>How hard the agent thinks before it replies.</small></label>
    <select><option>Low</option><option selected>Medium</option><option>High</option></select>
  </div>
  <div class="row">
    <label>Show key hints<small>Draw each key beside the control it runs.</small></label>
    <div class="switch on" role="switch" aria-checked="true" tabindex="0"></div>
  </div>
  <div class="foot"><button>Cancel</button><button class="primary">Save</button></div>
</div>
<script>
  for (const toggle of document.querySelectorAll('.switch')) {
    toggle.addEventListener('click', () => {
      const isOn = toggle.classList.toggle('on');
      toggle.setAttribute('aria-checked', String(isOn));
    });
  }
</script>
</body>
</html>`;

export const SAMPLE_FLOWCHART_VISUAL = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Visual flow</title>
<style>
  body { margin: 0; background: transparent; color: var(--wg-fg); font-family: var(--wg-font-ui); }
  svg { display: block; width: 100%; max-width: 560px; height: auto; }
  .node rect { fill: var(--wg-card-background); stroke-width: 1.5; }
  .node text { fill: var(--wg-fg); font-size: 13px; text-anchor: middle; dominant-baseline: middle; }
  .agent rect { stroke: var(--wg-status-success); }
  .page rect { stroke: var(--wg-accent); }
  .main rect { stroke: var(--wg-status-info); }
  .edge { fill: none; stroke: var(--wg-border-strong); stroke-width: 1.5; marker-end: url(#arrow); }
  .label { fill: var(--wg-fg-secondary); font-size: 11px; }
  #arrow path { fill: var(--wg-border-strong); }
</style>
</head>
<body>
<svg viewBox="0 0 520 390" role="img" aria-label="How an html block in a reply becomes a visual">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 Z"/>
    </marker>
  </defs>
  <g class="node agent"><rect x="20" y="20" width="200" height="44" rx="8"/><text x="120" y="42">Agent reply</text></g>
  <g class="node page"><rect x="20" y="110" width="200" height="44" rx="8"/><text x="120" y="132">Markdown renderer</text></g>
  <g class="node page"><rect x="20" y="200" width="200" height="44" rx="8"/><text x="120" y="222">Markdown mount</text></g>
  <g class="node page"><rect x="300" y="200" width="200" height="44" rx="8"/><text x="400" y="222">Visual plugin</text></g>
  <g class="node page"><rect x="20" y="290" width="200" height="44" rx="8"/><text x="120" y="312">Visual frame</text></g>
  <g class="node main"><rect x="300" y="290" width="200" height="44" rx="8"/><text x="400" y="312">wigley-visual scheme</text></g>
  <path class="edge" d="M120 64 V108"/>
  <text class="label" x="130" y="90">html fence</text>
  <path class="edge" d="M120 154 V198"/>
  <text class="label" x="130" y="180">placeholder</text>
  <path class="edge" d="M220 222 H298"/>
  <text class="label" x="226" y="214">source, closed</text>
  <path class="edge" d="M400 244 V267 H120 V288"/>
  <text class="label" x="240" y="261">open(source)</text>
  <path class="edge" d="M220 312 H298"/>
  <text class="label" x="226" y="304">load by hash</text>
  <g class="node agent"><rect x="20" y="360" width="14" height="14" rx="3"/></g><text class="label" x="40" y="371">agent</text>
  <g class="node page"><rect x="100" y="360" width="14" height="14" rx="3"/></g><text class="label" x="120" y="371">page</text>
  <g class="node main"><rect x="180" y="360" width="14" height="14" rx="3"/></g><text class="label" x="200" y="371">main</text>
</svg>
</body>
</html>`;

const FENCE = '```';

// An agent reply holding both visuals, each in its own html block.
export const SAMPLE_VISUALS_TEXT = [
  'Here is the chat settings panel as it would draw in the app.',
  '',
  `${FENCE}html`,
  SAMPLE_MOCKUP_VISUAL,
  FENCE,
  '',
  'And the flow that draws it, top to bottom: the reply becomes a placeholder, the visual plugin opens a frame, and main serves its document.',
  '',
  `${FENCE}html`,
  SAMPLE_FLOWCHART_VISUAL,
  FENCE,
].join('\n');

// The reply as it streams before its last closing fence: the mockup's block
// closed, the flowchart's still open.
export const SAMPLE_VISUALS_OPEN_TEXT = SAMPLE_VISUALS_TEXT.slice(
  0,
  -`\n${FENCE}`.length,
);
