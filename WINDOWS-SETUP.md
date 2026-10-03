# Setting up voicecap on Windows

This is the checklist for developing voicecap on a new Windows machine. (It was written to start Phase B, the real NVDA driver, which is now done; the brief in step 6 is kept for reference.)

## Which window do I use?

**PowerShell only for step 1.** You're installing Git, and Git Bash doesn't exist until Git is installed.

**Git Bash for everything after that**: installing pnpm, cloning the repository, and running voicecap and its development scripts. Git Bash is the same bash you use on macOS and Ubuntu, and voicecap's development scripts assume it. (To run voicecap, not develop it, the README's Windows setup uses PowerShell.)

Both run inside **Windows Terminal**. New tabs of either kind open from the **`˅`** next to the **`+`** at the top.

## 1. Install Git and Node (PowerShell)

Open Windows Terminal (it starts in PowerShell) and run:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
```

- Node's installer may ask for administrator rights once. On a managed PC, IT may need to run it.
- When both finish, **close Windows Terminal completely and open it again**, so Git and Node are on your PATH.

## 2. Open Git Bash

In Windows Terminal, click the **`˅`** next to the **`+`** and choose **Git Bash**. Optionally, make it the default so new windows open in Git Bash: Settings → Startup → Default profile → Git Bash.

Check that everything is there:

```bash
node --version    # v22.19 or later (24 recommended)
git --version
```

## 3. Install pnpm (Git Bash)

```bash
npm install -g pnpm@10
```

npm installs it for your user only, so no administrator rights are needed.

## 4. Get the code (Git Bash)

```bash
mkdir -p ~/code && cd ~/code
git clone https://github.com/ICJIA/voicecap.git
cd voicecap
```

Keep the repository out of folders that OneDrive syncs (Documents and Desktop often are): sync clients lock files while voicecap is writing them. `~/code` is `C:\Users\<you>\code`, which isn't synced.

## 5. Close your own NVDA

If you run NVDA yourself, close it before testing: voicecap shuts NVDA down when it starts.

Then install voicecap's NVDA and check the machine (Git Bash, in the repository):

```bash
pnpm install && pnpm build
node dist/cli.js setup     # downloads Guidepup's portable NVDA build (about 100 MB)
node dist/cli.js doctor    # starts NVDA and Chrome for about 20 seconds; hands off the keyboard and mouse
pnpm test:nvda             # optional: the real-NVDA checks on the fixture site (about 5 minutes)
```

## 6. Phase B's brief (for reference)

Phase B started from this brief:

> I'm continuing work on **voicecap** (this repo; Phase A is on `main`, tagged `v0.1.0`). Phase A is done: everything except the real NVDA driver, built on macOS with the replay driver. I'm now on my Windows machine, in Git Bash inside Windows Terminal, as a normal (non-admin) user, to do **Phase B**.
>
> 1. Read `docs/phase-b-handoff.md` first. Then read `docs/build-prompt.md` (the spec; Phase B is under "Deliverables"), `docs/plan.md` (the approved plan; I accepted all its recommendations), `README.md`, and `CHANGELOG.md`.
> 2. Check the environment and run the Phase A checks before changing anything: `pnpm install`, `pnpm exec playwright install chromium`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Tell me about any Windows-specific failures.
> 3. Before writing the driver, re-verify the Guidepup facts in the build prompt against the exact versions you'll pin. Check npm for newer releases than the ones listed in the handoff, and use the actual method names; don't guess.
> 4. Then give me a short plan for Phase B and wait for my OK. Phase B means:
>    - the Guidepup NVDA driver (`src/drivers/guidepup-nvda.ts`), `voicecap setup`, and `voicecap doctor`;
>    - running the real driver yourself against the fixture (`pnpm fixture:serve`);
>    - replacing `fixture/replay-run` with real captured output, retuning the flag phrasing, and putting measured run times in the README.
>
>    Keep code changes inside the driver layer as far as possible.
>
> My preferences: commit messages have one subject line and no trailers. Commit and push only when I ask. Don't publish to npm: the first release will be 0.2.0, after Phase B, and I'll say when. Ask me before building rather than silently working around something that conflicts with how Guidepup or NVDA actually work.

## If something goes wrong

- **`winget` isn't found** (PowerShell): update **App Installer** from the Microsoft Store, then try again.
- **`node`, `npm`, or `git` isn't found** (Git Bash): you didn't restart Windows Terminal after step 1. Close it completely and open it again.
- **A path like `/about` turns into `C:/Program Files/Git/about`** (Git Bash): Git Bash rewrites arguments that start with `/`. voicecap explains this when it happens. Use a full URL instead, or put `MSYS_NO_PATHCONV=1` in front of the command.
- **Can I use PowerShell instead?** For running voicecap, yes: the README's commands are written for PowerShell. For developing it, stay in Git Bash so this checklist's commands and voicecap's scripts work exactly as written.
