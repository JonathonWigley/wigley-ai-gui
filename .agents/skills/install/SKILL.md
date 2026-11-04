---
name: install
description: Installing wigley-ai-gui as the stable app the user runs (Auri) from a committed ref. Use when the user asks to install, update or reinstall the app, to make a landed change live in their app, or when a session in the app fails with EPERM on its folder.
---

# Install the app

**Contents**

- **Steps** — run the install, read the result, check the signature.
- **First install on a Mac** — the signing certificate, and the one prompt it needs.
- **Failures** — what each failure means and what to do.
- **What an install leaves alone** — sessions, the host, uncommitted work.

An install puts a committed ref into the user's stable app, with their running sessions and macOS
privacy grants intact. It quits and relaunches the app the user may be working in, so run it when
the user asks for it.

## Steps

1. Commit the work the install should carry: the build comes from a commit, so uncommitted edits
   stay out of it.
2. From the repo root, run `source ~/.nvm/nvm.sh && nvm use && npm run install-app`. It builds
   `main`; `npm run install-app -- --ref <ref>` builds another ref.
3. Exit 0 with `Installed <ref> (<commit>)` means the app is installed. It relaunches when it was
   running.
4. On a Mac, run `codesign -d -r- /Applications/wigley-ai-gui.app`. Done when the `designated`
   line names `certificate leaf`. A line naming `cdhash` means the build signed ad hoc: follow
   **First install on a Mac**.

## First install on a Mac

macOS ties an ad hoc app's privacy grants to its code hash, so each ad hoc install drops them and
asks again. A certificate's identity outlasts a rebuild, so these steps run once per Mac:

1. Run `npm run create-signing-identity`. It is safe to repeat, and it adds a keychain of its own
   to the user's search list, so get the user's yes first.
2. Run the install.
3. Tell the user before the install starts that macOS will ask for Documents access and that the
   answer is Allow: a denied answer sticks, and makes every session in `~/Documents` fail.

## Failures

- **A session exits with `Can't read the current directory (EPERM)`**: macOS denied the app that
  folder. The user turns it on in System Settings → Privacy & Security → Files & Folders →
  wigley-ai-gui. When the toggle is missing, the user runs
  `tccutil reset SystemPolicyDocumentsFolder com.electron.wigley-ai-gui` and clicks Allow on the
  next prompt. Then check step 4 of **Steps**.
- **`The stable app did not quit within 15 s`**: nothing was installed. Ask the user to quit the
  app, then run the install again. The script never force-kills it, because the app holds the
  user's open rounds.
- **`Replacing /Applications/wigley-ai-gui.app failed`**: relay the message, which names where the
  previous app now sits.
- **A build error**: the previous app is still installed. Fix the build and run the install again.

## What an install leaves alone

- Running sessions keep going: the session host stays up on the build it started from, so a change
  under `src/session-host` reaches them only once a new host starts. Restarting the host ends those
  sessions, so that is the user's call.
- A peer's uncommitted edits stay as they are: the build runs in its own worktree,
  `../.wigley-ai-gui-build`.
- Windows has no signing step: each build installs in its own folder under
  `%LOCALAPPDATA%\Programs\wigley-ai-gui\`.
