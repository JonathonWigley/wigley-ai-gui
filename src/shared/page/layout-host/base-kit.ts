import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { ViewScope } from '../../../contracts/keymap';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Platform } from '../../../contracts/platform';
import { element, markdownElement } from '../dom';
import { textButton } from '../ui/button';
import { card as cardPart } from '../ui/card';
import { emptyState } from '../ui/empty-state';
import { kbd } from '../ui/kbd';
import { keyPrompt } from '../ui/key-prompt';
import { row } from '../ui/row';
import { sectionHeader } from '../ui/section-header';
import { setDotStatus, statusDot } from '../ui/status-dot';
import { tag as tagPart } from '../ui/tag';
import type { BaseKit } from './kit';

// What the base kit reads. `keys` restates the keys plugin's page exports,
// which `src/shared/page` may not import. `scope` is the qualified scope the
// part's keys fire in; null anchors with no scope, so a hint shows in every
// scope, and reads keys in any scope. `commandNamed` turns the owner's short
// command name into its qualified id, null for a name the owner lacks.
export interface BaseKitDeps {
  markdown: MarkdownRenderer;
  keys: {
    anchor(
      element: HTMLElement,
      command: CommandId,
      options?: { scope?: ViewScope; label?: boolean | string },
    ): Disposable;
    keysFor(command: CommandId, scope?: ViewScope): string | null;
  };
  commands: KitCommands;
  scope: ViewScope | null;
  commandNamed(short: string): CommandId | null;
  platform: Platform;
}

// The commands a kit's `command` reaches: whether a plugin registers an id,
// and running it.
export interface KitCommands {
  exists(id: CommandId): boolean;
  run(id: CommandId): void;
}

// A runner for the command `qualifiedId`, which runs it on each call and
// never on creation. Throws `no command <id>` at once for an id no plugin
// registers, so a part asking for one fails while it builds.
export function commandRunner(
  qualifiedId: CommandId,
  commands: KitCommands,
): () => void {
  if (!commands.exists(qualifiedId)) {
    throw new Error(`no command ${qualifiedId}`);
  }
  return () => commands.run(qualifiedId);
}

// The parts every owner's layout draws with. It holds no state and builds
// nothing until a member is called, so an owner makes one per part draw.
export function createBaseKit(deps: BaseKitDeps): BaseKit {
  const keysFor = (id: CommandId) =>
    deps.scope === null
      ? deps.keys.keysFor(id)
      : deps.keys.keysFor(id, deps.scope);
  return {
    el(parent, tagName, className = '', text) {
      return appended(
        parent,
        element(tagName as keyof HTMLElementTagNameMap, className, text),
      );
    },
    markdown(parent, text, className = '') {
      return appended(
        parent,
        markdownElement('div', className, deps.markdown.block(text)),
      );
    },
    inlineMarkdown(parent, text, className = '') {
      return appended(
        parent,
        markdownElement('span', className, deps.markdown.inline(text)),
      );
    },
    section(parent, label, text) {
      if (text.trim() === '') {
        return null;
      }
      const section = element('section', 'context');
      section.append(
        sectionHeader(label),
        markdownElement('div', 'context-body md', deps.markdown.block(text)),
      );
      return appended(parent, section);
    },
    keys(command) {
      const id = deps.commandNamed(command);
      return id === null ? null : keysFor(id);
    },
    keyHint(parent, command, options = {}) {
      const node = appended(parent, element('span', options.className ?? ''));
      const id = deps.commandNamed(command);
      if (id !== null) {
        deps.keys.anchor(node, id, anchorOptions(deps.scope, options.label));
      }
      return node;
    },
    command: (qualifiedId) => commandRunner(qualifiedId, deps.commands),
    keysFor: (qualifiedId) => keysFor(qualifiedId),
    card(parent, className = '') {
      const node = cardPart();
      if (className !== '') {
        node.className = `${node.className} ${className}`;
      }
      return appended(parent, node);
    },
    tag: (parent, text, tone) => appended(parent, tagPart(text, tone)),
    kbd: (parent, keys) => appended(parent, kbd(keys, deps.platform)),
    button(parent, label, onClick, options = {}) {
      const keys = options.keys ?? null;
      return appended(
        parent,
        textButton(label, onClick, {
          variant: options.variant,
          hint: keys === null ? null : kbd(keys, deps.platform),
        }),
      );
    },
    sectionHeader: (parent, text) => appended(parent, sectionHeader(text)),
    statusDot: (parent, status) => appended(parent, statusDot(status)),
    setDotStatus: (dot, status) => setDotStatus(dot, status),
    row: (parent, options) => appended(parent, row(options)),
    emptyState: (parent, text, hint) =>
      appended(parent, emptyState(text, hint)),
    keyPrompt: (parent, keys, label) =>
      appended(parent, keyPrompt(keys, deps.platform, label)),
  };
}

function appended<E extends HTMLElement>(parent: HTMLElement, node: E): E {
  parent.append(node);
  return node;
}

// The anchor options for `scope`: no scope option when null, and no label
// option when left out.
function anchorOptions(
  scope: ViewScope | null,
  label: boolean | string | undefined,
): { scope?: ViewScope; label?: boolean | string } {
  return {
    ...(scope === null ? {} : { scope }),
    ...(label === undefined ? {} : { label }),
  };
}
