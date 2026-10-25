# 09 — The installed app's icon is the Auri art

Status: in progress
Type: Task
Wave: 2 · Depends on: 04 (shares `forge.config.mts`)
Plan: [plan.md](plan.md)

Added mid-run at the user's request (2026-10-24), decided in a forms round.

Files:     create `assets/icon/auri-source.png` (a copy of
           `C:/_root/_media/Pictures/ffxiv/commissions/mushroom/auri-mushroom-no-addressee.png`, 1500×2000) ·
           create `assets/icon/icon.png` (1024×1024) · create `assets/icon/icon.ico` · create `assets/icon/icon.icns`
           · create `scripts/make-icon.mts` (packs the icon files) · modify `forge.config.mts`
Consumes:  `packagerConfig` as group 04 landed it (`asar`, `win32metadata`, `extendInfo`)
Produces:  `packagerConfig.icon: 'assets/icon/icon'` in `forge.config.mts` (Electron Packager adds `.ico` / `.icns` per platform)
Decisions: crop her head with the ears and bow, a square of about 1000 px, x 250–1250, y 0–1000 (user) ·
           rounded-square outline with transparent corners (user) · the art's white background becomes
           transparent too (user's note: "the white bg is also just empty space that could be transparent") ·
           only the installed app carries the icon; the dev app keeps Electron's (user) · built only with
           tools already on the machine: Windows' .NET imaging through PowerShell and Node, no new package (lead)

**Changes**

- Crop and outline: the square above, scaled to 1024×1024, a rounded-square mask (corner radius about 22% of the
  side, the macOS shape) with the outside transparent.
- Transparent background: the white surrounding the figure and the oval frame, reached from the crop's edges,
  becomes transparent — a flood fill from the border over near-white pixels, stopping at the art's dark outlines.
  The hair, face and ears are light too, so the fill must never leak inside the figure: check the result by eye
  (save a preview over a dark and a checker background and look at it with the Read tool), and tighten the
  tolerance or close the gap when it leaks.
- `icon.ico` holds PNG-encoded images at 16, 24, 32, 48, 64, 128 and 256 px (the ICO format embeds PNGs directly).
- `icon.icns` holds PNG-encoded `ic07`–`ic10` (128, 256, 512, 1024) plus `ic11`–`ic14` retina entries as the format
  defines them; verify the type codes against Apple's icns format before writing.
- `scripts/make-icon.mts` takes the sized PNGs and writes `.ico` and `.icns`, so the icon can be rebuilt from the
  source; the PowerShell crop/resize/mask/fill step lives beside it (a `.ps1` or invoked from the script) — name
  how to rerun it in the script's header comment.
- `forge.config.mts`: `packagerConfig.icon: 'assets/icon/icon'`.
- Make sure `assets/` is not ignored and is not swept into the app's asar needlessly (packager `icon` is read at
  package time).

Tests:     none — image assets; group 08 packages and checks the exe's icon
Done when: the four icon files exist, the preview shows no leak into the figure, `npm run typecheck` and
           `npm run lint` pass
Commit:    one commit for the group

## Proof

