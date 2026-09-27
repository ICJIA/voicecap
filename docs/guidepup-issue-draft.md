# Draft: upstream Guidepup issue

A draft issue for the owner to file with Guidepup. voicecap works around it by explaining the fix (`voicecap setup`, `voicecap doctor`, and the driver check the path first).

**Title:** NVDA doesn't start when Guidepup's NVDA folder path contains a space (or `&`, `(`, `,`, `;`, `=`, `^`)

**Repository:** https://github.com/guidepup/guidepup/issues

---

In `@guidepup/guidepup` 0.34.0, `lib/windows/NVDA/start.js` starts NVDA with:

```js
spawn(executablePath, ["--config-path", sessionUserConfigPath], { shell: true, stdio: "ignore" })
```

With `shell: true`, Node joins the command and its arguments with spaces and doesn't quote them, and `cmd.exe` then parses the result. Both paths live in Guidepup's cache folder (`%LOCALAPPDATA%\guidepup` by default, so under the Windows user folder). When that path contains a space, as it does for a user folder like `C:\Users\Jane Doe\AppData\Local\guidepup\…`, `cmd.exe` tries to run `C:\Users\Jane` and NVDA never starts. `nvda.start()` then fails with "Timed out waiting for NVDA to be running". (`lib/windows/NVDA/quit.js` quotes the path, so `--quit` still works.)

It isn't only spaces. I tested the same `spawn(..., { shell: true })` call with Node 24.19 on Windows 11 (25H2), with the executable and the argument in a folder named `a<character>b`:

- `cmd.exe` can't start the executable at all when the path contains a space, `&`, `(`, `,`, `;`, or `=`;
- with `^`, the executable starts, but the `--config-path` argument arrives without the `^`, so NVDA would use the wrong configuration folder;
- `%NAME%` is expanded when `NAME` is an environment variable;
- `)`, `!`, `'`, `` ` ``, `~`, `#`, `@`, `$`, `+`, `[`, `]`, `{`, `}`, a lone `%`, and non-ASCII letters such as `é` are fine.

Windows user names can contain most of these (`Jane Doe`, `R&D`, `Pat (Work)`).

On Node 24, the same call also prints a deprecation warning, `[DEP0190] Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated`.

**To reproduce** (Windows):

1. Set `GUIDEPUP_SCREEN_READERS_PATH` to a folder whose path has a space, e.g. `C:\guidepup test`.
2. Run `npx @guidepup/setup install`.
3. Call `nvda.start()`.

**Suggested fix:** spawn NVDA without the shell, so Node quotes each argument itself:

```js
spawn(executablePath, ["--config-path", sessionUserConfigPath], { stdio: "ignore" })
```

and likewise `spawnSync(executablePath, ["--quit"], { stdio: "ignore" })` in `quit.js`.

**Workaround:** set `GUIDEPUP_SCREEN_READERS_PATH` to a folder whose path has none of these characters (for example `C:\guidepup`), then install again.
