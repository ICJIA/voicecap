# Draft: upstream Guidepup issue, VoiceOver's start on macOS 27

A draft issue for the owner to file with Guidepup (written on the Mac on 2026-10-22). voicecap has no workaround: it can't change the time limit Guidepup gives `open`, or stop the second restart. Until Guidepup fixes it, the Mac's live test passes or fails by chance (`docs/phase-c-handoff.md`, "Guidepup 0.36.4, for macOS 27").

**Title:** VoiceOver often fails to start on macOS 27: `mountGuidepupPreferences` restarts `cfprefsd` twice, and launchd holds it back for 10 seconds

**Repository:** https://github.com/guidepup/guidepup/issues

---

With `@guidepup/guidepup` 0.36.4 on macOS 27.0.1 (26A434), `voiceOver.start({ settings })` sometimes fails with "VoiceOver cannot be started", caused by `spawnSync /usr/bin/open ETIMEDOUT` in both of its attempts. Other times it succeeds only on its second attempt, about 20 seconds in.

**Cause.** `mountGuidepupPreferences()` calls `restartPreferencesDaemon()` (`killall cfprefsd`) twice, a few milliseconds apart: once after trusting the portable identifier, and again after creating the portable symlinks. Between the two calls, launchd starts the per-user `cfprefsd` agent again on demand, so the second `killall` ends a daemon that has run for a few milliseconds. launchd then holds it back for 10 seconds, and VoiceOver can't start properly until it's back.

From launchd's log, in a run where `start()` failed (times UTC):

```
16:54:29.453 [user/501/com.apple.cfprefsd.xpc.agent [7508]:] exited due to exit(0), ran for 3153532ms
16:54:29.502 [user/501/com.apple.cfprefsd.xpc.agent [24844]:] exited due to exit(0), ran for 47ms
16:54:29.536 [user/501/com.apple.cfprefsd.xpc.agent:] Service only ran for 0 seconds. Pushing respawn out by 10 seconds.
16:54:29.536 [user/501/com.apple.cfprefsd.xpc.agent:] service spawn deferred by 10 seconds due to throttle
16:54:39.551 [user/501/com.apple.cfprefsd.xpc.agent [24893]:] Successfully spawned cfprefsd[24893] because ipc (mach)
16:54:39.601 [gui/501/com.apple.VoiceOver [24912]:] Successfully spawned VoiceOver[24912] because launch job demand
```

And Guidepup's own log of the same run (`DEBUG=guidepup*`, times UTC):

```
16:54:29.446 guidepup:mountGuidepupPreferences Restarting preferences daemon
16:54:29.453 guidepup:mountGuidepupPreferences Preferences daemon restarted
16:54:29.453 guidepup:mountGuidepupPreferences Creating portable preference symlinks
16:54:29.453 guidepup:mountGuidepupPreferences Portable preference symlinks created
16:54:29.453 guidepup:mountGuidepupPreferences Restarting preferences daemon after symlink creation
16:54:29.458 guidepup:mountGuidepupPreferences Preferences daemon restarted
16:54:29.526 guidepup:start opening VoiceOver app
16:54:34.530 guidepup:start opening VoiceOver app failed Error: spawnSync /usr/bin/open ETIMEDOUT
16:54:34.564 guidepup:start opening VoiceOver app
16:54:39.565 guidepup:start opening VoiceOver app failed Error: spawnSync /usr/bin/open ETIMEDOUT
```

Here `/usr/bin/open -a VoiceOver.app` waited for the daemon in both attempts, past `DEFAULT_TIMEOUT` (5 seconds) each time. VoiceOver launched 50 ms after the daemon came back, and 36 ms after the second attempt had given up.

In an earlier run the same hold happened (`ran for 20ms`, then `Pushing respawn out by 10 seconds`), but `open` returned at once and VoiceOver launched. That VoiceOver then didn't answer any of the four `activate` tries (5 seconds each). The second start attempt came after the daemon was back, and worked.

0.34.0 has the same two restarts, but the stall didn't show there: `VoiceOverStarter` ran without a time limit, and each AppleScript try had 10 seconds.

**To reproduce** (macOS 27, after `npx @guidepup/setup`):

1. In one terminal: `log stream --predicate 'process == "launchd" AND eventMessage CONTAINS "respawn"'`
2. In another, with VoiceOver off:

   ```
   DEBUG='guidepup*' node -e 'const { voiceOver } = require("@guidepup/guidepup"); voiceOver.start().then(() => voiceOver.stop())'
   ```

The "Pushing respawn out by 10 seconds" line for `cfprefsd` appeared in both runs we looked at. Whether `start()` then fails depends on timing.

**Suggested fix:** restart the daemon once, after both steps. The trust step writes the local plist directly (PlistBuddy) and the symlinks are plain file system changes, so one restart after both should flush what the daemon holds. If two restarts are needed, wait for the daemon to come back before the second one. Separately, the `open` in `start()` could take `options.timeout`, where it now has the fixed `DEFAULT_TIMEOUT`.

**Environment:** macOS 27.0.1 (26A434) on Apple silicon (M4), VoiceOver 10 (build 993), Node 22.22.2, `@guidepup/guidepup` 0.36.4, `@guidepup/setup` 0.29.3.
