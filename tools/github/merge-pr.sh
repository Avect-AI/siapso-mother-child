#!/usr/bin/env sh
# SPDX-License-Identifier: MIT
# Squash-merges a pull request once its required checks have run and passed,
# then deletes its branch. Replaces GitHub auto-merge, which the Free plan does
# not offer on private repositories.
#
# The four required checks must be reported and pass: a skipped, cancelled,
# failed, pending or missing one blocks the merge. Any other check must pass or
# be skipped. One exception: hygiene.yml skips the Developer Certificate of
# Origin job for Dependabot, so that check may be skipped on a pull request
# whose author is Dependabot (and only there); the three others must pass.
#
# A pull request whose branch is behind its base is refused, before the checks
# are read and again just before the merge (the base may move meanwhile): its
# checks did not run with the latest base, so a green run proves nothing about
# the merged result. The refusal says how to bring the branch up to date.
# Usage: tools/github/merge-pr.sh <pr-number>
# Tested by tools/github/merge-pr.test.sh (a fake gh on PATH).
set -eu

PR="${1:?Usage: tools/github/merge-pr.sh <pr-number>}"

# One check name per line: the jobs of .github/workflows/hygiene.yml and ci.yml.
REQUIRED_CHECKS='Text hygiene
Developer Certificate of Origin
Build and test
End-to-end'
# The required check that hygiene.yml skips for Dependabot.
DCO_CHECK='Developer Certificate of Origin'
# Checks can take a few seconds to register after the pull request is opened:
# wait up to WAIT_TRIES x WAIT_SECONDS for the required ones to be reported.
WAIT_TRIES="${MERGE_PR_WAIT_TRIES:-30}"
WAIT_SECONDS="${MERGE_PR_WAIT_SECONDS:-5}"
TAB="$(printf '\t')"

title="$(gh pr view "$PR" --json title --jq .title)"
if ! printf '%s\n' "$title" | sh "$(dirname "$0")/../hygiene/py.sh" "$(dirname "$0")/../hygiene/hygiene.py" title; then
  echo "Pull request $PR: title is not a valid Conventional Commits subject." >&2
  exit 1
fi

# Refuses the pull request when its branch is behind its base: GitHub says
# BEHIND, or the head commit lacks commits of the base (the comparison counts
# them; an answer that is not 0, an empty one included, is a refusal).
refuse_if_behind() {
  state="$(gh pr view "$PR" --json mergeStateStatus --jq .mergeStateStatus)"
  base="$(gh pr view "$PR" --json baseRefName --jq .baseRefName)"
  head="$(gh pr view "$PR" --json headRefOid --jq .headRefOid)"
  behind="$(gh api "repos/{owner}/{repo}/compare/$base...$head" --jq .behind_by)"
  if [ "$state" != 'BEHIND' ] && [ "$behind" = '0' ]; then return 0; fi
  branch="$(gh pr view "$PR" --json headRefName --jq .headRefName)"
  {
    echo "Pull request $PR: its branch $branch is behind $base, not merging."
    echo "Its checks did not run with the latest $base. Bring the branch up to date:"
    echo "  git fetch origin"
    echo "  git switch $branch"
    echo "  git merge --signoff origin/$base   (on a conflict: fix it, git add, git commit -s)"
    echo "  git push                           (a plain push, never a force-push)"
    echo "then wait until the checks of the new commit pass, and run this script again."
  } >&2
  exit 1
}

refuse_if_behind

# gh prints a GitHub App author as "app/<name>"; the REST API names the bot
# "dependabot[bot]". Neither "/" nor "[" can appear in the login of a person.
author="$(gh pr view "$PR" --json author --jq .author.login)"
case "$author" in
  'app/dependabot' | 'dependabot[bot]') dependabot=yes ;;
  *) dependabot=no ;;
esac

# The checks of the pull request, one per line: name, a tab, bucket (pass,
# fail, pending, skipping or cancel). gh exits non-zero while checks are
# pending; its output is still the listing.
list_checks() {
  gh pr checks "$PR" --json name,bucket --jq '.[] | [.name, .bucket] | @tsv' 2>/dev/null || true
}

# The buckets reported for the check named $2 in the listing $1, one per line.
buckets_of() {
  printf '%s\n' "$1" | awk -F "$TAB" -v name="$2" '$1 == name { print $2 }'
}

# The required checks absent from the listing $1, one per line.
missing_checks() {
  printf '%s\n' "$REQUIRED_CHECKS" | while IFS= read -r name; do
    if [ -z "$(buckets_of "$1" "$name")" ]; then printf '%s\n' "$name"; fi
  done
}

tries=0
while :; do
  missing="$(missing_checks "$(list_checks)")"
  if [ -z "$missing" ]; then break; fi
  tries=$((tries + 1))
  if [ "$tries" -gt "$WAIT_TRIES" ]; then
    echo "Pull request $PR: required checks never reported, not merging:" >&2
    printf '%s\n' "$missing" | sed 's/^/  /' >&2
    exit 1
  fi
  sleep "$WAIT_SECONDS"
done

# Waits until every check finishes; fails as soon as one fails.
if ! gh pr checks "$PR" --watch --fail-fast --interval 10; then
  echo "Pull request $PR: a check failed, not merging." >&2
  exit 1
fi

checks="$(list_checks)"
blocked="$(
  printf '%s\n' "$REQUIRED_CHECKS" | while IFS= read -r name; do
    buckets="$(buckets_of "$checks" "$name")"
    accepted='pass'
    if [ "$dependabot" = yes ] && [ "$name" = "$DCO_CHECK" ]; then accepted='pass|skipping'; fi
    if [ -z "$buckets" ]; then
      printf '  %s: missing\n' "$name"
    elif printf '%s\n' "$buckets" | grep -Evqx "$accepted"; then
      printf '  %s: %s\n' "$name" "$(printf '%s' "$buckets" | tr '\n' ' ')"
    fi
  done
  printf '%s\n' "$checks" | REQUIRED="$REQUIRED_CHECKS" awk -F "$TAB" '
    BEGIN { n = split(ENVIRON["REQUIRED"], names, "\n"); for (i = 1; i <= n; i++) need[names[i]] = 1 }
    $0 != "" && !($1 in need) && $2 != "pass" && $2 != "skipping" { printf "  %s: %s\n", $1, $2 }
  '
)"
if [ -n "$blocked" ]; then
  echo "Pull request $PR: some checks are not green, not merging:" >&2
  printf '%s\n' "$blocked" >&2
  exit 1
fi

# The base may have moved while the checks ran.
refuse_if_behind

# The squash commit carries the merging account's GitHub noreply address,
# never the address of the account (which a web merge would use unless
# "Keep my email addresses private" is on).
noreply="$(gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"')"
gh pr merge "$PR" --squash --delete-branch --author-email "$noreply"
echo "Pull request $PR squash-merged as $noreply."
