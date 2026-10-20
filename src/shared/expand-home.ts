// A value starting `~/` names a path in the home folder `homeDir`; any other
// value (`~` alone and `~user/x` included) is returned as it stands.
export function expandHome(value: string, homeDir: string): string {
  return value.startsWith('~/') ? `${homeDir}/${value.slice(2)}` : value;
}
