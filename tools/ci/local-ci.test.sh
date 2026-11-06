#!/usr/bin/env sh
# SPDX-License-Identifier: MIT
# Tests tools/ci/local-ci.sh on fixture repositories built at run time, with a
# fake gh and fake pnpm, node, shellcheck, docker and reuse on PATH (git and
# Python are real):
# - its steps are the steps of .github/workflows/ci.yml and hygiene.yml, and
#   a step it does not know (added, removed or renamed) fails this test and
#   makes it refuse the pull request;
# - it refuses a pull request behind main (as GitHub reports it, or as the
#   fetched main shows it), a head that moved, a closed pull request, a
#   temporary folder in OneDrive, a missing Docker without --skip-docker, a
#   server already on the port of the end-to-end tests (later on, it leaves
#   that job not run, without a status), and a Node download whose SHA-256
#   is not the one of the release;
# - it runs each job in a fresh worktree at the head commit, removed at the
#   end, also on failure, and posts one status per job on that commit only
#   once the job ran: success only when every step passed (the server image
#   step skipped by --skip-docker is said in the description), failure naming
#   the first failed step; nothing for the Developer Certificate of Origin of
#   a Dependabot pull request, which CI skips;
# - it applies the rules of hygiene.yml (commit messages, title, description,
#   Jira reference of internal pull requests, sign-off of every commit);
# - --workers sets the Playwright workers, --only the jobs that run.
# Usage: sh tools/ci/local-ci.test.sh
# The scenario functions are called by name, through "scenario".
# shellcheck disable=SC2329
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM

# This test also runs inside a local CI run: it must not inherit its settings.
unset LOCAL_CI_TMPDIR LOCAL_CI_LOGS LOCAL_CI_CACHE LOCAL_CI_REUSE LOCAL_CI_NODE_MIRROR PLAYWRIGHT_BROWSERS_PATH \
  VITEST_MAX_WORKERS

TAB="$(printf '\t')"
JOBS='Text hygiene
Developer Certificate of Origin
Build and test
End-to-end'

# The versions the fixture pins, as the repository does.
mkdir "$work/bin" "$work/tools" "$work/browsers" "$work/browsers/chromium-1"
sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' "$root/package.json" >"$work/tools/pnpm-version"
node_pin="$(tr -d ' \r\n' <"$root/.nvmrc" | sed 's/^v//')"
case "$node_pin" in
  *.*.*) echo "v$node_pin" >"$work/tools/node-version" ;;
  *) echo "v$node_pin.0.1" >"$work/tools/node-version" ;;
esac
sed -n 's/^reuse\(\[[^]]*\]\)\{0,1\}==\([0-9][0-9.]*\).*/\2/p' "$root/tools/reuse/requirements.txt" >"$work/tools/reuse-version"

# A fake tool: it records each call with CI and the commit of its folder,
# answers the version checks, refuses the release build as the real one does
# with an unsigned pack, and fails a call listed in $FAKE/fail (one call per
# line, as recorded). A failed end-to-end run leaves a report.
cat >"$work/bin/fake-tool" <<'FAKE'
#!/usr/bin/env sh
name="${0##*/}"
call="$name $*"
printf '%s [CI=%s] [at %s] [vitest workers=%s]\n' "$call" "${CI:-}" "$(git rev-parse HEAD 2>/dev/null || echo none)" \
  "${VITEST_MAX_WORKERS:-}" >>"$FAKE/calls"
# A copy of this tool in a fake Node release answers the version of the release.
if [ "$call" = 'node --version' ] && [ -f "${0%/*}/VERSION" ]; then cat "${0%/*}/VERSION"; exit 0; fi
case "$call" in
  'pnpm --version') cat "$FAKE_TOOLS/pnpm-version"; exit 0 ;;
  'node --version') cat "$FAKE/node-version" 2>/dev/null || cat "$FAKE_TOOLS/node-version"; exit 0 ;;
  'reuse --version') echo "reuse, version $(cat "$FAKE_TOOLS/reuse-version")"; exit 0 ;;
  'docker info') if [ -f "$FAKE/no-docker" ]; then exit 1; fi; exit 0 ;;
  'pnpm --filter @siapso/app exec vite build --outDir '*)
    echo 'Release build refused: the knowledge pack is not signed.'
    exit 1
    ;;
esac
if [ -f "$FAKE/fail" ] && grep -Fxq -- "$call" "$FAKE/fail"; then
  case "$call" in
    'pnpm e2e '*) mkdir -p app/playwright-report && echo report >app/playwright-report/index.html ;;
  esac
  echo "fake $name: failing as asked"
  exit 1
fi
exit 0
FAKE
for tool in pnpm node shellcheck docker reuse; do
  cp "$work/bin/fake-tool" "$work/bin/$tool"
  chmod +x "$work/bin/$tool"
done

# A fake curl for the address of the end-to-end tests: nothing answers there,
# unless $FAKE/port-taken-from holds n, and this is the n-th check or later.
# Any other address goes to the real curl (the Node mirror of the test).
REAL_CURL="$(command -v curl)"
export REAL_CURL
cat >"$work/bin/curl" <<'FAKE'
#!/usr/bin/env sh
case "$*" in
  *'http://localhost:4173'*)
    count=$(($(cat "$FAKE/port-checks" 2>/dev/null || echo 0) + 1))
    echo "$count" >"$FAKE/port-checks"
    if [ -f "$FAKE/port-taken-from" ] && [ "$count" -ge "$(cat "$FAKE/port-taken-from")" ]; then exit 0; fi
    exit 7
    ;;
esac
exec "$REAL_CURL" "$@"
FAKE
chmod +x "$work/bin/curl"

# The fake gh reads its answers from $FAKE:
# - state, head-sha, branch, merge-state, cross, author, title, body: what
#   "gh pr view" prints (OPEN, the pull request head, ci/SCRUM-1-a-topic,
#   CLEAN, false, a-maintainer, a valid title, a body with a Jira reference);
# - behind-by: how many commits of main the head lacks (0 by default);
# - actions-failed: the names of the failed check runs of GitHub Actions on
#   the head commit, as the check-runs query of the script prints them (none
#   by default);
# - statuses: written by "gh api --method POST .../statuses/<sha>", one line
#   per status: sha, context, state, description (tab-separated); each post
#   is also recorded in calls.
cat >"$work/bin/gh" <<'FAKE'
#!/usr/bin/env sh
set -eu
answer() { cat "$FAKE/$1" 2>/dev/null || printf '%s\n' "$2"; }
unexpected() { echo "fake gh: unexpected arguments: $*" >&2; exit 2; }
case "$1" in
  pr)
    [ "$2" = view ] || unexpected "$@"
    case " $* " in
      *' state '*) answer state OPEN ;;
      *' headRefOid '*) answer head-sha '' ;;
      *' baseRefName '*) echo main ;;
      *' headRefName '*) answer branch 'ci/SCRUM-1-a-topic' ;;
      *' mergeStateStatus '*) answer merge-state CLEAN ;;
      *' isCrossRepository '*) answer cross false ;;
      *' author '*) answer author a-maintainer ;;
      *' title '*) answer title 'ci: run a valid change' ;;
      *' body '*) answer body 'A change. Refs: SCRUM-1' ;;
      *) unexpected "$@" ;;
    esac
    ;;
  api)
    shift
    method=GET path='' state='' context='' description=''
    while [ $# -gt 0 ]; do
      case "$1" in
        --method) method="$2"; shift 2 ;;
        --jq) shift 2 ;;
        -f)
          case "$2" in
            state=*) state="${2#state=}" ;;
            context=*) context="${2#context=}" ;;
            description=*) description="${2#description=}" ;;
            *) unexpected "$2" ;;
          esac
          shift 2
          ;;
        *) path="$1"; shift ;;
      esac
    done
    case "$method $path" in
      'GET repos/{owner}/{repo}/compare/main...'*) answer behind-by 0 ;;
      'GET repos/{owner}/{repo}/commits/'*'/check-runs') cat "$FAKE/actions-failed" 2>/dev/null || true ;;
      'POST repos/{owner}/{repo}/statuses/'*)
        printf '%s\t%s\t%s\t%s\n' "${path##*/}" "$context" "$state" "$description" >>"$FAKE/statuses"
        printf 'gh status %s=%s\n' "$context" "$state" >>"$FAKE/calls"
        ;;
      *) unexpected "$method" "$path" ;;
    esac
    ;;
  *) unexpected "$@" ;;
esac
FAKE
chmod +x "$work/bin/gh"

# A fixture repository with a test identity and no line ending conversion.
identity() {
  git -C "$1" config user.name 'Fixture Author'
  git -C "$1" config user.email 'fixture@example.org'
  git -C "$1" config core.autocrlf false
  git -C "$1" config commit.gpgsign false
}

# Settings of a scenario, reset before each one.
reset_settings() {
  pr_message='feat: add a change

Refs: SCRUM-1

Signed-off-by: Fixture Author <fixture@example.org>'
  pr_change=change_a_file
  main_moves=no
  args='--skip-docker'
}

change_a_file() { echo 'a change' >"$1/change.txt"; }

# A step the script does not know, added to the build job of ci.yml.
add_a_build_step() {
  awk '{ print } $0 == "      - run: pnpm lint" { print "      - run: pnpm extra-check" }' \
    "$1/.github/workflows/ci.yml" >"$1/ci.yml.new"
  mv "$1/ci.yml.new" "$1/.github/workflows/ci.yml"
}

# The part of every fixture made once: a seed repository with main (copies of
# the workflows and of the files their steps read, stubs for the scripts the
# steps run), its bare origin and the maintainer's clone.
template="$work/template"
seed="$template/seed"
git init -q -b main "$seed"
identity "$seed"
mkdir -p "$seed/.github/workflows" "$seed/tools/hygiene" "$seed/tools/reuse" \
  "$seed/tools/github" "$seed/tools/ci" "$seed/tools/release"
cp "$root/.github/workflows/ci.yml" "$root/.github/workflows/hygiene.yml" "$seed/.github/workflows/"
cp "$root/.nvmrc" "$root/package.json" "$root/.hygieneignore" "$seed/"
cp "$root/tools/hygiene/hygiene.py" "$root/tools/hygiene/py.sh" "$seed/tools/hygiene/"
cp "$root/tools/reuse/requirements.txt" "$seed/tools/reuse/"
for stub in tools/github/merge-pr.sh tools/github/merge-pr.test.sh tools/ci/local-ci.sh \
  tools/ci/local-ci.test.sh tools/release/audit.sh tools/release/audit.test.sh \
  tools/ci/check-playwright-image.mjs; do
  echo '# A stub of the fixture repository.' >"$seed/$stub"
done
git -C "$seed" add -A
git -C "$seed" commit -q -s -m 'chore: start the fixture'
git clone -q --bare "$seed" "$template/origin.git"
git clone -q "$template/origin.git" "$template/clone"
identity "$template/clone"

# fixture <dir>: a copy of the template in <dir>, with pull request 7 (one
# commit, made with the scenario settings) pushed to the origin.
fixture() {
  cp -R "$template/seed" "$template/origin.git" "$template/clone" "$1/"
  seed="$1/seed"
  git -C "$seed" remote add origin "$1/origin.git"
  git -C "$1/clone" remote set-url origin "$1/origin.git"
  git -C "$seed" switch -q -c ci/SCRUM-1-a-topic
  "$pr_change" "$seed"
  git -C "$seed" add -A
  printf '%s\n' "$pr_message" | git -C "$seed" commit -q -F -
  git -C "$seed" push -q origin HEAD:refs/heads/ci/SCRUM-1-a-topic HEAD:refs/pull/7/head
  git -C "$seed" rev-parse HEAD >"$1/head"
  if [ "$main_moves" = yes ]; then
    git -C "$seed" switch -q main
    echo 'main moved' >"$seed/main.txt"
    git -C "$seed" add -A
    git -C "$seed" commit -q -s -m 'fix: move main on'
    git -C "$seed" push -q origin main
  fi
}

# node_mirror <dir> <good|bad>: a mirror of nodejs.org/dist in <dir> with one
# release of the Node .nvmrc names, for this platform, whose node is the fake
# tool answering that version; "bad" lists a wrong SHA-256 for its archive.
# Sets mirror to its file:// address.
node_mirror() {
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) os=win ext=zip bin='' ;;
    Darwin) os=darwin ext=tar.gz bin=/bin ;;
    *) os=linux ext=tar.gz bin=/bin ;;
  esac
  case "$(uname -m)" in
    aarch64 | arm64) arch=arm64 ;;
    *) arch=x64 ;;
  esac
  case "$node_pin" in
    *.*.*) release="v$node_pin" folder="v$node_pin" ;;
    *) release="v$node_pin.99.0" folder="latest-v$node_pin.x" ;;
  esac
  archive="node-$release-$os-$arch"
  mkdir -p "$1/build/$archive$bin" "$1/$folder"
  cp "$work/bin/fake-tool" "$1/build/$archive$bin/node"
  echo "$release" >"$1/build/$archive$bin/VERSION"
  sh "$root/tools/hygiene/py.sh" - "$1/build" "$archive" "$1/$folder/$archive.$ext" <<'PY'
import os, sys, tarfile, zipfile
base, name, out = sys.argv[1:4]
if out.endswith('.zip'):
    with zipfile.ZipFile(out, 'w') as archive:
        for folder, _, files in os.walk(os.path.join(base, name)):
            for file in files:
                path = os.path.join(folder, file)
                archive.write(path, os.path.relpath(path, base))
else:
    with tarfile.open(out, 'w:gz') as archive:
        archive.add(os.path.join(base, name), arcname=name)
PY
  if [ "$2" = good ]; then
    sum="$(sha256sum "$1/$folder/$archive.$ext" | cut -d ' ' -f 1)"
  else
    sum="$(printf '%064d' 0)"
  fi
  {
    printf '%s  %s\n' "$(printf '%064d' 0 | tr 0 a)" "node-$release.tar.gz"
    printf '%s  %s\n' "$sum" "$archive.$ext"
  } >"$1/$folder/SHASUMS256.txt"
  if command -v cygpath >/dev/null 2>&1; then
    mirror="file:///$(cygpath -m "$1")"
  else
    mirror="file://$1"
  fi
}

failures=0
total=0
tmpdir=''
mirror=''

fail() {
  failures=$((failures + 1))
  echo "FAIL: $1"
}

# Runs a scenario prepared by the function named $2, which may change the
# settings and write the answers of the fakes into $FAKE; $1 is "passes" (exit
# 0), "fails" (exit 1: a job failed) or "refuses" (exit 2: nothing ran), and
# $3, when given, is a text the output must contain.
scenario() {
  expected="$1"
  name="$2"
  says="${3:-}"
  total=$((total + 1))
  dir="$work/$name"
  mkdir -p "$dir/fake" "$dir/tmp"
  FAKE="$dir/fake"
  reset_settings
  "$name"
  fixture "$dir"
  if [ ! -f "$FAKE/head-sha" ]; then cp "$dir/head" "$FAKE/head-sha"; fi
  status=0
  # shellcheck disable=SC2086 # the arguments of the scenario, split on purpose
  (cd "$dir/clone" && FAKE="$FAKE" FAKE_TOOLS="$work/tools" PATH="$work/bin:$PATH" \
    LOCAL_CI_TMPDIR="${tmpdir:-$dir/tmp}" LOCAL_CI_REUSE="$work/bin/reuse" \
    LOCAL_CI_NODE_MIRROR="${mirror:-file:///no-network-in-this-test}" \
    PLAYWRIGHT_BROWSERS_PATH="$work/browsers" sh "$here/local-ci.sh" 7 $args) >"$dir/out" 2>&1 || status=$?
  tmpdir=''
  mirror=''
  : >>"$FAKE/statuses"
  : >>"$FAKE/calls"
  case "$expected" in
    passes) want=0 ;;
    fails) want=1 ;;
    *) want=2 ;;
  esac
  ok=yes
  if [ "$status" -ne "$want" ]; then ok=no; fi
  if [ -n "$says" ] && ! grep -Fq -- "$says" "$dir/out"; then ok=no; fi
  if [ "$expected" = refuses ] && [ -s "$FAKE/statuses" ]; then ok=no; fi
  # No worktree and no run folder are left behind, whatever the outcome.
  if [ -d "$dir/clone" ] && [ "$(git -C "$dir/clone" worktree list | wc -l | tr -d ' ')" != 1 ]; then ok=no; fi
  if [ -n "$(find "$dir/tmp" -maxdepth 1 -name 'lci.*' 2>/dev/null)" ]; then ok=no; fi
  if [ "$ok" = yes ]; then
    echo "ok: $name"
  else
    fail "$name (expected $expected${says:+ saying \"$says\"}, exit $status)"
    sed 's/^/  | /' "$dir/out"
  fi
}

# The state the status of job $2 got in scenario $1 ("none" when not posted).
status_of() {
  awk -F "$TAB" -v job="$2" '$2 == job { print $3; found = 1 } END { if (!found) print "none" }' \
    "$work/$1/fake/statuses" 2>/dev/null || echo none
}

# The description of the status of job $2 in scenario $1.
description_of() {
  awk -F "$TAB" -v job="$2" '$2 == job { print $4 }' "$work/$1/fake/statuses" 2>/dev/null
}

# expect_status <scenario> <job> <state>
expect_status() {
  got="$(status_of "$1" "$2")"
  if [ "$got" != "$3" ]; then fail "$1: the status of $2 is $3 (got $got)"; fi
}

called() { grep -Fq -- "$2 [CI=" "$work/$1/fake/calls"; }

# Most scenarios run only the jobs they are about (--only), to stay quick.
passes_when_every_step_passes() {
  args=''
  printf '%s\n' 'Build and test' 'End-to-end' >"$FAKE/actions-failed"
}
skips_the_server_image_and_runs_one_worker() { args='--skip-docker --workers 1 --only build-and-test,end-to-end'; }
refuses_without_docker() {
  args=''
  : >"$FAKE/no-docker"
}
fails_a_job_at_its_first_failed_step() {
  args='--skip-docker --only build-and-test,end-to-end'
  printf '%s\n' 'pnpm lint' 'pnpm e2e --workers=2' >"$FAKE/fail"
}
fails_dco_for_a_commit_not_signed_off() {
  args='--only developer-certificate-of-origin'
  pr_message='feat: add a change

Refs: SCRUM-1'
}
fails_hygiene_for_a_bad_commit_message() {
  args='--only text-hygiene'
  pr_message='Added a change.

Signed-off-by: Fixture Author <fixture@example.org>'
}
fails_hygiene_for_a_bad_title() {
  args='--only text-hygiene'
  echo 'Fixed things.' >"$FAKE/title"
}
fails_hygiene_for_an_attributed_body() {
  args='--only text-hygiene'
  printf 'Refs: SCRUM-1\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n' >"$FAKE/body"
}
fails_hygiene_without_a_jira_reference() {
  args='--only text-hygiene'
  echo 'ci/a-topic' >"$FAKE/branch"
  echo 'A change.' >"$FAKE/body"
}
passes_a_fork_without_a_jira_reference() {
  args='--only text-hygiene'
  echo 'ci/a-topic' >"$FAKE/branch"
  echo 'A change.' >"$FAKE/body"
  echo true >"$FAKE/cross"
}
skips_dco_for_dependabot() {
  args='--only text-hygiene,developer-certificate-of-origin'
  echo 'app/dependabot' >"$FAKE/author"
  pr_message='Bump a dependency'
}
refuses_an_unknown_job() { args='--only lint'; }
refuses_when_the_end_to_end_port_is_taken() {
  args='--only end-to-end'
  echo 1 >"$FAKE/port-taken-from"
}
leaves_the_end_to_end_job_when_its_port_is_taken_later() {
  args='--skip-docker --only build-and-test,end-to-end'
  echo 2 >"$FAKE/port-taken-from"
}
downloads_the_node_nvmrc_names() {
  args='--only end-to-end'
  echo 'v99.0.0' >"$FAKE/node-version"
  node_mirror "$dir/mirror" good
}
refuses_a_node_download_with_a_bad_checksum() {
  args='--only end-to-end'
  echo 'v99.0.0' >"$FAKE/node-version"
  node_mirror "$dir/mirror" bad
}
refuses_a_branch_github_reports_behind() { echo 'BEHIND' >"$FAKE/merge-state"; }
refuses_a_branch_behind_main() { echo 2 >"$FAKE/behind-by"; }
refuses_when_the_comparison_answers_nothing() { : >"$FAKE/behind-by"; }
refuses_when_the_fetched_main_is_ahead() { main_moves=yes; }
refuses_a_head_that_moved() { echo 0123456789abcdef0123456789abcdef01234567 >"$FAKE/head-sha"; }
refuses_a_closed_pull_request() { echo 'MERGED' >"$FAKE/state"; }
refuses_an_unknown_workflow_step() { pr_change=add_a_build_step; }
refuses_a_temporary_folder_in_onedrive() {
  tmpdir="$dir/tmp/OneDrive/Temp"
  mkdir -p "$tmpdir"
}
refuses_a_bad_workers_value() { args='--skip-docker --workers none'; }

scenario passes passes_when_every_step_passes 'Logs:'
scenario passes skips_the_server_image_and_runs_one_worker 'skipped'
scenario refuses refuses_without_docker '--skip-docker'
scenario fails fails_a_job_at_its_first_failed_step 'FAILED: run: pnpm lint'
scenario fails fails_dco_for_a_commit_not_signed_off "has no 'Signed-off-by' line"
scenario fails fails_hygiene_for_a_bad_commit_message 'Hygiene check failed'
scenario fails fails_hygiene_for_a_bad_title 'Hygiene check failed'
scenario fails fails_hygiene_for_an_attributed_body 'Hygiene check failed'
scenario fails fails_hygiene_without_a_jira_reference 'must reference a Jira ticket'
scenario passes passes_a_fork_without_a_jira_reference
scenario passes skips_dco_for_dependabot 'Dependabot'
scenario refuses refuses_a_branch_github_reports_behind 'is behind main'
scenario refuses refuses_a_branch_behind_main 'is behind main'
scenario refuses refuses_when_the_comparison_answers_nothing 'is behind main'
scenario refuses refuses_when_the_fetched_main_is_ahead 'is behind main'
scenario refuses refuses_a_head_that_moved 'moved'
scenario refuses refuses_a_closed_pull_request 'not open'
scenario refuses refuses_an_unknown_workflow_step 'run: pnpm extra-check'
scenario refuses refuses_a_temporary_folder_in_onedrive 'OneDrive'
scenario refuses refuses_a_bad_workers_value 'Usage'
scenario refuses refuses_an_unknown_job 'Usage'
scenario refuses refuses_when_the_end_to_end_port_is_taken 'http://localhost:4173 already answers'
scenario fails leaves_the_end_to_end_job_when_its_port_is_taken_later 'http://localhost:4173 already answers'
scenario passes downloads_the_node_nvmrc_names 'Downloading node-v'
scenario refuses refuses_a_node_download_with_a_bad_checksum 'checksum mismatch'

# Every job ran at the head commit, with CI set, and posted success after its
# last step; the descriptions say where and when, and nothing more.
s=passes_when_every_step_passes
head="$(cat "$work/$s/head")"
for job in 'Text hygiene' 'Developer Certificate of Origin' 'Build and test' 'End-to-end'; do
  expect_status "$s" "$job" success
  description="$(description_of "$s" "$job")"
  case "$description" in
    'Local run on '*', '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' '[0-9][0-9]:[0-9][0-9]' UTC (GitHub Actions unavailable)') ;;
    *) fail "$s: the description of $job says where and when it ran (got \"$description\")" ;;
  esac
  case "$description" in *@*) fail "$s: the description of $job holds no address" ;; esac
  if [ "${#description}" -gt 140 ]; then fail "$s: the description of $job fits in 140 characters"; fi
done
if [ "$(cut -f 1 "$work/$s/fake/statuses" | sort -u)" != "$head" ]; then
  fail "$s: every status is posted on the head commit of the pull request"
fi
if [ "$(cut -f 2 "$work/$s/fake/statuses")" != "$JOBS" ]; then
  fail "$s: one status per job, in the order the jobs ran"
fi
if grep -v -e '^gh ' -e ' --version \[' -e '^docker info \[' "$work/$s/fake/calls" | grep -Fvq "[at $head]"; then
  fail "$s: every step runs in a worktree at the head commit"
fi
if grep -v -e '^gh ' "$work/$s/fake/calls" | grep -Fvq '[CI=true]'; then
  fail "$s: every step runs with CI=true, as on GitHub Actions"
fi
for step in 'pnpm install --frozen-lockfile' 'shellcheck tools/github/merge-pr.sh tools/github/merge-pr.test.sh' \
  'shellcheck tools/ci/local-ci.sh tools/ci/local-ci.test.sh' \
  'shellcheck tools/release/audit.sh tools/release/audit.test.sh' 'pnpm lint' 'pnpm format:check' \
  'pnpm typecheck' 'pnpm test:coverage' 'pnpm knowledge:check' 'pnpm eval:resolver' 'pnpm build' \
  'pnpm budget:app' 'docker build -f server/Dockerfile -t siapso-server:ci .' \
  'node tools/ci/check-playwright-image.mjs' 'pnpm knowledge:build' 'pnpm e2e --workers=2'; do
  if ! called "$s" "$step"; then fail "$s: runs \"$step\""; fi
done
if ! grep -q '^reuse .*lint \[' "$work/$s/fake/calls"; then fail "$s: runs reuse lint"; fi
if ! grep -q '^pnpm test:coverage \[.*\[vitest workers=2\]$' "$work/$s/fake/calls"; then
  fail "$s: runs the unit tests with at most 2 Vitest workers"
fi
if ! grep -q '^node tools/ci/check-playwright-image.mjs --browsers .*browsers \[' "$work/$s/fake/calls"; then
  fail "$s: checks the local Playwright browsers folder"
fi
# Each status comes after the last step of its job.
order="$(grep -n -e '^gh status Build and test=' -e '^pnpm budget:app ' -e '^docker build ' \
  -e '^gh status End-to-end=' -e '^pnpm e2e ' "$work/$s/fake/calls" | cut -d ' ' -f 1-2)"
expected_order="$(printf '%s\n' 'pnpm budget:app' 'docker build' 'gh status' 'pnpm e2e' 'gh status')"
if [ "$(printf '%s\n' "$order" | cut -d : -f 2-)" != "$expected_order" ]; then
  fail "$s: a job posts its status after its last step"
fi
logs="$(sed -n 's/^Logs: //p' "$work/$s/out")"
for file in text-hygiene.log developer-certificate-of-origin.log build-and-test.log end-to-end.log summary.txt; do
  if [ ! -f "$logs/$file" ]; then fail "$s: the logs folder holds $file"; fi
done
# The failed checks GitHub Actions left on the commit (jobs it refused to
# start) are named, since merge-pr.sh counts them too.
if ! grep -Fq 'merge-pr.sh counts them as failures' "$work/$s/out" ||
  ! grep -Fxq '  Build and test' "$work/$s/out" || ! grep -Fxq '  End-to-end' "$work/$s/out"; then
  fail "$s: names the failed checks of GitHub Actions on the commit"
fi
if grep -Fq 'merge-pr.sh counts them' "$work/skips_the_server_image_and_runs_one_worker/out"; then
  fail 'says nothing of GitHub Actions when it left no failed check'
fi

# --skip-docker: the server image step alone is skipped, and said; --workers;
# --only: the other jobs neither run nor get a status.
s=skips_the_server_image_and_runs_one_worker
expect_status "$s" 'Build and test' success
expect_status "$s" 'End-to-end' success
expect_status "$s" 'Text hygiene' none
expect_status "$s" 'Developer Certificate of Origin' none
case "$(description_of "$s" 'Build and test')" in
  *'(GitHub Actions unavailable), server image build skipped (--skip-docker)') ;;
  *) fail "$s: the description of Build and test says the server image build was skipped" ;;
esac
if grep -q '^docker build' "$work/$s/fake/calls"; then fail "$s: builds no server image"; fi
if ! called "$s" 'pnpm budget:app'; then fail "$s: runs every other step"; fi
if ! called "$s" 'pnpm e2e --workers=1'; then fail "$s: runs the end-to-end tests with --workers=1"; fi

# A job stops at its first failed step and posts failure, naming that step;
# the report of failed end-to-end tests stays with the logs.
s=fails_a_job_at_its_first_failed_step
expect_status "$s" 'Build and test' failure
expect_status "$s" 'End-to-end' failure
case "$(description_of "$s" 'Build and test')" in
  *'(GitHub Actions unavailable), failed at run: pnpm lint') ;;
  *) fail "$s: the description names the failed step" ;;
esac
if called "$s" 'pnpm format:check'; then fail "$s: no step runs after a failed step"; fi
logs="$(sed -n 's/^Logs: //p' "$work/$s/out")"
if [ ! -f "$logs/playwright-report/index.html" ]; then fail "$s: the Playwright report is kept with the logs"; fi

expect_status fails_dco_for_a_commit_not_signed_off 'Developer Certificate of Origin' failure
expect_status fails_hygiene_for_a_bad_commit_message 'Text hygiene' failure
expect_status fails_hygiene_for_a_bad_title 'Text hygiene' failure
expect_status fails_hygiene_for_an_attributed_body 'Text hygiene' failure
expect_status fails_hygiene_without_a_jira_reference 'Text hygiene' failure
expect_status passes_a_fork_without_a_jira_reference 'Text hygiene' success

# A server that took the port of the end-to-end tests after the checks
# leaves that job not run, without a status, and the run fails.
s=leaves_the_end_to_end_job_when_its_port_is_taken_later
expect_status "$s" 'Build and test' success
expect_status "$s" 'End-to-end' none
if called "$s" 'pnpm e2e --workers=2'; then fail "$s: does not run the end-to-end tests"; fi

# Dependabot: the commit message is not checked and the Developer
# Certificate of Origin job is skipped, without a status, as in hygiene.yml.
s=skips_dco_for_dependabot
expect_status "$s" 'Developer Certificate of Origin' none
expect_status "$s" 'Text hygiene' success

# The steps the script knows are the steps of the workflows of this
# repository; a step added, removed or renamed in either file is reported.
total=$((total + 1))
if sh "$here/local-ci.sh" --check-workflows "$root" >"$work/check.out" 2>&1; then
  echo 'ok: knows every step of ci.yml and hygiene.yml'
else
  fail 'the steps of local-ci.sh are the steps of ci.yml and hygiene.yml'
  sed 's/^/  | /' "$work/check.out"
fi

# check_changed <name> <text the report names> <edit>: the edit, applied to a
# copy of the workflows, makes --check-workflows fail and name the step.
check_changed() {
  total=$((total + 1))
  copy="$work/workflows-$1"
  mkdir -p "$copy/.github/workflows"
  cp "$root/.github/workflows/ci.yml" "$root/.github/workflows/hygiene.yml" "$copy/.github/workflows/"
  "$3" "$copy/.github/workflows"
  if sh "$here/local-ci.sh" --check-workflows "$copy" >"$work/$1.out" 2>&1; then
    fail "$1: --check-workflows reports the change"
  elif ! grep -Fq -- "$2" "$work/$1.out"; then
    fail "$1: --check-workflows names \"$2\""
    sed 's/^/  | /' "$work/$1.out"
  else
    echo "ok: $1"
  fi
}
add_to_ci() {
  awk '{ print } $0 == "      - run: pnpm lint" { print "      - run: pnpm extra-check" }' "$1/ci.yml" >"$1/new"
  mv "$1/new" "$1/ci.yml"
}
add_to_hygiene() { printf '%s\n' '      - name: A new check' '        run: echo new' >>"$1/hygiene.yml"; }
remove_from_ci() { grep -vx '      - run: pnpm typecheck' "$1/ci.yml" >"$1/new" && mv "$1/new" "$1/ci.yml"; }
rename_in_hygiene() {
  sed 's/name: Tracked files (no em dash, no emoji)/name: Tracked files/' "$1/hygiene.yml" >"$1/new"
  mv "$1/new" "$1/hygiene.yml"
}
add_a_job() { printf '%s\n' '  extra:' '    name: Extra' '    steps:' '      - run: echo extra' >>"$1/ci.yml"; }
check_changed reports_a_step_added_to_ci 'run: pnpm extra-check' add_to_ci
check_changed reports_a_step_added_to_hygiene 'A new check' add_to_hygiene
check_changed reports_a_step_removed_from_ci 'run: pnpm typecheck' remove_from_ci
check_changed reports_a_renamed_step 'Tracked files' rename_in_hygiene
check_changed reports_a_new_job 'Extra' add_a_job

echo "$((total - failures)) of $total scenarios passed"
[ "$failures" -eq 0 ]
