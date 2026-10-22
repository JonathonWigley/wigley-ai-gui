import type { DriveAction, DriveHost } from '../../contracts/plugin';

// One drive action as `actions` lists it.
export interface ListedAction {
  name: string;
  description: string;
  args: string;
}

// The drive actions a drive run's commands list and run.
export interface DriveActions {
  // Every added action, sorted by name.
  list(): ListedAction[];
  // Runs the action `name` names; rejects when no action has that name.
  run(name: string, args: unknown): Promise<unknown>;
}

// The plugins' drive actions, each named `<pluginId>.<name>`.
export interface ActionRegistry extends DriveActions {
  // The host a plugin adds its actions through. `add` throws on a name already
  // added; its Disposable removes that action only.
  hostFor(pluginId: string): DriveHost;
}

export function createActionRegistry(): ActionRegistry {
  const actions = new Map<string, DriveAction>();
  return {
    hostFor: (pluginId) => ({
      add: (name, action) => {
        const qualified = `${pluginId}.${name}`;
        if (actions.has(qualified)) {
          throw new Error(`Drive action ${qualified} is already added`);
        }
        actions.set(qualified, action);
        return {
          dispose: () => {
            if (actions.get(qualified) === action) {
              actions.delete(qualified);
            }
          },
        };
      },
    }),
    list: () =>
      [...actions]
        .map(([name, { description, args }]) => ({ name, description, args }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    run: async (name, args) => {
      const action = actions.get(name);
      if (action === undefined) {
        throw new Error(`No drive action ${name}; \`actions\` lists them`);
      }
      return action.run(args);
    },
  };
}
