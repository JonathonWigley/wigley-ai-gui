// @ts-check

// The built-in app-update look: a compact ghost button at the title bar's end, a Codicon before its label. Available
// reads "Update available" with the commit in its tooltip; installing reads "Updating…" and is disabled; failed is the
// danger button reading "Update failed", the install log's last lines in its tooltip, and a click retries.

/** @type {Record<import('../layout').ButtonInput['state'], { label: string, icon: string, variant: 'ghost' | 'danger' }>} */
const LOOKS = {
  available: {
    label: 'Update available',
    icon: 'cloud-download',
    variant: 'ghost',
  },
  installing: { label: 'Updating…', icon: 'sync', variant: 'ghost' },
  failed: { label: 'Update failed', icon: 'error', variant: 'danger' },
};

/** @type {import('../layout').CompleteLayout} */
const layout = {
  button(parent, input, kit) {
    const look = LOOKS[input.state];
    const button = kit.button(parent, look.label, 'app-update.install', {
      variant: look.variant,
    });
    button.classList.add('app-update-button');
    button.prepend(kit.icon(document.createElement('span'), look.icon));
    button.disabled = input.state === 'installing';
    button.title = tooltip(input);
    button.setAttribute('aria-label', look.label);
    return { element: button };
  },
};

/** @param {import('../layout').ButtonInput} input */
function tooltip(input) {
  if (input.state === 'available') {
    return `Install origin/main (${input.sha ?? ''}); the app quits and starts again`;
  }
  if (input.state === 'installing') {
    return 'Installing origin/main; the app quits and starts again when it is done';
  }
  return `The install failed; click to try again.\n\n${input.error ?? ''}`;
}

export default layout;
