// Which of the two apps runs: the installed stable app or the dev app run
// from the repo. `id` names its user data and relay endpoint folders;
// `displayName` is the name the app shows.
export interface AppInstance {
  id: 'wigley-ai-gui' | 'wigley-ai-gui-dev';
  displayName: 'Auri' | 'Auri Dev';
  isDev: boolean;
}
