import type { CommandId } from '../../../contracts/commands';
import type { Disposable } from '../../../contracts/disposable';
import type { ViewScope } from '../../../contracts/keymap';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Platform } from '../../../contracts/platform';
import type { PluginManifest } from '../../../contracts/plugin';
import { qualify } from '../../plugin-manifests';
import { appended, element, markdownElement } from '../dom';
import { textButton } from '../ui/button';
import { card as cardPart } from '../ui/card';
import { emptyState } from '../ui/empty-state';
import { icon } from '../ui/icon';
import { kbd } from '../ui/kbd';
import { keyChevron } from '../ui/key-anchors';
import { keyPrompt } from '../ui/key-prompt';
import { row } from '../ui/row';
import { sectionHeader } from '../ui/section-header';
import { setDotStatus, statusDot } from '../ui/status-dot';
import { tag as tagPart } from '../ui/tag';
import type { RollbackDeps } from './draw-part';
import type { BaseKit } from './kit';

// What the base kit reads. `keys` restates the keys plugin's page exports,
// which `src/shared/page` may not import. `scope` is the qualified scope the
// part's keys fire in; null anchors with no scope, so a hint shows in every
// scope, and reads keys in any scope. `commandNamed` turns the owner's short
// command name into its qualified id, null for a name the owner lacks.
// `recordAnchor`, the drawing attempt's, takes each anchor the kit names;
// left out, recording them is the `keys`' job, as forms' recording `keys`
// does for its own anchors too.
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
  recordAnchor?(anchor: Disposable): void;
}

// The page services an owner's base kit reads beside its manifest, its scope
// and the drawing attempt.
export interface OwnerKitServices {
  markdown: MarkdownRenderer;
  keys: BaseKitDeps['keys'];
  commands: KitCommands;
  platform: Platform;
}

// The qualified id of the short command name `short` of the plugin of
// `manifest`; null for a name its manifest lacks.
export function commandNamedIn(
  manifest: Pick<PluginManifest, 'id' | 'commands'>,
): (short: string) => CommandId | null {
  return (short) =>
    Object.hasOwn(manifest.commands, short)
      ? qualify(manifest.id, short)
      : null;
}

// The scope an owner's part keys fire in: a short scope of the owner's,
// qualified with its plugin id, or one already qualified, such as `any`.
export type OwnerScope = string | { qualified: ViewScope };

// The base-kit deps of one part draw by the plugin of `manifest`: its keys in
// `scope` (null for no scope), its short command names read from the
// manifest, and each anchor it names recorded through `rollback`, the drawing
// attempt's.
export function ownerBaseKitDeps(
  manifest: Pick<PluginManifest, 'id' | 'commands'>,
  services: OwnerKitServices,
  scope: OwnerScope | null,
  rollback: Pick<RollbackDeps, 'recordAnchor'>,
): BaseKitDeps {
  return {
    markdown: services.markdown,
    keys: services.keys,
    commands: services.commands,
    platform: services.platform,
    scope: qualifiedScope(manifest.id, scope),
    commandNamed: commandNamedIn(manifest),
    recordAnchor: (anchor) => rollback.recordAnchor(anchor),
  };
}

function qualifiedScope(
  pluginId: string,
  scope: OwnerScope | null,
): ViewScope | null {
  if (scope === null) {
    return null;
  }
  return typeof scope === 'string' ? qualify(pluginId, scope) : scope.qualified;
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
  // A name holding a `.` is a qualified id, null unless a plugin registers it.
  const commandId = (name: string) =>
    name.includes('.')
      ? deps.commands.exists(name)
        ? name
        : null
      : deps.commandNamed(name);
  const kit: BaseKit = {
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
      const id = commandId(command);
      return id === null ? null : keysFor(id);
    },
    keyHint(parent, command, options = {}) {
      const node = appended(parent, element('span', options.className ?? ''));
      const id = commandId(command);
      if (id !== null) {
        const anchor = deps.keys.anchor(
          node,
          id,
          anchorOptions(deps.scope, options.label),
        );
        deps.recordAnchor?.(anchor);
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
    icon(parent, name, className = '') {
      const node = icon(name);
      const classes = className.split(/\s+/).filter((each) => each !== '');
      node.classList.add(...classes);
      return appended(parent, node);
    },
    chevron: (parent, text) => appended(parent, keyChevron(text)),
    edge(parent, command, options) {
      const edge = appended(parent, element('span', 'ui-key-edge'));
      const chevron = options.chevron ?? (options.side === 'start' ? '‹' : '›');
      const hintOptions =
        options.label === undefined ? {} : { label: options.label };
      if (options.side === 'start') {
        kit.chevron(edge, chevron);
      }
      kit.keyHint(edge, command, hintOptions);
      if (options.side === 'end') {
        kit.chevron(edge, chevron);
      }
      return edge;
    },
    rowTrailing: (parentRow) =>
      appended(parentRow, element('span', 'ui-row-trailing')),
  };
  return kit;
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
