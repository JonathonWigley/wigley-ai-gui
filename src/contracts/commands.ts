// A command names an action. Keymaps bind keys to command ids; features
// register what each id does.
export type CommandId = string;

// The one argument a command takes, as a manifest declares it: a number, a string
// or a small record of those.
export type CommandArgShape =
  | 'number'
  | 'string'
  | { readonly [field: string]: 'number' | 'string' };

// The argument value of a shape; `undefined` for a command that declares none.
export type ArgOf<S> = S extends 'number'
  ? number
  : S extends 'string'
    ? string
    : S extends { readonly [field: string]: 'number' | 'string' }
      ? { readonly [F in keyof S]: ArgOf<S[F]> }
      : undefined;

// An argument command as its plugin's `contract.ts` names it, so a run's argument
// is checked by the compiler; `argType` is never set.
export interface CommandKey<A, Id extends string = string> {
  readonly id: Id;
  readonly argType?: A;
}

// An argument as a bind carries it.
export type CommandArg =
  | number
  | string
  | { readonly [field: string]: number | string };

// Chooses the row at item `index` of `owner`'s open list picker, as a click on
// the row does; `owner` is the plugin id that created the picker.
export const PICKER_CHOOSE_ROW: CommandKey<
  { owner: string; index: number },
  'picker.chooseRow'
> = { id: 'picker.chooseRow' };

// Cancels `owner`'s open list picker, as a click outside its panel does.
export const PICKER_CANCEL: CommandKey<string, 'picker.cancel'> = {
  id: 'picker.cancel',
};

// Shows the mode its arg names by qualified id, as a click on its activity item
// does; an unknown id does nothing.
export const MODES_SHOW: CommandKey<string, 'modes.show'> = {
  id: 'modes.show',
};

// Opens the http or https URL its arg names in the default browser, as a
// click on a rendered link does; toasts the refusal of any other URL.
export const CORE_OPEN_LINK: CommandKey<string, 'core.openLink'> = {
  id: 'core.openLink',
};

// Loads the user plugin its arg names again from its folder, as a save under
// that folder does; rejects for a built-in or unknown id.
export const CORE_RELOAD_PLUGIN: CommandKey<string, 'core.reloadPlugin'> = {
  id: 'core.reloadPlugin',
};

// What an intercept reads of the run it wraps.
export interface CommandRunContext {
  readonly id: CommandId;
  readonly arg: unknown;
}
