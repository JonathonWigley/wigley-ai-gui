import type { Paths } from '../../../contracts/paths';
import type { BacklogHome, BacklogRead } from '../../backlog/contract';
import type { NoteFollowup, NoteHome, NoteHomes } from '../contract';

function noteHome(home: BacklogHome, paths: Paths): NoteHome {
  const isInRepo =
    home.gitRoot !== null && paths.isInside(home.root, home.gitRoot);
  const followups: NoteFollowup[] = home.followupFiles.flatMap((file) =>
    file.items
      .filter((item) => !item.done)
      .map((item) => ({ path: file.path, title: item.title })),
  );
  return {
    repo: home.repo,
    root: home.root,
    folder: isInRepo ? home.gitRoot : null,
    followups,
  };
}

// Each repo's create-target home from Backlog's read, sorted by repo, with
// its open follow-ups in file then item order.
export function noteHomes(read: BacklogRead, paths: Paths): NoteHomes {
  const homes = read.homes
    .filter((home) => home.isCreateTarget)
    .map((home) => noteHome(home, paths))
    .sort((a, b) => a.repo.localeCompare(b.repo));
  return { homes, message: read.message };
}
