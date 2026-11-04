#!/usr/bin/env sh
# SPDX-License-Identifier: MIT
# Tests tools/github/merge-pr.sh with a fake gh on PATH: it merges only when
# the four required checks are reported and pass, waits for them to be
# reported, and refuses a skipped, failed or missing one. The only exception:
# a Dependabot pull request may have the Developer Certificate of Origin
# check skipped.
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
# - merged: written by "gh pr merge".
cat >"$work/bin/gh" <<'FAKE'
#!/usr/bin/env sh
set -eu
case "$1 $2" in
  'pr view')
    case " $* " in
      *' author '*) cat "$FAKE_GH/author" 2>/dev/null || echo 'a-maintainer' ;;
      *' title '*) cat "$FAKE_GH/title" ;;
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

if [ "$(cat "$work/waits_for_the_checks_to_be_reported/calls")" -lt 3 ]; then
  failures=$((failures + 1))
  echo 'FAIL: the script lists the checks again until the four are reported'
fi

echo "$((total - failures)) of $total scenarios passed"
[ "$failures" -eq 0 ]
