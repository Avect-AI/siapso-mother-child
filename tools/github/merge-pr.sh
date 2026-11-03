#!/usr/bin/env sh
# SPDX-License-Identifier: MIT
# Squash-merges a pull request once every check is green, then deletes its
# branch. Replaces GitHub auto-merge, which the Free plan does not offer on
# private repositories.
# Usage: tools/github/merge-pr.sh <pr-number>
set -eu

PR="${1:?Usage: tools/github/merge-pr.sh <pr-number>}"

title="$(gh pr view "$PR" --json title --jq .title)"
if ! printf '%s\n' "$title" | sh "$(dirname "$0")/../hygiene/py.sh" "$(dirname "$0")/../hygiene/hygiene.py" title; then
  echo "Pull request $PR: title is not a valid Conventional Commits subject." >&2
  exit 1
fi

# Checks can take a few seconds to register after the pull request is opened.
tries=0
until [ "$(gh pr checks "$PR" --json name --jq 'length' 2>/dev/null || echo 0)" -gt 0 ]; do
  tries=$((tries + 1))
  if [ "$tries" -gt 30 ]; then
    echo "Pull request $PR: no check started." >&2
    exit 1
  fi
  sleep 5
done

# Waits until every check finishes; exits non-zero as soon as one fails.
gh pr checks "$PR" --watch --fail-fast --interval 10

not_green="$(gh pr checks "$PR" --json bucket --jq '[.[] | select(.bucket != "pass" and .bucket != "skipping")] | length')"
if [ "$not_green" -ne 0 ]; then
  echo "Pull request $PR: some checks are not green, not merging." >&2
  exit 1
fi

gh pr merge "$PR" --squash --delete-branch
echo "Pull request $PR squash-merged."
