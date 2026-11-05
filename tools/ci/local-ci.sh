#!/usr/bin/env sh
# SPDX-License-Identifier: MIT
# Runs the four required checks of a pull request on this machine while
# GitHub Actions cannot start jobs, then posts the result of each one as a
# commit status named after the job, which tools/github/merge-pr.sh reads like
# the check of GitHub Actions (CONTRIBUTING.md, step 7; docs/testing.md).
#
# - The pull request must be open and not behind its base (the rule of
#   merge-pr.sh: GitHub says BEHIND, or the head lacks commits of the base),
#   and its head must not move while it is read. Nothing may answer yet on
#   http://localhost:4173, where the end-to-end tests serve the app (a server
#   that takes it later leaves the End-to-end job not run, without status).
# - The steps are the steps of .github/workflows/ci.yml and hygiene.yml, in
#   the same order, listed below (known_steps). The workflows of the head
#   commit are compared with that list first: a step added, removed or renamed
#   there is refused, since this script would not run it.
# - Each job runs in a fresh detached worktree at the exact head commit, in a
#   temporary folder outside OneDrive, removed at the end, also on failure.
#   The jobs run one after the other (the machine may be short of memory):
#   Text hygiene, Developer Certificate of Origin, Build and test, End-to-end.
#   As on GitHub, a job stops at its first failed step, CI is set to true, and
#   Node and pnpm are the versions .nvmrc and package.json name (a missing
#   Node is downloaded from nodejs.org into the cache, its SHA-256 checked
#   against the release's SHASUMS256.txt).
# - Local differences: actions/checkout, pnpm/action-setup and
#   actions/setup-node are replaced by the worktree and the version checks;
#   the fetch of origin/main is not shallow (the worktree shares the clone,
#   which must stay complete); REUSE lint runs on a git archive export on
#   Windows (node_modules paths are too long there); the end-to-end tests run
#   with the browsers Playwright installed on this machine, not in the
#   Playwright image, with --workers=2 by default; the report of a failed
#   end-to-end run is kept with the logs instead of being uploaded.
# - A status is posted on the head commit only after its job ran: success when
#   every step passed, failure otherwise (the first failed step is named).
#   Its description says "Local run on <host>, <UTC time> (GitHub Actions
#   unavailable)", and that the server image was not built under
#   --skip-docker. hygiene.yml skips the Developer Certificate of Origin job
#   for Dependabot: no status is posted for it then.
# - The logs of each job, and a summary, go to a folder printed at the end.
#
# Usage: sh tools/ci/local-ci.sh <pr-number> [--skip-docker] [--workers N] [--only JOBS]
#   --skip-docker  do not build the server image, the last step of Build and
#                  test: the step is reported as skipped, and the status is
#                  success only if every other step passed
#   --workers N    Playwright workers for the end-to-end tests (default 2)
#   --only JOBS    run (and post the status of) these jobs only, separated by
#                  commas, among text-hygiene, developer-certificate-of-origin,
#                  build-and-test and end-to-end: to run again a job that
#                  failed, once the cause is known
# Usage: sh tools/ci/local-ci.sh --check-workflows [DIR]
#   compares the steps of DIR/.github/workflows/ci.yml and hygiene.yml
#   (default: this repository) with the steps this script runs, and names
#   each difference (exit 1)
# Environment: LOCAL_CI_TMPDIR (base of the worktrees, logs and cache;
# default $TMPDIR, else /tmp; never in OneDrive), LOCAL_CI_LOGS (logs folder),
# LOCAL_CI_CACHE (downloads and the reuse environment), LOCAL_CI_REUSE (a
# reuse command of the pinned version, instead of installing it),
# LOCAL_CI_NODE_MIRROR (a mirror of https://nodejs.org/dist),
# PLAYWRIGHT_BROWSERS_PATH (where Playwright installed its browsers), and
# PIP_CERT for pip behind a proxy or an antivirus that inspects TLS.
# Exit code: 0 every job passed and its status was posted, 1 a job failed or
# did not run or a status could not be posted, 2 refused or usage error
# (nothing posted).
# Tested by tools/ci/local-ci.test.sh (fake gh and tools on PATH).
# The step handlers are called by name, through --step.
# shellcheck disable=SC2329
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SELF="$SCRIPT_DIR/$(basename "$0")"
TAB="$(printf '\t')"
# No TLS key log: pip and the other tools must not write session keys to disk.
unset SSLKEYLOGFILE
# GitHub Actions sets CI in every job; Playwright and pnpm read it.
CI=true
export CI

# --- The steps ----------------------------------------------------------------

# step <job> <step> <handler> [failure]: one line of known_steps. A step is
# named by its name, or "run: <command>" or "uses: <action>" when it has none
# (the version of an action is left out). "failure" marks a step that runs
# only after a failed step (if: failure()).
step() {
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "${4:-success}"
}

# Every step of .github/workflows/ci.yml, then hygiene.yml, in their order.
known_steps() {
  job='Build and test'
  step "$job" 'uses: actions/checkout' checkout
  step "$job" 'uses: pnpm/action-setup' setup_pnpm
  step "$job" 'uses: actions/setup-node' setup_node
  step "$job" 'run: pnpm install --frozen-lockfile' run
  step "$job" 'REUSE lint (every file has a licence)' reuse
  step "$job" 'Merge gate script (shellcheck and fake gh test)' merge_gate
  step "$job" 'Local CI script (shellcheck and fake gh test)' local_ci
  step "$job" 'Pre-publication audit script (shellcheck and fixture test)' audit
  step "$job" 'run: pnpm lint' run
  step "$job" 'run: pnpm format:check' run
  step "$job" 'run: pnpm typecheck' run
  step "$job" 'run: pnpm test:coverage' run
  step "$job" 'Fetch origin/main for the minimum safe version check' fetch_main
  step "$job" 'run: pnpm knowledge:check' run
  step "$job" 'run: pnpm eval:resolver' run
  step "$job" 'Build (demo build, never published)' build
  step "$job" 'The release build refuses the unsigned pack' release_refusal
  step "$job" 'The build changes no committed file (NOTICE included)' no_diff
  step "$job" 'run: pnpm budget:app' run
  step "$job" 'The server image builds (built locally on the runner, never pushed)' server_image
  job='End-to-end'
  step "$job" 'uses: actions/checkout' checkout
  step "$job" 'uses: pnpm/action-setup' setup_pnpm
  step "$job" 'uses: actions/setup-node' setup_node
  step "$job" 'The image is the Playwright app/package.json pins, by digest' image_pin
  step "$job" 'run: pnpm install --frozen-lockfile' run
  step "$job" 'The image holds the Chromium builds this Playwright expects' browsers
  step "$job" 'run: pnpm knowledge:build' run
  step "$job" 'run: pnpm e2e' e2e
  step "$job" 'Upload the Playwright report' keep_report failure
  job='Text hygiene'
  step "$job" 'uses: actions/checkout' checkout
  step "$job" 'Tracked files (no em dash, no emoji)' hygiene_files
  step "$job" 'Commit messages (Conventional Commits, no AI attribution)' hygiene_messages
  step "$job" 'Pull request title and description' hygiene_title
  step "$job" 'Jira reference for internal pull requests' jira
  job='Developer Certificate of Origin'
  step "$job" 'uses: actions/checkout' checkout
  step "$job" 'Every commit is signed off by its author' dco
}

# The steps of a workflow file, one per line: the job name, a tab and the step
# named as in known_steps. Reads the layout Prettier gives the workflows (two
# spaces per level, steps as a list under each job).
workflow_steps() {
  awk -v q="'" '
function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
function value(s,   c, i) {
  s = trim(s)
  c = substr(s, 1, 1)
  if (c == q || c == "\"") { s = substr(s, 2); i = index(s, c); return i ? substr(s, 1, i - 1) : s }
  sub(/[ \t]+#.*$/, "", s)
  return s
}
function field(text,   k, v) {
  k = text; sub(/:.*$/, "", k)
  v = text; sub(/^[^:]*:/, "", v); v = value(v)
  if (k == "name") name = v
  else if (k == "uses") uses = v
  else if (k == "run") { if (v ~ /^[|>]/) block = 1; else run = v }
}
function flush(   key) {
  if (!open) return
  if (name != "") key = name
  else if (run != "") key = "run: " run
  else if (uses != "") { key = uses; sub(/@.*$/, "", key); key = "uses: " key }
  else key = "(a step without name, run or uses)"
  n++; stepjob[n] = job; stepkey[n] = key
  open = 0
}
/^jobs:[ \t]*$/ { injobs = 1; next }
!injobs { next }
/^[^ \t#]/ { flush(); injobs = 0; next }
/^  [^ #][^:]*:[ \t]*$/ { flush(); job = trim($0); sub(/:$/, "", job); title[job] = job; insteps = 0; next }
/^    name:/ { t = $0; sub(/^    name:/, "", t); title[job] = value(t); next }
/^    steps:/ { insteps = 1; next }
/^    [^ #]/ { flush(); insteps = 0; next }
!insteps { next }
/^      - / { flush(); open = 1; name = ""; run = ""; uses = ""; block = 0; field(substr($0, 9)); next }
/^        [A-Za-z_-]+:/ { if (open) { block = 0; field(substr($0, 9)) } next }
block && run == "" && /^          [^ ]/ { run = trim($0); block = 0; next }
END { flush(); for (i = 1; i <= n; i++) print title[stepjob[i]] "\t" stepkey[i] }
' "$1"
}

# check_workflows <root>: whether the workflows under <root> have exactly the
# steps of known_steps, in the same order; names each difference otherwise.
check_workflows() {
  folder="$1/.github/workflows"
  scratch="$(mktemp -d)"
  for file in ci.yml hygiene.yml; do
    if [ ! -f "$folder/$file" ]; then
      echo "$folder/$file is missing."
      rm -rf "$scratch"
      return 1
    fi
    workflow_steps "$folder/$file" >>"$scratch/found"
  done
  known_steps | cut -f 1-2 >"$scratch/known"
  if cmp -s "$scratch/known" "$scratch/found"; then
    rm -rf "$scratch"
    echo "The steps of ci.yml and hygiene.yml are the steps local-ci.sh runs."
    return 0
  fi
  echo "The steps of ci.yml and hygiene.yml are not the steps local-ci.sh runs:"
  grep -Fxv -f "$scratch/known" "$scratch/found" | awk -F "$TAB" '{ print "  not run by local-ci.sh: " $1 ": " $2 }' || true
  grep -Fxv -f "$scratch/found" "$scratch/known" | awk -F "$TAB" '{ print "  not in the workflows: " $1 ": " $2 }' || true
  if [ "$(sort "$scratch/known")" = "$(sort "$scratch/found")" ]; then
    echo "  the same steps, in another order"
  fi
  echo "Update known_steps and the step handlers of tools/ci/local-ci.sh with the workflows."
  rm -rf "$scratch"
  return 1
}

# --- Step handlers ------------------------------------------------------------
# Each one runs in its own shell (set -eu, like a "run:" step of GitHub
# Actions) in the worktree of its job, with RUNNER_TEMP set to a folder of the
# job and the LCI_ variables of the run.

# skip <reason>: the step does not run, as a step whose "if:" is false.
skip() {
  echo "Skipped: $1"
  printf '%s\n' "$1" >"$LCI_JOB_TMP/skipped"
  exit 0
}

native_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s\n' "$1"; fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    openssl dgst -sha256 -r "$1" | cut -d ' ' -f 1
  fi
}

step_checkout() {
  test "$(git rev-parse HEAD)" = "$LCI_SHA"
  echo "In place of actions/checkout: a fresh worktree at $LCI_SHA (detached), $(pwd)."
}

step_setup_pnpm() {
  pinned="$(sed -n 's/.*"packageManager": *"pnpm@\([^"+]*\).*/\1/p' package.json)"
  have="$(pnpm --version)"
  echo "In place of pnpm/action-setup: pnpm $have, package.json pins pnpm $pinned."
  test "$have" = "$pinned"
}

step_setup_node() {
  want="$(tr -d ' \r\n' <.nvmrc | sed 's/^v//')"
  have="$(node --version | sed 's/^v//')"
  echo "In place of actions/setup-node: Node $have, .nvmrc asks for $want."
  case "$have" in
    "$want" | "$want".*) ;;
    *) exit 1 ;;
  esac
}

# A step without a name: its command, as the workflow writes it.
step_run() {
  command="${LCI_STEP_KEY#run: }"
  echo "+ $command"
  eval "$command"
}

step_reuse() {
  requirements=tools/reuse/requirements.txt
  pinned="$(sed -n 's/^reuse\(\[[^]]*\]\)\{0,1\}==\([0-9][0-9.]*\).*/\2/p' "$requirements")"
  test -n "$pinned"
  if [ -n "${LOCAL_CI_REUSE:-}" ]; then
    reuse="$LOCAL_CI_REUSE"
  else
    # The environment GitHub makes at each run, kept in the cache for the
    # same requirements file.
    venv="$LCI_CACHE/reuse-$(sha256_of "$requirements" | cut -c 1-12)"
    if [ ! -f "$venv/ready" ]; then
      rm -rf "$venv"
      sh tools/hygiene/py.sh -m venv "$venv"
      if [ -x "$venv/bin/python" ]; then python="$venv/bin/python"; else python="$venv/Scripts/python"; fi
      "$python" -m pip install --require-virtualenv -r "$requirements"
      : >"$venv/ready"
    fi
    if [ -x "$venv/bin/reuse" ]; then reuse="$venv/bin/reuse"; else reuse="$venv/Scripts/reuse"; fi
  fi
  if ! "$reuse" --version 2>/dev/null | grep -q "version $pinned\$"; then
    echo "$reuse is not reuse $pinned, the version tools/reuse/requirements.txt pins." >&2
    exit 1
  fi
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      # The committed files only, away from the long node_modules paths.
      mkdir "$RUNNER_TEMP/reuse-tree"
      git archive --format=tar -o "$RUNNER_TEMP/reuse-tree.tar" HEAD
      tar -xf "$RUNNER_TEMP/reuse-tree.tar" -C "$RUNNER_TEMP/reuse-tree"
      echo "+ reuse --root <git archive export of $LCI_SHA> lint"
      "$reuse" --root "$(native_path "$RUNNER_TEMP/reuse-tree")" lint
      ;;
    *)
      echo '+ reuse lint'
      "$reuse" lint
      ;;
  esac
}

step_merge_gate() {
  shellcheck tools/github/merge-pr.sh tools/github/merge-pr.test.sh
  sh tools/github/merge-pr.test.sh
}

step_local_ci() {
  shellcheck tools/ci/local-ci.sh tools/ci/local-ci.test.sh
  sh tools/ci/local-ci.test.sh
}

step_audit() {
  shellcheck tools/release/audit.sh tools/release/audit.test.sh
  sh tools/release/audit.test.sh
}

# Not shallow, unlike CI: the worktree shares the refs and objects of the
# clone it was made from, which a --depth fetch would make shallow.
step_fetch_main() {
  git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
}

step_build() {
  pnpm build
}

step_release_refusal() {
  log="$RUNNER_TEMP/release-check.log"
  if pnpm --filter @siapso/app exec vite build --outDir "$RUNNER_TEMP/release-check" >"$log" 2>&1; then
    cat "$log"
    echo "A production build accepted an unsigned pack." >&2
    exit 1
  fi
  if ! grep -Eq "would refuse every knowledge pack|Release build refused" "$log"; then
    cat "$log"
    echo "The production build failed, but not with the signing refusal." >&2
    exit 1
  fi
  grep -E "would refuse every knowledge pack|Release build refused" "$log"
}

step_no_diff() {
  git diff --exit-code
}

step_server_image() {
  if [ "$LCI_SKIP_DOCKER" = yes ]; then
    echo 'server image build skipped (--skip-docker)' >"$LCI_JOB_TMP/note"
    skip '--skip-docker: the server image was not built'
  fi
  docker build -f server/Dockerfile -t siapso-server:ci .
}

step_image_pin() {
  node tools/ci/check-playwright-image.mjs
}

# In place of the image: the browsers Playwright installed on this machine.
step_browsers() {
  node tools/ci/check-playwright-image.mjs --browsers "$LCI_BROWSERS"
}

step_e2e() {
  echo "+ pnpm e2e --workers=$LCI_WORKERS"
  pnpm e2e --workers="$LCI_WORKERS"
}

# In place of the upload: the report stays with the logs.
step_keep_report() {
  for folder in app/playwright-report app/test-results; do
    if [ -d "$folder" ]; then
      cp -R "$folder" "$LCI_LOGS/"
      echo "Kept $folder in $LCI_LOGS."
    fi
  done
}

step_hygiene_files() {
  sh tools/hygiene/py.sh tools/hygiene/hygiene.py files
}

step_hygiene_messages() {
  if [ "$LCI_DEPENDABOT" = yes ]; then skip 'hygiene.yml skips it for Dependabot'; fi
  BASE="$LCI_BASE_SHA"
  HEAD="$LCI_SHA"
  status=0
  for sha in $(git rev-list --no-merges "$BASE..$HEAD"); do
    git log -1 --format=%B "$sha" >"$RUNNER_TEMP/msg.txt"
    sh tools/hygiene/py.sh tools/hygiene/hygiene.py message "$RUNNER_TEMP/msg.txt" || status=1
  done
  exit "$status"
}

step_hygiene_title() {
  if [ "$LCI_DEPENDABOT" = yes ]; then skip 'hygiene.yml skips it for Dependabot'; fi
  printf '%s\n' "$LCI_TITLE" | sh tools/hygiene/py.sh tools/hygiene/hygiene.py title
  printf '%s\n' "$LCI_BODY" | sh tools/hygiene/py.sh tools/hygiene/hygiene.py text
}

step_jira() {
  if [ "$LCI_DEPENDABOT" = yes ]; then skip 'hygiene.yml skips it for Dependabot'; fi
  if [ "$LCI_CROSS" = true ]; then skip 'a pull request from another repository'; fi
  printf '%s\n%s\n' "$LCI_BRANCH" "$LCI_BODY" | grep -Eq 'SCRUM-[0-9]+' || {
    echo "Internal pull requests must reference a Jira ticket (SCRUM-<n>) in the branch name or the description." >&2
    exit 1
  }
}

step_dco() {
  BASE="$LCI_BASE_SHA"
  HEAD="$LCI_SHA"
  status=0
  for sha in $(git rev-list --no-merges "$BASE..$HEAD"); do
    email="$(git log -1 --format=%ae "$sha")"
    if ! git log -1 --format=%B "$sha" | grep -Eiq "^Signed-off-by: .+ <${email}>$"; then
      echo "Commit $sha has no 'Signed-off-by' line matching its author <$email>. Use 'git commit -s'." >&2
      status=1
    fi
  done
  exit "$status"
}

# --- Arguments ----------------------------------------------------------------

usage() {
  sed -n 's/^# \{0,1\}//; /^Usage:/,/^Environment:/p' "$SELF" | sed '$d' >&2
  exit 2
}

case "${1:-}" in
  --step)
    [ $# -eq 2 ] || usage
    known_steps | cut -f 3 | grep -Fxq -- "$2" || usage
    "step_$2"
    exit 0
    ;;
  --check-workflows)
    [ $# -le 2 ] || usage
    check_workflows "${2:-$SCRIPT_DIR/../..}"
    exit
    ;;
esac

# The name of a job in file names and in --only: "Build and test" is
# build-and-test.
slug_of() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-'
}
JOBS='text-hygiene developer-certificate-of-origin build-and-test end-to-end'

PR=''
SKIP_DOCKER=no
WORKERS=2
ONLY="$(printf '%s' "$JOBS" | tr ' ' ',')"
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-docker) SKIP_DOCKER=yes; shift ;;
    --workers)
      [ $# -ge 2 ] || usage
      WORKERS="$2"
      shift 2
      ;;
    --workers=*) WORKERS="${1#--workers=}"; shift ;;
    --only)
      [ $# -ge 2 ] || usage
      ONLY="$2"
      shift 2
      ;;
    --only=*) ONLY="${1#--only=}"; shift ;;
    -h | --help) usage ;;
    -*)
      echo "local-ci: unknown option \"$1\"" >&2
      usage
      ;;
    *)
      [ -z "$PR" ] || usage
      PR="$1"
      shift
      ;;
  esac
done
case "$PR" in '' | *[!0-9]*) usage ;; esac
case "$WORKERS" in '' | *[!0-9]* | 0) usage ;; esac
for wanted in $(printf '%s' "$ONLY" | tr ',' ' '); do
  case " $JOBS " in
    *" $wanted "*) ;;
    *)
      echo "local-ci: unknown job \"$wanted\" (jobs: $JOBS)" >&2
      usage
      ;;
  esac
done
[ -n "$(printf '%s' "$ONLY" | tr -d ', ')" ] || usage

# selected <slug>: whether the job runs in this run.
selected() {
  case ",$ONLY," in
    *",$1,"*) return 0 ;;
  esac
  return 1
}
if selected build-and-test || selected end-to-end; then NODE_JOBS=yes; else NODE_JOBS=no; fi

# --- Checks before anything runs (nothing is posted on a refusal) -------------

refuse() {
  printf 'local-ci: %s\n' "$@" >&2
  exit 2
}

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || refuse 'run it inside a clone of the repository.'
cd "$ROOT"
git remote get-url origin >/dev/null 2>&1 || refuse 'this clone has no remote named origin.'

need() {
  command -v "$1" >/dev/null 2>&1 || refuse "$1 is not installed: $2"
}
need gh 'it reads the pull request and posts the statuses (https://cli.github.com).'
sh "$SCRIPT_DIR/../hygiene/py.sh" -c '' >/dev/null 2>&1 || refuse 'Python 3 is not installed: the hygiene steps and REUSE use it.'
if [ "$NODE_JOBS" = yes ]; then
  need pnpm 'install the version package.json pins (packageManager).'
  need node 'any version: the one .nvmrc names is downloaded when it differs.'
  need tar 'the REUSE step and the Node download use it.'
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    refuse 'curl or wget is needed: the audit test and the Node download use it.'
  fi
fi
if selected build-and-test; then
  need shellcheck 'the merge gate, local CI and audit steps run it (https://github.com/koalaman/shellcheck#installing).'
fi
if selected build-and-test && [ "$SKIP_DOCKER" = no ] && ! docker info >/dev/null 2>&1; then
  refuse 'Docker is not available: start Docker Desktop (or the Docker daemon), or pass --skip-docker' \
    'to skip the server image build (the status of Build and test then says so).'
fi

BASE_TMP="${LOCAL_CI_TMPDIR:-${TMPDIR:-/tmp}}"
LOGS_ROOT="${LOCAL_CI_LOGS:-$BASE_TMP/siapso-local-ci-logs}"
CACHE="${LOCAL_CI_CACHE:-$BASE_TMP/siapso-local-ci-cache}"
for folder in "$BASE_TMP" "$LOGS_ROOT" "$CACHE"; do
  case "$(native_path "$folder")" in
    *[Oo][Nn][Ee][Dd][Rr][Ii][Vv][Ee]*)
      refuse "$folder is in OneDrive, which would sync every file of the run." \
        'Set LOCAL_CI_TMPDIR to a folder outside OneDrive.'
      ;;
  esac
done
mkdir -p "$BASE_TMP" "$LOGS_ROOT" "$CACHE"

RUN=''
cleanup() {
  code=$?
  if [ -n "$RUN" ]; then
    if [ -f "$RUN/worktrees" ]; then
      while IFS= read -r tree; do remove_worktree "$tree"; done <"$RUN/worktrees"
    fi
    git -C "$ROOT" worktree prune 2>/dev/null || true
    rm -rf "$RUN" 2>/dev/null || echo "local-ci: could not remove $RUN" >&2
  fi
  exit "$code"
}
remove_worktree() {
  if [ -d "$1" ]; then
    git -C "$ROOT" worktree remove --force "$1" 2>/dev/null || rm -rf "$1" 2>/dev/null ||
      echo "local-ci: could not remove the worktree $1" >&2
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM
RUN="$(mktemp -d "$BASE_TMP/lci.XXXXXX")"

# --- The pull request ---------------------------------------------------------

pr_view() {
  gh pr view "$PR" --json "$1" --jq "$2" || refuse "gh could not read pull request $PR."
}
STATE="$(pr_view state .state)"
[ "$STATE" = OPEN ] || refuse "pull request $PR is not open ($STATE)."
SHA="$(pr_view headRefOid .headRefOid)"
BASE_REF="$(pr_view baseRefName .baseRefName)"
BRANCH="$(pr_view headRefName .headRefName)"

# The rule of merge-pr.sh: GitHub says BEHIND, or the comparison counts
# commits of the base that the head lacks (an empty answer is a refusal).
refuse_behind() {
  refuse "pull request $PR: its branch $BRANCH is behind $BASE_REF, not running." \
    "Its checks would not run with the latest $BASE_REF. Bring the branch up to date:" \
    '  git fetch origin' \
    "  git switch $BRANCH" \
    "  git merge --signoff origin/$BASE_REF   (on a conflict: fix it, git add, git commit -s)" \
    '  git push                           (a plain push, never a force-push)' \
    'then run this script again.'
}
MERGE_STATE="$(pr_view mergeStateStatus .mergeStateStatus)"
BEHIND="$(gh api "repos/{owner}/{repo}/compare/$BASE_REF...$SHA" --jq .behind_by)" || BEHIND=''
if [ "$MERGE_STATE" = BEHIND ] || [ "$BEHIND" != 0 ]; then refuse_behind; fi

git fetch --quiet --no-tags origin "+refs/heads/$BASE_REF:refs/remotes/origin/$BASE_REF" ||
  refuse "could not fetch $BASE_REF from origin."
git fetch --quiet --no-tags origin "refs/pull/$PR/head" || refuse "could not fetch pull request $PR from origin."
FETCHED="$(git rev-parse FETCH_HEAD)"
if [ "$FETCHED" != "$SHA" ]; then
  refuse "pull request $PR moved while it was read (GitHub said $SHA, its head is now $FETCHED): run this script again."
fi
BASE_SHA="$(git rev-parse "refs/remotes/origin/$BASE_REF")"
git merge-base --is-ancestor "$BASE_SHA" "$SHA" || refuse_behind

TITLE="$(pr_view title .title)"
BODY="$(pr_view body .body)"
CROSS="$(pr_view isCrossRepository .isCrossRepository)"
AUTHOR="$(pr_view author .author.login)"
case "$AUTHOR" in
  'app/dependabot' | 'dependabot[bot]') DEPENDABOT=yes ;;
  *) DEPENDABOT=no ;;
esac

# The workflows of the head commit must have the steps this script runs.
mkdir -p "$RUN/workflows/.github/workflows"
for file in ci.yml hygiene.yml; do
  git show "$SHA:.github/workflows/$file" >"$RUN/workflows/.github/workflows/$file" 2>/dev/null ||
    refuse "the head commit of pull request $PR has no .github/workflows/$file."
done
if ! check_workflows "$RUN/workflows" >"$RUN/workflows.out" 2>&1; then
  cat "$RUN/workflows.out" >&2
  refuse "pull request $PR changes the steps of CI, which this version of local-ci.sh does not run." \
    'Read its change to tools/ci/local-ci.sh, then run the version of the script from that pull request.'
fi

# --- Node, pnpm and the browsers ----------------------------------------------

fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 -o "$2" "$1"; else wget -q -O "$2" "$1"; fi
}

# The address the end-to-end tests serve the app on (app/playwright.config.ts).
# With CI set, Playwright never reuses a server already there.
E2E_URL='http://localhost:4173'
port_taken() {
  command -v curl >/dev/null 2>&1 || return 1
  curl -s -o /dev/null --max-time 5 "$E2E_URL/"
}

node_is() {
  case "$(node --version 2>/dev/null | sed 's/^v//')" in
    "$1" | "$1".*) return 0 ;;
  esac
  return 1
}

# Puts on PATH the Node .nvmrc names (a major version or an exact one), from
# nodejs.org (or LOCAL_CI_NODE_MIRROR), as actions/setup-node would.
install_node() {
  mirror="${LOCAL_CI_NODE_MIRROR:-https://nodejs.org/dist}"
  case "$1" in
    *.*.*) url="$mirror/v$1" ;;
    *) url="$mirror/latest-v$1.x" ;;
  esac
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) os=win ext=zip ;;
    Linux) os=linux ext=tar.gz ;;
    Darwin) os=darwin ext=tar.gz ;;
    *) refuse "no Node download for $(uname -s): install Node $1." ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) refuse "no Node download for $(uname -m): install Node $1." ;;
  esac
  fetch "$url/SHASUMS256.txt" "$RUN/node-sums" || refuse "could not download $url/SHASUMS256.txt."
  line="$(grep -E "^[0-9a-f]{64}  node-v[0-9.]+-$os-$arch\\.$ext\$" "$RUN/node-sums" | head -n 1)"
  [ -n "$line" ] || refuse "$url lists no node-v$1 archive for $os-$arch."
  sum="${line%% *}"
  file="${line##* }"
  name="${file%."$ext"}"
  mkdir -p "$CACHE/node"
  if [ ! -f "$CACHE/node/$name/.ready" ]; then
    echo "Downloading $file (.nvmrc asks for Node $1, this machine has $(node --version))."
    fetch "$url/$file" "$RUN/$file" || refuse "could not download $url/$file."
    actual="$(sha256_of "$RUN/$file")"
    [ "$actual" = "$sum" ] || refuse "$file: checksum mismatch (SHASUMS256.txt says $sum, got $actual)."
    rm -rf "${CACHE:?}/node/$name"
    case "$ext" in
      zip)
        if command -v unzip >/dev/null 2>&1; then
          unzip -q "$RUN/$file" -d "$CACHE/node" || refuse "could not extract $file."
        else
          sh "$SCRIPT_DIR/../hygiene/py.sh" -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' \
            "$RUN/$file" "$CACHE/node" || refuse "could not extract $file."
        fi
        ;;
      *) tar -xzf "$RUN/$file" -C "$CACHE/node" || refuse "could not extract $file." ;;
    esac
    : >"$CACHE/node/$name/.ready"
  fi
  if [ "$os" = win ]; then PATH="$CACHE/node/$name:$PATH"; else PATH="$CACHE/node/$name/bin:$PATH"; fi
  export PATH
  node_is "$1" || refuse "$CACHE/node/$name does not run Node $1."
}

TOOLS='Python 3'
if [ "$NODE_JOBS" = yes ]; then
  NODE_WANTED="$(git show "$SHA:.nvmrc" 2>/dev/null | tr -d ' \r\n' | sed 's/^v//')"
  case "$NODE_WANTED" in
    '' | *[!0-9.]*) refuse ".nvmrc asks for \"$NODE_WANTED\": local-ci.sh reads a major or an exact version." ;;
  esac
  node_is "$NODE_WANTED" || install_node "$NODE_WANTED"
  PNPM_PINNED="$(git show "$SHA:package.json" | sed -n 's/.*"packageManager": *"pnpm@\([^"+]*\).*/\1/p')"
  PNPM_HAVE="$(pnpm --version 2>/dev/null || true)"
  if [ "$PNPM_HAVE" != "$PNPM_PINNED" ]; then
    refuse "pnpm ${PNPM_HAVE:-(none)} is installed, package.json pins pnpm $PNPM_PINNED: install that version."
  fi
  TOOLS="Node $(node --version | sed 's/^v//'), pnpm $PNPM_HAVE"
fi

BROWSERS=''
if selected end-to-end; then
  if [ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
    BROWSERS="$PLAYWRIGHT_BROWSERS_PATH"
  else
    case "$(uname -s)" in
      MINGW* | MSYS* | CYGWIN*) BROWSERS="$(cygpath -u "${LOCALAPPDATA:-$HOME/AppData/Local}")/ms-playwright" ;;
      Darwin) BROWSERS="$HOME/Library/Caches/ms-playwright" ;;
      *) BROWSERS="$HOME/.cache/ms-playwright" ;;
    esac
  fi
  chromium=no
  for entry in "$BROWSERS"/chromium*; do
    if [ -d "$entry" ]; then chromium=yes; fi
  done
  if [ "$chromium" = no ]; then
    refuse "no Playwright Chromium in $BROWSERS. Install it: pnpm --filter @siapso/app exec playwright install chromium"
  fi
  if port_taken; then
    refuse "$E2E_URL already answers: another server holds the port of the end-to-end tests," \
      'which CI never reuses. Stop it, or leave that job out with --only.'
  fi
  TOOLS="$TOOLS, Playwright workers: $WORKERS"
fi
if selected build-and-test && [ "$SKIP_DOCKER" = yes ]; then TOOLS="$TOOLS, --skip-docker"; fi

# --- The jobs -----------------------------------------------------------------

STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
LOGS="$LOGS_ROOT/pr-$PR-$(printf '%s' "$SHA" | cut -c 1-12)-$STAMP"
mkdir -p "$LOGS"
HOST="$(uname -n 2>/dev/null | tr -cd 'A-Za-z0-9._-' | cut -c 1-32)"
[ -n "$HOST" ] || HOST='an unnamed machine'

LCI_SHA="$SHA"
LCI_BASE_SHA="$BASE_SHA"
LCI_TITLE="$TITLE"
LCI_BODY="$BODY"
LCI_BRANCH="$BRANCH"
LCI_CROSS="$CROSS"
LCI_DEPENDABOT="$DEPENDABOT"
LCI_WORKERS="$WORKERS"
LCI_SKIP_DOCKER="$SKIP_DOCKER"
LCI_LOGS="$LOGS"
LCI_CACHE="$CACHE"
LCI_BROWSERS=''
if [ -n "$BROWSERS" ]; then LCI_BROWSERS="$(native_path "$BROWSERS")"; fi
export LCI_SHA LCI_BASE_SHA LCI_TITLE LCI_BODY LCI_BRANCH LCI_CROSS LCI_DEPENDABOT LCI_WORKERS \
  LCI_SKIP_DOCKER LCI_LOGS LCI_CACHE LCI_BROWSERS

echo "Local CI of pull request $PR at $SHA ($BRANCH, base $BASE_REF at $BASE_SHA)"
echo "$TOOLS"
echo "Logging to $LOGS"

minutes() {
  printf '%dm%02ds' $(($1 / 60)) $(($1 % 60))
}

# The description of a status: where and when the job ran, and a note.
describe() {
  text="Local run on $HOST, $(date -u '+%Y-%m-%d %H:%M') UTC (GitHub Actions unavailable)"
  if [ -n "$1" ]; then text="$text, $1"; fi
  printf '%s' "$text" | cut -c 1-140
}

post_status() {
  gh api --method POST "repos/{owner}/{repo}/statuses/$SHA" \
    -f state="$1" -f context="$2" -f description="$3" >/dev/null
}

FAILED_JOBS=0
UNPOSTED=0
NOT_RUN=0
: >"$RUN/summary"

# run_job <job> <number>: runs the steps of the job in a fresh worktree, then
# posts its status.
run_job() {
  job="$1"
  slug="$(slug_of "$job")"
  if ! selected "$slug"; then
    printf '%-32s %-8s %7s  %s\n' "$job" 'not run' '-' 'no status (--only)' >>"$RUN/summary"
    return 0
  fi
  log="$LOGS/$slug.log"
  : >"$log"
  started="$(date +%s)"
  echo
  echo "== $job"
  if [ "$job" = 'Developer Certificate of Origin' ] && [ "$DEPENDABOT" = yes ]; then
    echo '  skipped: hygiene.yml skips this job for Dependabot, no status posted' | tee -a "$log"
    printf '%-32s %-8s %7s  %s\n' "$job" skipped '-' 'no status (Dependabot: merge-pr.sh will find it missing)' >>"$RUN/summary"
    return 0
  fi
  # A server that took the port since the checks: the tests could not run.
  if [ "$job" = 'End-to-end' ] && port_taken; then
    echo "  not run: $E2E_URL already answers (another server holds the port), no status posted" | tee -a "$log"
    printf '%-32s %-8s %7s  %s\n' "$job" 'not run' '-' "no status ($E2E_URL already answered)" >>"$RUN/summary"
    NOT_RUN=$((NOT_RUN + 1))
    return 0
  fi
  tree="$RUN/w$2"
  jobtmp="$RUN/t$2"
  mkdir -p "$jobtmp/runner"
  known_steps | awk -F "$TAB" -v job="$job" '$1 == job' >"$jobtmp/steps"
  failed=''
  echo "$tree" >>"$RUN/worktrees"
  if ! git worktree add --detach --quiet "$tree" "$SHA" >>"$log" 2>&1; then
    failed='uses: actions/checkout'
    echo "  failed: could not make a worktree at $SHA (see the log)"
  fi
  while IFS="$TAB" read -r _ key handler when; do
    if [ -n "$failed" ] && [ "$when" != failure ]; then
      printf '\n==== %s\nNot run: an earlier step failed.\n' "$key" >>"$log"
      continue
    fi
    if [ -z "$failed" ] && [ "$when" = failure ]; then
      printf '\n==== %s\nSkipped: no step failed.\n' "$key" >>"$log"
      continue
    fi
    printf '\n==== %s (%s UTC)\n' "$key" "$(date -u '+%H:%M:%S')" >>"$log"
    rm -f "$jobtmp/skipped"
    step_started="$(date +%s)"
    lines_before="$(wc -l <"$log")"
    if (cd "$tree" && LCI_STEP_KEY="$key" LCI_JOB_TMP="$jobtmp" RUNNER_TEMP="$jobtmp/runner" \
      sh "$SELF" --step "$handler") </dev/null >>"$log" 2>&1; then
      if [ -f "$jobtmp/skipped" ]; then result="skipped ($(cat "$jobtmp/skipped"))"; else result=passed; fi
    else
      result=FAILED
      if [ -z "$failed" ]; then failed="$key"; fi
    fi
    echo "  $(minutes $(($(date +%s) - step_started)))  $result: $key"
    if [ "$result" = FAILED ]; then
      # The end of what the step printed; the whole of it is in the log.
      tail -n "+$((lines_before + 1))" "$log" | tail -n 15 | sed 's/^/      | /'
    fi
  done <"$jobtmp/steps"
  elapsed="$(minutes $(($(date +%s) - started)))"
  note=''
  if [ -f "$jobtmp/note" ]; then note="$(cat "$jobtmp/note")"; fi
  if [ -n "$failed" ]; then
    state=failure
    note="failed at $failed"
    FAILED_JOBS=$((FAILED_JOBS + 1))
  else
    state=success
  fi
  description="$(describe "$note")"
  if post_status "$state" "$job" "$description"; then
    posted="status posted: $description"
  else
    posted='status NOT posted (gh api failed)'
    UNPOSTED=$((UNPOSTED + 1))
  fi
  echo "  $job: $state in $elapsed, $posted" | tee -a "$log"
  printf '%-32s %-8s %7s  %s\n' "$job" "$state" "$elapsed" "$posted" >>"$RUN/summary"
  remove_worktree "$tree"
}

run_job 'Text hygiene' 1
run_job 'Developer Certificate of Origin' 2
run_job 'Build and test' 3
run_job 'End-to-end' 4

{
  echo "Local CI of pull request $PR at $SHA, on $HOST, $STAMP"
  cat "$RUN/summary"
} >"$LOGS/summary.txt"
echo
echo "Summary"
cat "$RUN/summary"

# GitHub records each job it refuses to start as a failed check run of the
# commit, under the name of the job: merge-pr.sh counts those too.
ACTIONS_FAILED="$(gh api "repos/{owner}/{repo}/commits/$SHA/check-runs" \
  --jq '.check_runs[] | select(.app.slug == "github-actions" and .conclusion == "failure") | .name' \
  2>/dev/null | sort -u)" || ACTIONS_FAILED=''
if [ -n "$ACTIONS_FAILED" ]; then
  echo
  echo "GitHub Actions also has failed checks on $SHA (jobs it refused to start, or that failed there):"
  printf '%s\n' "$ACTIONS_FAILED" | sed 's/^/  /'
  echo 'merge-pr.sh counts them as failures: see docs/testing.md, "While GitHub Actions is unavailable".'
fi
echo "Logs: $LOGS"
if [ "$FAILED_JOBS" -gt 0 ] || [ "$UNPOSTED" -gt 0 ] || [ "$NOT_RUN" -gt 0 ]; then exit 1; fi
exit 0
