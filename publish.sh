#!/usr/bin/env bash
set -euo pipefail

# voicecap publish script
#
# Usage:
#   ./publish.sh                 first publish: publish package.json's version as is;
#                                afterwards: bump the patch version and publish
#   ./publish.sh patch|minor|major
#                                bump that part of the version and publish
#   ./publish.sh current         publish package.json's version as is (not yet on npm)
#   ./publish.sh 1.2.3           publish exactly this version
#   ./publish.sh --dry-run [...] run every check and a dry-run publish; change nothing
#                                (if you're not logged in to npm, it warns instead of
#                                logging you in)
#
# A release is two commands: ./publish.sh --dry-run minor, then ./publish.sh minor (or patch,
# major, current, or a version). The version is the only argument. A publish asks for npm's 6-digit
# two-factor code last, just before it publishes: a code lasts about 30 seconds, and the checks
# take minutes. A dry run asks for no code.
#
# Works in Git Bash on Windows as well as on macOS and Linux.
#
# Before anything is published, it checks that:
#   - you're in the voicecap root, on main, up to date with origin/main, with a clean tree;
#   - you're logged in to npm and the version isn't on npm or tagged elsewhere yet;
#   - CHANGELOG.md has an entry for the version;
#   - CI finished and passed for this commit (this needs the GitHub CLI, logged in: without it, a
#     publish stops, and a dry run only warns);
#   - lint, typecheck, tests, and build pass, and the release's facts (the test counts, the commits,
#     and CI's matrix) are recorded in the package, in dist/release-facts.json;
#   - every dependency is locked in npm-shrinkwrap.json, which goes in the package, and npm audit
#     finds no high or critical advisory in them;
#   - the packed files are right, with nothing in the package but what this script expects, and the
#     packed tarball installs and runs.
# It then shows the commits since the last release and who made them, asks for the version to be
# typed, and then for npm's two-factor code. What it publishes is the same tarball it installed and
# ran in the scratch project.
# If anything fails before the publish, package.json and npm-shrinkwrap.json are restored.

PACKAGE_NAME="@icjia/voicecap"
BRANCH="main"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
info() { echo -e "${GREEN}[voicecap]${NC} $1"; }
warn() { echo -e "${YELLOW}[voicecap]${NC} $1"; }
error() { echo -e "${RED}[voicecap]${NC} $1" >&2; }
die() {
  error "$1"
  exit 1
}

# ─── Arguments ──────────────────────────────────────────────────────

DRY_RUN=false
POSITIONAL=()
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then DRY_RUN=true; else POSITIONAL+=("$arg"); fi
done
# The version is the only argument. npm's two-factor code is asked for just before the publish.
if [[ ${#POSITIONAL[@]} -gt 1 ]]; then
  die "publish.sh takes one version at most (patch, minor, major, current, or a version like 1.2.3). It asks for npm's two-factor code itself, just before it publishes."
fi
BUMP="${POSITIONAL[0]:-}"

if [[ -n "$BUMP" && ! "$BUMP" =~ ^(patch|minor|major|current|[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?)$ ]]; then
  die "Unknown version '$BUMP'. Use patch, minor, major, current, or a version like 1.2.3."
fi

# Read package.json with Node (the package is "type": "module", so force CommonJS here).
pkg_field() {
  node --input-type=commonjs -e "console.log(require('./package.json').$1)"
}

# ─── Restore package.json and the lock if we stop before publishing ─

PUBLISHED=false
BUMPED=false
LOCKED=false
LOCKDIR=""
SCRATCH=""
restore() {
  if [[ "$BUMPED" == true && "$PUBLISHED" == false ]]; then
    git checkout -- package.json
    warn "Restored package.json (nothing was published)."
  fi
  if [[ ( "$BUMPED" == true || "$LOCKED" == true ) && "$PUBLISHED" == false ]]; then
    # `npm version` rewrites a committed lock along with package.json, before the lock step makes
    # a new one, so a bump alone can leave it changed. Back to the last release's lock, or to none
    # if there wasn't one. A command of its own: one checkout of both files fails as a whole when
    # the lock isn't in Git yet.
    git checkout -- npm-shrinkwrap.json 2>/dev/null || rm -f npm-shrinkwrap.json
    warn "Put npm-shrinkwrap.json back as it was (nothing was published)."
  fi
  # The scratch project holds the tarball that gets published, so it stays until after the publish.
  [[ -z "$LOCKDIR" ]] || rm -rf "$LOCKDIR"
  [[ -z "$SCRATCH" ]] || rm -rf "$SCRATCH"
}
trap restore EXIT

# ─── Preflight ──────────────────────────────────────────────────────

[[ -f package.json ]] || die "No package.json here. Run this from the voicecap root."
[[ "$(pkg_field name)" == "$PACKAGE_NAME" ]] || die "package.json isn't $PACKAGE_NAME."
command -v pnpm >/dev/null || die "pnpm is required (npm install -g pnpm)."

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$CURRENT_BRANCH" == "$BRANCH" ]] || die "Publish from $BRANCH (you're on $CURRENT_BRANCH)."

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  die "Uncommitted changes. Commit or stash them first."
fi

info "Checking that $BRANCH is up to date with origin..."
git fetch --quiet origin "$BRANCH" --tags
[[ "$(git rev-parse HEAD)" == "$(git rev-parse "origin/$BRANCH")" ]] ||
  die "$BRANCH and origin/$BRANCH differ. Pull or push first."

if npm whoami >/dev/null 2>&1; then
  info "npm user: $(npm whoami)"
elif [[ "$DRY_RUN" == true ]]; then
  # Logging in writes a token to ~/.npmrc, and a dry run changes nothing.
  warn "Not logged in to npm. The dry run continues; a real publish will ask you to log in."
else
  warn "Not logged in to npm. Logging in now..."
  npm login
  info "npm user: $(npm whoami)"
fi

# ─── Which version ──────────────────────────────────────────────────

FIRST_TIME=false
if ! npm view "$PACKAGE_NAME" version >/dev/null 2>&1; then
  FIRST_TIME=true
  warn "$PACKAGE_NAME isn't on npm yet: this is its first publish."
fi
if [[ -z "$BUMP" ]]; then
  if [[ "$FIRST_TIME" == true ]]; then BUMP="current"; else BUMP="patch"; fi
fi

CURRENT_VERSION=$(pkg_field version)
if [[ "$BUMP" == "current" ]]; then
  NEW_VERSION="$CURRENT_VERSION"
else
  NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version --allow-same-version)
  NEW_VERSION="${NEW_VERSION#v}"
  [[ "$NEW_VERSION" == "$CURRENT_VERSION" ]] || BUMPED=true
fi
info "Version: $CURRENT_VERSION → $NEW_VERSION"

if npm view "$PACKAGE_NAME@$NEW_VERSION" version >/dev/null 2>&1; then
  die "$PACKAGE_NAME@$NEW_VERSION is already on npm."
fi

TAG="v$NEW_VERSION"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  if [[ "$BUMPED" == true || "$(git rev-list -n 1 "$TAG")" != "$(git rev-parse HEAD)" ]]; then
    die "Tag $TAG already exists on another commit."
  fi
  TAG_EXISTS=true
  info "Tag $TAG already marks this commit."
else
  TAG_EXISTS=false
fi

if ! grep -qE "^## \[$NEW_VERSION\]" CHANGELOG.md; then
  die "CHANGELOG.md has no '## [$NEW_VERSION]' entry. Add one (move items out of [Unreleased])."
fi
info "CHANGELOG.md has an entry for $NEW_VERSION."

# ─── CI status for this commit ──────────────────────────────────────

# Only a run that finished and passed counts. A run still going, none found, or no way to look (no
# GitHub CLI, or not logged in to it) stops a publish, and a dry run only warns.
CI_PROBLEM=""
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  CI=$(gh run list --commit "$(git rev-parse HEAD)" --workflow ci.yml --limit 1 \
    --json status,conclusion --jq '.[0] | "\(.status) \(.conclusion)"' 2>/dev/null || true)
  case "$CI" in
    "completed success") info "CI passed for this commit." ;;
    "") CI_PROBLEM="GitHub gave no answer" ;;
    "null null") CI_PROBLEM="no CI run found" ;;
    *) CI_PROBLEM="${CI% }" ;;
  esac
else
  CI_PROBLEM="the GitHub CLI isn't installed or isn't logged in"
fi
if [[ -n "$CI_PROBLEM" ]]; then
  if [[ "$DRY_RUN" == true ]]; then
    warn "CI hasn't passed for this commit ($CI_PROBLEM). A publish would stop here."
  else
    die "CI hasn't passed for this commit ($CI_PROBLEM)."
  fi
fi

# ─── Checks and build ───────────────────────────────────────────────

info "Installing dependencies..."
pnpm install --frozen-lockfile
info "Lint, typecheck, tests, build..."
pnpm lint
pnpm typecheck
# The tests' JSON report goes outside dist, which the build empties next; once the build is done,
# the release's facts (the test counts, the commits, CI's matrix) are recorded from it. This is
# `pnpm test`, which runs `vitest run`, with the report added. It runs Vitest through `pnpm exec`
# because pnpm 12 takes --reporter for itself, and refuses `pnpm test --reporter=json` before
# Vitest sees it.
RESULTS="$(mktemp -d)/vitest.json"
pnpm exec vitest run --reporter=default --reporter=json --outputFile="$RESULTS"
rm -rf dist
pnpm build
node scripts/release-facts.mjs "$RESULTS"

# ─── Lock every dependency ──────────────────────────────────────────

# npm-shrinkwrap.json goes in the package, so that `npx @icjia/voicecap` installs the same packages
# for everyone. It's made from the package's own dependencies alone: a copy of package.json without
# the development dependencies and the scripts, in a folder of its own. npm audit then looks at what
# was locked, and a high or critical advisory stops the release.
info "Locking every dependency (npm-shrinkwrap.json)..."
LOCKDIR=$(mktemp -d)
node --input-type=commonjs -e '
  const pkg = require("./package.json");
  delete pkg.devDependencies;
  delete pkg.scripts;
  require("fs").writeFileSync(process.argv[1] + "/package.json", JSON.stringify(pkg, null, 2));
' "$LOCKDIR"
LOCKED=true
(cd "$LOCKDIR" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null &&
  npm audit --omit=dev --audit-level=high) ||
  die "Locking the dependencies failed, or npm audit found a high or critical advisory in them."
cp "$LOCKDIR/package-lock.json" npm-shrinkwrap.json
rm -rf "$LOCKDIR"
STRAY=$(git status --porcelain | grep -vE '^( M package\.json| M npm-shrinkwrap\.json|\?\? npm-shrinkwrap\.json)$' || true)
[[ -z "$STRAY" ]] || die "The checks or the build changed the tree:"$'\n'"$STRAY"

# ─── What's in the package ──────────────────────────────────────────

info "Checking the packed files..."
FILES=$(npm pack --dry-run --json --ignore-scripts | node --input-type=commonjs -e '
  const [pack] = JSON.parse(require("fs").readFileSync(0, "utf8"));
  console.log(pack.files.map((f) => f.path).join("\n"));
')
for required in package.json README.md CHANGELOG.md LICENSE npm-shrinkwrap.json dist/cli.js dist/index.js dist/index.d.ts dist/release-facts.json demo/site/index.html; do
  grep -qx "$required" <<<"$FILES" || die "The package is missing $required."
done
# Only these go in the package, so a file that "files" in package.json takes in by mistake is found
# here and not published.
UNEXPECTED=$(grep -vE '^(dist/|demo/site/|package\.json$|README\.md$|CHANGELOG\.md$|LICENSE$|npm-shrinkwrap\.json$)' <<<"$FILES" || true)
[[ -z "$UNEXPECTED" ]] || die "The package would include files it shouldn't:"$'\n'"$UNEXPECTED"
head -1 dist/cli.js | grep -q '^#!/usr/bin/env node' || die "dist/cli.js has no #!/usr/bin/env node line."
info "$(wc -l <<<"$FILES" | tr -d ' ') files; nothing unexpected."

# ─── Install the real tarball and run it ────────────────────────────

info "Installing the packed tarball in a scratch project..."
SCRATCH=$(mktemp -d)
npm pack --ignore-scripts --pack-destination "$SCRATCH" >/dev/null
TARBALL=$(ls "$SCRATCH"/*.tgz)
(
  cd "$SCRATCH"
  npm init -y >/dev/null
  npm install --ignore-scripts --no-audit --no-fund "$TARBALL" >/dev/null
  INSTALLED=$(npx --no-install voicecap --version)
  [[ "$INSTALLED" == "$NEW_VERSION" ]] || {
    echo "voicecap --version printed '$INSTALLED', expected '$NEW_VERSION'" >&2
    exit 1
  }
) || die "The packed tarball didn't install and run."
info "The packed tarball installs, and voicecap --version prints $NEW_VERSION."

# ─── Dry run ────────────────────────────────────────────────────────

info "npm publish --dry-run..."
npm publish "$TARBALL" --dry-run --access public --ignore-scripts

# What changed since the last release, and who made it: shown by a dry run as well as a publish,
# to look over before anything goes out. A commit's author and subject are anyone's words, so a
# control character in them is shown as an escape, as voicecap shows text from outside.
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
if [[ -n "$LAST_TAG" ]]; then
  info "The commits since $LAST_TAG, and who made them:"
  git log --format='  %h  %an  %s' "$LAST_TAG"..HEAD |
    node --input-type=commonjs -e '
      const text = require("fs").readFileSync(0, "utf8");
      const shown = (c) => "\\u{" + c.codePointAt(0).toString(16) + "}";
      process.stdout.write(text.replace(/(?![\n\t])[\p{Cc}\p{Cf}\u{2028}\u{2029}]/gu, shown));
    '
fi

if [[ "$DRY_RUN" == true ]]; then
  info "Dry run complete. Nothing was published or changed."
  exit 0
fi

# ─── Confirm ────────────────────────────────────────────────────────

echo ""
if [[ "$FIRST_TIME" == true ]]; then
  warn "About to publish $PACKAGE_NAME@$NEW_VERSION for the FIRST TIME (public)."
else
  warn "About to publish $PACKAGE_NAME@$NEW_VERSION."
fi
read -r -p "To publish it, type the version ($NEW_VERSION): " REPLY
[[ "$REPLY" == "$NEW_VERSION" ]] || {
  info "Aborted. Nothing was published."
  exit 0
}

# ─── Publish ────────────────────────────────────────────────────────

# npm asks every publish for a fresh two-factor code, and a code lasts about 30 seconds, so it's
# asked for now, after every check and the typed version. A code that isn't 6 digits, or none at
# all, stops the release here, with nothing published.
read -r -p "npm's 6-digit two-factor code: " OTP || OTP=""
[[ "$OTP" =~ ^[0-9]{6}$ ]] ||
  die "That isn't a 6-digit code, so nothing was published. Run the same ./publish.sh command again, and type npm's code when it asks."

# The tarball that was installed and run above, not a new one packed from the folder. The checks
# above already ran, so skip prepublishOnly rather than run them all again.
npm publish "$TARBALL" --access public --ignore-scripts --otp "$OTP"
PUBLISHED=true
rm -rf "$SCRATCH"
info "Published $PACKAGE_NAME@$NEW_VERSION."

# ─── Commit, tag, push ──────────────────────────────────────────────

git add package.json npm-shrinkwrap.json
if ! git diff --cached --quiet; then
  git commit -m "Release $TAG"
fi
if [[ "$TAG_EXISTS" == false ]]; then
  git tag -a "$TAG" -m "voicecap $NEW_VERSION"
fi
if ! git push origin "$BRANCH" "$TAG"; then
  error "Published to npm, but pushing to GitHub failed. Push by hand:"
  error "  git push origin $BRANCH $TAG"
  exit 1
fi

echo ""
info "Done: $PACKAGE_NAME@$NEW_VERSION"
info "npm: https://www.npmjs.com/package/$PACKAGE_NAME"
info "Run it with: npx $PACKAGE_NAME --help"
