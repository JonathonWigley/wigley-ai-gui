# 01 — Login item spike: result

Run 2026-11-17 on this Mac, from a scratch package of base `a777cb41d` with the spike edits (never committed).

- `macOS:` 26.7 · `Signing:` certificate leaf (`designated => identifier "com.electron.wigley-ai-gui" and certificate leaf = H"f7e44a02…"`, the local signing identity)
- `agentService:` works (`register` returned `status: enabled` at once, no approval asked) · `probe ran:` yes (`out-probe-service.json` within 15 s; pid 81655, ppid 1; `launchctl print` showed `managed_by = com.apple.xpc.ServiceManagement`, `program identifier = Contents/MacOS/wigley-ai-gui (mode: 2)`, `runs = 1`, `last exit code = 0`) · `child survived unregister:` yes (child 81683 still running with ppid 1 after `unregister` returned `not-registered`; killed by hand)
- `LaunchAgent file:` works (`launchctl bootstrap` exit 0; `out-probe-agent.json` within 15 s; pid 82429, ppid 1) · `child survived bootout:` yes (child 82456 still running with ppid 1 after `bootout`; killed by hand)
- `Pick:` agentService
- `Registered:` agentService login item `wigley-ai-gui.spike` (plist `Contents/Library/LaunchAgents/wigley-ai-gui.spike.plist` in the scratch bundle) · LaunchAgent `wigley-ai-gui.spike-agent` from `~/Library/LaunchAgents/wigley-ai-gui.spike-agent.plist` · detached children 81683 and 82456 · scratch worktree `<scratchpad>/login-spike/worktree`
- `Removed:` `wigley-ai-gui.spike` by `--login-spike=unregister` (then `--login-spike=status` reads `not-registered`; `launchctl print gui/502/wigley-ai-gui.spike` reports `Could not find service`) · `wigley-ai-gui.spike-agent` by `launchctl bootout` (`launchctl print gui/502/wigley-ai-gui.spike-agent` reports `Could not find service`) · the plist file by `rm` (`test -e` false) · children 81683 and 82456 by `kill` (`ps -p` finds none of 81655, 81683, 82429, 82456) · the worktree by `git worktree remove --force` (`git worktree list` no longer lists it)

Notes for task 18: neither an unregister nor a bootout ends a detached child started with `AbandonProcessGroup`, so
the adapter cannot rely on unregistering to stop a running session host. Registration needed no approval on this run.
Why is unchecked: macOS may have trusted the bundle id `com.electron.wigley-ai-gui` or the signing identity from an
earlier grant. A first registration on another Mac may still ask for approval.
