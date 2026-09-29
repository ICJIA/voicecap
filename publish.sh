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
#   ./publish.sh minor 123456    also pass an npm 2FA code (skips the y/N prompt, so the
#                                code doesn't expire while waiting)
#   ./publish.sh --dry-run [...] run every check and a dry-run publish; change nothing
#                                (if you're not logged in to npm, it warns instead of
#                                logging you in)
#
# Works in Git Bash on Windows as well as on macOS and Linux.
#
# Before anything is published, it checks that:
#   - you're in the voicecap root, on main, up to date with origin/main, with a clean tree;
#   - you're logged in to npm and the version isn't on npm or tagged elsewhere yet;
#   - CHANGELOG.md has an entry for the version;
#   - CI passed for this commit (when the GitHub CLI is available);
#   - lint, typecheck, tests, and build pass;
#   - the packed files are right, and the packed tarball installs and runs.
# If anything fails before the publish, package.json is restored.

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
BUMP="${POSITIONAL[0]:-}"
OTP="${POSITIONAL[1]:-}"

if [[ -n "$BUMP" && ! "$BUMP" =~ ^(patch|minor|major|current|[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?)$ ]]; then
  die "Unknown version '$BUMP'. Use patch, minor, major, current, or a version like 1.2.3."
fi
if [[ -n "$OTP" && ! "$OTP" =~ ^[0-9]{6}$ ]]; then
  warn "The 2FA code '$OTP' isn't 6 digits; passing it to npm anyway."
fi

# Read package.json with Node (the package is "type": "module", so force CommonJS here).
pkg_field() {
  node --input-type=commonjs -e "console.log(require('./package.json').$1)"
}

# ─── Restore package.json if we stop before publishing ─────────────

PUBLISHED=false
BUMPED=false
restore() {
  if [[ "$BUMPED" == true && "$PUBLISHED" == false ]]; then
    git checkout -- package.json
    warn "Restored package.json (nothing was published)."
  fi
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

if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  CI=$(gh run list --commit "$(git rev-parse HEAD)" --workflow ci.yml --limit 1 \
    --json status,conclusion --jq '.[0] | "\(.status) \(.conclusion)"' 2>/dev/null || true)
  case "$CI" in
    "completed success") info "CI passed for this commit." ;;
    "") warn "No CI run found for this commit." ;;
    completed*) die "CI failed for this commit ($CI). Fix it before publishing." ;;
    *) warn "CI hasn't finished for this commit ($CI)." ;;
  esac
else
  warn "GitHub CLI not available: couldn't check CI for this commit."
fi

# ─── Checks and build ───────────────────────────────────────────────

info "Installing dependencies..."
pnpm install --frozen-lockfile
info "Lint, typecheck, tests, build..."
pnpm lint
pnpm typecheck
pnpm test
rm -rf dist
pnpm build

# ─── What's in the package ──────────────────────────────────────────

info "Checking the packed files..."
FILES=$(npm pack --dry-run --json --ignore-scripts | node --input-type=commonjs -e '
  const [pack] = JSON.parse(require("fs").readFileSync(0, "utf8"));
  console.log(pack.files.map((f) => f.path).join("\n"));
')
for required in package.json README.md CHANGELOG.md LICENSE dist/cli.js dist/index.js dist/index.d.ts demo/site/index.html; do
  grep -qx "$required" <<<"$FILES" || die "The package is missing $required."
done
if grep -E '^(src|test|fixture|scripts|docs)/' <<<"$FILES" >/dev/null; then
  die "The package would include source, tests, or fixtures. Check \"files\" in package.json."
fi
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
  npm install --no-audit --no-fund "$TARBALL" >/dev/null
  INSTALLED=$(npx --no-install voicecap --version)
  [[ "$INSTALLED" == "$NEW_VERSION" ]] || {
    echo "voicecap --version printed '$INSTALLED', expected '$NEW_VERSION'" >&2
    exit 1
  }
) || die "The packed tarball didn't install and run."
rm -rf "$SCRATCH"
info "The packed tarball installs, and voicecap --version prints $NEW_VERSION."

# ─── Dry run ────────────────────────────────────────────────────────

info "npm publish --dry-run..."
npm publish --dry-run --access public --ignore-scripts
if [[ "$DRY_RUN" == true ]]; then
  info "Dry run complete. Nothing was published or changed."
  exit 0
fi

# ─── Confirm ────────────────────────────────────────────────────────

if [[ -z "$OTP" ]]; then
  echo ""
  if [[ "$FIRST_TIME" == true ]]; then
    warn "About to publish $PACKAGE_NAME@$NEW_VERSION for the FIRST TIME (public)."
  else
    warn "About to publish $PACKAGE_NAME@$NEW_VERSION."
  fi
  read -r -p "Proceed? (y/N) " REPLY
  [[ "$REPLY" =~ ^[Yy]$ ]] || {
    info "Aborted. Nothing was published."
    exit 0
  }
fi

# ─── Publish ────────────────────────────────────────────────────────

# The checks above already ran, so skip prepublishOnly rather than run them all again.
npm publish --access public --ignore-scripts ${OTP:+--otp "$OTP"}
PUBLISHED=true
info "Published $PACKAGE_NAME@$NEW_VERSION."

# ─── Commit, tag, push ──────────────────────────────────────────────

if [[ "$BUMPED" == true ]]; then
  git add package.json
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
