#!/usr/bin/env sh
# SPDX-License-Identifier: MIT
# Tests tools/github/merge-pr.sh with a fake gh on PATH: it merges only when
# the four required checks are reported and pass, waits for them to be
# reported, and refuses a skipped, failed or missing one. The only exception:
# a Dependabot pull request may have the Developer Certificate of Origin
# check skipped. It also refuses a pull request whose branch is behind main,
# before the checks and again just before merging, and says how to update it.
# Usage: sh tools/github/merge-pr.test.sh
# The scenario functions are called by name, through "scenario".
# shellcheck disable=SC2329
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM

mkdir "$work/bin"
# The fake gh reads its answers from $FAKE_GH:
# - title: the pull request title;
# - author: the login of its author, as gh prints it (a person by default);
# - checks.<n>: the checks (name TAB bucket) on the n-th listing, else checks;
# - watch-exit: the exit code of "gh pr checks --watch" (0 by default);
# - merge-state: GitHub's mergeStateStatus (CLEAN by default);
# - behind-by.<n>: how many commits of main the branch lacks, on the n-th
#   comparison, else behind-by (0 by default);
# - compared: written by "gh api", the path of the last comparison;
# - merged: written by "gh pr merge".
cat >"$work/bin/gh" <<'FAKE'
#!/usr/bin/env sh
set -eu
case "$1 $2" in
  'api '*)
    case "$2" in
      repos/'{owner}/{repo}'/compare/*)
        printf '%s\n' "$2" >"$FAKE_GH/compared"
        count=$(($(cat "$FAKE_GH/comparisons" 2>/dev/null || echo 0) + 1))
        echo "$count" >"$FAKE_GH/comparisons"
        if [ -f "$FAKE_GH/behind-by.$count" ]; then
          cat "$FAKE_GH/behind-by.$count"
        else
          cat "$FAKE_GH/behind-by" 2>/dev/null || echo 0
        fi
        ;;
      *) echo "fake gh: unexpected arguments: $*" >&2; exit 2 ;;
    esac
    ;;
  'pr view')
    case " $* " in
      *' author '*) cat "$FAKE_GH/author" 2>/dev/null || echo 'a-maintainer' ;;
      *' title '*) cat "$FAKE_GH/title" ;;
      *' mergeStateStatus '*) cat "$FAKE_GH/merge-state" 2>/dev/null || echo 'CLEAN' ;;
      *' baseRefName '*) echo 'main' ;;
      *' headRefName '*) echo 'fix/SCRUM-1-a-topic' ;;
      *' headRefOid '*) echo 'abc123' ;;
      *) echo "fake gh: unexpected arguments: $*" >&2; exit 2 ;;
    esac
    ;;
  'pr merge') printf '%s\n' "$*" >"$FAKE_GH/merged" ;;
  'pr checks')
    case " $* " in
      *' --watch '*) exit "$(cat "$FAKE_GH/watch-exit" 2>/dev/null || echo 0)" ;;
    esac
    count=$(($(cat "$FAKE_GH/calls" 2>/dev/null || echo 0) + 1))
    echo "$count" >"$FAKE_GH/calls"
    if [ -f "$FAKE_GH/checks.$count" ]; then cat "$FAKE_GH/checks.$count"; else cat "$FAKE_GH/checks"; fi
    ;;
  *) echo "fake gh: unexpected arguments: $*" >&2; exit 2 ;;
esac
FAKE
chmod +x "$work/bin/gh"

tab="$(printf '\t')"
failures=0
total=0

# Writes a checks listing: each argument is "name=bucket".
listing() {
  for pair in "$@"; do
    printf '%s%s%s\n' "${pair%%=*}" "$tab" "${pair#*=}"
  done
}

all_pass() {
  listing 'Text hygiene=pass' 'Developer Certificate of Origin=pass' \
    'Build and test=pass' 'End-to-end=pass' "$@"
}

# Runs a scenario prepared by the function named $2; $1 is "merge" or "refuse",
# and $3, when given, is a text the output must contain.
scenario() {
  expected="$1"
  name="$2"
  says="${3:-}"
  total=$((total + 1))
  dir="$work/$name"
  mkdir "$dir"
  echo 'fix: a valid title' >"$dir/title"
  FAKE_GH="$dir"
  "$name" >"$dir/checks"
  status=0
  FAKE_GH="$dir" PATH="$work/bin:$PATH" MERGE_PR_WAIT_TRIES=3 MERGE_PR_WAIT_SECONDS=0 \
    sh "$here/merge-pr.sh" 42 >"$dir/out" 2>&1 || status=$?
  said=yes
  if [ -n "$says" ] && ! grep -Fq -- "$says" "$dir/out"; then said=no; fi
  if [ "$expected" = merge ] && [ "$status" -eq 0 ] && [ -f "$dir/merged" ] && [ "$said" = yes ]; then
    echo "ok: $name"
  elif [ "$expected" = refuse ] && [ "$status" -ne 0 ] && [ ! -f "$dir/merged" ] && [ "$said" = yes ]; then
    echo "ok: $name"
  else
    failures=$((failures + 1))
    echo "FAIL: $name (expected $expected${says:+ saying \"$says\"}, exit $status)"
    sed 's/^/  | /' "$dir/out"
  fi
}

merges_when_the_four_pass() { all_pass; }
merges_with_another_check_skipped() { all_pass 'Optional=skipping'; }
refuses_a_skipped_dco() {
  listing 'Text hygiene=pass' 'Developer Certificate of Origin=skipping' \
    'Build and test=pass' 'End-to-end=pass'
}
refuses_a_missing_end_to_end() {
  listing 'Text hygiene=pass' 'Developer Certificate of Origin=pass' 'Build and test=pass'
}
refuses_a_failed_build() {
  listing 'Text hygiene=pass' 'Developer Certificate of Origin=pass' \
    'Build and test=fail' 'End-to-end=pass'
}
refuses_a_pending_check() {
  listing 'Text hygiene=pass' 'Developer Certificate of Origin=pass' \
    'Build and test=pending' 'End-to-end=pass'
}
refuses_another_failed_check() { all_pass 'Optional=fail'; }
refuses_when_watch_fails() {
  echo 1 >"$FAKE_GH/watch-exit"
  all_pass
}
refuses_a_bad_title() {
  echo 'Fixed things.' >"$FAKE_GH/title"
  all_pass
}
waits_for_the_checks_to_be_reported() {
  listing 'Text hygiene=pending' >"$FAKE_GH/checks.1"
  listing 'Text hygiene=pass' 'Build and test=pending' >"$FAKE_GH/checks.2"
  all_pass
}
gives_up_when_a_check_is_never_reported() {
  listing 'Text hygiene=pass' 'Build and test=pass' 'End-to-end=pass'
}
dependabot_skipped_dco() {
  listing 'Text hygiene=pass' 'Developer Certificate of Origin=skipping' \
    'Build and test=pass' 'End-to-end=pass'
}
merges_a_dependabot_pr_with_dco_skipped() {
  echo 'app/dependabot' >"$FAKE_GH/author"
  dependabot_skipped_dco
}
merges_a_dependabot_pr_under_its_rest_login() {
  echo 'dependabot[bot]' >"$FAKE_GH/author"
  dependabot_skipped_dco
}
merges_a_dependabot_pr_with_dco_passed() {
  echo 'app/dependabot' >"$FAKE_GH/author"
  all_pass
}
refuses_a_dependabot_pr_with_a_failed_build() {
  echo 'app/dependabot' >"$FAKE_GH/author"
  listing 'Text hygiene=pass' 'Developer Certificate of Origin=skipping' \
    'Build and test=fail' 'End-to-end=pass'
}
refuses_a_dependabot_pr_with_end_to_end_skipped() {
  echo 'app/dependabot' >"$FAKE_GH/author"
  listing 'Text hygiene=pass' 'Developer Certificate of Origin=skipping' \
    'Build and test=pass' 'End-to-end=skipping'
}
refuses_a_dependabot_pr_with_dco_failed() {
  echo 'app/dependabot' >"$FAKE_GH/author"
  listing 'Text hygiene=pass' 'Developer Certificate of Origin=fail' \
    'Build and test=pass' 'End-to-end=pass'
}
refuses_a_skipped_dco_from_a_person_named_dependabot() {
  echo 'dependabot' >"$FAKE_GH/author"
  dependabot_skipped_dco
}
refuses_a_branch_behind_main() {
  echo 2 >"$FAKE_GH/behind-by"
  all_pass
}
refuses_what_github_reports_behind() {
  echo 'BEHIND' >"$FAKE_GH/merge-state"
  all_pass
}
refuses_when_main_moves_during_the_checks() {
  echo 0 >"$FAKE_GH/behind-by.1"
  echo 1 >"$FAKE_GH/behind-by"
  all_pass
}
refuses_when_the_comparison_answers_nothing() {
  : >"$FAKE_GH/behind-by"
  all_pass
}

scenario merge merges_when_the_four_pass 'squash-merged'
scenario merge merges_with_another_check_skipped 'squash-merged'
scenario merge waits_for_the_checks_to_be_reported 'squash-merged'
scenario refuse refuses_a_skipped_dco 'Developer Certificate of Origin: skipping'
scenario refuse refuses_a_missing_end_to_end '  End-to-end'
scenario refuse refuses_a_failed_build 'Build and test: fail'
scenario refuse refuses_a_pending_check 'Build and test: pending'
scenario refuse refuses_another_failed_check 'Optional: fail'
scenario refuse refuses_when_watch_fails 'a check failed'
scenario refuse refuses_a_bad_title 'not a valid Conventional Commits subject'
scenario refuse gives_up_when_a_check_is_never_reported 'never reported'
scenario merge merges_a_dependabot_pr_with_dco_skipped 'squash-merged'
scenario merge merges_a_dependabot_pr_under_its_rest_login 'squash-merged'
scenario merge merges_a_dependabot_pr_with_dco_passed 'squash-merged'
scenario refuse refuses_a_dependabot_pr_with_a_failed_build 'Build and test: fail'
scenario refuse refuses_a_dependabot_pr_with_end_to_end_skipped 'End-to-end: skipping'
scenario refuse refuses_a_dependabot_pr_with_dco_failed 'Developer Certificate of Origin: fail'
scenario refuse refuses_a_skipped_dco_from_a_person_named_dependabot \
  'Developer Certificate of Origin: skipping'
scenario refuse refuses_a_branch_behind_main 'is behind main'
scenario refuse refuses_what_github_reports_behind 'is behind main'
scenario refuse refuses_when_main_moves_during_the_checks 'is behind main'
scenario refuse refuses_when_the_comparison_answers_nothing 'is behind main'

if [ "$(cat "$work/waits_for_the_checks_to_be_reported/calls")" -lt 3 ]; then
  failures=$((failures + 1))
  echo 'FAIL: the script lists the checks again until the four are reported'
fi

# The branch is compared with its base, at the head commit of the pull request.
if [ "$(cat "$work/merges_when_the_four_pass/compared" 2>/dev/null)" != 'repos/{owner}/{repo}/compare/main...abc123' ]; then
  failures=$((failures + 1))
  echo 'FAIL: the script compares main with the head commit of the pull request'
fi

# A branch behind main is refused before waiting for the checks, and the
# refusal says how to bring it up to date.
behind="$work/refuses_a_branch_behind_main"
if [ -f "$behind/calls" ]; then
  failures=$((failures + 1))
  echo 'FAIL: a branch behind main is refused before the checks are read'
fi
for line in 'git fetch origin' 'git switch fix/SCRUM-1-a-topic' 'git merge --signoff origin/main' \
  'git push' 'wait until the checks of the new commit pass'; do
  if ! grep -Fq -- "$line" "$behind/out"; then
    failures=$((failures + 1))
    echo "FAIL: the refusal says how to update the branch: \"$line\""
  fi
done

# Main moving while the checks run is seen just before the merge.
if [ "$(cat "$work/refuses_when_main_moves_during_the_checks/comparisons" 2>/dev/null || echo 0)" -lt 2 ]; then
  failures=$((failures + 1))
  echo 'FAIL: the script compares the branch with main again just before merging'
fi

echo "$((total - failures)) of $total scenarios passed"
[ "$failures" -eq 0 ]
